/**
 * Scrape https://naturaflooring.co.uk → Living Mongo + Cloudinary
 *
 * Brand: "Natura Flooring" (slug: natura-flooring) — isolated brand-scoped menus/products.
 * Never touches other brands.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-natura-flooring.cjs
 *   DRY_RUN=1 LIMIT=5 CONCURRENCY=2 SKIP_IMAGES=1 RESUME=1
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
const sharp = require("sharp");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BASE = "https://naturaflooring.co.uk";
const BRAND_SLUG = "natura-flooring";
const BRAND_NAME = "Natura Flooring";
const SOURCE_TAG = "natura-flooring-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/natura-flooring";
const CHECKPOINT = path.join(__dirname, "_tmp-natura-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-natura-progress.json");
const LOG = path.join(__dirname, "_tmp-natura-import.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 10));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

/** Main nav taxonomy from naturaflooring.co.uk */
const SITE_TREE = [
  {
    handle: "engineered-wood-flooring",
    title: "Engineered Wood Flooring",
    children: [
      ["brushed-engineered-wood-flooring", "Brushed Engineered"],
      ["lacquered-engineered-wood-flooring", "Lacquered Engineered"],
      ["engineered-oak-flooring", "Engineered Oak"],
      ["13mm-wood-flooring", "13mm Wood Flooring"],
      ["15mm-wood-flooring", "15mm Wood Flooring"],
    ],
  },
  {
    handle: "solid-wood-flooring",
    title: "Solid Wood Flooring",
    children: [
      ["solid-oak-flooring", "Solid Oak"],
      ["reclaimed-wood-flooring", "Reclaimed Wood"],
    ],
  },
  {
    handle: "herringbone-wood-flooring",
    title: "Herringbone Flooring",
    children: [
      ["herringbone-engineered-wood-flooring", "Herringbone Engineered"],
      ["herringbone-engineered-oak-flooring", "Herringbone Engineered Oak"],
    ],
  },
  {
    handle: "the-family-floor-engineered-hardwood-flooring",
    title: "The Family Floor",
    children: [],
  },
  {
    handle: "trade-flooring",
    title: "Trade Flooring",
    children: [],
  },
  {
    handle: "wood-flooring",
    title: "Wood Flooring",
    children: [],
  },
];

const PARENT_PRIORITY = SITE_TREE.map((c) => c.handle);
const SKIP_COLLECTION = /^(frontpage|sale|all|home-page)$/i;

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

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0",
      Accept: "text/html,application/json",
    },
  });
  return { status: res.status, text: await res.text() };
}

async function uploadRemoteImage(imageUrl, publicId) {
  if (SKIP_IMAGES || DRY_RUN) return String(imageUrl).split("?")[0];
  const clean = String(imageUrl).split("?")[0];
  try {
    const res = await fetch(clean, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: `${BASE}/` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 9_000_000) {
      buf = await sharp(buf)
        .rotate()
        .resize({
          width: 2000,
          height: 2000,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
    }
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: CLOUDINARY_FOLDER,
          public_id: String(publicId).slice(0, 180),
          overwrite: true,
          invalidate: true,
          resource_type: "image",
        },
        (err, result) => (err ? reject(err) : resolve(result.secure_url)),
      );
      stream.end(buf);
    });
  } catch (e) {
    const result = await cloudinary.uploader.upload(clean, {
      folder: CLOUDINARY_FOLDER,
      public_id: String(publicId).slice(0, 180),
      overwrite: true,
      resource_type: "image",
    });
    return result.secure_url;
  }
}

async function fetchAllCollections() {
  const out = [];
  let page = 1;
  while (page <= 10) {
    const data = await fetchJson(
      `${BASE}/collections.json?limit=250&page=${page}`,
    );
    const rows = data.collections || [];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < 250) break;
    page += 1;
  }
  return out.filter((c) => c?.handle && !SKIP_COLLECTION.test(c.handle));
}

async function fetchAllProductHandles() {
  const out = [];
  let page = 1;
  while (page <= 20) {
    const data = await fetchJson(
      `${BASE}/products.json?limit=250&page=${page}`,
    );
    const rows = data.products || [];
    if (!rows.length) break;
    for (const p of rows) if (p.handle) out.push(p.handle);
    if (rows.length < 250) break;
    page += 1;
  }
  return [...new Set(out)];
}

async function fetchCollectionHandles(handle) {
  const set = new Set();
  let page = 1;
  while (page <= 20) {
    try {
      const data = await fetchJson(
        `${BASE}/collections/${encodeURIComponent(handle)}/products.json?limit=250&page=${page}`,
      );
      const rows = data.products || [];
      if (!rows.length) break;
      for (const p of rows) if (p.handle) set.add(p.handle);
      if (rows.length < 250) break;
      page += 1;
    } catch {
      break;
    }
    await delay(50);
  }
  return set;
}

function parsePriceFromHtml(html) {
  const out = { packPrice: 0, pricePerM2: 0 };
  const og = html.match(
    /property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i,
  ) || html.match(
    /content=["']([^"']+)["'][^>]*property=["']product:price:amount["']/i,
  );
  if (og) out.packPrice = Number(og[1]) || 0;

  const ldBlocks = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const m of ldBlocks) {
    try {
      const data = JSON.parse(m[1]);
      const nodes = Array.isArray(data) ? data : [data];
      for (const n of nodes) {
        const offer = n?.offers;
        const offers = Array.isArray(offer) ? offer : offer ? [offer] : [];
        for (const o of offers) {
          const p = Number(o?.price);
          if (p > 0 && !out.packPrice) out.packPrice = p;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // £49.99/m² style
  const m2 = html.match(/£\s*([0-9]+(?:\.[0-9]{2})?)\s*\/\s*m/i);
  if (m2) out.pricePerM2 = Number(m2[1]) || 0;

  // Theme sometimes embeds per-m2 separately
  const schemaExtra = html.match(/price:\s*"([0-9]+(?:\.[0-9]{2})?)"/);
  if (schemaExtra && out.pricePerM2 <= 0) {
    const maybe = Number(schemaExtra[1]);
    if (maybe > 0 && maybe < 500) out.pricePerM2 = maybe;
  }

  return out;
}

function specsFromTags(tags) {
  const specs = {};
  for (const raw of tags || []) {
    const t = String(raw).trim();
    if (!t) continue;
    if (t.includes("_")) {
      const [k, ...rest] = t.split("_");
      const v = rest.join("_").trim();
      if (k && v) specs[slugify(k).replace(/-/g, "")] = v;
    } else if (/^(oak|walnut|brushed|uv lacquered|straight plank|sample|promote|trade)$/i.test(t)) {
      specs[slugify(t)] = t;
    }
  }
  return specs;
}

function pickAssignment(membership) {
  // Prefer Family Floor when present (exclusive range)
  if (membership.has("the-family-floor-engineered-hardwood-flooring")) {
    return {
      category: "the-family-floor-engineered-hardwood-flooring",
      subCategory: "",
    };
  }

  const thicknessOnly = new Set(["13mm-wood-flooring", "15mm-wood-flooring"]);

  // Herringbone engineered leaves first
  {
    const parent = "herringbone-wood-flooring";
    const cat = SITE_TREE.find((c) => c.handle === parent);
    for (const [leaf] of cat.children) {
      if (membership.has(leaf)) {
        return { category: parent, subCategory: leaf };
      }
    }
  }

  // Solid (incl. reclaimed herringbone solid tagged only on herringbone parent)
  {
    const parent = "solid-wood-flooring";
    const cat = SITE_TREE.find((c) => c.handle === parent);
    for (const [leaf] of cat.children) {
      if (membership.has(leaf)) {
        return { category: parent, subCategory: leaf };
      }
    }
    if (membership.has(parent)) {
      return { category: parent, subCategory: "" };
    }
  }

  if (membership.has("herringbone-wood-flooring")) {
    return { category: "herringbone-wood-flooring", subCategory: "" };
  }

  // Engineered type leaves (skip thickness filters — those also tag trade SKUs)
  {
    const parent = "engineered-wood-flooring";
    const cat = SITE_TREE.find((c) => c.handle === parent);
    for (const [leaf] of cat.children) {
      if (thicknessOnly.has(leaf)) continue;
      if (membership.has(leaf)) {
        return { category: parent, subCategory: leaf };
      }
    }
    if (membership.has(parent)) {
      // Prefer thickness sub when present under engineered parent
      for (const leaf of thicknessOnly) {
        if (membership.has(leaf)) {
          return { category: parent, subCategory: leaf };
        }
      }
      return { category: parent, subCategory: "" };
    }
  }

  // Trade exclusives (Shopify price often £0 without trade login)
  if (membership.has("trade") || membership.has("trade-flooring")) {
    return { category: "trade-flooring", subCategory: "" };
  }

  // Thickness-only leftover
  for (const leaf of thicknessOnly) {
    if (membership.has(leaf)) {
      return { category: "engineered-wood-flooring", subCategory: leaf };
    }
  }

  return { category: "wood-flooring", subCategory: "" };
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: BRAND_SLUG });
  const now = new Date();
  if (!brand) {
    const insert = {
      name: BRAND_NAME,
      slug: BRAND_SLUG,
      order: 40,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) brand = { ...insert, _id: "dry-brand" };
    else {
      const r = await brands.insertOne(insert);
      brand = { ...insert, _id: r.insertedId };
      log(`Created brand ${BRAND_NAME}`);
    }
  } else if (!DRY_RUN) {
    await brands.updateOne(
      { _id: brand._id },
      { $set: { name: BRAND_NAME, isActive: true, updatedAt: now } },
    );
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
      level: parent ? "subcategory" : "category",
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
      order: order ?? menu.order,
      updatedAt: now,
    };
    if (image) set.image = image;
    await menus.updateOne({ _id: menu._id }, { $set: set });
    menu = { ...menu, ...set };
  }
  return menu;
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
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () =>
      run(),
    ),
  );
}

async function main() {
  fs.writeFileSync(LOG, `Natura import ${new Date().toISOString()}\n`);
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (
    !SKIP_IMAGES &&
    !DRY_RUN &&
    (!process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET)
  ) {
    throw new Error("Missing Cloudinary credentials");
  }

  log(`Natura Flooring import${DRY_RUN ? " (DRY)" : ""} concurrency=${CONCURRENCY}`);

  let collections = [];
  let productHandles = [];
  let productMembership = new Map();

  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    collections = saved.collections || [];
    productHandles = saved.productHandles || [];
    productMembership = new Map(
      (saved.productMembership || []).map(([k, v]) => [k, new Set(v)]),
    );
    log(`Resumed ${productHandles.length} products`);
  } else {
    collections = await fetchAllCollections();
    log(`Collections: ${collections.length}`);
    productHandles = await fetchAllProductHandles();
    log(`Product handles: ${productHandles.length}`);

    const needed = new Set();
    for (const cat of SITE_TREE) {
      needed.add(cat.handle);
      for (const [h] of cat.children) needed.add(h);
    }
    needed.add("trade");

    let n = 0;
    for (const h of needed) {
      n += 1;
      const set = await fetchCollectionHandles(h);
      log(`  [${n}/${needed.size}] ${h}: ${set.size}`);
      for (const ph of set) {
        if (!productMembership.has(ph)) productMembership.set(ph, new Set());
        productMembership.get(ph).add(h);
      }
    }

    fs.writeFileSync(
      CHECKPOINT,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          collections: collections.map((c) => ({
            handle: c.handle,
            title: c.title,
            products_count: c.products_count,
            image: c.image?.src || null,
          })),
          productHandles,
          productMembership: [...productMembership.entries()].map(([k, v]) => [
            k,
            [...v],
          ]),
        },
        null,
        2,
      ),
    );
  }

  if (LIMIT > 0) productHandles = productHandles.slice(0, LIMIT);

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");
  const colByHandle = new Map(collections.map((c) => [c.handle, c]));

  // Menus
  const keepMenuIds = new Set();
  let order = 0;
  for (const cat of SITE_TREE) {
    const col = colByHandle.get(cat.handle);
    let image = "";
    if (col?.image?.src) {
      try {
        image = await uploadRemoteImage(col.image.src, `menu-${cat.handle}`);
      } catch (e) {
        log(`menu img fail ${cat.handle}: ${e.message}`);
      }
    }
    const parent = await ensureMenu(db, {
      name: cat.title,
      slug: cat.handle,
      parent: null,
      brandId: brand._id,
      order: order++,
      image,
    });
    keepMenuIds.add(String(parent._id));

    let childOrder = 0;
    for (const [leaf, leafTitle] of cat.children) {
      const leafCol = colByHandle.get(leaf);
      let childImage = "";
      if (leafCol?.image?.src) {
        try {
          childImage = await uploadRemoteImage(
            leafCol.image.src,
            `menu-${cat.handle}-${leaf}`,
          );
        } catch {
          /* ignore */
        }
      }
      const child = await ensureMenu(db, {
        name: leafTitle,
        slug: leaf,
        parent: parent._id,
        brandId: brand._id,
        order: childOrder++,
        image: childImage,
      });
      keepMenuIds.add(String(child._id));
    }
  }

  // Remove any other menus for this brand only
  if (!DRY_RUN) {
    const all = await db.collection("menus").find({ brand: brand._id }).toArray();
    for (const m of all) {
      if (!keepMenuIds.has(String(m._id))) {
        await db.collection("menus").deleteOne({ _id: m._id, brand: brand._id });
        log(`Deleted obsolete menu ${m.slug}`);
      }
    }
  }

  let done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
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
  log(`Importing ${pending.length} products…`);

  let imported = 0;
  let failed = 0;

  await mapPool(pending, CONCURRENCY, async (handle, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    try {
      const data = await fetchJson(
        `${BASE}/products/${encodeURIComponent(handle)}.json`,
      );
      const detail = data.product;
      if (!detail) throw new Error("no product");

      const membership =
        productMembership.get(handle) || new Set();
      // also map trade → trade-flooring
      if (membership.has("trade")) membership.add("trade-flooring");

      const assign = pickAssignment(membership);
      const variant = (detail.variants || [])[0] || {};
      let price = Number(variant.price) || 0;
      let pricePerM2 = 0;

      if (!(price > 0)) {
        const { text } = await fetchText(`${BASE}/products/${handle}`);
        const scraped = parsePriceFromHtml(text);
        if (scraped.packPrice > 0) price = scraped.packPrice;
        pricePerM2 = scraped.pricePerM2;
      } else {
        // still try m2 from HTML lightly
        try {
          const { text } = await fetchText(`${BASE}/products/${handle}`);
          pricePerM2 = parsePriceFromHtml(text).pricePerM2;
        } catch {
          /* ignore */
        }
      }

      const name = cleanText(detail.title) || titleCase(handle);
      const description =
        cleanText(detail.body_html || "").slice(0, 8000) ||
        `${name} from Natura Flooring.`;
      const tags = Array.isArray(detail.tags)
        ? detail.tags
        : String(detail.tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);

      const sources = (detail.images || [])
        .map((img) => (typeof img === "string" ? img : img?.src))
        .filter(Boolean)
        .slice(0, MAX_IMAGES);

      const uploaded = [];
      for (let i = 0; i < sources.length; i++) {
        try {
          const url = await uploadRemoteImage(
            sources[i],
            `${slugify(handle)}-${i + 1}`,
          );
          if (url) uploaded.push(url);
        } catch (e) {
          log(`${label} img fail: ${e.message}`);
        }
      }

      const tagSpecs = specsFromTags(tags);
      const specs = {
        ...tagSpecs,
        sku: cleanText(variant.sku || "") || handle.toUpperCase(),
        source: SOURCE_TAG,
        sourceUrl: `${BASE}/products/${handle}`,
        naturaHandle: handle,
        naturaId: detail.id,
        vendorBrand: cleanText(detail.vendor || "Natura") || "Natura",
        productType: cleanText(detail.product_type || ""),
        tags: tags.slice(0, 40),
        ufhsCollections: undefined, // clear any mistaken field
        naturaCollections: [...membership],
      };
      if (pricePerM2 > 0) specs.pricePerM2 = pricePerM2;
      if (Number(variant.compare_at_price) > price && price > 0) {
        specs.compareAtPrice = Number(variant.compare_at_price);
      }
      for (const opt of detail.options || []) {
        const key = cleanText(opt.name);
        const val = cleanText((opt.values || [])[0]);
        if (key && val) specs[key] = val;
      }
      delete specs.ufhsCollections;

      const stock =
        typeof variant.inventory_quantity === "number"
          ? Math.max(0, variant.inventory_quantity)
          : STOCK_DEFAULT;

      const doc = {
        name,
        description,
        price: price > 0 ? price : 0,
        stock: Number.isFinite(stock) ? stock : STOCK_DEFAULT,
        images: uploaded,
        category: assign.category,
        subCategory: assign.subCategory || "",
        brand: brand._id,
        specs,
        updatedAt: new Date(),
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] ${name.slice(0, 50)} £${doc.price} cat=${doc.category}/${doc.subCategory || "-"} imgs=${uploaded.length}`,
        );
      } else {
        const existing = await productsCol.findOne({
          brand: brand._id,
          "specs.naturaHandle": handle,
        });
        if (existing) {
          await productsCol.updateOne(
            { _id: existing._id, brand: brand._id },
            { $set: doc },
          );
        } else {
          await productsCol.insertOne({ ...doc, createdAt: new Date() });
        }
        log(
          `${label} ok ${name.slice(0, 50)} £${doc.price} cat=${doc.category}/${doc.subCategory || "-"} imgs=${uploaded.length}`,
        );
      }

      imported += 1;
      done.add(handle);
      if (imported % 10 === 0) saveProgress();
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${handle}: ${e.message}`);
    }
  });

  saveProgress();

  // Brand cover from first family-floor / engineered lifestyle image
  if (!DRY_RUN && !SKIP_IMAGES) {
    try {
      const coverProd = await productsCol.findOne(
        {
          brand: brand._id,
          "images.0": { $exists: true },
          $or: [
            {
              category: "the-family-floor-engineered-hardwood-flooring",
            },
            { category: "engineered-wood-flooring" },
          ],
        },
        { projection: { images: 1, name: 1 } },
      );
      const src =
        (coverProd?.images || []).find((u) => /cloudinary/i.test(u)) || "";
      if (src) {
        const res = await fetch(src);
        const raw = Buffer.from(await res.arrayBuffer());
        const opt = await sharp(raw)
          .rotate()
          .resize({
            width: 1600,
            height: 1600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer();
        const uploaded = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "linx-living/brands",
              public_id: "natura-flooring-cover",
              overwrite: true,
              invalidate: true,
              format: "jpg",
            },
            (err, result) => (err ? reject(err) : resolve(result)),
          );
          stream.end(opt);
        });
        await db.collection("brands").updateOne(
          { _id: brand._id },
          { $set: { image: uploaded.secure_url, updatedAt: new Date() } },
        );
        log(`Brand cover set ${uploaded.secure_url}`);
      }
    } catch (e) {
      log(`Brand cover fail: ${e.message}`);
    }
  }

  const count = await productsCol.countDocuments({ brand: brand._id });
  const menus = await db.collection("menus").countDocuments({ brand: brand._id });
  log(`\nDone. imported=${imported} failed=${failed} brandProducts=${count} menus=${menus}`);

  try {
    await fetch("http://localhost:3000/api/revalidate-navigation");
    log("Navigation cache revalidated");
  } catch {
    log("Revalidate skipped — restart Next or hit /api/revalidate-navigation");
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
