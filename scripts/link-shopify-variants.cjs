/**
 * Link Mongo variant rows that carry no `shopifyVariantId` to the Shopify
 * variant that already exists for them, so checkout can sell them.
 *
 * Only empty links are filled. Nothing is created or deleted on Shopify, and
 * a row that already has a GID is never touched. Every match is validated;
 * anything ambiguous is reported, not guessed.
 *
 * Strategies, tried in order per row:
 *   sku        Shopify variant on the same product with the same SKU (unique),
 *              whose title agrees with the row's options/name.
 *   merged     Shopify SKU "MERGED-V<n>" ↔ row n (1-based) — how the merged
 *              ranges were pushed — and the title contains every option value.
 *   single     Product has no option picker on the page and Shopify holds one
 *              variant, which is the product's own GID: the row priced like
 *              the page is linked to it, so checkout charges the shown price.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/link-shopify-variants.cjs            # dry run
 *   APPLY=1 node --require ./scripts/mongo-dns.cjs scripts/link-shopify-variants.cjs    # write + rollback file
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.env.APPLY === "1";
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "scratch");
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const hasGid = (v) => /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(String(v?.shopifyVariantId || ""));

function rowOptions(v) {
  return [v.option1, v.option2, v.option3].map((o) => String(o ?? "").trim()).filter(Boolean);
}

/** Does a Shopify variant title describe this row? */
function titleAgrees(row, title) {
  const t = norm(title);
  const opts = rowOptions(row);
  if (opts.length) return opts.every((o) => t.includes(norm(o)));
  const label = norm(row.name || row.title);
  return label ? t === label || t.includes(label) || label.includes(t) : true;
}

/**
 * Looser test for the merged ranges, whose Shopify titles carry a shortened
 * size ("10cm" for "10cm x 20cm"): every word of the title, placeholders
 * aside, must appear in the row's name or option values.
 */
const PLACEHOLDER = /^(default (size|colou?r|title)|variant \d+)$/i;
function titleWordsInRow(row, title) {
  const segments = String(title || "").split("/").map((s) => s.trim()).filter((s) => s && !PLACEHOLDER.test(s));
  if (!segments.length) return false;
  const hay = norm([row.name, row.title, ...rowOptions(row)].filter(Boolean).join(" "));
  return segments.every((seg) => norm(seg).split(" ").every((w) => w && hay.includes(w)));
}

function pickerAxes(p) {
  return (p.shopifyOptions || []).filter(
    (a) => a?.name && !/^title$/i.test(String(a.name)) && (a.values || []).length > 0,
  );
}

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
  const secondary = process.env.MONGODB_URL2
    ? await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 }).asPromise()
    : null;
  const conns = { primary, secondary };

  const brands = await primary.db.collection("brands").find({}).project({ name: 1, slug: 1, isActive: 1 }).toArray();
  const brandName = new Map(brands.map((b) => [String(b._id), b.name]));
  const hidden = brands
    .filter((b) => b.isActive === false || HIDDEN_BRAND_SLUGS.includes(String(b.slug || "").toLowerCase()))
    .map((b) => b._id);
  const filter = {
    $and: [
      { category: { $exists: true, $nin: [null, ""] } },
      storefrontVisibilityClause(),
      ...(hidden.length ? [{ brand: { $nin: hidden } }] : []),
      { shopifyProductId: { $regex: /^gid:\/\/shopify\/Product\/\d+$/ } },
      { variants: { $elemMatch: { $or: [{ shopifyVariantId: { $in: [null, ""] } }, { shopifyVariantId: { $exists: false } }] } } },
    ],
  };
  const projection = { name: 1, brand: 1, price: 1, shopifyProductId: 1, shopifyVariantId: 1, shopifyOptions: 1, variants: 1 };

  const products = [];
  for (const [cluster, conn] of Object.entries(conns)) {
    if (!conn) continue;
    const rows = await conn.db.collection("products").find(filter).project(projection).toArray();
    for (const r of rows) products.push({ ...r, _cluster: cluster });
    console.log(`${cluster}: ${rows.length} visible products with unlinked rows`);
  }

  // Shopify variants for each product, 5 products per request.
  const shop = new Map();
  for (let i = 0; i < products.length; i += 5) {
    const ids = products.slice(i, i + 5).map((p) => p.shopifyProductId);
    const d = await shopifyAdminRequest(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product {
         id status
         variants(first: 250) { pageInfo { hasNextPage } nodes { id sku title price } }
       } } }`,
      { ids },
    );
    for (const n of d.nodes || []) if (n?.id) shop.set(n.id, n);
    if ((i / 5) % 100 === 0) console.log(`  shopify ${Math.min(i + 5, products.length)}/${products.length}`);
  }

  // Every GID already stored anywhere in the catalogue must stay unique.
  const claimedGlobal = new Set();
  for (const conn of Object.values(conns)) {
    if (!conn) continue;
    const cur = conn.db.collection("products").find({ "variants.shopifyVariantId": { $regex: /^gid:/ } }).project({ "variants.shopifyVariantId": 1 });
    for await (const d of cur) for (const v of d.variants || []) if (hasGid(v)) claimedGlobal.add(v.shopifyVariantId);
  }

  const links = [];
  const unmatched = [];
  const stats = {};
  const bump = (k) => (stats[k] = (stats[k] || 0) + 1);

  for (const p of products) {
    const brand = brandName.get(String(p.brand)) || "?";
    const sp = shop.get(p.shopifyProductId);
    const rows = p.variants || [];
    const note = (idx, reason) => {
      unmatched.push({ brand, cluster: p._cluster, mongoId: String(p._id), name: p.name, row: idx, sku: rows[idx]?.sku || "", label: rows[idx]?.name || rows[idx]?.title || "", reason });
      bump(`unmatched:${reason.replace(/ \(".*"\)$/, "")}`);
    };
    if (!sp) { rows.forEach((v, i) => !hasGid(v) && note(i, "shopify product not found")); continue; }
    if (sp.variants.pageInfo.hasNextPage) { rows.forEach((v, i) => !hasGid(v) && note(i, "shopify product has >250 variants")); continue; }

    const svs = sp.variants.nodes;
    const used = new Set(rows.filter(hasGid).map((v) => v.shopifyVariantId));
    const take = (idx, sv, strategy) => {
      used.add(sv.id);
      claimedGlobal.add(sv.id);
      links.push({ brand, cluster: p._cluster, mongoId: String(p._id), name: p.name, row: idx, sku: rows[idx].sku || "", label: rows[idx].name || rows[idx].title || "", variantId: sv.id, shopifyTitle: sv.title, shopifySku: sv.sku, strategy });
      bump(`linked:${strategy}`);
    };
    const free = (sv) => !used.has(sv.id) && !claimedGlobal.has(sv.id);

    // single — no picker on the page, one Shopify variant, nothing linked yet
    const noPicker = pickerAxes(p).length === 0;
    if (noPicker && svs.length === 1 && !rows.some(hasGid)) {
      const sv = svs[0];
      if (String(p.shopifyVariantId || "") !== sv.id) { note(0, "single: product GID is not the Shopify variant"); continue; }
      const idx = rows.findIndex((v) => Math.abs((Number(v.price) || 0) - Number(p.price)) < 0.005);
      if (idx < 0) { note(0, "single: no row priced like the page"); continue; }
      if (!free(sv)) { note(idx, "single: shopify variant already linked elsewhere"); continue; }
      take(idx, sv, "single");
      continue;
    }

    rows.forEach((row, idx) => {
      if (hasGid(row)) return;
      // sku
      const sku = norm(row.sku);
      if (sku) {
        const hits = svs.filter((sv) => norm(sv.sku) === sku);
        if (hits.length === 1) {
          if (!free(hits[0])) return note(idx, "sku: shopify variant already linked to another row");
          if (titleAgrees(row, hits[0].title)) return take(idx, hits[0], "sku");
          if (titleWordsInRow(row, hits[0].title)) return take(idx, hits[0], "sku+short-title");
          return note(idx, `sku: title disagrees ("${hits[0].title}")`);
        }
        if (hits.length > 1) return note(idx, "sku: several shopify variants share it");
      }
      // merged
      const merged = svs.find((sv) => String(sv.sku || "").trim() === `MERGED-V${idx + 1}`);
      if (merged) {
        if (!free(merged)) return note(idx, "merged: shopify variant already linked");
        if (titleAgrees(row, merged.title)) return take(idx, merged, "merged");
        if (titleWordsInRow(row, merged.title)) {
          // The short title must describe this row and no other one.
          // When the short title fits several rows, the position is what
          // decides — MERGED-V<n> was pushed from row n — and the title still
          // has to fit, so two independent signals agree.
          const alsoFits = rows.some((other, j) => j !== idx && titleWordsInRow(other, merged.title));
          return take(idx, merged, alsoFits ? "merged+position-tiebreak" : "merged+short-title");
        }
        return note(idx, `merged: title disagrees ("${merged.title}")`);
      }
      note(idx, noPicker ? "no picker; shopify has several variants and none matched" : "no matching shopify variant (would need creating)");
    });
  }

  const byBrand = {};
  for (const l of links) byBrand[l.brand] = (byBrand[l.brand] || 0) + 1;
  const unByBrand = {};
  for (const u of unmatched) unByBrand[u.brand] = (unByBrand[u.brand] || 0) + 1;
  const summary = {
    mode: APPLY ? "APPLY" : "DRY RUN",
    productsScanned: products.length,
    rowsToLink: links.length,
    productsTouched: new Set(links.map((l) => l.mongoId)).size,
    stats,
    linksByBrand: byBrand,
    unmatchedByBrand: unByBrand,
    sample: links.filter((_, i) => i % Math.max(1, Math.floor(links.length / 10)) === 0).slice(0, 10)
      .map((l) => `${l.strategy} | ${l.brand} | ${l.name} | row "${l.label || l.sku}" → "${l.shopifyTitle}"`),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const planFile = path.join(OUT_DIR, `variant-link-plan-${stamp}.json`);
  fs.writeFileSync(planFile, JSON.stringify({ summary, links, unmatched }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`plan: ${planFile}`);

  if (APPLY && links.length) {
    const rollback = path.join(ROOT, `rollback-link-shopify-variants-${stamp}.json`);
    fs.writeFileSync(rollback, JSON.stringify(links.map((l) => ({ cluster: l.cluster, mongoId: l.mongoId, row: l.row, sku: l.sku, previous: "" })), null, 2));
    console.log(`rollback: ${rollback}`);

    let ok = 0;
    const failed = [];
    for (const l of links) {
      const col = conns[l.cluster].db.collection("products");
      const _id = new mongoose.Types.ObjectId(l.mongoId);
      // Guard: the row is still the same row and still unlinked.
      const guard = {
        _id,
        [`variants.${l.row}.sku`]: l.sku ? l.sku : { $in: [null, ""] },
        $or: [
          { [`variants.${l.row}.shopifyVariantId`]: { $in: [null, ""] } },
          { [`variants.${l.row}.shopifyVariantId`]: { $exists: false } },
        ],
      };
      const r = await col.updateOne(guard, { $set: { [`variants.${l.row}.shopifyVariantId`]: l.variantId } });
      if (r.modifiedCount === 1) ok++;
      else failed.push({ ...l, reason: "guard did not match (row changed since dry run)" });
    }
    console.log(`applied: ${ok} rows linked · skipped: ${failed.length}`);
    if (failed.length) fs.writeFileSync(path.join(OUT_DIR, `variant-link-skipped-${stamp}.json`), JSON.stringify(failed, null, 2));
  }

  await primary.close();
  if (secondary) await secondary.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
