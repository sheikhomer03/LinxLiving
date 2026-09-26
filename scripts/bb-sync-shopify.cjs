/**
 * Push the imported Better Bathrooms products (DB2, specs.source = "bb-scrape")
 * to Shopify (ACTIVE by default now they are live; --status=DRAFT to hold) — options, every variant at its own price, stock,
 * gallery and per-variant images — and save back what Shopify returns: product
 * and variant ids, inventory items, handle, and the media pairing for each
 * image. Without that write-back a variant cannot be added to the cart.
 *
 * Only products carrying the bb-scrape tag are read or written. Resumable:
 * products already fully linked are skipped unless --all.
 *
 *   node scripts/bb-sync-shopify.cjs [--limit=N] [--only=text] [--all] [--concurrency=2]
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

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").slice(k.length + 3);
const LIMIT = Number(arg("limit")) || Infinity;
const ONLY = arg("only").toLowerCase();
const ALL = process.argv.includes("--all");
/** Products are live now; a re-sync keeps them ACTIVE unless --status=DRAFT is given. */
const STATUS = arg("status") || "ACTIVE";
const CONCURRENCY = Number(arg("concurrency")) || 2;
const LOG = path.join(__dirname, "../.scratch/betterbathrooms/work/shopify-sync.log");
const log = (m) => { const line = `[${new Date().toISOString()}] ${m}`; console.log(line); fs.appendFileSync(LOG, line + "\n"); };

const fullyLinked = (p) =>
  p.shopifyProductId && (p.variants || []).every((v) => v.shopifyVariantId) && (p.shopifyImages || []).length > 0;

/**
 * Shopify processes uploaded media after the mutation returns, so the CDN URL
 * of a fresh image is empty at sync time. Once media is READY, record each
 * URL on the gallery pairing and on the variant that shows it.
 */
async function fillImageUrls(col, rounds = 6) {
  for (let round = 1; round <= rounds; round++) {
    const pending = await col.find({ "specs.source": "bb-scrape", shopifyProductId: { $nin: [null, ""] },
      $or: [{ "shopifyImages.shopifyUrl": { $in: ["", null] } }, { variants: { $elemMatch: { shopifyMediaId: { $nin: [null, ""] }, shopifyImageUrl: { $in: ["", null] } } } }] }).toArray();
    if (!pending.length) { log("image URLs: all filled"); return; }
    let filled = 0;
    for (const p of pending) {
      const urls = {};
      let after = null;
      do {
        const d = await shopifyAdminRequest(`query($id:ID!,$a:String){ product(id:$id){ media(first:100, after:$a){ pageInfo{ hasNextPage endCursor } nodes{ id status ... on MediaImage { image { url } } } } } }`, { id: p.shopifyProductId, a: after });
        const m = d.product?.media;
        for (const n of m?.nodes || []) if (n.status === "READY" && n.image?.url) urls[n.id] = n.image.url;
        after = m?.pageInfo?.hasNextPage ? m.pageInfo.endCursor : null;
      } while (after);
      const shopifyImages = (p.shopifyImages || []).map((im) => ({ ...im, shopifyUrl: im.shopifyUrl || urls[im.mediaId] || "" }));
      const variants = (p.variants || []).map((v) => ({ ...v, shopifyImageUrl: v.shopifyImageUrl || (v.shopifyMediaId && urls[v.shopifyMediaId]) || v.shopifyImageUrl || "" }));
      await col.updateOne({ _id: p._id }, { $set: { shopifyImages, variants } });
      if (!shopifyImages.some((im) => !im.shopifyUrl)) filled++;
    }
    log(`image URLs round ${round}: ${filled}/${pending.length} products complete`);
    if (filled === pending.length) return;
    await new Promise((r) => setTimeout(r, 20000));
  }
}

async function main() {
  if (process.argv.includes("--fill-images")) {
    const client = new MongoClient(process.env.MONGODB_URL2);
    await client.connect();
    await fillImageUrls(client.db().collection("products"));
    await client.close();
    process.exit(0);
  }
  const client = new MongoClient(process.env.MONGODB_URL2);
  await client.connect();
  const col = client.db().collection("products");
  let rows = await col.find({ "specs.source": "bb-scrape" }).sort({ createdAt: 1, _id: 1 }).toArray();
  if (ONLY) rows = rows.filter((p) => p.name.toLowerCase().includes(ONLY));
  if (!ALL) rows = rows.filter((p) => !fullyLinked(p));
  rows = rows.slice(0, LIMIT);
  log(`syncing ${rows.length} Better Bathrooms products to Shopify as ${STATUS}`);

  let done = 0, ok = 0, failed = 0, warned = 0;
  const queue = [...rows];
  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      try {
        // Variant photo sets are media of this product but not in its gallery;
        // the gallery reconcile deletes any media it is not told about, so they
        // ride along for the sync and are split back out afterwards.
        const galleryImages = p.images || [];
        const gallerySet = new Set(galleryImages);
        const extra = [];
        for (const v of p.variants || []) for (const l of v.shopifyImages || []) {
          if (l.mediaId && !gallerySet.has(l.sourceUrl) && !extra.some((x) => x.sourceUrl === l.sourceUrl)) extra.push(l);
        }
        p.images = [...galleryImages, ...extra.map((l) => l.sourceUrl)];
        p.shopifyImages = [...(p.shopifyImages || []), ...extra];
        const report = await syncFullProductToShopify(p, "Better Bathrooms", { status: STATUS });
        const links = new Map((p.shopifyImages || []).map((l) => [l.sourceUrl, l]));
        for (const v of p.variants || []) {
          if (v.shopifyImages) v.shopifyImages = v.shopifyImages.map((l) => ({ ...l, ...(links.get(l.sourceUrl) || {}), position: l.position }));
        }
        p.images = galleryImages;
        p.shopifyImages = (p.shopifyImages || []).filter((l) => gallerySet.has(l.sourceUrl));
        await col.updateOne({ _id: p._id }, {
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
        await col.updateOne({ _id: p._id }, { $set: { shopifySyncError: String(e.message || e).slice(0, 1000) } });
        log(`✗ ${p.name} — ${String(e.message || e).slice(0, 300)}`);
      }
      done++;
      if (done % 25 === 0) log(`progress ${done}/${rows.length} (ok ${ok}, warnings ${warned}, failed ${failed})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`finished: ${ok} ok (${warned} with warnings), ${failed} failed`);
  await fillImageUrls(col);
  await client.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
