/**
 * Audit every Fakro product gallery vs Linx Glass (Supabase).
 * Expected sequence = buildProductImageList(image_path, gallery by sort_order)
 * with NO truncation — images + videos.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-fakro-gallery.cjs
 *
 * Options:
 *   FIX=1                 — re-upload/reorder mismatches (calls sync logic)
 *   LIMIT=50
 *   CONCURRENCY=3
 *   SAMPLE=20             — print this many mismatch samples
 *   OUT=tmp/gallery-audit.json
 */
const path = require("path");
const fs = require("fs");
const dns = require("dns");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({
  path: path.join(__dirname, "..", ".env.migrate"),
  override: false,
});

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const SOURCE_URL = (process.env.SOURCE_SUPABASE_URL || "").replace(/\/$/, "");
const SOURCE_KEY = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
const SOURCE_CLOUD =
  process.env.SOURCE_CLOUDINARY_CLOUD_NAME || "dkuqdi0ho";
const DEST_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;

const FIX = process.env.FIX === "1";
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const SAMPLE = Number(process.env.SAMPLE || 25);
const OUT =
  process.env.OUT ||
  path.join(__dirname, "..", "tmp", "gallery-audit.json");
const CLOUDINARY_FOLDER = "linx-living/products/fakro";
const SOURCE_TAG = "fakro-supabase";

const headers = {
  apikey: SOURCE_KEY,
  Authorization: `Bearer ${SOURCE_KEY}`,
  Accept: "application/json",
};

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isVideoUrl(pathOrUrl) {
  const raw = cleanText(pathOrUrl).toLowerCase();
  if (!raw) return false;
  if (/\/video\/upload\//.test(raw)) return true;
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(raw)) return true;
  return false;
}

function imageFingerprint(pathOrUrl) {
  const raw = cleanText(pathOrUrl);
  if (!raw) return "";
  let file = raw;
  try {
    if (/^https?:\/\//i.test(raw)) file = new URL(raw).pathname;
  } catch {
    /* keep */
  }
  const parts = file.split("/").filter(Boolean);
  let last = parts[parts.length - 1] || "";
  last = last.split("?")[0].replace(/\.[a-z0-9]+$/i, "");
  return last.toLowerCase();
}

function normalizeFp(fp) {
  return String(fp || "")
    .toLowerCase()
    .replace(/^p-/, "")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Compare key for source ↔ dest public ids (tolerant of migration prefixes). */
function compareKey(pathOrUrl) {
  let n = normalizeFp(imageFingerprint(pathOrUrl));
  if (!n) return "";
  // Cloudinary public_id / slugify turned underscores into hyphens
  n = n.replace(/_/g, "-");
  const video = n.match(/(video-[a-z0-9]+)$/i);
  if (video) return video[1].toLowerCase();
  const gallery = n.match(/(gallery-\d+)$/i);
  if (gallery) return gallery[1].toLowerCase();
  // Strip leading "<sku>-<frame>-" migration noise
  n = n.replace(/^[a-z0-9]+(?:-[a-z0-9]+)*-\d+-/, "");
  return n;
}

function glassKeys(seq) {
  return seq.map(compareKey);
}

function mongoKeys(images) {
  return (images || []).map(compareKey);
}

function keyMatch(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.endsWith(b) || b.endsWith(a);
}

function keysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((k, i) => keyMatch(k, b[i]));
}

/** Exact Glass sequence: primary + gallery sort_order asc, URL-deduped like Glass. */
function buildGlassImageSequence(primary, galleryRows) {
  const sorted = [...galleryRows].sort(
    (a, b) =>
      (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
      String(a.image_url || "").localeCompare(String(b.image_url || "")),
  );
  const galleryUrls = sorted.map((r) => r.image_url).filter(Boolean);

  const seen = new Set();
  const result = [];
  for (const url of [primary, ...galleryUrls]) {
    if (!url || !cleanText(url)) continue;
    // Glass dedupes by exact URL string
    if (seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

function isDestCloudUrl(url) {
  return (
    typeof url === "string" &&
    url.includes(`res.cloudinary.com/${DEST_CLOUD}/`)
  );
}

function candidateUrls(pathOrUrl) {
  const raw = cleanText(pathOrUrl);
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw)) {
    if (isDestCloudUrl(raw)) return [];
    if (isVideoUrl(raw)) return [raw];
    const urls = [raw];
    try {
      const u = new URL(raw);
      const file = u.pathname.split("/").pop();
      if (file) {
        urls.push(
          `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/linx-products/fakro/${file}`,
        );
        urls.push(`https://www.linxglass.co.uk/fakro-products/${file}`);
      }
    } catch {
      /* ignore */
    }
    return [...new Set(urls)];
  }
  const cleaned = raw.replace(/^\//, "");
  const file = cleaned.split("/").pop();
  const urls = [];
  if (file) {
    urls.push(
      `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/linx-products/fakro/${file}`,
    );
    urls.push(`https://www.linxglass.co.uk/fakro-products/${file}`);
  }
  if (cleaned.startsWith("image/upload/") || cleaned.startsWith("video/upload/")) {
    urls.unshift(`https://res.cloudinary.com/${SOURCE_CLOUD}/${cleaned}`);
  } else {
    urls.push(
      `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/${cleaned}`,
    );
  }
  return [...new Set(urls.filter(Boolean))];
}

async function downloadFirstOk(candidates) {
  let lastErr = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "LinxLivingGalleryAudit/1.0" },
      });
      if (!res.ok) {
        lastErr = new Error(`download ${res.status}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) continue;
      return { buffer, sourceUrl: url };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("no candidates");
}

function uploadBuffer(buffer, publicId, resourceType = "image") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: publicId.replace(/\.[^.]+$/, "").slice(0, 180),
        overwrite: true,
        resource_type: resourceType,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

const imageCache = new Map();

async function migrateMedia(pathOrUrl, publicIdHint) {
  const raw = cleanText(pathOrUrl);
  if (isDestCloudUrl(raw)) return raw;
  const candidates = candidateUrls(pathOrUrl);
  if (!candidates.length) return null;
  const cacheKey = candidates[0];
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);
  if (DRY_RUN) {
    const dry = `dry://${compareKey(pathOrUrl)}`;
    imageCache.set(cacheKey, dry);
    return dry;
  }

  const video = isVideoUrl(pathOrUrl) || candidates.some(isVideoUrl);
  const resourceType = video ? "video" : "image";
  const base =
    slugify(publicIdHint || imageFingerprint(pathOrUrl) || `media-${Date.now()}`) ||
    `media-${Date.now()}`;

  let lastErr = null;
  for (const url of candidates) {
    try {
      const result = await cloudinary.uploader.upload(url, {
        folder: CLOUDINARY_FOLDER,
        public_id: base.slice(0, 180),
        overwrite: true,
        resource_type: resourceType,
        timeout: video ? 300000 : 120000,
      });
      if (result?.secure_url) {
        for (const c of candidates) imageCache.set(c, result.secure_url);
        return result.secure_url;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (video) throw lastErr || new Error("video upload failed");

  const { buffer } = await downloadFirstOk(candidates);
  if (buffer.length > 10_000_000) {
    throw new Error(`file too large ${buffer.length}`);
  }
  const destUrl = await uploadBuffer(buffer, base, resourceType);
  for (const c of candidates) imageCache.set(c, destUrl);
  return destUrl;
}

function buildFingerprintIndex(images) {
  const byFp = new Map();
  for (const img of images || []) {
    if (!img) continue;
    for (const k of [
      imageFingerprint(img),
      normalizeFp(imageFingerprint(img)),
      compareKey(img),
    ]) {
      if (k && !byFp.has(k)) byFp.set(k, img);
    }
  }
  return byFp;
}

function lookupDest(byFp, sourcePath) {
  const keys = [
    imageFingerprint(sourcePath),
    normalizeFp(imageFingerprint(sourcePath)),
    compareKey(sourcePath),
  ].filter(Boolean);
  for (const k of keys) {
    if (byFp.has(k)) return byFp.get(k);
  }
  const want = compareKey(sourcePath);
  if (!want) return null;
  for (const [k, url] of byFp) {
    if (k === want || k.endsWith(want) || want.endsWith(k)) return url;
  }
  return null;
}

async function supabaseGet(pathname) {
  const res = await fetch(`${SOURCE_URL}${pathname}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Paginate PostgREST so we never miss gallery rows. */
async function supabasePaged(pathname, pageSize = 1000) {
  const rows = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const res = await fetch(`${SOURCE_URL}${pathname}`, {
      headers: {
        ...headers,
        Range: `${from}-${to}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
    }
    const chunk = await res.json();
    if (!Array.isArray(chunk) || !chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function mapPool(items, concurrency, worker) {
  let idx = 0;
  async function run() {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
}

async function main() {
  if (!SOURCE_URL || !SOURCE_KEY) throw new Error("Missing source Supabase env");
  if (!process.env.MONGODB_URI || !DEST_CLOUD) {
    throw new Error("Missing Mongo / Cloudinary env");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  if (!brand) throw new Error("FAKRO brand not found");

  const productsCol = db.collection("products");
  let products = await productsCol
    .find({ brand: brand._id, "specs.source": SOURCE_TAG })
    .project({ _id: 1, name: 1, images: 1, "specs.sku": 1 })
    .toArray();

  if (LIMIT > 0) products = products.slice(0, LIMIT);

  console.log(
    `Auditing ${products.length} Fakro products vs Linx Glass | fix=${FIX} dry=${DRY_RUN}`,
  );

  const skus = products.map((p) => p.specs?.sku).filter(Boolean);
  const sourceBySku = new Map();
  const galleryBySku = new Map();
  const chunkSize = 80;

  console.log("Fetching source products + galleries by SKU…");
  for (let i = 0; i < skus.length; i += chunkSize) {
    const chunk = skus.slice(i, i + chunkSize);
    const inList = chunk.map(encodeURIComponent).join(",");
    const rows = await supabaseGet(
      `/rest/v1/shop_products?sku=in.(${inList})&select=sku,image_path`,
    );
    for (const row of rows) sourceBySku.set(row.sku, row);

    // Paginate each chunk in case a SKU has many images and default max rows bites
    const imgs = await supabasePaged(
      `/rest/v1/shop_product_images?sku=in.(${inList})&select=sku,image_url,sort_order&order=sort_order.asc`,
    );
    for (const row of imgs) {
      if (!galleryBySku.has(row.sku)) galleryBySku.set(row.sku, []);
      galleryBySku.get(row.sku).push(row);
    }
    if ((i / chunkSize) % 5 === 0) {
      console.log(`  … ${Math.min(i + chunkSize, skus.length)}/${skus.length}`);
    }
  }
  console.log(
    `  source products: ${sourceBySku.size} | gallery skus: ${galleryBySku.size} | gallery rows: ${[...galleryBySku.values()].reduce((n, a) => n + a.length, 0)}`,
  );

  const mismatches = [];
  const report = {
    total: products.length,
    ok: 0,
    mismatch: 0,
    missingSource: 0,
    emptyBoth: 0,
    glassMedia: 0,
    mongoMedia: 0,
    glassVideos: 0,
    mongoVideos: 0,
    fixed: 0,
    fixFailed: 0,
    uploaded: 0,
  };

  for (const product of products) {
    const sku = product.specs?.sku;
    if (!sku) {
      report.missingSource++;
      continue;
    }
    const src = sourceBySku.get(sku);
    if (!src) {
      report.missingSource++;
      mismatches.push({
        sku,
        reason: "missing_in_source",
        mongoCount: (product.images || []).length,
      });
      continue;
    }

    const glassSeq = buildGlassImageSequence(
      src.image_path,
      galleryBySku.get(sku) || [],
    );
    const mongoSeq = product.images || [];
    const gKeys = glassKeys(glassSeq);
    const mKeys = mongoKeys(mongoSeq);

    report.glassMedia += glassSeq.length;
    report.mongoMedia += mongoSeq.length;
    report.glassVideos += glassSeq.filter(isVideoUrl).length;
    report.mongoVideos += mongoSeq.filter(isVideoUrl).length;

    if (!glassSeq.length && !mongoSeq.length) {
      report.emptyBoth++;
      report.ok++;
      continue;
    }

    if (keysEqual(gKeys, mKeys) && glassSeq.length === mongoSeq.length) {
      report.ok++;
      continue;
    }

    // Soft match: same multiset of keys and same length after fuzzy endsWith?
    // Require exact positional key equality for "exact sequence"
    const missing = gKeys.filter((k, i) => mKeys[i] !== k);
    const extra = mKeys.length > gKeys.length ? mKeys.slice(gKeys.length) : [];

    report.mismatch++;
    mismatches.push({
      sku,
      reason: "sequence_or_count",
      glassCount: glassSeq.length,
      mongoCount: mongoSeq.length,
      glassKeys: gKeys,
      mongoKeys: mKeys,
      glassVideos: glassSeq.filter(isVideoUrl).length,
      mongoVideos: mongoSeq.filter(isVideoUrl).length,
      missingAtPositions: missing.length,
      extraTail: extra.length,
    });
  }

  console.log("\n=== AUDIT SUMMARY ===");
  console.log({
    total: report.total,
    ok: report.ok,
    mismatch: report.mismatch,
    missingSource: report.missingSource,
    emptyBoth: report.emptyBoth,
    glassMedia: report.glassMedia,
    mongoMedia: report.mongoMedia,
    glassVideos: report.glassVideos,
    mongoVideos: report.mongoVideos,
  });

  const samples = mismatches.slice(0, SAMPLE);
  if (samples.length) {
    console.log(`\n=== SAMPLE MISMATCHES (${samples.length}) ===`);
    for (const m of samples) {
      console.log(
        `\n${m.sku}: glass=${m.glassCount} mongo=${m.mongoCount} vids ${m.glassVideos}/${m.mongoVideos}`,
      );
      console.log(`  glass: ${ (m.glassKeys || []).join(" → ") || "(none)"}`);
      console.log(`  mongo: ${ (m.mongoKeys || []).join(" → ") || "(none)"}`);
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify({ report, mismatches }, null, 2),
    "utf8",
  );
  console.log(`\nWrote ${OUT}`);

  if (!FIX || !mismatches.length) {
    await mongoose.disconnect();
    if (report.mismatch > 0) process.exitCode = 2;
    return;
  }

  console.log(`\n=== FIXING ${mismatches.length} products ===`);
  const bySku = new Map(products.map((p) => [p.specs?.sku, p]));
  const toFix = mismatches
    .filter((m) => m.reason === "sequence_or_count")
    .map((m) => bySku.get(m.sku))
    .filter(Boolean);

  await mapPool(toFix, CONCURRENCY, async (product, index) => {
    const sku = product.specs.sku;
    const src = sourceBySku.get(sku);
    const glassSeq = buildGlassImageSequence(
      src.image_path,
      galleryBySku.get(sku) || [],
    );
    const byFp = buildFingerprintIndex(product.images || []);
    const next = [];
    try {
      for (let i = 0; i < glassSeq.length; i++) {
        const sourcePath = glassSeq[i];
        // Prefer exact positional reuse only when counts already lined up
        let dest = null;
        const existingAt = (product.images || [])[i];
        if (
          existingAt &&
          isDestCloudUrl(existingAt) &&
          keyMatch(compareKey(existingAt), compareKey(sourcePath))
        ) {
          dest = existingAt;
        }
        if (!dest) dest = lookupDest(byFp, sourcePath);

        // Always upload with a unique frame public_id so duplicate source
        // filenames (same video used twice in Glass) stay as separate slots.
        if (!dest || !isDestCloudUrl(dest) || next.filter((u) => u === dest).length > 0) {
          try {
            const fp = imageFingerprint(sourcePath) || "media";
            dest = await migrateMedia(
              sourcePath,
              `p-${sku}-frame-${i + 1}-${fp}`,
            );
            if (dest && isDestCloudUrl(dest)) {
              report.uploaded++;
              for (const k of [
                imageFingerprint(sourcePath),
                normalizeFp(imageFingerprint(sourcePath)),
                compareKey(sourcePath),
              ]) {
                if (k) byFp.set(k, dest);
              }
            }
          } catch (e) {
            console.warn(`  ! ${sku} frame ${i + 1}: ${e.message}`);
            dest = null;
          }
        }
        if (dest) next.push(dest);
      }

      if (!next.length && glassSeq.length) {
        report.fixFailed++;
        console.warn(`  ✗ ${sku}: no media after fix`);
        return;
      }

      // Verify keys match expected length as much as possible
      if (!DRY_RUN) {
        await productsCol.updateOne(
          { _id: product._id },
          { $set: { images: next, updatedAt: new Date() } },
        );
      }
      report.fixed++;
      if ((index + 1) % 25 === 0 || index === 0) {
        console.log(
          `  … ${index + 1}/${toFix.length} fixed=${report.fixed} uploaded=${report.uploaded}`,
        );
      }
    } catch (e) {
      report.fixFailed++;
      console.warn(`  ✗ ${sku}: ${e.message}`);
    }
  });

  // Re-audit fixed set
  console.log("\n=== RE-AUDIT AFTER FIX ===");
  let stillBad = 0;
  for (const product of toFix) {
    const fresh = await productsCol.findOne(
      { _id: product._id },
      { projection: { images: 1, "specs.sku": 1 } },
    );
    const sku = fresh.specs.sku;
    const glassSeq = buildGlassImageSequence(
      sourceBySku.get(sku)?.image_path,
      galleryBySku.get(sku) || [],
    );
    const ok = keysEqual(glassKeys(glassSeq), mongoKeys(fresh.images || []));
    if (!ok) {
      stillBad++;
      if (stillBad <= 10) {
        console.log(
          `  still bad ${sku}: glass=${glassSeq.length} mongo=${(fresh.images || []).length}`,
        );
        console.log(`    glass ${glassKeys(glassSeq).join(" → ")}`);
        console.log(`    mongo ${mongoKeys(fresh.images || []).join(" → ")}`);
      }
    }
  }
  console.log({
    fixed: report.fixed,
    fixFailed: report.fixFailed,
    uploaded: report.uploaded,
    stillBad,
  });

  await mongoose.disconnect();
  if (stillBad > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
