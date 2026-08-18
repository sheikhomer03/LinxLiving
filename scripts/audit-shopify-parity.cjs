/**
 * Does Shopify hold the same catalogue Mongo does?
 *
 * "Synced" has meant several things over this migration — a product existing,
 * an id being stored, a variant carrying a GID — none of which prove the two
 * sides agree. This compares them field by field on a sample large enough to
 * trust, and counts the structural facts exactly across the whole catalogue.
 *
 * Checked per product: title, vendor, product type, status, description
 * presence, the Linx metafields, media, and every variant by price and SKU.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-shopify-parity.cjs
 *   SAMPLE=400   products to compare field by field (0 = structural counts only)
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const SAMPLE = Number(process.env.SAMPLE ?? 400);
const money = (v) => Math.round(Number(v || 0) * 100) / 100;
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(2)}%` : "n/a");

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const col = db.collection("products");
  const brands = await db.collection("brands").find({}).project({ name: 1 }).toArray();
  const brandName = new Map(brands.map((b) => [String(b._id), b.name]));

  // ------------------------------------------------ structural, whole catalogue
  console.log("=== VARIANT COVERAGE (exact, whole catalogue) ===");
  const [v] = await col
    .aggregate(
      [
        { $match: { "variants.0": { $exists: true } } },
        { $unwind: "$variants" },
        {
          $group: {
            _id: null,
            variants: { $sum: 1 },
            withGid: {
              $sum: {
                $cond: [{ $ne: [{ $ifNull: ["$variants.shopifyVariantId", ""] }, ""] }, 1, 0],
              },
            },
            withInv: {
              $sum: {
                $cond: [
                  { $ne: [{ $ifNull: ["$variants.shopifyInventoryItemId", ""] }, ""] },
                  1,
                  0,
                ],
              },
            },
            priced: {
              $sum: { $cond: [{ $gt: [{ $ifNull: ["$variants.price", 0] }, 0] }, 1, 0] },
            },
          },
        },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  console.log(`  variants in Mongo        ${v.variants}`);
  console.log(`  with a Shopify GID       ${v.withGid}  (${pct(v.withGid, v.variants)})`);
  console.log(`  with an inventory item   ${v.withInv}  (${pct(v.withInv, v.variants)})`);
  console.log(`  priced                   ${v.priced}`);
  const withVariants = await col.countDocuments({ "variants.0": { $exists: true } });
  const multi = await col.countDocuments({ "variants.1": { $exists: true } });
  console.log(`  products with variants   ${withVariants} (${multi} with 2 or more)`);

  if (SAMPLE <= 0) {
    await mongoose.disconnect();
    unregister();
    return;
  }

  // ---------------------------------------------------------- field comparison
  console.log(`\n=== FIELD-BY-FIELD PARITY (${SAMPLE} products) ===`);
  const sample = await col
    .aggregate([
      { $match: { shopifyProductId: { $nin: [null, ""] } } },
      { $sample: { size: SAMPLE } },
    ])
    .toArray();

  const issues = new Map();
  const note = (kind) => issues.set(kind, (issues.get(kind) || 0) + 1);
  const examples = [];

  let checked = 0;
  let variantsCompared = 0;
  let variantsMatched = 0;

  for (let i = 0; i < sample.length; i += 20) {
    const chunk = sample.slice(i, i + 20);
    const d = await shopifyAdminRequest(
      `query($ids: [ID!]!) {
        nodes(ids: $ids) {
          id
          ... on Product {
            title vendor productType status descriptionHtml tags
            media(first: 1) { nodes { id } }
            metafields(first: 20, namespace: "linx") { nodes { key } }
            variants(first: 250) {
              nodes { id title price sku inventoryQuantity }
            }
          }
        }
      }`,
      { ids: chunk.map((c) => c.shopifyProductId) },
    );
    const live = new Map((d.nodes || []).filter(Boolean).map((n) => [n.id, n]));

    for (const p of chunk) {
      const sp = live.get(p.shopifyProductId);
      if (!sp) {
        note("product-not-on-shopify");
        continue;
      }
      checked += 1;

      const title = String(p.name || "").trim();
      const spTitle = String(sp.title || "").trim();
      // A title over 255 chars is deliberately truncated on the way out.
      if (spTitle !== title && !title.startsWith(spTitle.replace(/…$/, "").slice(0, 60))) {
        note("title-differs");
        if (examples.length < 8) {
          examples.push(`title: "${title.slice(0, 38)}" vs "${spTitle.slice(0, 38)}"`);
        }
      }

      const wantVendor = brandName.get(String(p.brand)) || "Linx Square";
      if (String(sp.vendor || "") !== wantVendor) note("vendor-differs");
      if (String(sp.productType || "") !== String(p.category || "")) note("producttype-differs");

      const wantStatus =
        Number(p.price) > 0 && String(p.category || "").trim() ? "ACTIVE" : "DRAFT";
      if (sp.status !== wantStatus) {
        note("status-differs");
        if (examples.length < 8) {
          examples.push(
            `status: ${String(p.name).slice(0, 28)} £${p.price} -> ${sp.status}, expected ${wantStatus}`,
          );
        }
      }

      if (p.description && !String(sp.descriptionHtml || "").trim()) {
        note("description-empty-on-shopify");
      }
      if ((p.images || []).some((x) => /^https?:/i.test(x)) && !sp.media.nodes.length) {
        note("no-media-on-shopify");
      }

      const keys = new Set((sp.metafields?.nodes || []).map((m) => m.key));
      if (p.specs && Object.keys(p.specs).length && !keys.has("specs")) {
        note("specs-metafield-missing");
      }
      if (p.tagline && !keys.has("tagline")) note("tagline-metafield-missing");

      const mv = (p.variants || []).filter((x) => Number(x.price) > 0);
      const sv = sp.variants.nodes;

      if (mv.length >= 2 && sv.length < mv.length) {
        note("fewer-variants-on-shopify");
        if (examples.length < 8) {
          examples.push(
            `variants: ${String(p.name).slice(0, 32)} mongo ${mv.length} vs shopify ${sv.length}`,
          );
        }
      }

      for (const row of mv) {
        variantsCompared += 1;
        const gid = String(row.shopifyVariantId || "");
        const hit = gid ? sv.find((s) => s.id === gid) : null;
        if (!hit) {
          note("variant-gid-not-on-shopify");
          continue;
        }
        if (money(hit.price) !== money(row.price)) {
          note("variant-price-differs");
          if (examples.length < 8) {
            examples.push(
              `price: ${String(p.name).slice(0, 26)} / ${String(row.name).slice(0, 18)} mongo £${row.price} vs shopify £${hit.price}`,
            );
          }
          continue;
        }
        if (row.sku && String(hit.sku || "") !== String(row.sku)) {
          note("variant-sku-differs");
          continue;
        }
        variantsMatched += 1;
      }

      // Single-variant products carry their price on the product-level variant.
      if (!mv.length && Number(p.price) > 0 && sv.length) {
        variantsCompared += 1;
        if (money(sv[0].price) === money(p.price)) variantsMatched += 1;
        else {
          note("product-price-differs");
          if (examples.length < 8) {
            examples.push(
              `price: ${String(p.name).slice(0, 30)} mongo £${p.price} vs shopify £${sv[0].price}`,
            );
          }
        }
      }
    }
    process.stdout.write(`\r  compared ${Math.min(i + 20, sample.length)}/${sample.length}      `);
  }
  console.log("");

  console.log(`\nproducts compared       ${checked}/${sample.length}`);
  console.log(
    `variant prices matched  ${variantsMatched}/${variantsCompared}  (${pct(variantsMatched, variantsCompared)})`,
  );
  console.log("\ndiscrepancies:");
  if (!issues.size) console.log("   none — every field checked agrees");
  for (const [k, n] of [...issues].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(5)}  ${k}`);
  }
  if (examples.length) {
    console.log("\nexamples:");
    for (const e of examples) console.log(`   ${e}`);
  }

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
