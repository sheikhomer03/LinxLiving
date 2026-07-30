/**
 * Reorder Fakro product `images` arrays in Mongo to match Linx Glass:
 *   [0] shop_products.image_path (primary)
 *   [1…] shop_product_images ordered by sort_order
 *   (deduped — same as Glass buildProductImageList)
 *
 * Existing dest-Cloudinary URLs are reused when the filename fingerprint matches;
 * missing frames are uploaded from source.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-fakro-gallery-order.cjs
 *
 * Options:
 *   DRY_RUN=1
 *   LIMIT=50
 *   CONCURRENCY=4
 *   MAX_GALLERY_IMAGES=20   — 0 = unlimited (all gallery rows)
 *   SAMPLE=1               — print a few before/after fingerprints
 */
const path = require("path");
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

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 4));
const MAX_GALLERY_IMAGES = Number(process.env.MAX_GALLERY_IMAGES ?? 0);
const SAMPLE = process.env.SAMPLE === "1";
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

/** Stable fingerprint for matching source path ↔ dest URL (basename, no ext). */
function imageFingerprint(pathOrUrl) {
  const raw = cleanText(pathOrUrl);
  if (!raw) return "";
  let file = raw;
  try {
    if (/^https?:\/\//i.test(raw)) {
      file = new URL(raw).pathname;
    }
  } catch {
    /* keep raw */
  }
  const parts = file.split("/").filter(Boolean);
  let last = parts[parts.length - 1] || "";
  last = last.split("?")[0];
  last = last.replace(/\.[a-z0-9]+$/i, "");
  return last.toLowerCase();
}

/** Normalize migration public_id quirks (p- prefix, double dashes). */
function normalizeFp(fp) {
  return String(fp || "")
    .toLowerCase()
    .replace(/^p-/, "")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildFingerprintIndex(images) {
  const byFp = new Map();
  for (const img of images || []) {
    if (!img) continue;
    const raw = imageFingerprint(img);
    const norm = normalizeFp(raw);
    if (raw && !byFp.has(raw)) byFp.set(raw, img);
    if (norm && !byFp.has(norm)) byFp.set(norm, img);
  }
  return byFp;
}

function lookupDest(byFp, sourcePath) {
  const raw = imageFingerprint(sourcePath);
  const norm = normalizeFp(raw);
  if (raw && byFp.has(raw)) return byFp.get(raw);
  if (norm && byFp.has(norm)) return byFp.get(norm);
  // Loose: dest fingerprint ends with source (or vice versa)
  if (norm) {
    for (const [k, url] of byFp) {
      const nk = normalizeFp(k);
      if (!nk) continue;
      if (nk === norm || nk.endsWith(norm) || norm.endsWith(nk)) return url;
    }
  }
  return null;
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
    // Videos: use the source URL as-is (don't invent image/upload variants)
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
    urls.push(
      `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/fakro-products/${file}`,
    );
  }
  if (cleaned.startsWith("image/upload/")) {
    urls.unshift(`https://res.cloudinary.com/${SOURCE_CLOUD}/${cleaned}`);
  } else if (cleaned.startsWith("video/upload/")) {
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
        headers: { "User-Agent": "LinxLivingGallerySync/1.0" },
      });
      if (!res.ok) {
        lastErr = new Error(`download ${res.status}: ${url}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) {
        lastErr = new Error(`empty: ${url}`);
        continue;
      }
      return { buffer, sourceUrl: url };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("no candidates");
}

function isVideoUrl(pathOrUrl) {
  const raw = cleanText(pathOrUrl).toLowerCase();
  if (!raw) return false;
  if (/\/video\/upload\//.test(raw)) return true;
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(raw)) return true;
  return false;
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

async function migrateImage(pathOrUrl, publicIdHint) {
  const raw = cleanText(pathOrUrl);
  if (isDestCloudUrl(raw)) return raw;

  const candidates = candidateUrls(pathOrUrl);
  if (!candidates.length) return null;

  const cacheKey = candidates[0];
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

  if (DRY_RUN) {
    imageCache.set(cacheKey, `dry://${imageFingerprint(pathOrUrl)}`);
    return imageCache.get(cacheKey);
  }

  const video = isVideoUrl(pathOrUrl) || candidates.some(isVideoUrl);
  const resourceType = video ? "video" : "image";
  const base =
    slugify(
      publicIdHint || imageFingerprint(pathOrUrl) || `media-${Date.now()}`,
    ) || `media-${Date.now()}`;

  // Prefer Cloudinary remote fetch — required for large videos
  let lastRemoteErr = null;
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
      lastRemoteErr = e;
    }
  }

  if (video) {
    throw (
      lastRemoteErr || new Error(`video upload failed: ${candidates[0]}`)
    );
  }

  const { buffer, sourceUrl } = await downloadFirstOk(candidates);
  if (buffer.length > 10_000_000) {
    throw new Error(
      `File size too large after download (${buffer.length}). Source: ${sourceUrl}`,
    );
  }
  const destUrl = await uploadBuffer(buffer, base, resourceType);
  for (const c of candidates) imageCache.set(c, destUrl);
  return destUrl;
}

/** Same sequence as Linx Glass buildProductImageList — images + videos. */
function buildGlassImageSequence(primary, galleryRows) {
  const sorted = [...galleryRows].sort(
    (a, b) =>
      (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
      String(a.image_url).localeCompare(String(b.image_url)),
  );
  let galleryUrls = sorted.map((r) => r.image_url).filter(Boolean);
  if (MAX_GALLERY_IMAGES > 0) {
    galleryUrls = galleryUrls.slice(0, MAX_GALLERY_IMAGES);
  }

  const seen = new Set();
  const result = [];
  for (const url of [primary, ...galleryUrls]) {
    if (!url || !cleanText(url)) continue;
    const fp = imageFingerprint(url);
    const key = fp || cleanText(url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(url);
  }
  return result;
}

async function supabaseGet(pathname) {
  const res = await fetch(`${SOURCE_URL}${pathname}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
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

function fingerprintsEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every(
    (u, i) => normalizeFp(imageFingerprint(u)) === normalizeFp(imageFingerprint(b[i])),
  );
}

async function main() {
  if (!SOURCE_URL || !SOURCE_KEY) {
    throw new Error("Missing SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SERVICE_ROLE_KEY");
  }
  if (
    !process.env.MONGODB_URI ||
    !DEST_CLOUD ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("Missing Mongo / dest Cloudinary env");
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

  const onlySkus = (process.env.SKUS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (onlySkus.length) {
    const set = new Set(onlySkus.map((s) => s.toLowerCase()));
    products = products.filter((p) =>
      set.has(String(p.specs?.sku || "").toLowerCase()),
    );
  }

  if (LIMIT > 0) products = products.slice(0, LIMIT);

  const WITH_VIDEO = process.env.WITH_VIDEO === "1";

  console.log(
    `Syncing gallery order for ${products.length} Fakro products | dry=${DRY_RUN} | maxGallery=${MAX_GALLERY_IMAGES || "∞"} | withVideoFilter=${WITH_VIDEO}`,
  );

  const skus = products.map((p) => p.specs?.sku).filter(Boolean);
  const sourceBySku = new Map();
  const galleryBySku = new Map();

  const chunkSize = 80;
  for (let i = 0; i < skus.length; i += chunkSize) {
    const chunk = skus.slice(i, i + chunkSize);
    const inList = chunk.map(encodeURIComponent).join(",");
    const rows = await supabaseGet(
      `/rest/v1/shop_products?sku=in.(${inList})&select=sku,image_path`,
    );
    for (const row of rows) sourceBySku.set(row.sku, row);

    const imgs = await supabaseGet(
      `/rest/v1/shop_product_images?sku=in.(${inList})&select=sku,image_url,sort_order&order=sort_order.asc`,
    );
    for (const row of imgs) {
      if (!galleryBySku.has(row.sku)) galleryBySku.set(row.sku, []);
      galleryBySku.get(row.sku).push(row);
    }
  }

  console.log(
    `  source products: ${sourceBySku.size} | gallery skus: ${galleryBySku.size}`,
  );

  if (WITH_VIDEO) {
    products = products.filter((p) => {
      const sku = p.specs?.sku;
      if (!sku) return false;
      const seq = buildGlassImageSequence(
        sourceBySku.get(sku)?.image_path,
        galleryBySku.get(sku) || [],
      );
      return seq.some(isVideoUrl);
    });
    console.log(`  with-video products: ${products.length}`);
  }

  const report = {
    updated: 0,
    unchanged: 0,
    failed: 0,
    uploaded: 0,
    missingSource: 0,
    imageFails: 0,
  };
  let samplesLeft = SAMPLE ? 5 : 0;

  await mapPool(products, CONCURRENCY, async (product, index) => {
    const sku = product.specs?.sku;
    if (!sku) {
      report.failed++;
      return;
    }

    const src = sourceBySku.get(sku);
    if (!src) {
      report.missingSource++;
      return;
    }

    const glassSequence = buildGlassImageSequence(
      src.image_path,
      galleryBySku.get(sku) || [],
    );

    if (!glassSequence.length) {
      report.unchanged++;
      return;
    }

    // Map fingerprint → existing dest URL on this product
    const byFp = buildFingerprintIndex(product.images || []);

    const nextImages = [];
    try {
      for (let i = 0; i < glassSequence.length; i++) {
        const sourcePath = glassSequence[i];
        let dest = lookupDest(byFp, sourcePath);

        if (!dest || (!isDestCloudUrl(dest) && !String(dest).startsWith("dry://"))) {
          try {
            dest = await migrateImage(
              sourcePath,
              `p-${sku}-${i + 1}-${imageFingerprint(sourcePath) || "img"}`,
            );
            if (dest && isDestCloudUrl(dest)) {
              report.uploaded++;
              const fp = imageFingerprint(sourcePath);
              const norm = normalizeFp(fp);
              if (fp) byFp.set(fp, dest);
              if (norm) byFp.set(norm, dest);
            }
          } catch (imgErr) {
            report.imageFails = (report.imageFails || 0) + 1;
            console.warn(`  ! ${sku} frame ${i + 1}: ${imgErr.message}`);
            dest = null;
          }
        }

        if (dest) {
          // Keep duplicate slots when Glass lists the same asset twice
          nextImages.push(dest);
        }
      }
    } catch (e) {
      report.failed++;
      console.warn(`  ✗ ${sku}: ${e.message}`);
      return;
    }

    if (!nextImages.length) {
      report.failed++;
      console.warn(`  ✗ ${sku}: no images after sync`);
      return;
    }

    const current = product.images || [];
    const same =
      current.length === nextImages.length &&
      current.every((u, i) => u === nextImages[i]);

    // Also treat fingerprint-equal as unchanged when dry-run placeholders differ
    const sameFp = fingerprintsEqual(current, nextImages);

    if (same || (DRY_RUN && sameFp && current.length === glassSequence.length)) {
      report.unchanged++;
      return;
    }

    if (!sameFp || current.length !== nextImages.length) {
      if (samplesLeft > 0) {
        samplesLeft--;
        console.log(`\n  SAMPLE ${sku}`);
        console.log(
          `    before: ${current.map(imageFingerprint).join(" → ") || "(none)"}`,
        );
        console.log(
          `    glass:  ${glassSequence.map(imageFingerprint).join(" → ")}`,
        );
        console.log(
          `    after:  ${nextImages.map(imageFingerprint).join(" → ")}`,
        );
      }

      if (!DRY_RUN) {
        await productsCol.updateOne(
          { _id: product._id },
          { $set: { images: nextImages, updatedAt: new Date() } },
        );
      }
      report.updated++;
    } else {
      report.unchanged++;
    }

    if ((index + 1) % 100 === 0 || index === 0) {
      console.log(
        `  … ${index + 1}/${products.length} updated=${report.updated} unchanged=${report.unchanged} failed=${report.failed}`,
      );
    }
  });

  console.log("\nDone:", report);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
