/**
 * Re-point variant rows that were linked to the wrong Shopify variant.
 *
 * Bathdisc and FAKRO reuse one SKU across several options ("Matt Black" and
 * "Gunmetal" both Bottle-Trap_Matt Black), and the link was made by SKU, so
 * several rows share the first variant's GID and checkout bills that option.
 * Shopify itself holds a distinct variant per option, titled like the row.
 *
 * For every storefront-visible product whose rows share a GID, each row is
 * matched to the Shopify variant on the same product whose title equals the
 * row's label (options joined " / ", else its name). A row is changed only
 * when exactly one variant has that title and no other row is given it.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/relink-variants-by-title.cjs            # dry run
 *   APPLY=1 node --require ./scripts/mongo-dns.cjs scripts/relink-variants-by-title.cjs    # write + rollback
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.env.APPLY === "1";
const ROOT = path.join(__dirname, "..");
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const label = (v) => {
  const opts = [v.option1, v.option2, v.option3].map((o) => String(o ?? "").trim()).filter(Boolean);
  return opts.length ? opts.join(" / ") : String(v.name || v.title || "");
};

async function main() {
  const { register } = require("tsx/cjs/api");
  register();
  const mongoose = require("mongoose");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
  const { storefrontVisibilityClause } = require("../src/lib/pricedOnly.ts");
  const { HIDDEN_BRAND_SLUGS } = require("../src/lib/hiddenBrands.ts");
  const { connectMongo, applyDns } = require("./mongo-connect.cjs");

  const primary = await connectMongo(process.env.MONGODB_URI);
  applyDns();
  const secondary = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 }).asPromise();
  const conns = { primary, secondary };

  const brands = await primary.db.collection("brands").find({}).project({ name: 1, slug: 1, isActive: 1 }).toArray();
  const brandName = new Map(brands.map((b) => [String(b._id), b.name]));
  const hidden = brands.filter((b) => b.isActive === false || HIDDEN_BRAND_SLUGS.includes(String(b.slug || "").toLowerCase())).map((b) => b._id);
  const filter = {
    $and: [
      { category: { $exists: true, $nin: [null, ""] } },
      storefrontVisibilityClause(),
      ...(hidden.length ? [{ brand: { $nin: hidden } }] : []),
      { shopifyProductId: { $regex: /^gid:\/\/shopify\/Product\/\d+$/ } },
      { "variants.1": { $exists: true } },
    ],
  };

  const candidates = [];
  for (const [cluster, conn] of Object.entries(conns)) {
    const cur = conn.db.collection("products").find(filter).project({ name: 1, brand: 1, shopifyProductId: 1, variants: 1 });
    for await (const p of cur) {
      const gids = (p.variants || []).map((v) => v.shopifyVariantId).filter(Boolean);
      if (new Set(gids).size < gids.length) candidates.push({ ...p, _cluster: cluster });
    }
  }
  console.log(`products with rows sharing a Shopify variant: ${candidates.length}`);

  const changes = [];
  const unresolved = [];
  for (const p of candidates) {
    const d = await shopifyAdminRequest(
      `query($id:ID!){product(id:$id){variants(first:250){nodes{id title}}}}`,
      { id: p.shopifyProductId },
    );
    const svs = d.product?.variants?.nodes || [];
    const byTitle = new Map();
    for (const sv of svs) {
      const k = norm(sv.title);
      byTitle.set(k, byTitle.has(k) ? null : sv.id); // null = title not unique
    }
    const proposed = (p.variants || []).map((v) => {
      const hit = byTitle.get(norm(label(v)));
      return hit || null;
    });
    // Every row must resolve, and to distinct variants, or the product is left alone.
    const resolved = proposed.filter(Boolean);
    if (resolved.length !== proposed.length || new Set(resolved).size !== resolved.length) {
      unresolved.push({ brand: brandName.get(String(p.brand)) || "?", name: p.name, rows: proposed.length, matched: resolved.length });
      continue;
    }
    p.variants.forEach((v, i) => {
      if (v.shopifyVariantId !== proposed[i]) {
        changes.push({
          cluster: p._cluster, mongoId: String(p._id), brand: brandName.get(String(p.brand)) || "?", name: p.name,
          row: i, label: label(v), from: v.shopifyVariantId || "", to: proposed[i],
        });
      }
    });
  }

  const byBrand = {};
  for (const c of changes) byBrand[c.brand] = (byBrand[c.brand] || 0) + 1;
  console.log(JSON.stringify({
    mode: APPLY ? "APPLY" : "DRY RUN",
    rowsToRelink: changes.length,
    products: new Set(changes.map((c) => c.mongoId)).size,
    byBrand,
    leftAlone: unresolved.length,
    leftAloneSample: unresolved.slice(0, 5),
    sample: changes.slice(0, 6).map((c) => `${c.brand} | ${c.name} | "${c.label}" ${c.from.slice(-6)} → ${c.to.slice(-6)}`),
  }, null, 2));

  if (APPLY && changes.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rollback = path.join(ROOT, `rollback-relink-variants-by-title-${stamp}.json`);
    fs.writeFileSync(rollback, JSON.stringify(changes.map((c) => ({ cluster: c.cluster, mongoId: c.mongoId, row: c.row, previous: c.from })), null, 2));
    console.log(`rollback: ${rollback}`);
    let ok = 0;
    for (const c of changes) {
      const r = await conns[c.cluster].db.collection("products").updateOne(
        { _id: new mongoose.Types.ObjectId(c.mongoId), [`variants.${c.row}.shopifyVariantId`]: c.from },
        { $set: { [`variants.${c.row}.shopifyVariantId`]: c.to } },
      );
      if (r.modifiedCount === 1) ok++;
    }
    console.log(`applied: ${ok} / ${changes.length} rows re-linked`);
  }

  await primary.close();
  await secondary.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
