/**
 * Scrape https://www.sterlingbuild.co.uk → Living Mongo + Cloudinary
 *
 * Uses Jina Reader proxy (site CDN blocks this host with HTTP 405) and
 * Cloudinary remote URL upload for images.
 *
 * Creates brand "Sterlingbuild", category menus, products (details + images).
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/import-sterlingbuild.cjs
 *
 * Options:
 *   DRY_RUN=1
 *   LIMIT=20
 *   CONCURRENCY=3
 *   SKIP_IMAGES=1
 *   DISCOVER_ONLY=1
 *   RESUME=1
 *   CATEGORIES=/pitched-roof-windows/,/flat-roof-windows/
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
const BRAND_SLUG = "sterlingbuild";
const BRAND_NAME = "Sterlingbuild";
const SOURCE_TAG = "sterlingbuild-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/sterlingbuild";
const CHECKPOINT = path.join(__dirname, "_tmp-sterling-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-sterling-progress.json");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const DISCOVER_ONLY = process.env.DISCOVER_ONLY === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 8));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

const DEFAULT_SEED_CATEGORIES = [
  "/pitched-roof-windows/",
  "/flat-roof-windows/",
  "/sun-tunnels/",
  "/blinds-shutters/",
  "/windows-and-doors/",
  "/loft-ladders/",
  "/flashings/",
  "/accessories/",
  "/internal-door/",
];

const NON_PRODUCT = new Set([
  "pitched-roof-windows",
  "flat-roof-windows",
  "sun-tunnels",
  "blinds-shutters",
  "windows-and-doors",
  "loft-ladders",
  "flashings",
  "accessories",
  "internal-door",
  "faq",
  "wishlist",
  "sales",
  "store-locator",
  "customer",
  "checkout",
  "media",
  "static",
  "info",
  "sale",
  "delivery",
  "contact",
  "privacy-policy",
  "privacy-policy-cookie-restriction-mode",
  "terms-and-conditions",
  "sb-returns-policy",
  "sb-cancellations",
  "sb-about-us",
  "sb-job-vacancies",
  "sb-contact-us",
  "sb-why-shop-at-sterlingbuild",
]);

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

function parsePrice(text) {
  const raw = String(text || "").replace(/,/g, "");

  // Magento often renders: From£184.43£153.69 (list + sale)
  const fromPair = raw.match(
    /From\s*£\s*([\d]+(?:\.\d{1,2})?)\s*£\s*([\d]+(?:\.\d{1,2})?)/i,
  );
  if (fromPair) {
    return Math.min(Number(fromPair[1]), Number(fromPair[2]));
  }

  const fromOne = raw.match(/From\s*£\s*([\d]+(?:\.\d{1,2})?)/i);
  if (fromOne) return Number(fromOne[1]);

  // Slice around product code / add to bag to avoid nav £15 delivery etc.
  const start = Math.max(0, raw.search(/Product Code|More Information/i));
  const endIdx = raw.search(/Add To Bag|You may also need|Est\. delivery/i);
  const slice =
    start >= 0
      ? raw.slice(start, endIdx > start ? endIdx : start + 4000)
      : raw;

  const nums = [...slice.matchAll(/£\s*([\d]+(?:\.\d{1,2})?)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 20); // ignore tiny/nav amounts
  if (!nums.length) return 0;
  return Math.min(...nums);
}

function isProductUrl(url) {
  if (!url || !url.startsWith(BASE)) return false;
  const u = url.replace(BASE, "");
  if (/\/(customer|checkout|wishlist|catalogsearch|contact|faq|info|sb-|store-locator|sales|account|cart|blog|media|static|top-brands|manufacturer-|opening-method|operation|application)\b/i.test(u)) {
    return false;
  }
  const parts = u.split("/").filter(Boolean);
  if (parts.length !== 1) return false;
  if (NON_PRODUCT.has(parts[0])) return false;
  if (parts[0].length < 8) return false;
  return true;
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
  if (SKIP_IMAGES || DRY_RUN) return clean;
  const result = await cloudinary.uploader.upload(clean, {
    folder: CLOUDINARY_FOLDER,
    public_id: publicId,
    overwrite: true,
    resource_type: "image",
  });
  return result.secure_url;
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: BRAND_SLUG });
  const now = new Date();
  if (!brand) {
    const insert = {
      name: BRAND_NAME,
      slug: BRAND_SLUG,
      order: 50,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      brand = { ...insert, _id: "dry-brand" };
      console.log("[dry] create brand Sterlingbuild");
    } else {
      const r = await brands.insertOne(insert);
      brand = { ...insert, _id: r.insertedId };
      console.log(`Created brand ${BRAND_NAME} (${brand._id})`);
    }
  } else {
    console.log(`Using brand ${brand.name} (${brand._id})`);
    if (!DRY_RUN) {
      await brands.updateOne(
        { _id: brand._id },
        { $set: { isActive: true, name: BRAND_NAME, updatedAt: now } },
      );
    }
  }
  return brand;
}

async function ensureMenu(db, { name, slug, parent, brandId, order }) {
  const menus = db.collection("menus");
  const query = parent
    ? { slug, parent, brand: brandId }
    : { slug, parent: null, brand: brandId };
  let menu = DRY_RUN ? null : await menus.findOne(query);
  const now = new Date();
  if (!menu) {
    const insert = {
      name,
      slug,
      parent: parent || null,
      brand: brandId,
      order: order ?? 0,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      menu = { ...insert, _id: `dry-${slug}` };
    } else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
      console.log(`+ menu ${name}`);
    }
  }
  return menu;
}

function extractLinks(markdown) {
  const urls = new Set();
  const re = /https:\/\/www\.sterlingbuild\.co\.uk\/[a-z0-9\-./%]+/gi;
  for (const m of markdown.matchAll(re)) {
    const u = absUrl(m[0]);
    if (u) urls.add(u);
  }
  // Also markdown links ](/slug/)
  const re2 = /\]\((https?:\/\/www\.sterlingbuild\.co\.uk\/[^)\s]+|\/[a-z0-9\-]+\/)/gi;
  for (const m of markdown.matchAll(re2)) {
    const u = absUrl(m[1]);
    if (u) urls.add(u);
  }
  return [...urls];
}

function extractTitle(md) {
  const m =
    md.match(/^Title:\s*(.+)$/m) ||
    md.match(/^#\s+(.+)$/m);
  return cleanText(m?.[1] || "");
}

async function collectProductUrls(seedCategories) {
  const productUrls = new Set();
  const categoryMeta = new Map();

  for (const seed of seedCategories) {
    const catPath = seed.startsWith("http") ? seed : BASE + seed;
    const catUrl = absUrl(catPath);
    let categoryName = cleanText(seed.replace(/\//g, " "));
    let categorySlug = slugify(categoryName) || "uncategorized";
    console.log(`\nCategory crawl: ${catUrl}`);

    for (let pageNo = 1; pageNo <= 60; pageNo++) {
      const listUrl =
        pageNo === 1
          ? `${catUrl}?product_list_limit=36`
          : `${catUrl}?p=${pageNo}&product_list_limit=36`;
      try {
        const md = await fetchViaJina(listUrl);
        const title = extractTitle(md);
        if (title && !/privacy|cookie/i.test(title)) {
          categoryName = title
            .split("|")[0]
            .replace(/^Buy\s+/i, "")
            .trim() || categoryName;
          categorySlug = slugify(categoryName) || categorySlug;
        }

        const links = extractLinks(md).filter(isProductUrl);
        let added = 0;
        for (const url of links) {
          if (!productUrls.has(url)) added += 1;
          productUrls.add(url);
          if (!categoryMeta.has(url)) {
            categoryMeta.set(url, { categorySlug, categoryName });
          }
        }

        const showing = md.match(/Showing\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/i);
        const total = showing ? Number(showing[3]) : null;
        console.log(
          `  p=${pageNo}: +${added} pageLinks=${links.length} total=${productUrls.size}` +
            (total != null ? ` (listed ${total})` : ""),
        );

        if (!links.length) break;
        if (showing && Number(showing[2]) >= total) break;
        if (added === 0 && pageNo > 1) break;
        await delay(800);
      } catch (e) {
        console.warn(`  crawl error p=${pageNo}:`, e.message);
        break;
      }
    }
  }

  return {
    urls: [...productUrls],
    categoryMeta: Object.fromEntries(categoryMeta),
  };
}

function parseProductMarkdown(url, md) {
  const name =
    extractTitle(md).replace(/\s*\|\s*Sterlingbuild.*$/i, "").trim() ||
    cleanText((md.match(/^#\s+(.+)$/m) || [])[1]);

  let sku = "";
  const skuMatch =
    md.match(/Product Code[:\s|*]*\*?\*?([A-Z0-9][A-Z0-9\-_./]*)/i) ||
    md.match(/\*\*Product Code:\*\*\s*([A-Z0-9][A-Z0-9\-_./]*)/i);
  if (skuMatch) sku = cleanText(skuMatch[1]);

  const price = parsePrice(md);

  // Description: take chunk after Short Description / first long paragraph
  let description = "";
  const shortIdx = md.search(/Short Description|Product Highlights|Why Choose/i);
  if (shortIdx >= 0) {
    description = cleanText(md.slice(shortIdx, shortIdx + 6000));
  }
  if (!description) {
    const paras = md
      .split(/\n\n+/)
      .map(cleanText)
      .filter((p) => p.length > 80 && !/^Title:|^URL Source:|^Markdown/i.test(p));
    description = paras.slice(0, 4).join("\n\n");
  }
  if (!description) description = name || "Sterlingbuild product";

  // Specs from markdown tables |Key|Value|
  const specs = {};
  for (const row of md.matchAll(/\|\s*\*?\*?([^|]+?)\*?\*?\s*\|\s*([^|]+?)\s*\|/g)) {
    const k = cleanText(row[1]);
    const v = cleanText(row[2]);
    if (!k || !v || /^-+$/.test(k) || /^-+$/.test(v)) continue;
    if (/more information|attribute/i.test(k)) continue;
    if (k.length > 60 || v.length > 200) continue;
    specs[k] = v;
  }

  // Images
  const images = [];
  const pushImg = (raw) => {
    const u = absUrl(String(raw).replace(/&amp;/g, "&"));
    if (!u) return;
    if (!/\/media\/catalog\/product\//i.test(u)) return;
    const clean = u.split("?")[0];
    if (!images.includes(clean)) images.push(clean);
  };
  for (const m of md.matchAll(/https:\/\/www\.sterlingbuild\.co\.uk\/media\/catalog\/product\/[^\s)"']+/gi)) {
    pushImg(m[0]);
  }
  for (const m of md.matchAll(/!\[[^\]]*\]\((https?:[^)]+)\)/g)) {
    pushImg(m[1]);
  }

  const inStock = /in stock/i.test(md);

  return {
    url,
    name: cleanText(name) || url,
    sku,
    price,
    description: description.slice(0, 20000),
    specs,
    images,
    inStock,
  };
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  const out = new Array(items.length);
  async function run() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
  return out;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (!SKIP_IMAGES && !DRY_RUN) {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      throw new Error("Missing Cloudinary credentials");
    }
  }

  console.log(
    `Sterlingbuild import via Jina${DRY_RUN ? " (DRY RUN)" : ""}${DISCOVER_ONLY ? " [discover only]" : ""}`,
  );

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);

  let urls = [];
  let categoryMeta = {};

  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    urls = saved.urls || [];
    categoryMeta = saved.categoryMeta || {};
    console.log(`Resumed ${urls.length} product URLs from checkpoint`);
  } else {
    const envCats = (process.env.CATEGORIES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const seeds = envCats.length ? envCats : DEFAULT_SEED_CATEGORIES;
    const discovered = await collectProductUrls(seeds);
    urls = discovered.urls;
    categoryMeta = discovered.categoryMeta;
    fs.writeFileSync(
      CHECKPOINT,
      JSON.stringify({ at: new Date().toISOString(), urls, categoryMeta }, null, 2),
    );
    console.log(`\nDiscovered ${urls.length} products → ${CHECKPOINT}`);
  }

  if (DISCOVER_ONLY) {
    await mongoose.disconnect();
    console.log("Discover-only done.");
    return;
  }

  if (LIMIT > 0) urls = urls.slice(0, LIMIT);

  let done = new Set();
  if (fs.existsSync(PROGRESS)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []);
    } catch {
      /* ignore */
    }
  }

  const productsCol = db.collection("products");
  const menuCache = new Map();

  async function menuFor(meta) {
    const catName = meta?.categoryName || "Sterlingbuild";
    const catSlug = meta?.categorySlug || slugify(catName) || "sterlingbuild";
    if (menuCache.has(catSlug)) return menuCache.get(catSlug);
    const menu = await ensureMenu(db, {
      name: catName,
      slug: catSlug,
      parent: null,
      brandId: brand._id,
      order: menuCache.size,
    });
    menuCache.set(catSlug, menu);
    return menu;
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  const pending = urls.filter((u) => !done.has(u));
  console.log(
    `\nImporting ${pending.length} products (skip ${urls.length - pending.length} done)…`,
  );

  await mapPool(pending, CONCURRENCY, async (url, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    try {
      const md = await fetchViaJina(url);
      const p = parseProductMarkdown(url, md);
      if (!p.name || p.price <= 0) {
        console.warn(`${label} skip (no name/price): ${url}`);
        skipped += 1;
        done.add(url);
        return;
      }

      const meta = categoryMeta[url] || {};
      const menu = await menuFor(meta);
      const handle =
        slugify(url.replace(BASE, "").replace(/\//g, "")) || slugify(p.name);

      const uploaded = [];
      for (let i = 0; i < Math.min(p.images.length, MAX_IMAGES); i++) {
        try {
          const cloudUrl = await uploadRemoteImage(p.images[i], `${handle}-${i + 1}`);
          if (cloudUrl) uploaded.push(cloudUrl);
        } catch (e) {
          console.warn(`${label} image fail:`, e.message);
        }
      }

      const specs = {
        ...(p.specs || {}),
        sku: p.sku || handle,
        source: SOURCE_TAG,
        sourceUrl: url,
        sterlingSku: p.sku || "",
        sterlingHandle: handle,
      };

      const doc = {
        name: p.name,
        description: p.description,
        price: p.price,
        images: uploaded.length ? uploaded : [],
        category: menu.slug,
        subCategory: "",
        brand: brand._id,
        stock: p.inStock ? STOCK_DEFAULT : STOCK_DEFAULT,
        tagline: "",
        schematicImage: "",
        specs,
        showSpecs: true,
        updatedAt: new Date(),
      };

      if (DRY_RUN) {
        console.log(
          `${label} [dry] ${p.name} £${p.price} imgs=${p.images.length}->${uploaded.length}`,
        );
      } else {
        await productsCol.updateOne(
          {
            $or: [
              { "specs.sourceUrl": url },
              ...(p.sku
                ? [{ "specs.sterlingSku": p.sku, "specs.source": SOURCE_TAG }]
                : []),
            ],
          },
          { $set: doc, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        );
        console.log(
          `${label} ✓ ${p.name} (£${p.price}) imgs=${uploaded.length}`,
        );
      }

      imported += 1;
      done.add(url);
      if (imported % 5 === 0) {
        fs.writeFileSync(
          PROGRESS,
          JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
        );
      }
      await delay(400);
    } catch (e) {
      failed += 1;
      console.error(`${label} ✗ ${url}:`, e.message);
      await delay(1000);
    }
  });

  fs.writeFileSync(
    PROGRESS,
    JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
  );

  await mongoose.disconnect();
  console.log("\nDone.", { imported, skipped, failed, brand: BRAND_SLUG });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
