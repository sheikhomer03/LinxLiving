/**
 * Re-attach option (variant) photos for Bathdisc products where Shopify
 * rejected the batch with "Duplicated input value" — several options share
 * one photo, and Shopify refuses the same media twice in one bulk call. Each
 * option's photo is attached in its own call instead.
 *
 * Touches only Bathdisc products (specs.source = "bathdisc-scrape", DB2) whose
 * sync recorded that warning. Clears the warning once every option is attached.
 *
 *   node scripts/bathdisc-fix-variant-images.cjs
 */
require("tsx/cjs");
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

const TAG = "bathdisc-scrape";
const PROGRESS = path.join(__dirname, "../.scratch/bathdisc/v2/progress.log");
const log = (m) => { const line = `[${new Date().toISOString()}] FIX-IMAGES ${m}`; console.log(line); fs.appendFileSync(PROGRESS, line + "\n"); };

async function main() {
  const client = new MongoClient(process.env.MONGODB_URL2);
  await client.connect();
  const col = client.db().collection("products");
  const rows = await col.find({ "specs.source": TAG, shopifySyncError: /Duplicated input value/ }).toArray();
  log(`${rows.length} products to repair`);
  let attached = 0, failed = 0, done = 0;
  for (const p of rows) {
    const mediaBySource = new Map((p.shopifyImages || []).map((im) => [im.sourceUrl, im]));
    const errors = [];
    for (const v of p.variants || []) {
      const media = v.shopifyMediaId ? { mediaId: v.shopifyMediaId } : mediaBySource.get(String(v.imageUrl || "").trim());
      if (!v.shopifyVariantId || !media?.mediaId) continue;
      const d = await shopifyAdminRequest(
        `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { message } } }`,
        { productId: p.shopifyProductId, variants: [{ id: v.shopifyVariantId, mediaId: media.mediaId }] },
      );
      const errs = d.productVariantsBulkUpdate.userErrors || [];
      if (errs.length) { errors.push(errs.map((e) => e.message).join("; ")); failed++; } else attached++;
    }
    await col.updateOne({ _id: p._id, "specs.source": TAG }, { $set: { shopifySyncError: errors.length ? errors.join(" | ").slice(0, 1000) : null } });
    done++;
    if (done % 10 === 0 || done === rows.length) log(`${done}/${rows.length} products repaired (${attached} option photos attached, ${failed} failed)`);
  }
  log(`DONE: ${attached} option photos attached, ${failed} failed`);
  await client.close();
  process.exit(0);
}

main().catch((e) => { log(`ERROR ${e.message}`); process.exit(1); });
