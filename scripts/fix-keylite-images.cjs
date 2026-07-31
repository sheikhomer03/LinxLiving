/**
 * Scrape Keylite listing + PDPs from Sterlingbuild, upload images to Cloudinary,
 * and attach them to matching Sterlingbuild products. Also scrapes category banner images.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-keylite-images.cjs
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
const KEYLITE_URL = `${BASE}/pitched-roof-windows/top-brands/keylite/`;
const BRAND_SLUG = "sterlingbuild";
const CLOUDINARY_FOLDER = "linx-living/products/sterlingbuild";
const LOG = path.join(__dirname, "_tmp-keylite-images.log");
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 8));
const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE = process.env.FORCE === "1";

function log(...args) {
  const line = args.map(String).join(" ");
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(href) {
  if (!href) return null;
  try {
    return new URL(href, BASE).href.split("#")[0].split("?")[0];
  } catch {
    return null;
  }
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchViaJina(url) {
  const endpoint = `https://r.jina.ai/${url}`;
  const res = await fetch(endpoint, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0",
    },
  });
  if (!res.ok) throw new Error(`Jina ${res.status} for ${url}`);
  return res.text();
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = String(imageUrl).split("?")[0];
  if (DRY_RUN) return clean;
  const result = await cloudinary.uploader.upload(clean, {
    folder: CLOUDINARY_FOLDER,
    public_id: publicId.slice(0, 180),
    overwrite: true,
    resource_type: "image",
  });
  return result.secure_url;
}

function hasGoodImages(images) {
  return (images || []).some((i) => typeof i === "string" && i.trim());
}

function extractCatalogImages(md) {
  const images = [];
  const push = (raw) => {
    const u = absUrl(String(raw || "").replace(/&amp;/g, "&"));
    if (!u || !/\/media\/catalog\/product\//i.test(u)) return;
    const clean = u.split("?")[0];
    if (!images.includes(clean)) images.push(clean);
  };
  for (const m of md.matchAll(
    /https:\/\/www\.sterlingbuild\.co\.uk\/media\/catalog\/product\/[^\s)"']+/gi,
  )) {
    push(m[0]);
  }
  for (const m of md.matchAll(/!\[[^\]]*\]\((https?:[^)]+)\)/g)) {
    push(m[1]);
  }
  return images;
}

function extractCategoryBanners(md) {
  const out = [];
  for (const m of md.matchAll(
    /https:\/\/www\.sterlingbuild\.co\.uk\/media\/wysiwyg\/[^\s)"']+/gi,
  )) {
    const u = absUrl(m[0].replace(/&amp;/g, "&"));
    if (!u) continue;
    if (/manufacturer_logo|logo\.svg|icon/i.test(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

function parseListingProducts(md) {
  const products = [];
  const seen = new Set();
  // [ ![Name](img) ](url) ... Product Code: XXX
  const blockRe =
    /!\[[^\]]*\]\((https?:[^)]+catalog\/product[^)]+)\)\]\((https?:\/\/www\.sterlingbuild\.co\.uk\/[^)#\s]+)\)[\s\S]{0,1200}?Product Code:\s*([A-Z0-9][A-Z0-9\-_./]*)/gi;
  for (const m of md.matchAll(blockRe)) {
    const url = absUrl(m[2]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    products.push({
      url,
      thumb: absUrl(String(m[1]).replace(/&amp;/g, "&")),
      sku: cleanText(m[3]),
      name: "",
    });
  }

  // Fallback: product links containing keylite
  for (const m of md.matchAll(
    /\[([^\]]+)\]\((https:\/\/www\.sterlingbuild\.co\.uk\/keylite-[^)#\s]+)\)/gi,
  )) {
    const url = absUrl(m[2]);
    const name = cleanText(m[1]);
    if (!url || seen.has(url)) {
      const existing = products.find((p) => p.url === url);
      if (existing && !existing.name && name && !/^image/i.test(name)) {
        existing.name = name;
      }
      continue;
    }
    seen.add(url);
    products.push({ url, thumb: "", sku: "", name });
  }

  return products;
}

function parsePdp(url, md) {
  const name =
    cleanText((md.match(/^#\s+(.+)$/m) || [])[1] || "")
      .replace(/\s*\|\s*Sterlingbuild.*$/i, "")
      .trim() || "";
  let sku = "";
  const skuMatch =
    md.match(/Product Code[:\s|*]*\*?\*?([A-Z0-9][A-Z0-9\-_./]*)/i) ||
    md.match(/\*\*Product Code:\*\*\s*([A-Z0-9][A-Z0-9\-_./]*)/i);
  if (skuMatch) sku = cleanText(skuMatch[1]);
  return {
    url,
    name,
    sku,
    images: extractCatalogImages(md).slice(0, MAX_IMAGES),
  };
}

function scoreMatch(product, candidate) {
  let score = 0;
  const pSku = (product.specs?.sterlingSku || product.specs?.sku || "").toUpperCase();
  const cSku = (candidate.sku || "").toUpperCase();
  if (pSku && cSku && pSku === cSku) score += 100;
  const src = product.specs?.sourceUrl || "";
  if (src && candidate.url && src.replace(/\/$/, "") === candidate.url.replace(/\/$/, "")) {
    score += 80;
  }
  const pn = slugify(product.name);
  const cn = slugify(candidate.name);
  if (pn && cn && (pn === cn || pn.includes(cn) || cn.includes(pn))) score += 40;
  if (/keylite/i.test(product.name) && /keylite/i.test(candidate.name || candidate.url)) {
    score += 5;
  }
  return score;
}

async function main() {
  fs.writeFileSync(LOG, `Keylite image fix ${new Date().toISOString()}\n`);
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
  if (!brand) throw new Error("Sterlingbuild brand not found");

  log(`Fetching listing ${KEYLITE_URL}`);
  const listingMd = await fetchViaJina(KEYLITE_URL);
  const listed = parseListingProducts(listingMd);
  const banners = extractCategoryBanners(listingMd);
  log(`Found ${listed.length} Keylite products, ${banners.length} category banners`);

  // Update category / Keylite-related menus with banner image
  if (banners[0]) {
    try {
      const cloudBanner = await uploadRemoteImage(
        banners[0],
        "category-keylite-banner",
      );
      const targets = await db
        .collection("menus")
        .find({
          brand: brand._id,
          $or: [
            { slug: "pitched-roof-windows" },
            { name: /keylite/i },
            { slug: /keylite/i },
          ],
        })
        .toArray();
      for (const menu of targets) {
        if (!FORCE && menu.image) {
          log(`menu keep image: ${menu.name}`);
          continue;
        }
        if (!DRY_RUN) {
          await db.collection("menus").updateOne(
            { _id: menu._id },
            { $set: { image: cloudBanner, updatedAt: new Date() } },
          );
        }
        log(`menu image set: ${menu.name} → ${cloudBanner}`);
      }
      // If no Keylite submenu exists, still set pitched-roof-windows when empty
      if (!targets.length) {
        log("No matching menus for banner");
      }
    } catch (e) {
      log(`banner upload fail: ${e.message}`);
    }
  }

  const dbProducts = await db
    .collection("products")
    .find({
      brand: brand._id,
      $or: [
        { name: /keylite/i },
        { "specs.sterlingSku": /KQFS|VKPCP|VKQFS/i },
        { "specs.sku": /KQFS|VKPCP|VKQFS/i },
        { "specs.sourceUrl": /keylite/i },
      ],
    })
    .toArray();
  log(`DB Keylite-related products: ${dbProducts.length}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < listed.length; i++) {
    const item = listed[i];
    const label = `[${i + 1}/${listed.length}]`;
    try {
      log(`${label} scrape ${item.url}`);
      const md = await fetchViaJina(item.url);
      const pdp = parsePdp(item.url, md);
      if (!pdp.name) pdp.name = item.name;
      if (!pdp.sku) pdp.sku = item.sku;
      if (!pdp.images.length && item.thumb) pdp.images = [item.thumb.split("?")[0]];

      let best = null;
      let bestScore = 0;
      for (const prod of dbProducts) {
        const s = scoreMatch(prod, pdp);
        if (s > bestScore) {
          bestScore = s;
          best = prod;
        }
      }

      if (!best || bestScore < 40) {
        log(`${label} no DB match (score=${bestScore}) ${pdp.name || item.url}`);
        skipped += 1;
        await delay(400);
        continue;
      }

      if (hasGoodImages(best.images) && !FORCE) {
        log(`${label} already has images: ${best.name}`);
        skipped += 1;
        await delay(200);
        continue;
      }

      const handle =
        slugify(pdp.url.replace(BASE, "").replace(/\//g, "")) ||
        slugify(pdp.name) ||
        pdp.sku ||
        String(best._id);
      const uploaded = [];
      for (let j = 0; j < pdp.images.length; j++) {
        try {
          const url = await uploadRemoteImage(pdp.images[j], `keylite-${handle}-${j + 1}`);
          if (url) uploaded.push(url);
        } catch (e) {
          log(`${label} image fail: ${e.message}`);
        }
      }

      if (!uploaded.length) {
        log(`${label} no images uploaded for ${best.name}`);
        failed += 1;
        await delay(400);
        continue;
      }

      if (!DRY_RUN) {
        await db.collection("products").updateOne(
          { _id: best._id },
          {
            $set: {
              images: uploaded,
              updatedAt: new Date(),
              "specs.sourceUrl": pdp.url,
              "specs.sterlingSku": pdp.sku || best.specs?.sterlingSku || "",
              "specs.sku": pdp.sku || best.specs?.sku || "",
            },
          },
        );
      }
      log(`${label} updated ${best.name} imgs=${uploaded.length} score=${bestScore}`);
      updated += 1;
      // avoid reusing same DB product
      best.images = uploaded;
      await delay(500);
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${e.message}`);
      await delay(800);
    }
  }

  log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
