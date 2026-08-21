/**
 * Restore Direct Flooring Online products missing Cloudinary images.
 * Sources: directflooringonline.co.uk WC Store API (+ working Shopify CDN fallback).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/restore-dfo-missing-images.cjs
 *   DRY_RUN=1 CONCURRENCY=2
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
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BASE = "https://directflooringonline.co.uk";
const BRAND_SLUG = "direct-flooring-online";
const CLOUDINARY_FOLDER = "linx-living/products/direct-flooring-online";
const LOG = path.join(__dirname, "_tmp-dfo-restore-images.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 8));

function log(...args) {
  const line = args.map(String).join(" ");
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
    (i) => typeof i === "string" && /cloudinary\.com/i.test(i),
  );
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function uploadImage(imageUrl, publicId) {
  const raw = String(imageUrl || "").trim();
  const clean = /cdn\.shopify\.com|shopifycdn/i.test(raw)
    ? raw
    : raw.split("?")[0];
  if (DRY_RUN) return clean.split("?")[0];
  try {
    const result = await cloudinary.uploader.upload(clean, {
      folder: CLOUDINARY_FOLDER,
      public_id: String(publicId).slice(0, 180),
      overwrite: true,
      resource_type: "image",
    });
    return result.secure_url;
  } catch (e) {
    // Buffer fallback
    const res = await fetch(clean, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: BASE + "/",
        Accept: "image/*,*/*;q=0.8",
      },
    });
    if (!res.ok) throw e;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) throw e;
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: CLOUDINARY_FOLDER,
          public_id: String(publicId).slice(0, 180),
          overwrite: true,
          resource_type: "image",
        },
        (err, result) => (err ? reject(err) : resolve(result.secure_url)),
      );
      stream.end(buf);
    });
  }
}

async function resolveDfoImages(product) {
  const images = [];
  const push = (u) => {
    const url = String(u || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (/logo|svg|favicon|placeholder|woocommerce-placeholder/i.test(url)) return;
    if (!images.includes(url)) images.push(url);
  };

  const sourceUrl = product.specs?.sourceUrl || "";
  const slug =
    product.specs?.dfoSlug ||
    (sourceUrl.match(/\/product\/([^/]+)/) || [])[1] ||
    "";
  const sku = String(product.specs?.dfoSku || product.specs?.sku || "").trim();

  async function pullStore(item) {
    if (!item) return;
    for (const img of item.images || []) push(img.src || img.thumbnail);
    if (item.id) {
      try {
        const media = await fetchJson(
          `${BASE}/wp-json/wp/v2/media?parent=${item.id}&per_page=20`,
        );
        for (const m of media || []) push(m.source_url || m.guid?.rendered);
      } catch {
        /* ignore */
      }
    }
  }

  if (slug) {
    try {
      const data = await fetchJson(
        `${BASE}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`,
      );
      await pullStore(Array.isArray(data) ? data[0] : null);
    } catch (e) {
      log(`  slug api fail: ${e.message}`);
    }
  }

  if (!images.length && sku) {
    try {
      const data = await fetchJson(
        `${BASE}/wp-json/wc/store/v1/products?search=${encodeURIComponent(sku)}&per_page=5`,
      );
      const item = Array.isArray(data)
        ? data.find(
            (p) =>
              String(p.sku || "").toUpperCase() === sku.toUpperCase() ||
              String(p.slug || "") === slug,
          ) || data[0]
        : null;
      await pullStore(item);
    } catch (e) {
      log(`  sku search fail: ${e.message}`);
    }
  }

  if (!images.length && sourceUrl) {
    try {
      const html = await fetch(sourceUrl, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
      }).then((r) => r.text());
      for (const m of html.matchAll(
        /https?:\/\/[^"'\\\s]+\/wp-content\/uploads\/[^"'\\\s]+\.(?:jpe?g|png|webp)/gi,
      )) {
        push(m[0]);
      }
    } catch (e) {
      log(`  html fail: ${e.message}`);
    }
  }

  // Working Shopify / existing URLs as last resort
  for (const raw of product.images || []) {
    const u = String(raw || "").trim();
    if (!u || /cloudinary\.com/i.test(u)) continue;
    push(u);
  }

  // Validate downloadable
  const valid = [];
  for (const img of images) {
    if (valid.length >= MAX_IMAGES) break;
    try {
      const res = await fetch(img, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: BASE + "/",
          Accept: "image/*,*/*;q=0.8",
        },
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 500) valid.push(img);
    } catch {
      /* skip */
    }
  }

  valid.sort((a, b) => {
    const score = (u) =>
      /directflooringonline\.co\.uk|wp-content\/uploads/i.test(u)
        ? 0
        : /shopify/i.test(u)
          ? 2
          : 1;
    return score(a) - score(b);
  });

  return valid.slice(0, MAX_IMAGES);
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

(async () => {
  fs.writeFileSync(LOG, `DFO image restore ${new Date().toISOString()}\n`);
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
  if (!brand) throw new Error("Direct Flooring Online brand not found");

  let products = await db.collection("products").find({ brand: brand._id }).toArray();
  products = products.filter((p) => !hasCloudinary(p.images));
  log(`Fixing ${products.length} products missing Cloudinary images`);

  let updated = 0;
  let failed = 0;
  let stillMissing = 0;

  await mapPool(products, CONCURRENCY, async (p, idx) => {
    const label = `[${idx + 1}/${products.length}]`;
    const name = String(p.name || "").slice(0, 70);
    try {
      log(`${label} ${name}`);
      const candidates = await resolveDfoImages(p);
      if (!candidates.length) {
        stillMissing += 1;
        log(`${label} NO SOURCE IMAGES`);
        return;
      }

      const handle = slugify(
        p.specs?.dfoSlug || p.specs?.sku || p.name || String(p._id),
      );
      const uploaded = [];
      for (let i = 0; i < candidates.length; i++) {
        try {
          const url = await uploadImage(candidates[i], `fix-${handle}-${i + 1}`);
          if (url) uploaded.push(url);
        } catch (e) {
          log(`${label} upload fail: ${e.message}`);
        }
      }

      if (!uploaded.length) {
        stillMissing += 1;
        log(`${label} UPLOAD FAILED`);
        return;
      }

      if (!DRY_RUN) {
        await db.collection("products").updateOne(
          { _id: p._id },
          { $set: { images: uploaded, updatedAt: new Date() } },
        );
      }
      updated += 1;
      log(`${label} ok imgs=${uploaded.length}`);
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${e.message}`);
    }
  });

  log(`\nDone updated=${updated} failed=${failed} stillMissing=${stillMissing}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
