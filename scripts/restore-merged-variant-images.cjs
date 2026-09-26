/**
 * Restore the photographs merged products lost.
 *
 * The colour/size merges (merge-variants-brands.cjs, merge-size-variants.cjs)
 * folded several products into one and deleted the rest, but the merged
 * document kept only a fraction of their images:
 *   - `shopifyImages` was deduplicated on `url`, a field the pairs don't have,
 *     so every merged product kept a single pair (or none);
 *   - each variant's `imageUrl` became a Shopify CDN path grafted onto the
 *     supplier's host (`…/650X650/1///1/1053/…/files/x.jpg`), which the
 *     supplier answers with a ~1KB placeholder rather than a 404.
 * So a merged product shows one photo (or none) and picking a colour changes
 * nothing.
 *
 * The 2026-09-24 backup predates every merge and still holds each original
 * product with its full gallery and Shopify pairings. For every product that
 * gained variants since that backup, each variant is traced to its original
 * (by `originalId`, its own `_id`, its SKU, or its exact name) and given that
 * original's photographs, in the original's order; the product's gallery
 * becomes all of them, the first variant's first, with identical files
 * (compared by content) shown once.
 *
 * Every URL is downloaded. A Shopify CDN copy that no longer exists falls back
 * to the supplier's original URL; anything that is not a real image (error,
 * HTML, or a placeholder under 2.5KB) is dropped.
 *
 *   node scripts/restore-merged-variant-images.cjs            # dry run, report only
 *   node scripts/restore-merged-variant-images.cjs --apply    # write (backs up first)
 *   node scripts/restore-merged-variant-images.cjs --id=<id>  # one product
 *
 * Shopify itself is not touched.
 */
require("dotenv").config({ path: ".env.local" });
const dns = require("dns");
const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const readline = require("readline");
const { MongoClient, BSON } = require("mongodb");

const APPLY = process.argv.includes("--apply");
const ONLY_ID = (process.argv.find((a) => a.startsWith("--id=")) || "").slice(5);
const ONLY_CLUSTER = (process.argv.find((a) => a.startsWith("--cluster=")) || "").slice(10);
const BACKUP_DIR = path.join(__dirname, "../backups/db-2026-09-24-exact");
const MERGED_LIST = path.join(__dirname, "../backups/merged_products_list.md");
const CLUSTERS = [
  { label: "secondary", uri: process.env.MONGODB_URL2 },
  { label: "primary", uri: process.env.MONGODB_URI },
].filter((c) => c.uri && (!ONLY_CLUSTER || c.label === ONLY_CLUSTER));
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const REPORT = path.join(__dirname, `../backups/merged-image-restore-report-${STAMP}.json`);

const MIN_IMAGE_BYTES = 2500;
const FETCH_CONCURRENCY = 24;
const PRODUCT_CONCURRENCY = 6;
/** A Shopify CDN path grafted onto a supplier host — always a placeholder. */
const GRAFTED_CDN_PATH = /\/1\/\/\/1\/\d+\/\d+\/\d+\/files\//;
const VIDEO_URL = /\.(mp4|webm|mov)(\?|$)|youtube\.com|youtu\.be|vimeo\.com/i;

const idOf = (v) => (v == null ? "" : String(v));
const trim = (v) => String(v || "").trim();
const norm = (v) => trim(v).toLowerCase();
const nameKey = (v) => norm(v).replace(/\s+/g, " ");

async function loadBackup(label) {
  const file = path.join(BACKUP_DIR, label, "test", "products.ejson.gz");
  const byId = new Map();
  const bySku = new Map();
  const byName = new Map();
  if (!fs.existsSync(file)) return { byId, bySku, byName };
  const rl = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const doc = BSON.EJSON.parse(line, { relaxed: false });
    byId.set(idOf(doc._id), doc);
    for (const sku of [doc.sku, doc.productCode, doc.sourceSku, doc.supplierSku]) {
      const k = norm(sku);
      if (k && !bySku.has(k)) bySku.set(k, doc);
    }
    const n = nameKey(doc.name);
    if (n) byName.set(n, byName.has(n) ? null : doc); // null = ambiguous
  }
  return { byId, bySku, byName };
}

/* ── concurrency limiter ─────────────────────────────────────────────────── */
function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}
const fetchLimit = limiter(FETCH_CONCURRENCY);

/* ── image checks, cached: { ok, hash, bytes, reason } ───────────────────── */
const checked = new Map();
function checkImage(url) {
  if (!/^https?:\/\//i.test(url || "")) return Promise.resolve({ ok: false, reason: "not a URL" });
  if (GRAFTED_CDN_PATH.test(url)) return Promise.resolve({ ok: false, reason: "grafted placeholder path" });
  if (checked.has(url)) return checked.get(url);
  const p = fetchLimit(async () => {
    let last = "unreachable";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25000) });
        if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
        const type = res.headers.get("content-type") || "";
        if (!/^image\//i.test(type)) return { ok: false, reason: `not an image (${type})` };
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < MIN_IMAGE_BYTES) return { ok: false, reason: `placeholder (${buf.length} bytes)` };
        return { ok: true, bytes: buf.length, hash: crypto.createHash("md5").update(buf).digest("hex") };
      } catch (e) {
        last = e.name === "TimeoutError" ? "timeout" : e.message;
      }
    }
    return { ok: false, reason: last };
  });
  checked.set(url, p);
  return p;
}

const isShopifyCdn = (u) => /(^https?:\/\/)?cdn\.shopify(cdn)?\.(com|net)\//i.test(u);
const fileKey = (u) => String(u).split("?")[0].split("/").pop().toLowerCase();

/**
 * An original product's photographs in its own display order, each as
 * { source, cdn } — the supplier URL and the Shopify copy, either may be "".
 */
function originalImageList(orig) {
  const pairs = (orig.shopifyImages || [])
    .filter((p) => p && (p.sourceUrl || p.shopifyUrl))
    .map((p, i) => ({ source: trim(p.sourceUrl), cdn: trim(p.shopifyUrl), pos: Number(p.position ?? i) || 0 }))
    .sort((a, b) => a.pos - b.pos);
  const used = new Set();
  const findPair = (u) => {
    let i = pairs.findIndex((p, j) => !used.has(j) && (p.source === u || p.cdn === u));
    if (i < 0) i = pairs.findIndex((p, j) => !used.has(j) && p.cdn && fileKey(p.cdn) === fileKey(u));
    return i;
  };
  const out = [];
  for (const raw of orig.images || []) {
    const u = trim(raw);
    if (!u) continue;
    const i = findPair(u);
    if (i >= 0) {
      used.add(i);
      out.push({ source: pairs[i].source, cdn: pairs[i].cdn });
    } else if (isShopifyCdn(u)) out.push({ source: "", cdn: u });
    else out.push({ source: u, cdn: "" });
  }
  pairs.forEach((p, j) => {
    if (!used.has(j)) out.push({ source: p.source, cdn: p.cdn });
  });
  return out;
}

/** Resolve an original's list to working URLs: CDN copy first, then supplier. */
async function resolveImages(orig, dead) {
  const list = originalImageList(orig);
  const results = await Promise.all(
    list.map(async ({ source, cdn }) => {
      const any = source || cdn;
      if (VIDEO_URL.test(any)) return { video: any };
      for (const url of [cdn, source].filter(Boolean)) {
        const r = await checkImage(url);
        if (r.ok) return { sourceUrl: source || cdn, shopifyUrl: url, hash: r.hash };
      }
      const why = await checkImage(cdn || source);
      dead.push({ url: any, reason: why.reason });
      return null;
    }),
  );
  const images = [];
  const videos = [];
  const seen = new Set();
  for (const r of results) {
    if (!r) continue;
    if (r.video) {
      if (!videos.includes(r.video)) videos.push(r.video);
      continue;
    }
    if (seen.has(r.hash)) continue; // same file twice in one original
    seen.add(r.hash);
    images.push(r);
  }
  return { images, videos };
}

function loadMergedListNames() {
  if (!fs.existsSync(MERGED_LIST)) return new Set();
  return new Set(
    fs
      .readFileSync(MERGED_LIST, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => nameKey(l.slice(2))),
  );
}

async function main() {
  if (!CLUSTERS.length) throw new Error("No MONGODB_URL2 / MONGODB_URI in .env.local");
  const report = { mode: APPLY ? "apply" : "dry-run", startedAt: new Date().toISOString(), products: [] };
  const preImage = [];
  const listNames = loadMergedListNames();
  const listNamesSeen = new Set();

  console.log("Loading backups…");
  const backups = {};
  for (const label of ["primary", "secondary"]) backups[label] = await loadBackup(label);

  for (const { label, uri } of CLUSTERS) {
    console.log(`\n=== ${label} cluster`);
    const own = backups[label];
    const other = backups[label === "primary" ? "secondary" : "primary"];
    const findOrig = (v) => {
      for (const b of [own, other]) {
        const hit = b.byId.get(idOf(v.originalId));
        if (hit) return { orig: hit, via: "originalId" };
      }
      for (const b of [own, other]) {
        const hit = b.byId.get(idOf(v._id));
        if (hit) return { orig: hit, via: "_id" };
      }
      const sku = norm(v.sku);
      if (sku && !/^(merged|.*-v\d+$)/.test(sku)) {
        const hit = own.bySku.get(sku) || other.bySku.get(sku);
        if (hit) return { orig: hit, via: "sku" };
      }
      const n = nameKey(v.name);
      if (n) {
        const hit = own.byName.get(n) || other.byName.get(n);
        if (hit) return { orig: hit, via: "name" };
      }
      return null;
    };

    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 60000, socketTimeoutMS: 120000 });
    await client.connect();
    const col = client.db("test").collection("products");
    const filter = { "variants.1": { $exists: true } };
    if (ONLY_ID) filter._id = new BSON.ObjectId(ONLY_ID);
    // Only ids and variant counts first — the full documents are large and
    // only the merged few are needed.
    const counts = await col
      .aggregate([{ $match: filter }, { $project: { n: { $size: "$variants" } } }])
      .toArray();
    const mergedIds = counts
      .filter(({ _id, n }) => {
        const before = own.byId.get(idOf(_id)) || other.byId.get(idOf(_id));
        // Only products that gained variants since the backup were merged.
        return !before || (before.variants || []).length < n;
      })
      .map((d) => d._id);
    const candidates = mergedIds.length ? await col.find({ _id: { $in: mergedIds } }).toArray() : [];
    console.log(`   ${counts.length} products with 2+ variants, ${candidates.length} merged since backup`);

    const productLimit = limiter(PRODUCT_CONCURRENCY);
    let done = 0;
    await Promise.all(
      candidates.map((doc) =>
        productLimit(async () => {
          const entry = {
            id: idOf(doc._id),
            cluster: label,
            name: doc.name,
            url: `https://www.linxsquare.co.uk/products/${idOf(doc._id)}`,
            variants: doc.variants.length,
            imagesBefore: (doc.images || []).length,
            shopifyPairsBefore: (doc.shopifyImages || []).length,
            variantsMatched: 0,
            unmatched: [],
            deadImages: [],
            imagesAfter: 0,
            variantImages: [],
          };

          const newVariants = [];
          const gallery = [];
          const videos = [];
          const seen = new Set();
          for (const v of doc.variants) {
            if (listNames.has(nameKey(v.name))) listNamesSeen.add(nameKey(v.name));
            const hit = findOrig(v);
            if (!hit) {
              entry.unmatched.push(v.name || v.sku || idOf(v._id));
              newVariants.push(v);
              continue;
            }
            const { images, videos: vids } = await resolveImages(hit.orig, entry.deadImages);
            entry.variantImages.push({
              variant: [v.option1, v.option2].filter(Boolean).join(" / ") || v.name,
              from: idOf(hit.orig._id),
              via: hit.via,
              images: images.length,
            });
            if (!images.length) {
              newVariants.push(v);
              continue;
            }
            entry.variantsMatched++;
            const pairs = images.map((p, i) => ({ sourceUrl: p.sourceUrl, shopifyUrl: p.shopifyUrl, position: i + 1 }));
            newVariants.push({
              ...v,
              imageUrl: pairs[0].sourceUrl,
              shopifyImageUrl: pairs[0].shopifyUrl,
              shopifyImages: pairs,
            });
            for (const p of images) {
              if (seen.has(p.hash)) continue;
              seen.add(p.hash);
              gallery.push({ sourceUrl: p.sourceUrl, shopifyUrl: p.shopifyUrl });
            }
            for (const u of vids) if (!videos.includes(u)) videos.push(u);
          }

          // Never lose a photo the product shows today: anything that still
          // loads and is not already in the gallery (by content) stays, after
          // the restored ones. Covers variants the backup could not trace.
          entry.keptFromCurrent = 0;
          if (gallery.length) {
            const pairOf = new Map();
            for (const p of doc.shopifyImages || []) {
              for (const k of [trim(p?.sourceUrl), trim(p?.shopifyUrl)]) if (k) pairOf.set(k, p);
            }
            for (const raw of doc.images || []) {
              const u = trim(raw);
              if (!u) continue;
              if (VIDEO_URL.test(u)) {
                if (!videos.includes(u)) videos.push(u);
                continue;
              }
              const pair = pairOf.get(u);
              for (const url of [trim(pair?.shopifyUrl), u].filter(Boolean)) {
                const r = await checkImage(url);
                if (!r.ok) continue;
                if (!seen.has(r.hash)) {
                  seen.add(r.hash);
                  gallery.push({ sourceUrl: u, shopifyUrl: url });
                  entry.keptFromCurrent++;
                }
                break;
              }
            }
          }

          done++;
          if (done % 50 === 0) console.log(`   … ${done}/${candidates.length}`);

          // Nothing traced back — leave it exactly as it is.
          if (!entry.variantsMatched || !gallery.length) {
            entry.skipped = entry.unmatched.length === doc.variants.length ? "no variant found in backup" : "no working images found";
            report.products.push(entry);
            return;
          }

          entry.imagesAfter = gallery.length;
          report.products.push(entry);
          const update = {
            images: [...gallery.map((p) => p.sourceUrl), ...videos],
            shopifyImages: gallery.map((p, i) => ({ ...p, position: i + 1 })),
            variants: newVariants,
          };
          if (APPLY) {
            preImage.push(BSON.EJSON.stringify({ cluster: label, doc }, { relaxed: false }));
            await col.updateOne({ _id: doc._id }, { $set: update });
          }
        }),
      ),
    );
    await client.close();
  }

  if (APPLY && preImage.length) {
    const undo = path.join(__dirname, `../backups/pre-image-restore-${STAMP}.ejson`);
    fs.writeFileSync(undo, preImage.join("\n") + "\n");
    console.log(`\nPrevious versions of ${preImage.length} products saved to ${undo}`);
  }
  const fixed = report.products.filter((p) => !p.skipped);
  report.summary = {
    mergedProductsFound: report.products.length,
    willFix: fixed.length,
    skipped: report.products.length - fixed.length,
    partiallyMatched: fixed.filter((p) => p.unmatched.length || p.variantsMatched < p.variants).length,
    imagesBefore: fixed.reduce((s, p) => s + p.imagesBefore, 0),
    imagesAfter: fixed.reduce((s, p) => s + p.imagesAfter, 0),
    deadImagesDropped: fixed.reduce((s, p) => s + p.deadImages.length, 0),
    mergedListNames: listNames.size,
    mergedListNamesCovered: listNamesSeen.size,
  };
  report.mergedListNotFound = [...listNames].filter((n) => !listNamesSeen.has(n));
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log("\n", report.summary, `\nReport: ${REPORT}`);
  if (!APPLY) console.log("Dry run — nothing written. Re-run with --apply to save.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
