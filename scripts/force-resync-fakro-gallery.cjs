/**
 * Force-rebuild Fakro galleries from exact Linx Glass source URLs.
 * Always re-uploads from the Glass URL (no fingerprint reuse) so content matches.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/force-resync-fakro-gallery.cjs
 *
 * Options:
 *   SKUS=SKU1,SKU2     — only these SKUs (default: all with gallery rows, or ALL=1)
 *   ALL=1              — every Fakro product
 *   DRY_RUN=1
 *   CONCURRENCY=2
 *   VERIFY=1           — after upload, compare byte length to source
 */
const path = require("path");
const crypto = require("crypto");
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
const DEST_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const SOURCE_CLOUD =
  process.env.SOURCE_CLOUDINARY_CLOUD_NAME || "dkuqdi0ho";
const DRY_RUN = process.env.DRY_RUN === "1";
const ALL = process.env.ALL === "1";
const VERIFY = process.env.VERIFY !== "0";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const CLOUDINARY_FOLDER = "linx-living/products/fakro";
const SOURCE_TAG = "fakro-supabase";

const onlySkus = (process.env.SKUS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const headers = {
  apikey: SOURCE_KEY,
  Authorization: `Bearer ${SOURCE_KEY}`,
  Accept: "application/json",
};

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isVideoUrl(url) {
  const raw = cleanText(url).toLowerCase();
  return /\/video\/upload\//.test(raw) || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(raw);
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Resolve relative Glass paths to absolute download/upload URLs. */
function glassUrlCandidates(pathOrUrl) {
  const raw = cleanText(pathOrUrl);
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw)) return [raw];

  const cleaned = raw.replace(/^\//, "");
  const file = cleaned.split("/").pop();
  const urls = [];

  if (cleaned.startsWith("image/upload/") || cleaned.startsWith("video/upload/")) {
    urls.push(`https://res.cloudinary.com/${SOURCE_CLOUD}/${cleaned}`);
  } else if (cleaned.startsWith("linx-products/") || cleaned.startsWith("fakro-products/")) {
    urls.push(
      `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/${cleaned}`,
    );
  }

  if (file) {
    urls.push(`https://www.linxglass.co.uk/fakro-products/${file}`);
    urls.push(
      `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/linx-products/fakro/${file}`,
    );
    urls.push(
      `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/fakro-products/${file}`,
    );
    urls.push(
      `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/${cleaned}`,
    );
  }

  return [...new Set(urls.filter(Boolean))];
}

function basenameNoExt(url) {
  const raw = cleanText(url);
  try {
    const p = /^https?:\/\//i.test(raw) ? new URL(raw).pathname : raw;
    const last = p.split("/").filter(Boolean).pop() || "";
    return last.replace(/\.[a-z0-9]+$/i, "");
  } catch {
    return slugify(raw).slice(0, 80);
  }
}

/** Glass sequence: primary + gallery by sort_order, exact-URL dedupe. */
function buildGlassSequence(primary, galleryRows) {
  const sorted = [...galleryRows].sort(
    (a, b) =>
      (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
      String(a.image_url || "").localeCompare(String(b.image_url || "")),
  );
  const seen = new Set();
  const out = [];
  for (const url of [primary, ...sorted.map((r) => r.image_url)]) {
    if (!url || !cleanText(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

async function supabaseGet(pathname) {
  const res = await fetch(`${SOURCE_URL}${pathname}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function supabasePaged(pathname, pageSize = 1000) {
  const rows = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const res = await fetch(`${SOURCE_URL}${pathname}`, {
      headers: { ...headers, Range: `${from}-${to}`, Prefer: "count=exact" },
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

async function download(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "LinxLivingForceGallerySync/1.0" },
  });
  if (!res.ok) throw new Error(`download ${res.status}: ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error(`empty: ${url}`);
  return buffer;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Upload from exact Glass URL via Cloudinary remote fetch (preserves content). */
async function uploadFromGlassUrl(glassUrl, publicId) {
  if (DRY_RUN) return `dry://${publicId}`;
  const candidates = glassUrlCandidates(glassUrl);
  if (!candidates.length) throw new Error(`no candidates for ${glassUrl}`);

  const video = isVideoUrl(glassUrl) || candidates.some(isVideoUrl);
  const resourceType = video ? "video" : "image";
  let lastErr = null;

  for (const url of candidates) {
    try {
      const result = await cloudinary.uploader.upload(url, {
        folder: CLOUDINARY_FOLDER,
        public_id: publicId.slice(0, 180),
        overwrite: true,
        invalidate: true,
        resource_type: resourceType,
        timeout: video ? 300000 : 120000,
      });
      if (result?.secure_url) return result.secure_url;
    } catch (e) {
      lastErr = e;
    }
  }

  if (video) throw lastErr || new Error(`video upload failed: ${glassUrl}`);

  // Fallback: download first working candidate then stream upload
  let buffer = null;
  for (const url of candidates) {
    try {
      buffer = await download(url);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!buffer) throw lastErr || new Error(`download failed: ${glassUrl}`);

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: publicId.slice(0, 180),
        overwrite: true,
        invalidate: true,
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
  if (!SOURCE_URL || !SOURCE_KEY) throw new Error("Missing source Supabase");
  if (!process.env.MONGODB_URI || !DEST_CLOUD) {
    throw new Error("Missing Mongo / Cloudinary");
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

  if (onlySkus.length) {
    const set = new Set(onlySkus.map((s) => s.toLowerCase()));
    products = products.filter((p) =>
      set.has(String(p.specs?.sku || "").toLowerCase()),
    );
  }

  const skus = products.map((p) => p.specs?.sku).filter(Boolean);
  const sourceBySku = new Map();
  const galleryBySku = new Map();
  const chunkSize = 80;

  console.log(`Loading Glass source for ${skus.length} products…`);
  for (let i = 0; i < skus.length; i += chunkSize) {
    const chunk = skus.slice(i, i + chunkSize);
    const inList = chunk.map(encodeURIComponent).join(",");
    const rows = await supabaseGet(
      `/rest/v1/shop_products?sku=in.(${inList})&select=sku,image_path`,
    );
    for (const row of rows) sourceBySku.set(row.sku, row);
    const imgs = await supabasePaged(
      `/rest/v1/shop_product_images?sku=in.(${inList})&select=sku,image_url,sort_order&order=sort_order.asc`,
    );
    for (const row of imgs) {
      if (!galleryBySku.has(row.sku)) galleryBySku.set(row.sku, []);
      galleryBySku.get(row.sku).push(row);
    }
  }

  if (!ALL && !onlySkus.length) {
    // Default: products that have gallery rows OR more than 1 expected media
    products = products.filter((p) => {
      const sku = p.specs?.sku;
      const gal = galleryBySku.get(sku) || [];
      const seq = buildGlassSequence(sourceBySku.get(sku)?.image_path, gal);
      return seq.length > 1 || gal.length > 0;
    });
  }

  console.log(
    `Force re-sync ${products.length} products | dry=${DRY_RUN} | verify=${VERIFY}`,
  );

  const report = {
    updated: 0,
    failed: 0,
    frames: 0,
    contentMismatch: 0,
  };

  await mapPool(products, CONCURRENCY, async (product, index) => {
    const sku = product.specs?.sku;
    if (!sku) return;
    const src = sourceBySku.get(sku);
    if (!src) {
      report.failed++;
      console.warn(`  ✗ ${sku}: missing source`);
      return;
    }

    const glassSeq = buildGlassSequence(
      src.image_path,
      galleryBySku.get(sku) || [],
    );
    if (!glassSeq.length) return;

    const next = [];
    try {
      for (let i = 0; i < glassSeq.length; i++) {
        const glassUrl = glassSeq[i];
        const base = basenameNoExt(glassUrl) || `frame-${i + 1}`;
        // Unique public_id per frame — never reuse wrong prior uploads
        const publicId = slugify(`${sku}-g${i + 1}-${base}`).slice(0, 180);
        const destUrl = await uploadFromGlassUrl(glassUrl, publicId);

        if (VERIFY && !DRY_RUN && !isVideoUrl(glassUrl)) {
          try {
            const srcCandidates = glassUrlCandidates(glassUrl);
            let srcBuf = null;
            for (const c of srcCandidates) {
              try {
                srcBuf = await download(c);
                break;
              } catch {
                /* next */
              }
            }
            const destBuf = await download(destUrl);
            if (srcBuf && sha256(srcBuf) !== sha256(destBuf)) {
              if (srcBuf.length !== destBuf.length) {
                report.contentMismatch++;
                console.warn(
                  `  ! ${sku} frame ${i + 1}: size ${srcBuf.length}→${destBuf.length}`,
                );
              }
            }
          } catch (e) {
            console.warn(`  ! ${sku} verify ${i + 1}: ${e.message}`);
          }
        }

        next.push(destUrl);
        report.frames++;
      }

      if (!DRY_RUN) {
        await productsCol.updateOne(
          { _id: product._id },
          { $set: { images: next, updatedAt: new Date() } },
        );
      }
      report.updated++;
      console.log(
        `  ✓ ${sku} (${next.length} frames)  [${index + 1}/${products.length}]`,
      );
    } catch (e) {
      report.failed++;
      console.warn(`  ✗ ${sku}: ${e.message}`);
    }
  });

  console.log("\nDone:", report);
  await mongoose.disconnect();
  if (report.failed) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
