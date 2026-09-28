/**
 * Final read-only check of the Bathdisc import (DB2 + Shopify).
 *
 *  - DB2: every Bathdisc product and variant linked to Shopify, every image on
 *    OUR store's Shopify CDN (not Bathdisc's), no £0 price, other data unchanged
 *  - Shopify: Bathdisc product count, every one DRAFT, sampled prices/options
 *    matching the database, brand still inactive
 *
 *   node scripts/bathdisc-final-check.cjs
 */
require("tsx/cjs");
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

const OUR_CDN = /cdn\.shopify\.com\/s\/files\/1\/1053\/8385\/4344\//;
const PROGRESS = path.join(__dirname, "../.scratch/bathdisc/v2/progress.log");
const log = (m) => { const line = `[${new Date().toISOString()}] CHECK ${m}`; console.log(line); fs.appendFileSync(PROGRESS, line + "\n"); };

async function main() {
  const c1 = new MongoClient(process.env.MONGODB_URI);
  const c2 = new MongoClient(process.env.MONGODB_URL2);
  await Promise.all([c1.connect(), c2.connect()]);
  const col = c2.db().collection("products");
  const q = { "specs.source": "bathdisc-scrape" };
  const rows = await col.find(q, { projection: { name: 1, price: 1, images: 1, variants: 1, shopifyProductId: 1, department: 1, category: 1, subCategory: 1 } }).sort({ _id: 1 }).toArray();

  const r = {
    products: rows.length,
    variants: rows.reduce((n, p) => n + p.variants.length, 0),
    productsNotInShopify: rows.filter((p) => !p.shopifyProductId).length,
    variantsNotLinked: rows.reduce((n, p) => n + p.variants.filter((v) => !v.shopifyVariantId).length, 0),
    productsWithoutImages: rows.filter((p) => !(p.images || []).length).length,
    productImagesNotOnOurShopify: rows.reduce((n, p) => n + (p.images || []).filter((u) => !OUR_CDN.test(u)).length, 0),
    variantImagesNotOnOurShopify: rows.reduce((n, p) => n + p.variants.filter((v) => !OUR_CDN.test(v.imageUrl || "")).length, 0),
    zeroPriceVariants: rows.reduce((n, p) => n + p.variants.filter((v) => !(v.price > 0)).length, 0),
    duplicates: rows.length - new Set(rows.map((p) => String(p._id))).size,
    otherDb2Products: (await col.countDocuments()) - rows.length,
    bathdiscInDb1: await c1.db().collection("products").countDocuments(q),
    brand: await c1.db().collection("brands").findOne({ slug: "bathdisc" }, { projection: { name: 1, isActive: 1, dataCluster: 1 } }),
  };
  log(`DB2: ${JSON.stringify(r)}`);

  // Shopify: count and status of every Bathdisc product
  const statuses = {};
  let after = null, count = 0;
  do {
    const d = await shopifyAdminRequest(`query($a:String){products(first:250,after:$a,query:"vendor:Bathdisc"){pageInfo{hasNextPage endCursor} nodes{status}}}`, { a: after });
    for (const n of d.products.nodes) { statuses[n.status] = (statuses[n.status] || 0) + 1; count++; }
    after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    if (count % 1000 < 250) log(`Shopify count so far: ${count}`);
  } while (after);
  log(`Shopify: ${count} Bathdisc products, by status ${JSON.stringify(statuses)}`);

  // sampled deep check: every variant price in Shopify equals the database
  const sample = [...rows].sort(() => Math.random() - 0.5).slice(0, 60);
  let checked = 0, mismatches = [];
  for (const p of sample) {
    const d = await shopifyAdminRequest(`query($id:ID!){product(id:$id){status variants(first:250){nodes{id price}} media(first:1){nodes{id}}}}`, { id: p.shopifyProductId });
    const byId = new Map((d.product?.variants?.nodes || []).map((v) => [v.id, Number(v.price)]));
    for (const v of p.variants) {
      checked++;
      const sp = byId.get(v.shopifyVariantId);
      if (sp == null || Math.abs(sp - v.price) > 0.005) mismatches.push(`${p.name} / ${v.name}: db £${v.price} vs Shopify £${sp}`);
    }
    if (!d.product?.media?.nodes?.length) mismatches.push(`${p.name}: no media in Shopify`);
    if (d.product?.status !== "DRAFT") mismatches.push(`${p.name}: status ${d.product?.status}`);
  }
  log(`sample: ${sample.length} products / ${checked} variants checked in Shopify, ${mismatches.length} problems ${JSON.stringify(mismatches.slice(0, 10))}`);
  await Promise.all([c1.close(), c2.close()]);
  process.exit(0);
}

main().catch((e) => { log(`ERROR ${e.message}`); process.exit(1); });
