/**
 * Retry scrape/upload for UFHS products missing Cloudinary images.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/restore-ufhs-missing-images.cjs
 *   DRY_RUN=1
 */
const path = require("path");
const fs = require("fs");
const dns = require("dns");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const sharp = require("sharp");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BASE = "https://www.theunderfloorheatingstore.com";
const BRAND_SLUG = "the-under-floor-heating";
const CLOUDINARY_FOLDER = "linx-living/products/the-under-floor-heating";
const LOG = path.join(__dirname, "_tmp-ufhs-restore-images.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 8));

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function hasCloudinary(images) {
  return (images || []).some(
    (u) => typeof u === "string" && /cloudinary\.com/i.test(u),
  );
}

function absUrl(u) {
  let s = String(u || "")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&")
    .trim();
  if (!s) return "";
  if (s.startsWith("//")) s = `https:${s}`;
  if (s.startsWith("/")) s = `${BASE}${s}`;
  return s;
}

function isLogoOrPlaceholder(url) {
  return /logo|icon|badge|spacer|1x1|placeholder|favicon|payment|avatar/i.test(
    url,
  );
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0",
      Accept: "text/html,application/json,*/*",
    },
  });
  return { status: res.status, text: await res.text() };
}

async function fetchProductDetail(handle) {
  const { status, text } = await fetchText(
    `${BASE}/products/${encodeURIComponent(handle)}.json`,
  );
  if (status !== 200) return null;
  try {
    return JSON.parse(text)?.product || null;
  } catch {
    return null;
  }
}

function imagesFromDetail(detail) {
  return (detail?.images || [])
    .map((img) => (typeof img === "string" ? img : img?.src))
    .map(absUrl)
    .filter((u) => /^https?:\/\//i.test(u) && !isLogoOrPlaceholder(u));
}

async function imagesFromHtml(handle) {
  const { status, text } = await fetchText(
    `${BASE}/products/${encodeURIComponent(handle)}`,
  );
  if (status !== 200) return [];
  const out = [];
  const og =
    text.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    text.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1];
  if (og) out.push(absUrl(og));

  for (const m of text.matchAll(
    /https?:\/\/cdn\.shopify\.com\/[^"'\\\s>]+\.(?:jpg|jpeg|png|webp)[^"'\\\s>]*/gi,
  )) {
    out.push(absUrl(m[0]));
  }
  for (const m of text.matchAll(
    /\/\/(?:cdn\.shopify\.com|www\.theunderfloorheatingstore\.com)\/[^"'\\\s>]+\.(?:jpg|jpeg|png|webp)[^"'\\\s>]*/gi,
  )) {
    out.push(absUrl(m[0]));
  }

  // Featured media in Shopify JSON blobs
  for (const m of text.matchAll(
    /"(?:src|preview_image)"\s*:\s*"(https?:[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
  )) {
    out.push(absUrl(m[1]));
  }

  return [...new Set(out)].filter((u) => !isLogoOrPlaceholder(u));
}

async function searchSuggest(query) {
  const q = encodeURIComponent(query);
  const { status, text } = await fetchText(
    `${BASE}/search/suggest.json?q=${q}&resources[type]=product&resources[limit]=8`,
  );
  if (status !== 200) return [];
  try {
    return JSON.parse(text)?.resources?.results?.products || [];
  } catch {
    return [];
  }
}

function shrinkShopifyUrl(url) {
  const raw = String(url || "").trim();
  if (!/cdn\.shopify\.com/i.test(raw)) return raw.split("?")[0];
  // Prefer a width-capped Shopify CDN variant under Cloudinary's 10MB limit
  try {
    const u = new URL(raw);
    u.searchParams.set("width", "1600");
    return u.toString();
  } catch {
    return raw.includes("?") ? `${raw}&width=1600` : `${raw}?width=1600`;
  }
}

async function prepareUploadBuffer(buf) {
  // Cloudinary free/standard limit is 10MB — resize oversized sources first
  if (buf.length < 9_000_000) return buf;
  return sharp(buf)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

async function uploadBuffer(buf, publicId) {
  const prepared = await prepareUploadBuffer(buf);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: String(publicId).slice(0, 180),
        overwrite: true,
        invalidate: true,
        resource_type: "image",
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result.secure_url);
      },
    );
    stream.end(prepared);
  });
}

async function uploadRemoteImage(imageUrl, publicId) {
  const candidates = [
    shrinkShopifyUrl(imageUrl),
    String(imageUrl || "").split("?")[0],
  ].filter(Boolean);
  if (DRY_RUN) return candidates[0];

  let lastErr;
  for (const clean of [...new Set(candidates)]) {
    try {
      // Always fetch locally so we can shrink >10MB files before Cloudinary
      const res = await fetch(clean, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: `${BASE}/`,
          Accept: "image/*,*/*;q=0.8",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 400) throw new Error("image too small");
      return await uploadBuffer(buf, publicId);
    } catch (e) {
      lastErr = e;
      try {
        // Fallback: direct remote upload (works for smaller files)
        const result = await cloudinary.uploader.upload(clean, {
          folder: CLOUDINARY_FOLDER,
          public_id: String(publicId).slice(0, 180),
          overwrite: true,
          invalidate: true,
          resource_type: "image",
        });
        return result.secure_url;
      } catch (e2) {
        lastErr = e2;
      }
    }
  }
  throw lastErr || new Error("upload failed");
}

async function resolveSources(product) {
  const handle = String(
    product.specs?.ufhsHandle || product.specs?.sourceHandle || "",
  ).trim();
  const sources = [];
  let usedHandle = handle;

  if (handle) {
    const detail = await fetchProductDetail(handle);
    sources.push(...imagesFromDetail(detail));
    if (!sources.length) {
      sources.push(...(await imagesFromHtml(handle)));
    }
  }

  if (!sources.length) {
    const queries = [
      product.name,
      handle?.replace(/-/g, " "),
      product.specs?.sku,
    ].filter(Boolean);
    for (const q of queries) {
      const hits = await searchSuggest(String(q).slice(0, 80));
      for (const hit of hits.slice(0, 3)) {
        const img =
          hit.image?.url ||
          hit.image ||
          hit.featured_image?.url ||
          hit.featured_image;
        if (typeof img === "string" && img) sources.push(absUrl(img));
        if (hit.handle) {
          usedHandle = hit.handle;
          const detail = await fetchProductDetail(hit.handle);
          sources.push(...imagesFromDetail(detail));
          if (!sources.length) {
            sources.push(...(await imagesFromHtml(hit.handle)));
          }
        }
        if (sources.length) break;
      }
      if (sources.length) break;
    }
  }

  return {
    handle: usedHandle || handle,
    sources: [...new Set(sources)].slice(0, MAX_IMAGES),
  };
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
}

async function main() {
  fs.writeFileSync(LOG, `UFHS image restore ${new Date().toISOString()}\n`);
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (
    !DRY_RUN &&
    (!process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET)
  ) {
    throw new Error("Missing Cloudinary credentials");
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("UFHS brand not found");

  const products = await db
    .collection("products")
    .find({ brand: brand._id })
    .toArray();
  const missing = products.filter((p) => !hasCloudinary(p.images));
  log(`Missing Cloudinary images: ${missing.length}`);

  let updated = 0;
  let stillMissing = 0;
  let failed = 0;

  await mapPool(missing, CONCURRENCY, async (p, idx) => {
    const label = `[${idx + 1}/${missing.length}]`;
    try {
      const { handle, sources } = await resolveSources(p);
      if (!sources.length) {
        stillMissing += 1;
        log(`${label} NO IMAGES ${String(p.name).slice(0, 70)} handle=${handle}`);
        return;
      }

      const uploaded = [];
      const pidBase = slugify(handle || p.name || String(p._id));
      for (let i = 0; i < sources.length; i++) {
        try {
          const url = await uploadRemoteImage(
            sources[i],
            `fix-${pidBase}-${i + 1}`,
          );
          if (url) uploaded.push(url);
        } catch (e) {
          log(`${label} img fail: ${e.message}`);
        }
      }

      if (!uploaded.length) {
        stillMissing += 1;
        log(`${label} UPLOAD FAIL ${String(p.name).slice(0, 70)}`);
        return;
      }

      const specs = {
        ...(p.specs || {}),
        ufhsHandle: handle || p.specs?.ufhsHandle,
        sourceUrl: handle
          ? `${BASE}/products/${handle}`
          : p.specs?.sourceUrl,
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] ${String(p.name).slice(0, 50)} imgs=${uploaded.length}`,
        );
      } else {
        await db.collection("products").updateOne(
          { _id: p._id, brand: brand._id },
          {
            $set: {
              images: uploaded,
              specs,
              updatedAt: new Date(),
            },
          },
        );
        log(
          `${label} ok ${String(p.name).slice(0, 50)} imgs=${uploaded.length}`,
        );
      }
      updated += 1;
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${e.message}`);
    }
  });

  log(
    `\nDone updated=${updated} stillMissing=${stillMissing} failed=${failed}`,
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
