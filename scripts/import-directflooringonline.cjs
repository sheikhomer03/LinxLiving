/**
 * Scrape https://directflooringonline.co.uk → Living Mongo + Cloudinary
 *
 * Creates brand "Direct Flooring Online", category menus (brand-scoped),
 * and products with galleries / descriptions / attribute specs.
 * Images are uploaded to Cloudinary (never stored as hotlinks).
 *
 * Shopify inbound already refuses to overwrite Cloudinary galleries with CDN URLs.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/import-directflooringonline.cjs
 *
 * Options:
 *   DRY_RUN=1 LIMIT=20 CONCURRENCY=2 SKIP_IMAGES=1 RESUME=1 DISCOVER_ONLY=1
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
const BRAND_NAME = "Direct Flooring Online";
const SOURCE_TAG = "directflooringonline-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/direct-flooring-online";
const CHECKPOINT = path.join(__dirname, "_tmp-dfo-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-dfo-progress.json");
const LOG = path.join(__dirname, "_tmp-dfo-import.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const DISCOVER_ONLY = process.env.DISCOVER_ONLY === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 8));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

/** Prefer these as parent catalogue categories when present on a product */
const PRIMARY_PARENT_SLUGS = new Set([
  "wood-flooring",
  "laminate-flooring",
  "lvt-flooring",
  "parquet-flooring",
  "accessories",
  "brands",
]);

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
    .replace(/&#822[01];|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
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
      "User-Agent": "Mozilla/5.0 LinxLivingDFOImporter/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxLivingDFOImporter/1.0",
      Accept: "*/*",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = String(imageUrl || "").split("?")[0];
  if (!clean || !/^https?:\/\//i.test(clean)) return "";
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
      order: 70,
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
      level: parent ? "subcategory" : "category",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      menu = { ...insert, _id: `dry-${slug}` };
    } else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
      log(`+ menu ${parent ? "sub" : "cat"} ${name}`);
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

async function discoverCategories() {
  const cats = [];
  const seen = new Set();
  for (let page = 1; page <= 20; page++) {
    const rows = await fetchJson(
      `${BASE}/wp-json/wc/store/v1/products/categories?per_page=100&page=${page}`,
    );
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      const slug = slugify(row.slug || row.name);
      if (!slug || seen.has(slug)) continue;
      if (slug === "default-category" || slug === "uncategorized") continue;
      seen.add(slug);
      cats.push({
        id: row.id,
        name: cleanText(row.name) || titleCase(slug),
        slug,
        parentId: row.parent || 0,
        description: cleanText(row.description || ""),
        count: Number(row.count) || 0,
        image: row.image?.src || "",
        url: row.permalink || `${BASE}/product-category/${slug}/`,
      });
    }
    if (rows.length < 100) break;
    await delay(150);
  }

  // Sitemap fallback / enrichment
  try {
    const xml = await fetchText(`${BASE}/product_cat-sitemap.xml`);
    for (const loc of extractLocs(xml)) {
      const m = loc.match(/\/product-category\/(.+?)\/?$/i);
      if (!m) continue;
      const parts = m[1].split("/").filter(Boolean);
      const slug = slugify(parts[parts.length - 1]);
      if (!slug || seen.has(slug)) continue;
      if (slug === "default-category") continue;
      seen.add(slug);
      cats.push({
        id: null,
        name: titleCase(slug),
        slug,
        parentId: 0,
        parentSlug: parts.length > 1 ? slugify(parts[0]) : null,
        description: "",
        count: 0,
        image: "",
        url: loc,
      });
    }
  } catch (e) {
    log("category sitemap warn:", e.message);
  }

  return cats;
}

async function discoverProductsViaApi() {
  const products = [];
  for (let page = 1; page <= 100; page++) {
    const rows = await fetchJson(
      `${BASE}/wp-json/wc/store/v1/products?per_page=100&page=${page}&orderby=id&order=asc`,
    );
    if (!Array.isArray(rows) || !rows.length) break;
    products.push(...rows);
    log(`API products page ${page}: +${rows.length} (total ${products.length})`);
    if (rows.length < 100) break;
    await delay(200);
  }
  return products;
}

async function discoverProductUrlsFromSitemap() {
  const urls = new Set();
  const xml = await fetchText(`${BASE}/product-sitemap.xml`);
  for (const loc of extractLocs(xml)) {
    if (/\/product\//i.test(loc)) urls.add(loc.replace(/\/$/, "") + "/");
  }
  // Yoast may split: product-sitemap2.xml etc.
  try {
    const index = await fetchText(`${BASE}/wp-sitemap.xml`);
    for (const sm of extractLocs(index).filter((u) => /product-sitemap/i.test(u))) {
      if (sm.includes("product-sitemap.xml") && !/product-sitemap\d/i.test(sm))
        continue;
      const body = await fetchText(sm);
      for (const loc of extractLocs(body)) {
        if (/\/product\//i.test(loc)) urls.add(loc.replace(/\/$/, "") + "/");
      }
      await delay(150);
    }
  } catch {
    /* optional */
  }
  return [...urls];
}

function pickPrimaryCategory(storeCats) {
  const list = Array.isArray(storeCats) ? storeCats : [];
  if (!list.length) {
    return { categorySlug: "flooring", categoryName: "Flooring", subSlug: "", subName: "" };
  }

  // Prefer a known top-level floor type as parent
  const parentish = list.find((c) => PRIMARY_PARENT_SLUGS.has(c.slug));
  const parent = parentish || list.find((c) => /flooring|accessories/i.test(c.slug)) || list[0];

  // Prefer a child that nests under that parent in its link path
  let child =
    list.find(
      (c) =>
        c.slug !== parent.slug &&
        String(c.link || "").includes(`/product-category/${parent.slug}/`),
    ) ||
    list.find((c) => c.slug !== parent.slug && !PRIMARY_PARENT_SLUGS.has(c.slug)) ||
    null;

  // Room-only cats as parent are weak — swap if we have a better floor type
  if (
    /flooring-by-room|bedroom-|kitchen-|hallway-|living-room-|utility-|conservatory-|office-|dining-room-/i.test(
      parent.slug,
    )
  ) {
    const better = list.find((c) =>
      /^(wood|laminate|lvt|parquet)-flooring$|accessories/i.test(c.slug),
    );
    if (better) {
      return {
        categorySlug: slugify(better.slug),
        categoryName: cleanText(better.name),
        subSlug: slugify(parent.slug),
        subName: cleanText(parent.name),
      };
    }
  }

  return {
    categorySlug: slugify(parent.slug),
    categoryName: cleanText(parent.name),
    subSlug: child ? slugify(child.slug) : "",
    subName: child ? cleanText(child.name) : "",
  };
}

function buildSpecs(store) {
  const specs = {
    source: SOURCE_TAG,
    sourceUrl: store.permalink || "",
    dfoId: store.id,
    dfoSku: store.sku || "",
    sku: store.sku || "",
  };
  for (const attr of store.attributes || []) {
    const key = cleanText(attr.name);
    const vals = (attr.terms || [])
      .map((t) => cleanText(t.name))
      .filter(Boolean);
    if (key && vals.length) specs[key] = vals.join(", ");
  }
  if (Array.isArray(store.brands) && store.brands[0]?.name) {
    specs.manufacturerBrand = cleanText(store.brands[0].name);
  }
  const minor = store.prices?.currency_minor_unit === 2 ? 100 : 1;
  const regular = Number(store.prices?.regular_price || 0) / minor;
  if (regular > 0) specs.regularPrice = regular;
  if (store.on_sale) specs.onSale = true;
  specs.unit = /per\s*m2|m²/i.test(String(store.price_html || ""))
    ? "per m2"
    : "";
  return specs;
}

function mapStoreProduct(store) {
  const slug =
    store.slug ||
    String(store.permalink || "")
      .split("/product/")[1]
      ?.replace(/\/$/, "") ||
    "";
  const name = cleanText(store.name) || titleCase(slug);
  const description =
    cleanText(store.description || "") ||
    cleanText(store.short_description || "") ||
    `${name} from Direct Flooring Online.`;

  const images = [];
  for (const img of store.images || []) {
    const src = String(img.src || "").split("?")[0];
    if (!src || !/^https?:\/\//i.test(src)) continue;
    if (/logo|favicon|\.svg$/i.test(src)) continue;
    if (!images.includes(src)) images.push(src);
  }

  const cats = pickPrimaryCategory(store.categories);
  const minor = store.prices?.currency_minor_unit === 2 ? 100 : 1;
  const price =
    Number(store.prices?.sale_price || store.prices?.price || 0) / minor || 0;

  return {
    id: store.id,
    url: store.permalink || `${BASE}/product/${slug}/`,
    slug,
    name,
    description: description.slice(0, 12000),
    images: images.slice(0, MAX_IMAGES),
    price,
    stock: store.is_in_stock === false ? 0 : STOCK_DEFAULT,
    ...cats,
    specs: buildSpecs(store),
    sku: cleanText(store.sku || "") || slugify(slug).toUpperCase(),
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
  fs.writeFileSync(LOG, `DFO import ${new Date().toISOString()}\n`);
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

  log(
    `Direct Flooring Online import${DRY_RUN ? " (DRY RUN)" : ""} concurrency=${CONCURRENCY}`,
  );

  let categories = [];
  let storeProducts = [];

  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    categories = saved.categories || [];
    storeProducts = saved.storeProducts || [];
    log(
      `Resumed ${storeProducts.length} products, ${categories.length} categories`,
    );
  } else {
    categories = await discoverCategories();
    log(`Categories discovered: ${categories.length}`);
    storeProducts = await discoverProductsViaApi();
    log(`Products from API: ${storeProducts.length}`);

    // Merge any sitemap-only products missing from API page walk
    try {
      const sitemapUrls = await discoverProductUrlsFromSitemap();
      const have = new Set(
        storeProducts.map((p) =>
          String(p.permalink || "").replace(/\/$/, "").toLowerCase(),
        ),
      );
      let missing = 0;
      for (const url of sitemapUrls) {
        const key = url.replace(/\/$/, "").toLowerCase();
        if (have.has(key)) continue;
        const slug = url.split("/product/")[1]?.replace(/\/$/, "");
        if (!slug) continue;
        try {
          const rows = await fetchJson(
            `${BASE}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`,
          );
          if (Array.isArray(rows) && rows[0]) {
            storeProducts.push(rows[0]);
            have.add(key);
            missing++;
          }
        } catch {
          /* skip */
        }
        await delay(120);
      }
      log(`Sitemap extras fetched: ${missing}`);
    } catch (e) {
      log("sitemap merge warn:", e.message);
    }

    fs.writeFileSync(
      CHECKPOINT,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          categories,
          storeProducts,
          count: storeProducts.length,
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

  if (LIMIT > 0) storeProducts = storeProducts.slice(0, LIMIT);

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  // Build parent menus for primary floor types first
  const parentMenus = new Map();
  const primaryParents = categories.filter((c) =>
    PRIMARY_PARENT_SLUGS.has(c.slug),
  );
  const orderedParents = primaryParents.length
    ? primaryParents
    : categories.filter((c) => !c.parentId);

  for (let i = 0; i < orderedParents.length; i++) {
    const cat = orderedParents[i];
    let image = "";
    if (cat.image) {
      try {
        image = await uploadRemoteImage(cat.image, `menu-${cat.slug}`);
      } catch (e) {
        log(`menu image fail ${cat.slug}:`, e.message);
      }
    }
    const menu = await ensureMenu(db, {
      name: cat.name,
      slug: cat.slug,
      parent: null,
      brandId: brand._id,
      order: i,
      image,
    });
    parentMenus.set(cat.slug, menu);
  }

  // Subcategory menus under known parents
  const subMenus = new Map();
  for (const cat of categories) {
    if (PRIMARY_PARENT_SLUGS.has(cat.slug)) continue;
    // Infer parent from URL path /product-category/parent/child/
    let parentSlug = cat.parentSlug || null;
    if (!parentSlug && cat.url) {
      const m = String(cat.url).match(
        /\/product-category\/([^/]+)\/([^/]+)\/?$/i,
      );
      if (m) parentSlug = slugify(m[1]);
    }
    if (!parentSlug && cat.parentId) {
      const parent = categories.find((c) => c.id === cat.parentId);
      parentSlug = parent?.slug || null;
    }
    if (!parentSlug || !parentMenus.has(parentSlug)) continue;

    let image = "";
    if (cat.image) {
      try {
        image = await uploadRemoteImage(cat.image, `menu-${cat.slug}`);
      } catch {
        /* ignore */
      }
    }
    const menu = await ensureMenu(db, {
      name: cat.name,
      slug: cat.slug,
      parent: parentMenus.get(parentSlug)._id,
      brandId: brand._id,
      order: 0,
      image,
    });
    subMenus.set(`${parentSlug}/${cat.slug}`, menu);
  }

  const done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    try {
      const prog = JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
      for (const id of prog.done || []) done.add(String(id));
      log(`Resume progress: ${done.size} already done`);
    } catch {
      /* ignore */
    }
  }

  let imported = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  const pending = storeProducts.filter((p) => !done.has(String(p.id)));
  log(`Importing ${pending.length} products…`);

  await mapPool(pending, CONCURRENCY, async (store, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    try {
      const p = mapStoreProduct(store);
      if (!p.name || p.price < 0) {
        skipped++;
        log(`${label} skip bad product ${store.id}`);
        return;
      }

      // Ensure category menu exists (create on the fly if needed)
      let parentMenu = parentMenus.get(p.categorySlug);
      if (!parentMenu) {
        parentMenu = await ensureMenu(db, {
          name: p.categoryName || titleCase(p.categorySlug),
          slug: p.categorySlug || "flooring",
          parent: null,
          brandId: brand._id,
          order: 99,
          image: "",
        });
        parentMenus.set(p.categorySlug, parentMenu);
      }
      if (p.subSlug) {
        const key = `${p.categorySlug}/${p.subSlug}`;
        if (!subMenus.has(key)) {
          const sub = await ensureMenu(db, {
            name: p.subName || titleCase(p.subSlug),
            slug: p.subSlug,
            parent: parentMenu._id,
            brandId: brand._id,
            order: 0,
            image: "",
          });
          subMenus.set(key, sub);
        }
      }

      const handle = slugify(p.slug || p.name) || `dfo-${p.id}`;
      const uploaded = [];
      for (let i = 0; i < p.images.length; i++) {
        try {
          const url = await uploadRemoteImage(p.images[i], `${handle}-${i + 1}`);
          if (url) uploaded.push(url);
        } catch (e) {
          log(`${label} image fail:`, e.message);
        }
      }

      // If category has no cover yet, use first product image
      if (uploaded[0] && parentMenu && !parentMenu.image && !DRY_RUN) {
        await db.collection("menus").updateOne(
          { _id: parentMenu._id },
          { $set: { image: uploaded[0], updatedAt: new Date() } },
        );
        parentMenu.image = uploaded[0];
      }

      const now = new Date();
      const doc = {
        name: p.name,
        description: p.description,
        price: p.price,
        images: uploaded,
        category: p.categorySlug || "flooring",
        subCategory: p.subSlug || "",
        brand: brand._id,
        brands: [brand._id],
        stock: p.stock,
        tagline: p.specs.unit ? String(p.specs.unit) : "",
        schematicImage: "",
        linxSku: p.sku || "",
        manufacturerSku: p.sku || "",
        specs: p.specs,
        showSpecs: true,
        updatedAt: now,
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] ${p.name} £${p.price} imgs=${p.images.length}->${uploaded.length} cat=${doc.category}/${doc.subCategory}`,
        );
        imported++;
      } else {
        const existing = await productsCol.findOne({
          $or: [
            { "specs.sourceUrl": p.url, "specs.source": SOURCE_TAG },
            { "specs.dfoId": p.id, "specs.source": SOURCE_TAG },
            ...(p.sku
              ? [{ "specs.dfoSku": p.sku, "specs.source": SOURCE_TAG }]
              : []),
          ],
        });

        // Never clobber an existing Cloudinary gallery with empty upload failure
        if (existing) {
          const prev = Array.isArray(existing.images) ? existing.images : [];
          const prevCloud = prev.filter((u) => /cloudinary\.com/i.test(u));
          if (!uploaded.length && prevCloud.length) {
            doc.images = prevCloud;
          } else if (uploaded.length) {
            doc.images = uploaded;
          } else {
            doc.images = prev;
          }
          await productsCol.updateOne(
            { _id: existing._id },
            { $set: doc },
          );
          updated++;
        } else {
          await productsCol.insertOne({ ...doc, createdAt: now });
          imported++;
        }
        log(
          `${label} ✓ ${p.name} (£${p.price}) imgs=${doc.images.length}`,
        );
      }

      done.add(String(store.id));
      if ((imported + updated) % 10 === 0) {
        fs.writeFileSync(
          PROGRESS,
          JSON.stringify(
            {
              at: new Date().toISOString(),
              done: [...done],
              imported,
              updated,
              failed,
            },
            null,
            2,
          ),
        );
      }
    } catch (e) {
      failed++;
      log(`${label} ✗`, e.message);
    }
  });

  fs.writeFileSync(
    PROGRESS,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        done: [...done],
        imported,
        updated,
        failed,
        skipped,
      },
      null,
      2,
    ),
  );

  log("\n========== DFO IMPORT ==========");
  log(`Created:  ${imported}`);
  log(`Updated:  ${updated}`);
  log(`Failed:   ${failed}`);
  log(`Skipped:  ${skipped}`);
  log(`Brand:    ${BRAND_NAME} (${brand._id})`);

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
