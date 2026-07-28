/**
 * Retry Fakro product images that failed or still point at the source cloud.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/retry-fakro-images.cjs
 *
 * Options:
 *   DRY_RUN=1
 *   LIMIT=50
 *   CONCURRENCY=3
 *   ONLY_MISSING=1   — only products with no images (default: also re-upload source-cloud URLs)
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
const ONLY_MISSING = process.env.ONLY_MISSING === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const MAX_GALLERY_IMAGES = Math.max(
  0,
  Number(process.env.MAX_GALLERY_IMAGES || 6),
);
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

function isDestCloudUrl(url) {
  return (
    typeof url === "string" &&
    url.includes(`res.cloudinary.com/${DEST_CLOUD}/`)
  );
}

function isSourceOrRelative(url) {
  if (!url || typeof url !== "string") return true;
  if (isDestCloudUrl(url)) return false;
  if (url.includes(`res.cloudinary.com/${SOURCE_CLOUD}/`)) return true;
  if (url.startsWith("/")) return true;
  if (/linxglass\.co\.uk/i.test(url)) return true;
  return !/^https?:\/\//i.test(url);
}

/** Candidate absolute URLs to try for a source path/URL */
function candidateUrls(pathOrUrl) {
  const raw = cleanText(pathOrUrl);
  if (!raw) return [];

  if (/^https?:\/\//i.test(raw)) {
    const urls = [raw];
    // If it's already a dest URL, nothing to do
    if (isDestCloudUrl(raw)) return [];
    // Also try stripping transforms / trying file basename on known folder
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

  if (cleaned.startsWith("fakro-products/") || file) {
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
        headers: { "User-Agent": "LinxLivingFakroImageRetry/1.0" },
      });
      if (!res.ok) {
        lastErr = new Error(`download ${res.status}: ${url}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) {
        lastErr = new Error(`empty body: ${url}`);
        continue;
      }
      return { buffer, sourceUrl: url };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("no candidates");
}

function uploadBuffer(buffer, publicId) {
  const ext = (publicId.match(/\.(gif|webp|png|jpe?g)$/i) || [])[1];
  const resourceType = ext === "gif" ? "auto" : "image";
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
  const candidates = candidateUrls(pathOrUrl);
  if (!candidates.length) {
    // Already on dest cloud
    const raw = cleanText(pathOrUrl);
    return isDestCloudUrl(raw) ? raw : null;
  }

  const cacheKey = candidates[0];
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

  if (DRY_RUN) {
    imageCache.set(cacheKey, candidates[0]);
    return candidates[0];
  }

  const { buffer, sourceUrl } = await downloadFirstOk(candidates);
  const base =
    slugify(publicIdHint || path.basename(sourceUrl).replace(/\.[^.]+$/, "")) ||
    `img-${Date.now()}`;
  const destUrl = await uploadBuffer(buffer, base);
  imageCache.set(cacheKey, destUrl);
  // Cache all candidates to dest
  for (const c of candidates) imageCache.set(c, destUrl);
  return destUrl;
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

async function main() {
  if (!SOURCE_URL || !SOURCE_KEY) {
    throw new Error("Missing source Supabase credentials in .env.migrate");
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
  const all = await productsCol
    .find({ brand: brand._id, "specs.source": SOURCE_TAG })
    .project({
      _id: 1,
      name: 1,
      images: 1,
      "specs.sku": 1,
    })
    .toArray();

  let targets = all.filter((p) => {
    const images = Array.isArray(p.images) ? p.images : [];
    if (!images.length) return true;
    if (ONLY_MISSING) return false;
    return images.some(isSourceOrRelative);
  });

  if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  console.log(
    `Fakro products: ${all.length} | needing image retry: ${targets.length} | dry=${DRY_RUN}`,
  );

  if (!targets.length) {
    await mongoose.disconnect();
    return;
  }

  const skus = targets.map((p) => p.specs?.sku).filter(Boolean);
  const sourceBySku = new Map();
  const galleryBySku = new Map();

  const chunkSize = 80;
  for (let i = 0; i < skus.length; i += chunkSize) {
    const chunk = skus.slice(i, i + chunkSize);
    const rows = await supabaseGet(
      `/rest/v1/shop_products?sku=in.(${chunk.map(encodeURIComponent).join(",")})&select=sku,image_path,id`,
    );
    for (const row of rows) sourceBySku.set(row.sku, row);

    if (MAX_GALLERY_IMAGES > 0) {
      const imgs = await supabaseGet(
        `/rest/v1/shop_product_images?sku=in.(${chunk.map(encodeURIComponent).join(",")})&select=sku,image_url,sort_order&order=sort_order.asc`,
      );
      for (const row of imgs) {
        if (!galleryBySku.has(row.sku)) galleryBySku.set(row.sku, []);
        galleryBySku.get(row.sku).push(row.image_url);
      }
    }
  }

  const report = { updated: 0, unchanged: 0, failed: 0, imageFails: 0 };

  await mapPool(targets, CONCURRENCY, async (product, index) => {
    const sku = product.specs?.sku;
    const label = `${sku || product._id} · ${cleanText(product.name).slice(0, 50)}`;
    try {
      const src = sku ? sourceBySku.get(sku) : null;
      const imageUrls = [];

      // Keep any already-migrated dest URLs
      for (const img of product.images || []) {
        if (isDestCloudUrl(img) && !imageUrls.includes(img)) imageUrls.push(img);
      }

      const primary = src?.image_path;
      if (primary) {
        try {
          const url = await migrateImage(primary, `p-${sku || product._id}-1`);
          if (url && !imageUrls.includes(url)) {
            // Prefer new primary at front
            imageUrls.unshift(url);
          }
        } catch (e) {
          report.imageFails++;
          console.warn(`  ! primary ${label}: ${e.message}`);
        }
      }

      // If still no primary but mongo had source URLs, try migrating those
      if (!imageUrls.length) {
        for (let i = 0; i < (product.images || []).length; i++) {
          const img = product.images[i];
          if (!isSourceOrRelative(img)) continue;
          try {
            const url = await migrateImage(img, `p-${sku || product._id}-retry-${i}`);
            if (url && !imageUrls.includes(url)) imageUrls.push(url);
          } catch (e) {
            report.imageFails++;
          }
        }
      }

      const gallery = (galleryBySku.get(sku) || []).slice(0, MAX_GALLERY_IMAGES);
      let gi = 2;
      for (const g of gallery) {
        if (imageUrls.length >= 1 + MAX_GALLERY_IMAGES) break;
        try {
          const url = await migrateImage(g, `p-${sku}-${gi++}`);
          if (url && !imageUrls.includes(url)) imageUrls.push(url);
        } catch {
          report.imageFails++;
        }
      }

      // Dedupe while preserving order
      const unique = [...new Set(imageUrls.filter(Boolean))];

      if (!unique.length) {
        report.failed++;
        console.warn(`  ✗ no images: ${label}`);
        return;
      }

      const same =
        unique.length === (product.images || []).length &&
        unique.every((u, i) => u === product.images[i]);

      if (same) {
        report.unchanged++;
        return;
      }

      if (!DRY_RUN) {
        await productsCol.updateOne(
          { _id: product._id },
          { $set: { images: unique, updatedAt: new Date() } },
        );
      }
      report.updated++;
      if ((index + 1) % 25 === 0 || index === 0) {
        console.log(
          `  … ${index + 1}/${targets.length} updated=${report.updated} failed=${report.failed} cache=${imageCache.size}`,
        );
      }
    } catch (err) {
      report.failed++;
      console.error(`  ✗ ${label}:`, err.message);
    }
  });

  console.log("\n========== FAKRO IMAGE RETRY ==========");
  console.log(`Updated:   ${report.updated}`);
  console.log(`Unchanged: ${report.unchanged}`);
  console.log(`Failed:    ${report.failed}`);
  console.log(`Image errs:${report.imageFails}`);
  console.log(`Cache:     ${imageCache.size}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
