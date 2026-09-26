/**
 * Push the imported Topps Tiles products (DB1, specs.source = "topps-scrape")
 * to Shopify as DRAFT — options, every variant at its own price, stock,
 * gallery and per-variant images — and save back what Shopify returns:
 * product and variant ids, inventory items, handle and URL, and the media
 * pairing for each image. Without that write-back a variant cannot be added
 * to the cart.
 *
 * Only products carrying the topps-scrape tag are read or written. Resumable:
 * products already fully linked are skipped unless --all.
 *
 *   node scripts/topps-sync-shopify.cjs [--limit=N] [--only=text] [--all] [--concurrency=2]
 *   node scripts/topps-sync-shopify.cjs --fill-images      (Shopify CDN URLs, then rewrite images[])
 */
require("tsx/cjs");
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

const TAG = "topps-scrape";
const VENDOR = "Topps Tiles";
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").slice(k.length + 3);
const LIMIT = Number(arg("limit")) || Infinity;
const ONLY = arg("only").toLowerCase();
const ALL = process.argv.includes("--all");
const CONCURRENCY = Number(arg("concurrency")) || 2;
const LOG = path.join(__dirname, "../.scratch/toppstiles/v2/shopify-sync.log");
const log = (m) => { const line = `[${new Date().toISOString()}] ${m}`; console.log(line); fs.appendFileSync(LOG, line + "\n"); };

const fullyLinked = (p) =>
  p.shopifyProductId && (p.variants || []).every((v) => v.shopifyVariantId) && ((p.images || []).length === 0 || (p.shopifyImages || []).length > 0);

/**
 * Shopify processes uploaded media after the mutation returns, so a fresh
 * image has no CDN URL at sync time. Once media is READY, record each URL on
 * the gallery pairing and on the variant, then point images[] (product and
 * variant) at the Shopify copies — no supplier URLs left behind.
 */
async function fillImageUrls(col, rounds = 8) {
  for (let round = 1; round <= rounds; round++) {
    const rows = await col.find({ "specs.source": TAG, shopifyProductId: { $nin: [null, ""] } }).toArray();
    let pending = 0;
    for (const p of rows) {
      const incomplete = (p.shopifyImages || []).some((im) => !im.shopifyUrl) ||
        (p.images || []).some((u) => !/cdn\.shopify\.com/.test(u));
      if (!incomplete) continue;
      const urls = {};
      let after = null;
      do {
        const d = await shopifyAdminRequest(`query($id:ID!,$a:String){ product(id:$id){ media(first:100, after:$a){ pageInfo{ hasNextPage endCursor } nodes{ id status ... on MediaImage { image { url } } } } } }`, { id: p.shopifyProductId, a: after });
        const m = d.product?.media;
        for (const n of m?.nodes || []) if (n.status === "READY" && n.image?.url) urls[n.id] = n.image.url;
        after = m?.pageInfo?.hasNextPage ? m.pageInfo.endCursor : null;
      } while (after);
      const shopifyImages = (p.shopifyImages || []).map((im) => ({ ...im, shopifyUrl: im.shopifyUrl || urls[im.mediaId] || "" }));
      const cdn = new Map(shopifyImages.filter((im) => im.shopifyUrl).map((im) => [im.sourceUrl, im.shopifyUrl]));
      const complete = shopifyImages.every((im) => im.shopifyUrl);
      const set = { shopifyImages };
      set.variants = (p.variants || []).map((v) => {
        const row = { ...v, shopifyImageUrl: v.shopifyImageUrl || (v.shopifyMediaId && urls[v.shopifyMediaId]) || "" };
        if (complete) {
          row.imageUrl = cdn.get(v.imageUrl) || v.imageUrl;
          row.images = (v.images || []).map((u) => cdn.get(u) || u);
        }
        return row;
      });
      if (complete) set.images = (p.images || []).map((u) => cdn.get(u) || u);
      else pending++;
      await col.updateOne({ _id: p._id, "specs.source": TAG }, { $set: set });
    }
    log(`image URLs round ${round}: ${pending} products still processing`);
    if (!pending) return;
    await new Promise((r) => setTimeout(r, 20000));
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db().collection("products");
  if (process.argv.includes("--fill-images")) {
    await fillImageUrls(col);
    await client.close();
    process.exit(0);
  }
  let rows = await col.find({ "specs.source": TAG }).sort({ createdAt: 1, _id: 1 }).toArray();
  if (ONLY) rows = rows.filter((p) => p.name.toLowerCase().includes(ONLY));
  if (!ALL) rows = rows.filter((p) => !fullyLinked(p));
  rows = rows.slice(0, LIMIT);
  log(`syncing ${rows.length} Topps Tiles products to Shopify as DRAFT`);

  let done = 0, ok = 0, failed = 0, warned = 0;
  const queue = [...rows];
  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      try {
        const report = await syncFullProductToShopify(p, VENDOR, { status: "DRAFT" });
        await col.updateOne({ _id: p._id, "specs.source": TAG }, {
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
        });
        ok++;
        if (report.warnings.length) warned++;
        log(`✓ ${p.name} — ${report.variantsLinked}/${report.variantsTotal} variants, ${report.images} images, ${report.variantImagesAttached} variant images${report.warnings.length ? " — WARN " + report.warnings.join(" | ").slice(0, 300) : ""}`);
      } catch (e) {
        failed++;
        await col.updateOne({ _id: p._id, "specs.source": TAG }, { $set: { shopifySyncError: String(e.message || e).slice(0, 1000) } });
        log(`✗ ${p.name} — ${String(e.message || e).slice(0, 300)}`);
      }
      done++;
      if (done % 25 === 0) log(`progress ${done}/${rows.length} (ok ${ok}, warnings ${warned}, failed ${failed})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`finished: ${ok} ok (${warned} with warnings), ${failed} failed`);
  await client.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
