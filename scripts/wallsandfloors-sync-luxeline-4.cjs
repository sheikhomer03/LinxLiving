/**
 * Create the 4 LuxeLine fence panels that are live on the site but were never
 * pushed to Shopify, so they can be bought and their images served from Shopify.
 *
 * They are the merged three-colour products (Black / Walnut / Teak); the old
 * single-colour Shopify products holding 8 of their SKUs are ARCHIVED, so
 * creating these makes no live duplicate. Uses the site's own sync
 * (syncFullProductToShopify, as bb-sync-shopify.cjs does) and writes back only
 * what it returns: product/variant ids, handle, URL and the media pairing.
 * Each document is backed up first. Afterwards, wallsandfloors-move-images-to-shopify.cjs
 * swaps the remaining supplier URLs as for every other W&F product.
 *
 *   node scripts/wallsandfloors-sync-luxeline-4.cjs           # dry run
 *   node scripts/wallsandfloors-sync-luxeline-4.cjs --write
 */
require("tsx/cjs");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env.local"), quiet: true });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const { MongoClient, ObjectId, BSON } = require("mongodb");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

const WRITE = process.argv.includes("--write");
const IDS = ["6ab3b88453747b87fb838827", "6ab3b88453747b87fb838830", "6ab3b88453747b87fb83888b", "6ab3b88453747b87fb8388a3"];
const DIR = path.join(__dirname, "..", "image-audit", "wallsandfloors");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const say = (s = "") => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Record each media's CDN URL once Shopify has processed it. */
async function fillUrls(col, id) {
  for (let round = 0; round < 12; round++) {
    const p = await col.findOne({ _id: id });
    const d = await shopifyAdminRequest(
      `query($id: ID!) { product(id: $id) { media(first: 250) { nodes { id status ... on MediaImage { image { url } } } } } }`,
      { id: p.shopifyProductId },
    );
    const urls = {};
    for (const n of d.product?.media?.nodes || []) if (n.status === "READY" && n.image?.url) urls[n.id] = n.image.url;
    const shopifyImages = (p.shopifyImages || []).map((l) => ({ ...l, shopifyUrl: l.shopifyUrl || urls[l.mediaId] || "" }));
    const variants = (p.variants || []).map((v) => ({ ...v, shopifyImageUrl: (v.shopifyMediaId && urls[v.shopifyMediaId]) || v.shopifyImageUrl || "" }));
    await col.updateOne({ _id: id }, { $set: { shopifyImages, variants } });
    const missing = shopifyImages.filter((l) => !l.shopifyUrl).length;
    if (!missing) return 0;
    await sleep(10_000);
    if (round === 11) return missing;
  }
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URL2);
  await client.connect();
  const col = client.db().collection("products");
  const docs = await col.find({ _id: { $in: IDS.map((i) => new ObjectId(i)) } }).toArray();
  say(`${WRITE ? "WRITE" : "DRY RUN"}: ${docs.length} products`);

  for (const p of docs) {
    if (p.shopifyProductId) {
      say(`  skip (already in Shopify): ${p.name}`);
      continue;
    }
    const price = Math.max(Number(p.price) || 0, ...(p.variants || []).map((v) => Number(v.price) || 0));
    say(`\n${p.name}`);
    say(`  category ${p.category} | price ${price} | variants ${(p.variants || []).length} (${(p.variants || []).map((v) => `${v.option1} ${v.sku} £${v.price}`).join(", ")})`);
    say(`  images to send: ${(p.images || []).length} gallery + ${(p.variants || []).length} variant images | status will be ${price > 0 && p.category ? "ACTIVE" : "DRAFT"}`);
    if (!WRITE) continue;

    fs.appendFileSync(path.join(DIR, `backup-luxeline-sync-${STAMP}.ejson.jsonl`), `${BSON.EJSON.stringify(p, { relaxed: false })}\n`);
    // Fake pairs (supplier URL in shopifyUrl, no media) carry nothing the sync can reuse.
    p.shopifyImages = (p.shopifyImages || []).filter((l) => /cdn\.shopify\.com/.test(l.shopifyUrl || "") && l.mediaId);
    try {
      const report = await syncFullProductToShopify(p, "Walls and Floors");
      await col.updateOne(
        { _id: p._id, shopifyProductId: { $in: [null, ""] } },
        {
          $set: {
            shopifyProductId: p.shopifyProductId,
            shopifyVariantId: p.shopifyVariantId,
            shopifyImages: p.shopifyImages || [],
            shopifyHandle: p.shopifyHandle || "",
            shopifyProductUrl: p.shopifyProductUrl || "",
            variants: p.variants,
            shopifySyncedAt: new Date(),
            shopifySyncError: report.warnings.length ? report.warnings.join(" | ").slice(0, 1000) : null,
          },
        },
      );
      say(`  ✓ created ${report.productId} [${report.status}] — ${report.variantsLinked}/${report.variantsTotal} variants linked, ${report.images} images${report.warnings.length ? " — WARN " + report.warnings.join(" | ") : ""}`);
      const missing = await fillUrls(col, p._id);
      say(`  image URLs: ${missing ? missing + " still processing" : "all ready"}`);
    } catch (e) {
      await col.updateOne({ _id: p._id }, { $set: { shopifySyncError: String(e.message || e).slice(0, 1000) } });
      say(`  ✗ ${String(e.message || e).slice(0, 300)}`);
    }
  }
  await client.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
