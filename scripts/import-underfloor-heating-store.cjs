/**
 * Scrape https://www.theunderfloorheatingstore.com → Living Mongo + Cloudinary
 *
 * Brand: "The Under Floor Heating" (slug: the-under-floor-heating)
 * Isolated brand-scoped menus + products. Images → Cloudinary only.
 *
 * Taxonomy:
 *   - Top menus = site product-type collections (Electric / Water / Thermostats / …)
 *   - Sub menus = nested collections when available
 *   - Vendor (ProWarm, Warmup, …) stored in specs.vendorBrand (not separate Linx brands)
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-underfloor-heating-store.cjs
 *
 * Options: DRY_RUN=1 LIMIT=20 CONCURRENCY=2 SKIP_IMAGES=1 RESUME=1 DISCOVER_ONLY=1
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

const BASE = "https://www.theunderfloorheatingstore.com";
const BRAND_SLUG = "the-under-floor-heating";
const BRAND_NAME = "The Under Floor Heating";
const SOURCE_TAG = "underfloor-heating-store-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/the-under-floor-heating";
const CHECKPOINT = path.join(__dirname, "_tmp-ufhs-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-ufhs-progress.json");
const LOG = path.join(__dirname, "_tmp-ufhs-import.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const DISCOVER_ONLY = process.env.DISCOVER_ONLY === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 8));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

/** Preferred top-level catalogue buckets (site nav). */
const PRIMARY_HANDLES = [
  "electric-underfloor-heating",
  "water-underfloor-heating",
  "thermostats",
  "insulation-fixing-systems",
  "insulation-boards",
  "adhesives-levellers",
  "energy-efficiency",
  "wet-rooms",
  "plumbing",
  "pallet-deals",
];

const SKIP_COLLECTION = /^(frontpage|all|all-products|home-page|featured|sale|best-sellers)$/i;

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
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
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = String(imageUrl).split("?")[0];
  if (SKIP_IMAGES || DRY_RUN) return clean;
  const result = await cloudinary.uploader.upload(clean, {
    folder: CLOUDINARY_FOLDER,
    public_id: String(publicId).slice(0, 180),
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
      order: 75,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      brand = { ...insert, _id: "dry-brand" };
      log("[dry] create brand", BRAND_NAME);
    } else {
      const r = await brands.insertOne(insert);
      brand = { ...insert, _id: r.insertedId };
      log(`Created brand ${BRAND_NAME} (${brand._id})`);
    }
  } else {
    log(`Using brand ${brand.name} (${brand._id})`);
    if (!DRY_RUN) {
      await brands.updateOne(
        { _id: brand._id },
        { $set: { name: BRAND_NAME, isActive: true, updatedAt: now } },
      );
    }
  }
  return brand;
}

async function ensureMenu(db, { name, slug, parent, brandId, order, image }) {
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
      image: image || "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) menu = { ...insert, _id: `dry-${slug}` };
    else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
      log(`Created menu ${name}`);
    }
  } else if (!DRY_RUN) {
    const set = {
      name,
      isActive: true,
      updatedAt: now,
      order: order ?? menu.order,
    };
    if (image && (!menu.image || process.env.FORCE_MENU_IMAGE === "1")) {
      set.image = image;
    }
    await menus.updateOne({ _id: menu._id }, { $set: set });
    menu = { ...menu, ...set };
  }
  return menu;
}

async function fetchAllCollections() {
  const out = [];
  let page = 1;
  while (page <= 40) {
    const data = await fetchJson(
      `${BASE}/collections.json?limit=250&page=${page}`,
    );
    const rows = data.collections || [];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < 250) break;
    page += 1;
    await delay(120);
  }
  return out.filter((c) => c?.handle && !SKIP_COLLECTION.test(c.handle));
}

async function fetchAllProductsLite() {
  const out = [];
  let page = 1;
  while (page <= 80) {
    const data = await fetchJson(
      `${BASE}/products.json?limit=250&page=${page}`,
    );
    const rows = data.products || [];
    if (!rows.length) break;
    out.push(...rows);
    log(`products page ${page}: +${rows.length} (total ${out.length})`);
    if (rows.length < 250) break;
    page += 1;
    await delay(150);
  }
  return out;
}

async function fetchCollectionProductHandles(handle) {
  const handles = [];
  let page = 1;
  while (page <= 40) {
    const data = await fetchJson(
      `${BASE}/collections/${encodeURIComponent(handle)}/products.json?limit=250&page=${page}`,
    );
    const rows = data.products || [];
    if (!rows.length) break;
    for (const p of rows) if (p.handle) handles.push(p.handle);
    if (rows.length < 250) break;
    page += 1;
    await delay(100);
  }
  return handles;
}

async function fetchProductDetail(handle) {
  const data = await fetchJson(
    `${BASE}/products/${encodeURIComponent(handle)}.json`,
  );
  return data.product || null;
}

function pickPrimaryCategory(product, collectionByHandle, productCollections) {
  const handles = productCollections.get(product.handle) || [];
  // Prefer primary nav collections
  for (const h of PRIMARY_HANDLES) {
    if (handles.includes(h) && collectionByHandle.has(h)) {
      return { categorySlug: h, subSlug: "" };
    }
  }
  // Prefer any non-brand collection
  for (const h of handles) {
    const col = collectionByHandle.get(h);
    if (!col) continue;
    if (/brand|prowarm|warmup|floorwarmers|wavin|polypipe|heatmiser|salus|hive|john-guest/i.test(h))
      continue;
    return { categorySlug: h, subSlug: "" };
  }
  // Fall back to product_type
  if (product.product_type) {
    return { categorySlug: slugify(product.product_type), subSlug: "" };
  }
  return { categorySlug: "underfloor-heating", subSlug: "" };
}

function parseProduct(detail, collectionByHandle, productCollections) {
  const handle = detail.handle;
  const name = cleanText(detail.title) || titleCase(handle);
  const description =
    cleanText(detail.body_html || "").slice(0, 8000) ||
    `${name} from The Underfloor Heating Store.`;
  const vendor = cleanText(detail.vendor || "");
  const productType = cleanText(detail.product_type || "");
  const tags = Array.isArray(detail.tags)
    ? detail.tags
    : String(detail.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

  const variant = (detail.variants || [])[0] || {};
  const price = Number(variant.price) || 0;
  const compareAt = Number(variant.compare_at_price) || 0;
  const sku = cleanText(variant.sku || "") || handle.toUpperCase();
  const stock =
    typeof variant.inventory_quantity === "number"
      ? Math.max(0, variant.inventory_quantity)
      : STOCK_DEFAULT;

  const images = [];
  for (const img of detail.images || []) {
    const src = typeof img === "string" ? img : img?.src;
    if (src && /^https?:\/\//i.test(src) && !images.includes(src)) {
      images.push(src.split("?")[0]);
    }
  }

  const { categorySlug, subSlug } = pickPrimaryCategory(
    detail,
    collectionByHandle,
    productCollections,
  );

  const specs = {
    sku,
    source: SOURCE_TAG,
    sourceUrl: `${BASE}/products/${handle}`,
    ufhsHandle: handle,
    ufhsId: detail.id,
    vendorBrand: vendor || undefined,
    productType: productType || undefined,
    tags: tags.slice(0, 40),
  };
  if (compareAt > price && price > 0) {
    specs.compareAtPrice = compareAt;
  }
  // Variant options as specs
  for (const opt of detail.options || []) {
    const key = cleanText(opt.name);
    const val = cleanText((opt.values || [])[0]);
    if (key && val) specs[key] = val;
  }

  return {
    handle,
    name,
    description,
    price,
    stock: Number.isFinite(stock) ? stock : STOCK_DEFAULT,
    images: images.slice(0, MAX_IMAGES),
    categorySlug: slugify(categorySlug) || "underfloor-heating",
    categoryName: collectionByHandle.get(categorySlug)?.title || titleCase(categorySlug),
    subSlug: subSlug ? slugify(subSlug) : "",
    sku,
    specs,
    vendor,
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
  fs.writeFileSync(LOG, `UFHS import ${new Date().toISOString()}\n`);
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

  log(`UFHS import${DRY_RUN ? " (DRY)" : ""} concurrency=${CONCURRENCY}`);

  let collections = [];
  let productHandles = [];
  let productCollections = new Map(); // handle → [collection handles]

  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    collections = saved.collections || [];
    productHandles = saved.productHandles || [];
    productCollections = new Map(saved.productCollections || []);
    log(
      `Resumed ${productHandles.length} products, ${collections.length} collections`,
    );
  } else {
    collections = await fetchAllCollections();
    log(`Collections: ${collections.length}`);

    const lite = await fetchAllProductsLite();
    productHandles = [...new Set(lite.map((p) => p.handle).filter(Boolean))];
    log(`Product handles: ${productHandles.length}`);

    // Map products → collections (primary nav first, then others with products)
    const mapTargets = [
      ...PRIMARY_HANDLES.filter((h) => collections.some((c) => c.handle === h)),
      ...collections
        .map((c) => c.handle)
        .filter((h) => !PRIMARY_HANDLES.includes(h))
        .slice(0, 80),
    ];

    for (const handle of mapTargets) {
      try {
        const hs = await fetchCollectionProductHandles(handle);
        for (const ph of hs) {
          if (!productCollections.has(ph)) productCollections.set(ph, []);
          productCollections.get(ph).push(handle);
        }
        log(`  collection ${handle}: ${hs.length} products`);
      } catch (e) {
        log(`  collection fail ${handle}: ${e.message}`);
      }
      await delay(80);
    }

    fs.writeFileSync(
      CHECKPOINT,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          collections: collections.map((c) => ({
            id: c.id,
            title: c.title,
            handle: c.handle,
            products_count: c.products_count,
            image: c.image?.src || null,
          })),
          productHandles,
          productCollections: [...productCollections.entries()],
        },
        null,
        2,
      ),
    );
  }

  if (DISCOVER_ONLY) {
    log("Discover-only done.");
    return;
  }

  if (LIMIT > 0) productHandles = productHandles.slice(0, LIMIT);

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  const collectionByHandle = new Map(
    collections.map((c) => [c.handle, c]),
  );

  // Ensure primary + used category menus
  const menuCache = new Map();
  const ensureCat = async (slug, name, order = 0, imageUrl = "") => {
    if (menuCache.has(slug)) return menuCache.get(slug);
    let image = "";
    if (imageUrl) {
      try {
        image = await uploadRemoteImage(imageUrl, `menu-${slug}`);
      } catch (e) {
        log(`menu image fail ${slug}: ${e.message}`);
      }
    }
    const menu = await ensureMenu(db, {
      name: name || titleCase(slug),
      slug,
      parent: null,
      brandId: brand._id,
      order,
      image,
    });
    menuCache.set(slug, menu);
    return menu;
  };

  let order = 0;
  for (const h of PRIMARY_HANDLES) {
    const col = collectionByHandle.get(h);
    if (!col) continue;
    await ensureCat(h, col.title, order++, col.image?.src || "");
  }
  // Fallback catch-all
  await ensureCat("underfloor-heating", "Underfloor Heating", 99);

  let done = new Set();
  if (fs.existsSync(PROGRESS)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []);
    } catch {
      /* ignore */
    }
  }
  const saveProgress = () =>
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );

  const pending = productHandles.filter((h) => !done.has(h));
  log(`Importing ${pending.length} (skip ${productHandles.length - pending.length} done)`);

  let imported = 0;
  let failed = 0;

  await mapPool(pending, CONCURRENCY, async (handle, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    try {
      const detail = await fetchProductDetail(handle);
      if (!detail) throw new Error("no product json");
      const p = parseProduct(detail, collectionByHandle, productCollections);

      const menu = await ensureCat(
        p.categorySlug,
        p.categoryName,
        menuCache.size,
        collectionByHandle.get(p.categorySlug)?.image?.src || "",
      );

      const uploaded = [];
      for (let i = 0; i < p.images.length; i++) {
        try {
          const url = await uploadRemoteImage(
            p.images[i],
            `${slugify(p.handle)}-${i + 1}`,
          );
          if (url) uploaded.push(url);
        } catch (e) {
          log(`${label} image fail: ${e.message}`);
        }
      }

      const doc = {
        name: p.name,
        description: p.description,
        price: p.price || 0,
        images: uploaded,
        category: menu.slug,
        subCategory: p.subSlug || "",
        brand: brand._id,
        stock: p.stock,
        tagline: p.vendor || p.specs.productType || "",
        schematicImage: "",
        specs: p.specs,
        showSpecs: true,
        updatedAt: new Date(),
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] ${p.name.slice(0, 55)} £${p.price} cat=${menu.slug} vendor=${p.vendor} imgs=${uploaded.length}`,
        );
      } else {
        // Never wipe Cloudinary gallery on empty re-fetch
        const prev = await productsCol.findOne({
          brand: brand._id,
          "specs.source": SOURCE_TAG,
          "specs.ufhsHandle": handle,
        });
        if (
          !uploaded.length &&
          prev?.images?.some((u) => /cloudinary\.com/i.test(String(u || "")))
        ) {
          doc.images = prev.images;
        }

        await productsCol.updateOne(
          {
            brand: brand._id,
            "specs.source": SOURCE_TAG,
            "specs.ufhsHandle": handle,
          },
          { $set: doc, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        );
        log(
          `${label} ok ${p.name.slice(0, 55)} £${p.price} cat=${menu.slug} imgs=${doc.images.length}`,
        );
      }

      imported += 1;
      done.add(handle);
      if (imported % 25 === 0) saveProgress();
      await delay(80);
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${handle}: ${e.message}`);
      await delay(250);
    }
  });

  saveProgress();
  log(`\nDone. imported=${imported} failed=${failed} total=${productHandles.length}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
