/**
 * Import Noken catalogue → Living Mongo + Cloudinary
 *
 * Source: https://www.noken.com/en
 * Brand slug: noken (isolated — never upserts other brands)
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/import-noken.cjs
 *
 * Options:
 *   DRY_RUN=1
 *   LIMIT=50
 *   CONCURRENCY=2
 *   SKIP_IMAGES=1
 *   RESUME=1
 *   MAX_IMAGES=6
 *   EXPAND_VARIANTS=1  (default) import each finish/SAP as its own product
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

const BASE = "https://www.noken.com";
const BRAND_SLUG = "noken";
const BRAND_NAME = "Noken";
const SOURCE_TAG = "noken-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/noken";
const CHECKPOINT = path.join(__dirname, "_tmp-noken-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-noken-progress.json");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const RESUME = process.env.RESUME !== "0";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 6));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 0);
const EXPAND_VARIANTS = process.env.EXPAND_VARIANTS !== "0";

const TOP_CATEGORIES = [
  { slug: "accessories", name: "Accessories" },
  { slug: "basins", name: "Basins" },
  { slug: "bathroom-taps", name: "Bathroom Faucets" },
  { slug: "bathroom-furniture", name: "Bathroom Furniture" },
  { slug: "bathtub", name: "Bathtub" },
  { slug: "installation-systems", name: "Installation Systems" },
  { slug: "kitchen-taps", name: "Kitchen Faucets" },
  { slug: "mirror", name: "Mirrors" },
  { slug: "sanitaryware", name: "Sanitaryware" },
  { slug: "shower", name: "Shower" },
  { slug: "shower-trays", name: "Shower Trays" },
  { slug: "towel-warmers", name: "Towel Warmers" },
];

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
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function titleCaseSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function http(url, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
      Referer: `${BASE}/en`,
      ...headers,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 160)}`);
  return text;
}

function extractAllProducts(html) {
  const m = html.match(
    /id=["']all-products-data["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m) return [];
  try {
    const data = JSON.parse(m[1].trim());
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function extractSubcategoryLinks(html, parentSlug) {
  const re = new RegExp(
    `href=["'](https://www\\.noken\\.com/en/products/${parentSlug}/([a-z0-9-]+))["']`,
    "gi",
  );
  const out = new Map();
  for (const m of html.matchAll(re)) {
    const url = m[1];
    const sub = m[2];
    if (!sub || sub === "feed") continue;
    out.set(sub, url);
  }
  return [...out.entries()].map(([slug, url]) => ({
    slug,
    url,
    name: titleCaseSlug(slug),
  }));
}

function extractOgDescription(html) {
  const m =
    html.match(
      /property=["']og:description["']\s+content=["']([^"']+)/i,
    ) ||
    html.match(
      /content=["']([^"']+)["']\s+property=["']og:description["']/i,
    );
  return cleanText(m?.[1] || "");
}

function extractPdpImages(html, sap) {
  const found = [];
  const push = (u) => {
    const url = String(u || "").split("?")[0];
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (/favicon|garantias|categoria_|noken\.jpg|icon-/i.test(url)) return;
    if (!found.includes(url)) found.push(url);
  };

  for (const m of html.matchAll(
    /https:\/\/catalogos\.porcelanosagrupo\.com\/recursos\/(?:img|amb)\/high\/[^"'\\\s]+/gi,
  )) {
    push(m[0]);
  }
  if (sap) {
    push(`https://catalogos.porcelanosagrupo.com/recursos/img/high/${sap}.jpg`);
  }
  return found;
}

function absCatalogImage(relOrUrl) {
  const s = String(relOrUrl || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://catalogos.porcelanosagrupo.com/${s.replace(/^\/+/, "")}`;
}

async function downloadImageBuffer(imageUrl) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    Referer: `${BASE}/en`,
  };
  const res = await fetch(imageUrl, { headers });
  if (!res.ok) throw new Error(`download ${res.status}: ${imageUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error(`empty image: ${imageUrl}`);
  return buffer;
}

function uploadBuffer(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: publicId.slice(0, 180),
        overwrite: true,
        resource_type: "image",
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = String(imageUrl).split("?")[0];
  if (!clean) return "";
  if (SKIP_IMAGES || DRY_RUN) return clean;
  const buffer = await downloadImageBuffer(clean);
  return uploadBuffer(buffer, publicId);
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: BRAND_SLUG });
  const now = new Date();
  if (!brand) {
    const insert = {
      name: BRAND_NAME,
      slug: BRAND_SLUG,
      order: 61,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      brand = { ...insert, _id: "dry-brand" };
      console.log("[dry] create brand", BRAND_NAME);
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
    if (DRY_RUN) {
      menu = { ...insert, _id: `dry-${slug}` };
    } else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
    }
  } else if (!DRY_RUN) {
    await menus.updateOne(
      { _id: menu._id },
      {
        $set: {
          isActive: true,
          name,
          updatedAt: now,
          // Dedicated banner/listing image wins over empty or missing
          ...(image ? { image } : {}),
        },
      },
    );
    if (image) menu.image = image;
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
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
}

function upsertItem(map, item) {
  const key = String(item.sap);
  const prev = map.get(key);
  if (!prev) {
    map.set(key, item);
    return;
  }
  // Prefer deeper subcategory assignment
  const prevDepth =
    (prev.subCategorySlug ? 1 : 0) + (prev.description ? 0.1 : 0);
  const nextDepth =
    (item.subCategorySlug ? 1 : 0) + (item.description ? 0.1 : 0);
  if (nextDepth >= prevDepth) map.set(key, { ...prev, ...item });
}

function expandProductRows(raw, meta) {
  const rows = [];
  const base = {
    title: cleanText(raw.title),
    description: cleanText(raw.description),
    agrupacion: cleanText(raw.agrupacion),
    orden: Number(raw.orden) || 0,
    categorySlug: meta.categorySlug,
    categoryName: meta.categoryName,
    subCategorySlug: meta.subCategorySlug || "",
    subCategoryName: meta.subCategoryName || "",
    listingUrl: meta.listingUrl,
  };

  const colors = Array.isArray(raw.colors) ? raw.colors : [];
  if (EXPAND_VARIANTS && colors.length) {
    for (const color of colors) {
      const sap = String(color.CodigoSAP || raw.sap || "").trim();
      if (!sap) continue;
      const finish = cleanText(
        color.Acabado || color.DescripcionRetocada || color.MarcaAcabado || "",
      );
      const image =
        absCatalogImage(color.product_image) ||
        absCatalogImage(color.Imagen) ||
        absCatalogImage(raw.image_url) ||
        `https://catalogos.porcelanosagrupo.com/recursos/img/high/${sap}.jpg`;
      const link =
        String(color.link || raw.link || "").trim() ||
        `${BASE}/en/products/${slugify(raw.title)}-${sap}`;
      rows.push({
        ...base,
        sap,
        finish,
        image_url: image,
        link,
        colorIcon: absCatalogImage(color.image),
      });
    }
  } else {
    const sap = String(raw.sap || "").trim();
    if (!sap) return rows;
    rows.push({
      ...base,
      sap,
      finish: "",
      image_url: absCatalogImage(raw.image_url),
      link: String(raw.link || "").trim(),
      colorIcon: "",
    });
  }
  return rows;
}

/** Homepage tipology cards + nav menu_image → parent category banners. */
async function scrapeCategoryBanners() {
  const bySlug = new Map();
  try {
    const home = await http(`${BASE}/en`);
    for (const m of home.matchAll(
      /<div class="tipology[\s\S]*?<a href=["']https:\/\/www\.noken\.com\/en\/products\/([a-z0-9-]+)["'][\s\S]*?<img[^>]+src=["']([^"']+)["'][\s\S]*?<\/div>/gi,
    )) {
      bySlug.set(m[1], m[2]);
    }
    const blocks = new Map();
    for (const m of home.matchAll(
      /<div[^>]*id=["'](menu_image_\d+)["'][^>]*>([\s\S]*?)<\/div>/gi,
    )) {
      const src = m[2].match(/src=["']([^"']+)["']/i)?.[1];
      if (src) blocks.set(m[1], src);
    }
    for (const m of home.matchAll(
      /data-img=["']#(menu_image_\d+)["'][^>]*href=["']https:\/\/www\.noken\.com\/en\/products\/([a-z0-9-]+)["']/gi,
    )) {
      const src = blocks.get(m[1]);
      if (src && !bySlug.has(m[2])) bySlug.set(m[2], src);
    }
  } catch (e) {
    console.warn(`Category banner scrape failed: ${e.message}`);
  }
  return bySlug;
}

async function discoverAll() {
  if (RESUME && fs.existsSync(CHECKPOINT)) {
    try {
      const prev = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
      if (Array.isArray(prev.items) && prev.items.length) {
        console.log(`Resume checkpoint: ${prev.items.length} products`);
        const categoryImages =
          prev.categoryImages && Object.keys(prev.categoryImages).length
            ? prev.categoryImages
            : Object.fromEntries(await scrapeCategoryBanners());
        return {
          items: prev.items,
          categoryImages,
          subcategoryImages: prev.subcategoryImages || {},
        };
      }
    } catch {
      /* ignore */
    }
  }

  const bySap = new Map();
  const listingPages = [];
  const categoryImages = Object.fromEntries(await scrapeCategoryBanners());
  const subcategoryImages = {};
  console.log(
    `Category banners: ${Object.keys(categoryImages).length}`,
    Object.keys(categoryImages).join(", "),
  );

  for (const cat of TOP_CATEGORIES) {
    const url = `${BASE}/en/products/${cat.slug}`;
    listingPages.push({
      url,
      categorySlug: cat.slug,
      categoryName: cat.name,
      subCategorySlug: "",
      subCategoryName: "",
    });

    try {
      const html = await http(url);
      const subs = extractSubcategoryLinks(html, cat.slug);
      console.log(`Category ${cat.slug}: ${subs.length} subcategories`);
      for (const sub of subs) {
        listingPages.push({
          url: sub.url,
          categorySlug: cat.slug,
          categoryName: cat.name,
          subCategorySlug: sub.slug,
          subCategoryName: sub.name,
        });
      }
    } catch (e) {
      console.warn(`Category fail ${cat.slug}: ${e.message}`);
    }
    await delay(150);
  }

  console.log(`Listing pages to scrape: ${listingPages.length}`);

  for (let i = 0; i < listingPages.length; i++) {
    const page = listingPages[i];
    const label = `[${i + 1}/${listingPages.length}] ${page.url.replace(BASE, "")}`;
    try {
      const html = await http(page.url);
      const products = extractAllProducts(html);
      let added = 0;
      for (const raw of products) {
        for (const row of expandProductRows(raw, page)) {
          const before = bySap.size;
          upsertItem(bySap, row);
          if (bySap.size > before) added += 1;
        }
      }
      // Capture subcategory listing image (first product) when page is a subcat
      if (page.subCategorySlug && products[0]) {
        const key = `${page.categorySlug}::${page.subCategorySlug}`;
        const img =
          absCatalogImage(products[0].image_url) ||
          (products[0].sap
            ? `https://catalogos.porcelanosagrupo.com/recursos/img/high/${products[0].sap}.jpg`
            : "");
        if (img && !subcategoryImages[key]) subcategoryImages[key] = img;
      }
      console.log(`${label} products=${products.length} unique+=${added} total=${bySap.size}`);
    } catch (e) {
      console.warn(`${label} FAIL ${e.message}`);
    }
    await delay(120);
  }

  const items = [...bySap.values()];
  fs.writeFileSync(
    CHECKPOINT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        items,
        categoryImages,
        subcategoryImages,
      },
      null,
      2,
    ),
  );
  return { items, categoryImages, subcategoryImages };
}

async function enrichProduct(item) {
  let description = item.description || "";
  const images = [];
  const pushImg = (u) => {
    const url = absCatalogImage(u);
    if (url && !images.includes(url)) images.push(url);
  };
  pushImg(item.image_url);
  pushImg(
    `https://catalogos.porcelanosagrupo.com/recursos/img/high/${item.sap}.jpg`,
  );

  try {
    if (item.link) {
      const html = await http(item.link);
      const og = extractOgDescription(html);
      if (og) description = og;
      for (const img of extractPdpImages(html, item.sap)) pushImg(img);
    }
  } catch (e) {
    // listing data is enough
  }

  const nameParts = [item.title, item.finish].filter(Boolean);
  const name = cleanText(nameParts.join(" — ")) || `Noken ${item.sap}`;
  if (!description) {
    description = item.finish
      ? `${item.title} in ${item.finish}. Noken bathroom product.`
      : `${item.title}. Noken bathroom product.`;
  }

  return {
    name,
    description: description.slice(0, 8000),
    images: images.slice(0, MAX_IMAGES),
  };
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
    `Noken import${DRY_RUN ? " (DRY RUN)" : ""} concurrency=${CONCURRENCY}`,
  );

  let discovered = await discoverAll();
  let items = discovered.items;
  const categoryImages = discovered.categoryImages || {};
  const subcategoryImages = discovered.subcategoryImages || {};
  if (LIMIT > 0) items = items.slice(0, LIMIT);

  let done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []);
    } catch {
      /* ignore */
    }
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  const parentMenus = new Map();
  const childMenus = new Map();

  // Upload dedicated category banners once up front
  const uploadedCatImages = {};
  for (const [slug, url] of Object.entries(categoryImages)) {
    try {
      uploadedCatImages[slug] = await uploadRemoteImage(
        url,
        `menu-cat-${slug}`,
      );
      console.log(`Category image ${slug} ok`);
    } catch (e) {
      console.warn(`Category image ${slug} fail: ${e.message}`);
    }
  }
  const uploadedSubImages = {};
  for (const [key, url] of Object.entries(subcategoryImages)) {
    try {
      uploadedSubImages[key] = await uploadRemoteImage(
        url,
        `menu-sub-${slugify(key)}`,
      );
    } catch (e) {
      console.warn(`Subcategory image ${key} fail: ${e.message}`);
    }
  }

  async function menusFor(item) {
    if (!parentMenus.has(item.categorySlug)) {
      const parent = await ensureMenu(db, {
        name: item.categoryName,
        slug: item.categorySlug,
        parent: null,
        brandId: brand._id,
        order: parentMenus.size,
        image: uploadedCatImages[item.categorySlug] || "",
      });
      parentMenus.set(item.categorySlug, parent);
      // Prefer dedicated banner over any empty/stale image
      if (
        !DRY_RUN &&
        uploadedCatImages[item.categorySlug] &&
        parent?._id &&
        !String(parent._id).startsWith("dry")
      ) {
        await db.collection("menus").updateOne(
          { _id: parent._id },
          {
            $set: {
              image: uploadedCatImages[item.categorySlug],
              updatedAt: new Date(),
            },
          },
        );
      }
    }
    const parent = parentMenus.get(item.categorySlug);
    const subSlug = item.subCategorySlug || "general";
    const subName = item.subCategoryName || "General";
    const childKey = `${item.categorySlug}::${subSlug}`;
    if (!childMenus.has(childKey)) {
      const child = await ensureMenu(db, {
        name: subName,
        slug: subSlug,
        parent: parent._id,
        brandId: brand._id,
        order: childMenus.size,
        image: uploadedSubImages[childKey] || "",
      });
      childMenus.set(childKey, child);
      if (
        !DRY_RUN &&
        uploadedSubImages[childKey] &&
        child?._id &&
        !String(child._id).startsWith("dry")
      ) {
        await db.collection("menus").updateOne(
          { _id: child._id },
          {
            $set: {
              image: uploadedSubImages[childKey],
              updatedAt: new Date(),
            },
          },
        );
      }
    }
    return {
      parent: parentMenus.get(item.categorySlug),
      child: childMenus.get(childKey),
    };
  }

  const pending = items.filter((it) => !done.has(it.sap));
  console.log(
    `\nImporting ${pending.length} (skip ${items.length - pending.length} done)`,
  );

  let imported = 0;
  let failed = 0;

  const saveProgress = () => {
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );
  };

  await mapPool(pending, CONCURRENCY, async (item, idx) => {
    const label = `[${idx + 1}/${pending.length}] ${item.sap}`;
    try {
      const enriched = await enrichProduct(item);
      const { parent, child } = await menusFor(item);
      const handle =
        slugify(`${item.title}-${item.finish}-${item.sap}`) || item.sap;

      const uploaded = [];
      for (let i = 0; i < enriched.images.length; i++) {
        try {
          const url = await uploadRemoteImage(
            enriched.images[i],
            `${handle}-${i + 1}`,
          );
          if (url) uploaded.push(url);
        } catch (e) {
          console.warn(`${label} image fail: ${e.message}`);
        }
      }

      const childKey = `${item.categorySlug}::${child.slug}`;
      if (
        !DRY_RUN &&
        uploaded[0] &&
        child?._id &&
        !String(child._id).startsWith("dry") &&
        !uploadedSubImages[childKey]
      ) {
        await db.collection("menus").updateOne(
          {
            _id: child._id,
            $or: [{ image: "" }, { image: { $exists: false } }],
          },
          { $set: { image: uploaded[0], updatedAt: new Date() } },
        );
      }
      if (
        !DRY_RUN &&
        uploaded[0] &&
        parent?._id &&
        !String(parent._id).startsWith("dry") &&
        !uploadedCatImages[item.categorySlug]
      ) {
        await db.collection("menus").updateOne(
          {
            _id: parent._id,
            $or: [{ image: "" }, { image: { $exists: false } }],
          },
          { $set: { image: uploaded[0], updatedAt: new Date() } },
        );
      }

      const specs = {
        sku: item.sap,
        productCode: item.sap,
        source: SOURCE_TAG,
        sourceUrl: item.link || "",
        finish: item.finish || "",
        agrupacion: item.agrupacion || "",
        nokenSap: item.sap,
        listingUrl: item.listingUrl || "",
      };

      const doc = {
        name: enriched.name,
        description: enriched.description,
        price: 0,
        images: uploaded,
        category: parent.slug,
        subCategory: child.slug,
        brand: brand._id,
        stock: STOCK_DEFAULT,
        tagline: item.finish || item.title || "",
        schematicImage: "",
        specs,
        showSpecs: true,
        updatedAt: new Date(),
      };

      if (DRY_RUN) {
        console.log(
          `${label} [dry] ${enriched.name} imgs=${uploaded.length} cat=${parent.slug}/${child.slug}`,
        );
      } else {
        await productsCol.updateOne(
          {
            brand: brand._id,
            "specs.source": SOURCE_TAG,
            "specs.sku": item.sap,
          },
          { $set: doc, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        );
        console.log(
          `${label} ok ${enriched.name.slice(0, 60)} imgs=${uploaded.length}`,
        );
      }

      imported += 1;
      done.add(item.sap);
      if (imported % 25 === 0) saveProgress();
      await delay(80);
    } catch (e) {
      failed += 1;
      console.warn(`${label} FAIL ${e.message}`);
    }
  });

  saveProgress();
  console.log(
    JSON.stringify(
      {
        brand: BRAND_SLUG,
        discovered: items.length,
        imported,
        failed,
        done: done.size,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
