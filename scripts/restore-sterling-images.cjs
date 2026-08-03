/**
 * Restore Sterlingbuild product images from sterlingbuild.co.uk (via Jina)
 * for products with empty galleries or Shopify-only CDN URLs.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/restore-sterling-images.cjs
 *   DRY_RUN=1 LIMIT=10 CONCURRENCY=2 MAX_IMAGES=6
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

const BASE = "https://www.sterlingbuild.co.uk";
const SOURCE_TAG = "sterlingbuild-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/sterlingbuild";
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 6));
const REPORT = path.join(__dirname, "_tmp-sterling-restore-report.json");

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isShopify(u) {
  return /cdn\.shopify\.com|cdn\.shopifycdn\.net/i.test(String(u || ""));
}

function isCloudinary(u) {
  return /res\.cloudinary\.com|cloudinary\.com/i.test(String(u || ""));
}

function cleanImages(list) {
  return (Array.isArray(list) ? list : []).filter(
    (u) => typeof u === "string" && u.trim(),
  );
}

function needsRestore(p) {
  const imgs = cleanImages(p.images);
  if (!imgs.length) return true;
  const hasCloud = imgs.some(isCloudinary);
  const hasShop = imgs.some(isShopify);
  return hasShop && !hasCloud;
}

function sourceUrlOf(p) {
  return (
    cleanText(p.specs?.sourceUrl) ||
    cleanText(p.specs?.source_url) ||
    cleanText(p.descriptionSourceUrl) ||
    cleanText(p.sourceUrl) ||
    ""
  );
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchViaJina(url) {
  const endpoint = `https://r.jina.ai/${url}`;
  const res = await fetch(endpoint, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "LinxLivingSterlingRestore/1.0",
    },
  });
  if (!res.ok) {
    throw new Error(`Jina ${res.status} for ${url}`);
  }
  return res.text();
}

function extractSterlingImages(md) {
  const images = [];
  const pushImg = (raw) => {
    let u = String(raw || "").replace(/&amp;/g, "&").trim();
    if (!u) return;
    if (u.startsWith("//")) u = `https:${u}`;
    if (u.startsWith("/")) u = `${BASE}${u}`;
    if (!/^https?:\/\//i.test(u)) return;
    if (!/sterlingbuild\.co\.uk\/media\/catalog\/product\//i.test(u)) return;
    const clean = u.split("?")[0];
    if (!images.includes(clean)) images.push(clean);
  };
  for (const m of md.matchAll(
    /https:\/\/www\.sterlingbuild\.co\.uk\/media\/catalog\/product\/[^\s)"']+/gi,
  )) {
    pushImg(m[0]);
  }
  for (const m of md.matchAll(/!\[[^\]]*\]\((https?:[^)]+)\)/g)) {
    pushImg(m[1]);
  }
  return images;
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = String(imageUrl).split("?")[0];
  const result = await cloudinary.uploader.upload(clean, {
    folder: CLOUDINARY_FOLDER,
    public_id: String(publicId).slice(0, 180),
    overwrite: true,
    resource_type: "image",
  });
  return result.secure_url;
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
  const brand = await db.collection("brands").findOne({ slug: "sterlingbuild" });
  if (!brand) throw new Error("Sterlingbuild brand not found");

  const productsCol = db.collection("products");
  let targets = await productsCol
    .find({
      $or: [{ brand: brand._id }, { "specs.source": SOURCE_TAG }],
    })
    .project({
      name: 1,
      images: 1,
      specs: 1,
      descriptionSourceUrl: 1,
      sourceUrl: 1,
    })
    .toArray();

  targets = targets.filter(needsRestore);
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  console.log(
    `Sterlingbuild needing restore: ${targets.length} (dry=${DRY_RUN} concurrency=${CONCURRENCY})`,
  );

  const report = {
    updated: 0,
    failed: 0,
    skippedNoSource: 0,
    skippedNoImages: 0,
    failures: [],
  };

  await mapPool(targets, CONCURRENCY, async (product, index) => {
    const label = `[${index + 1}/${targets.length}] ${cleanText(product.name).slice(0, 55)}`;
    const sourceUrl = sourceUrlOf(product);
    if (!sourceUrl || !/sterlingbuild\.co\.uk/i.test(sourceUrl)) {
      report.skippedNoSource++;
      report.failures.push(`${label}: no sterling sourceUrl`);
      console.warn(`  ✗ ${label}: no sourceUrl`);
      return;
    }

    try {
      const md = await fetchViaJina(sourceUrl);
      const found = extractSterlingImages(md).slice(0, MAX_IMAGES);
      if (!found.length) {
        report.skippedNoImages++;
        report.failures.push(`${label}: no media images on page`);
        console.warn(`  ✗ ${label}: no images on page`);
        return;
      }

      const handle =
        slugify(
          sourceUrl.replace(BASE, "").replace(/\//g, "-").replace(/^-|-$/g, ""),
        ) || slugify(product.name) || String(product._id);

      const uploaded = [];
      if (DRY_RUN) {
        uploaded.push(...found);
      } else {
        for (let i = 0; i < found.length; i++) {
          try {
            const url = await uploadRemoteImage(found[i], `${handle}-${i + 1}`);
            if (url) uploaded.push(url);
          } catch (e) {
            console.warn(`  ! ${label} img ${i + 1}: ${e.message}`);
          }
        }
      }

      // Keep any existing Cloudinary URLs
      for (const u of cleanImages(product.images).filter(isCloudinary)) {
        if (!uploaded.includes(u)) uploaded.unshift(u);
      }

      const unique = [...new Set(uploaded.filter(Boolean))];
      if (!unique.length) {
        report.failed++;
        report.failures.push(`${label}: upload produced nothing`);
        console.warn(`  ✗ ${label}: upload failed`);
        return;
      }

      if (!DRY_RUN) {
        await productsCol.updateOne(
          { _id: product._id },
          {
            $set: {
              images: unique,
              updatedAt: new Date(),
              "specs.sourceUrl": sourceUrl,
              "specs.source": SOURCE_TAG,
            },
          },
        );
      }

      report.updated++;
      if ((index + 1) % 5 === 0 || index === 0 || index === targets.length - 1) {
        console.log(
          `  … ${index + 1}/${targets.length} updated=${report.updated} failed=${report.failed} noSrc=${report.skippedNoSource}`,
        );
      }
      await delay(400);
    } catch (e) {
      report.failed++;
      report.failures.push(`${label}: ${e.message}`);
      console.error(`  ✗ ${label}:`, e.message);
    }
  });

  console.log("\n========== STERLING IMAGE RESTORE ==========");
  console.log(`Updated:         ${report.updated}`);
  console.log(`Failed:          ${report.failed}`);
  console.log(`No source URL:   ${report.skippedNoSource}`);
  console.log(`No page images:  ${report.skippedNoImages}`);

  // Recount
  const after = await productsCol
    .find({ brand: brand._id })
    .project({ images: 1 })
    .toArray();
  const empty = after.filter((p) => !cleanImages(p.images).length).length;
  const shopOnly = after.filter((p) => {
    const imgs = cleanImages(p.images);
    return imgs.length && imgs.some(isShopify) && !imgs.some(isCloudinary);
  }).length;
  const cloud = after.filter((p) => cleanImages(p.images).some(isCloudinary)).length;
  console.log(
    `\nSterling brand after: total=${after.length} cloudinary=${cloud} shopifyOnly=${shopOnly} empty=${empty}`,
  );

  fs.writeFileSync(REPORT, JSON.stringify({ report, after: { empty, shopOnly, cloud, total: after.length } }, null, 2));
  console.log("Wrote", REPORT);

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
