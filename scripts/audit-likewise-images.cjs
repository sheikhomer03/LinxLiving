/**
 * Check every Likewise Floors product's images against likewisefloors.com.
 *
 * The site is WooCommerce and attaches no images in Woo itself — each product
 * carries a SKU and the photo is served as uploads/<SKU>.jpg. Our copies are
 * re-hosted on Cloudinary under names derived from the product, so the URL
 * says nothing about what the file actually shows. Cloudinary stored the
 * originals byte-for-byte, though, so the two sides join on a content hash:
 * hash every live SKU photo, hash every stored image, and each stored image
 * resolves to the SKU — and therefore the product — it really depicts.
 *
 * An image is then one of:
 *   own      the product's own SKU photo
 *   wrong    another product's photo (a range sibling, in practice)
 *   unknown  matches no live SKU photo
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-likewise-images.cjs
 *
 *   LIMIT=100      audit only the first N db products
 *   CONCURRENCY=8  parallel downloads
 *   REPORT=path    machine-readable output
 */
require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://likewisefloors.com";
const UPLOADS = "https://uploads.likewisefloors.co.uk/uploads";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const REPORT = process.env.REPORT || path.join(__dirname, "_tmp-likewise-images.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LinxLikewiseImageAudit/1.0";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * WordPress returns names HTML-encoded — "NATURE&#8217;S POWER", "Luxury Faux
 * Fur &#8211; 60x90cm". Left encoded, the numeric entities survive as digits
 * and the name never matches the real punctuation we store.
 */
const decodeEntities = (s) =>
  String(s || "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&nbsp;/g, " ");

const norm = (s) =>
  decodeEntities(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Fingerprints are the slow part — ten thousand requests — and they do not
 * change between runs, so they are kept on disk. Delete the file to refetch.
 */
const CACHE_FILE = path.join(__dirname, "_tmp-likewise-fingerprints.json");
const cache = fs.existsSync(CACHE_FILE)
  ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))
  : { len: {}, hash: {} };
let cacheDirty = false;
const saveCache = () => {
  if (!cacheDirty) return;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  cacheDirty = false;
};

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) { await delay(1000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch {
      await delay(800 * (i + 1));
    }
  }
  return null;
}

/**
 * Byte length of a file, via HEAD. Cloudinary stored the originals unmodified,
 * so a stored image and the live photo it came from report the same length —
 * which makes this a fingerprint costing one tiny request instead of the ~800KB
 * a hash would pull. Lengths that turn out to be ambiguous are re-checked with
 * a real hash below.
 */
async function lengthOf(url, tries = 3) {
  if (Object.prototype.hasOwnProperty.call(cache.len, url)) return cache.len[url];
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: "HEAD", headers: { "user-agent": UA } });
      if (r.status === 404 || r.status === 403) return null;
      if (r.status === 429 || r.status >= 500) { await delay(800 * (i + 1)); continue; }
      if (!r.ok) return null;
      const n = Number(r.headers.get("content-length"));
      const val = Number.isFinite(n) && n > 0 ? n : null;
      cache.len[url] = val;
      cacheDirty = true;
      return val;
    } catch {
      await delay(600 * (i + 1));
    }
  }
  return null;
}

/** sha256 of the bytes, or null when the file is not there. */
async function hashOf(url, tries = 3) {
  if (Object.prototype.hasOwnProperty.call(cache.hash, url)) return cache.hash[url];
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA } });
      if (r.status === 404 || r.status === 403) return null;
      if (r.status === 429 || r.status >= 500) { await delay(800 * (i + 1)); continue; }
      if (!r.ok) return null;
      const b = Buffer.from(await r.arrayBuffer());
      const val = crypto.createHash("sha256").update(b).digest("hex");
      cache.hash[url] = val;
      cacheDirty = true;
      return val;
    } catch {
      await delay(600 * (i + 1));
    }
  }
  return null;
}

/** Run jobs with a fixed worker pool, reporting progress as they land. */
async function pool(items, worker, label) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  const run = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
      done += 1;
      if (done % 100 === 0 || done === items.length) {
        process.stdout.write(`   ${label}: ${done}/${items.length}\r`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
  process.stdout.write("\n");
  saveCache();
  return out;
}

(async () => {
  await connectMongo();
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ name: /likewise/i });
  if (!brand) throw new Error("Likewise Floors brand not found");

  let products = await db
    .collection("products")
    .find({ brand: brand._id })
    .project({ name: 1, images: 1, category: 1 })
    .toArray();
  if (LIMIT) products = products.slice(0, LIMIT);
  console.log(`db products: ${products.length}`);

  // 1. Live catalogue from the WooCommerce Store API.
  const live = [];
  for (let page = 1; page <= 40; page++) {
    const batch = await getJson(`${BASE}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!batch || !batch.length) break;
    live.push(...batch);
    if (batch.length < 100) break;
  }
  // Colour names repeat across ranges, so a name can cover several live
  // products. Keep them all: a stored image counts as the product's own if it
  // is the photo of any live product sharing its name.
  const liveByName = new Map();
  for (const p of live) {
    if (!p.sku) continue;
    const k = norm(p.name);
    if (!liveByName.has(k)) liveByName.set(k, []);
    liveByName.get(k).push(p);
  }
  const shared = [...liveByName.values()].filter((l) => l.length > 1);
  console.log(`live products: ${live.length}   distinct names: ${liveByName.size}`);
  console.log(`names used by more than one product: ${shared.length}`);

  // 2. Fingerprint every live SKU photo, so any stored image can be identified.
  const skus = [...new Set(live.map((p) => p.sku).filter(Boolean))];
  console.log(`\nfingerprinting ${skus.length} live sku photos…`);
  const liveLens = await pool(skus, (sku) => lengthOf(`${UPLOADS}/${sku}.jpg`), "live");
  const skusByLen = new Map();
  const lenBySku = new Map();
  let missingPhoto = 0;
  skus.forEach((sku, i) => {
    const n = liveLens[i];
    if (!n) { missingPhoto += 1; return; }
    lenBySku.set(sku, n);
    if (!skusByLen.has(n)) skusByLen.set(n, []);
    skusByLen.get(n).push(sku);
  });
  console.log(`   resolved ${lenBySku.size}   no photo at uploads/<sku>.jpg: ${missingPhoto}`);

  // Lengths shared by several SKUs cannot identify a photo on their own, so
  // those few get a real hash.
  const ambiguous = [...skusByLen].filter(([, list]) => list.length > 1);
  const hashBySku = new Map();
  if (ambiguous.length) {
    const dupSkus = ambiguous.flatMap(([, list]) => list);
    console.log(`\n${ambiguous.length} lengths shared by ${dupSkus.length} skus — hashing those…`);
    const hs = await pool(dupSkus, (sku) => hashOf(`${UPLOADS}/${sku}.jpg`), "dedupe");
    dupSkus.forEach((sku, i) => hs[i] && hashBySku.set(sku, hs[i]));
  }

  const productBySku = new Map();
  for (const p of live) if (p.sku) productBySku.set(p.sku, p);

  // 3. Fingerprint every stored image once, even where products share a URL.
  const urls = [...new Set(products.flatMap((p) => p.images || []))];
  console.log(`\nfingerprinting ${urls.length} stored images…`);
  const storedLens = await pool(urls, (u) => lengthOf(u), "stored");
  const lenByUrl = new Map();
  urls.forEach((u, i) => lenByUrl.set(u, storedLens[i]));

  // Only stored images whose length is ambiguous need their bytes read.
  const needHash = urls.filter((u) => (skusByLen.get(lenByUrl.get(u)) || []).length > 1);
  const hashByUrl = new Map();
  if (needHash.length) {
    console.log(`\n${needHash.length} stored images land on an ambiguous length — hashing those…`);
    const hs = await pool(needHash, (u) => hashOf(u), "dedupe");
    needHash.forEach((u, i) => hs[i] && hashByUrl.set(u, hs[i]));
  }

  /** Which SKUs a stored image could be, narrowed by hash when needed. */
  const skusFor = (url) => {
    const n = lenByUrl.get(url);
    if (!n) return null;
    const list = skusByLen.get(n) || [];
    if (list.length <= 1) return list;
    const h = hashByUrl.get(url);
    if (!h) return list;
    const exact = list.filter((s) => hashBySku.get(s) === h);
    return exact.length ? exact : [];
  };

  // 4. Classify.
  const rows = [];
  for (const p of products) {
    const candidates = liveByName.get(norm(p.name)) || [];
    const ownSkus = candidates.map((c) => c.sku);
    const ownSku = ownSkus.length === 1 ? ownSkus[0] : ownSkus.join(" | ") || null;

    const images = (p.images || []).map((url) => {
      const matches = skusFor(url);
      const isOwn = Boolean(matches && matches.some((s) => ownSkus.includes(s)));
      return {
        url,
        file: String(url).split("/").pop(),
        len: lenByUrl.get(url) || null,
        isOwn,
        belongsTo: isOwn
          ? null
          : (matches || []).map((s) => (productBySku.get(s) || {}).name || s).join(", ") || null,
        kind:
          matches === null
            ? "unreachable"
            : isOwn
              ? "own"
              : matches.length
                ? "wrong"
                : "unknown",
      };
    });

    rows.push({
      // 167 names cover more than one product row, so the id is the only safe
      // way for a consumer of this report to address a specific product.
      _id: String(p._id),
      name: p.name,
      category: p.category,
      matchedLive: candidates.length > 0,
      ambiguousName: candidates.length > 1,
      sku: ownSku,
      total: images.length,
      own: images.filter((i) => i.kind === "own").length,
      wrong: images.filter((i) => i.kind === "wrong").length,
      unknown: images.filter((i) => i.kind === "unknown").length,
      unreachable: images.filter((i) => i.kind === "unreachable").length,
      images,
    });
  }

  fs.writeFileSync(REPORT, JSON.stringify({ rows }, null, 2));

  const unmatched = rows.filter((r) => !r.matchedLive);
  const clean = rows.filter((r) => r.matchedLive && r.own === 1 && r.total === 1);
  const withWrong = rows.filter((r) => r.wrong > 0);
  const noOwn = rows.filter((r) => r.matchedLive && r.own === 0);
  const withUnknown = rows.filter((r) => r.unknown > 0);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`products audited            : ${rows.length}`);
  console.log(`no matching product on site : ${unmatched.length}`);
  console.log(`exactly its own photo, no more: ${clean.length}`);
  console.log(`carrying another product's photo: ${withWrong.length}`);
  console.log(`missing their own photo     : ${noOwn.length}`);
  console.log(`with unidentifiable images  : ${withUnknown.length}`);
  console.log(`stored images total         : ${rows.reduce((a, r) => a + r.total, 0)}`);
  console.log(`  own                       : ${rows.reduce((a, r) => a + r.own, 0)}`);
  console.log(`  wrong (another product)   : ${rows.reduce((a, r) => a + r.wrong, 0)}`);
  console.log(`  unknown                   : ${rows.reduce((a, r) => a + r.unknown, 0)}`);
  console.log(`  unreachable               : ${rows.reduce((a, r) => a + r.unreachable, 0)}`);
  console.log(`\nreport: ${REPORT}`);

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
