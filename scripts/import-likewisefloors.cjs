/**
 * Scrape https://likewisefloors.com → Living Mongo + Cloudinary
 *
 * Brand slug: likewisefloors
 * Discovers products via Yoast product sitemaps, categories from /categories/,
 * scrapes PDP details via Jina, uploads images to Cloudinary (no hotlinks).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-likewisefloors.cjs
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

const BASE = "https://likewisefloors.com";
const BRAND_SLUG = "likewisefloors";
const BRAND_NAME = "Likewise Floors";
const SOURCE_TAG = "likewisefloors-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/likewisefloors";
const CHECKPOINT = path.join(__dirname, "_tmp-likewise-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-likewise-progress.json");
const LOG = path.join(__dirname, "_tmp-likewise-import.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const DISCOVER_ONLY = process.env.DISCOVER_ONLY === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 6));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

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
    .replace(/&#822[01];|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(s) {
  return cleanText(
    String(s || "")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
        String.fromCharCode(parseInt(h, 16)),
      ),
  );
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0",
      Accept: "*/*",
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchViaJina(url) {
  return fetchText(`https://r.jina.ai/${url}`, { Accept: "text/plain" });
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
    public_id: publicId.slice(0, 180),
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
      order: 60,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      brand = { ...insert, _id: "dry-brand" };
      log("[dry] create brand Likewise Floors");
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
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      menu = { ...insert, _id: `dry-${slug}` };
    } else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
      log(`Created menu ${name}`);
    }
  } else if (!DRY_RUN) {
    const set = { name, isActive: true, updatedAt: now, order: order ?? menu.order };
    if (image && (!menu.image || process.env.FORCE_MENU_IMAGE === "1")) {
      set.image = image;
    }
    await menus.updateOne({ _id: menu._id }, { $set: set });
    menu = { ...menu, ...set };
  }
  return menu;
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

async function discoverCategories() {
  const md = await fetchViaJina(`${BASE}/categories/`);
  const cats = [];
  const seen = new Set();
  for (const m of md.matchAll(
    /!\[([^\]]*)\]\((https?:[^)]+)\)\s*([^\]]+?)→\]\((https?:\/\/likewisefloors\.com\/product-category\/[^)]+)\)/gi,
  )) {
    const name = cleanText(m[3] || m[1]).replace(/→/g, "").trim();
    const image = m[2].split("?")[0];
    const url = m[4].split("?")[0];
    const slug = slugify(url.split("/product-category/")[1] || name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    cats.push({ name: name || titleCase(slug), slug, url, image });
  }
  // Fallback regex
  if (!cats.length) {
    for (const m of md.matchAll(
      /\[(?:!\[[^\]]*\]\((https?:[^)]+)\)\s*)?([^\]]+)→\]\((https?:\/\/likewisefloors\.com\/product-category\/[^)]+)\)/gi,
    )) {
      const image = (m[1] || "").split("?")[0];
      const name = cleanText(m[2]).replace(/→/g, "").trim();
      const url = m[3].split("?")[0];
      const slug = slugify(url.split("/product-category/")[1] || name);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      cats.push({ name: name || titleCase(slug), slug, url, image });
    }
  }
  return cats;
}

function titleCase(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function discoverProductUrls() {
  const sitemapIndex = await fetchText(`${BASE}/sitemap_index.xml`);
  const productSitemaps = extractLocs(sitemapIndex).filter((u) =>
    /product-sitemap/i.test(u),
  );
  const urls = new Set();
  for (const sm of productSitemaps) {
    log(`Reading sitemap ${sm}`);
    const xml = await fetchText(sm);
    for (const loc of extractLocs(xml)) {
      if (/\/product\//i.test(loc)) urls.add(loc.replace(/\/$/, "") + "/");
    }
    await delay(200);
  }
  return [...urls];
}

async function fetchStoreProductBySlug(slug) {
  try {
    const data = await fetchJson(
      `${BASE}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`,
    );
    return Array.isArray(data) ? data[0] : null;
  } catch {
    return null;
  }
}

function parseProductMarkdown(url, md, store) {
  const slug = url.split("/product/")[1]?.replace(/\/$/, "") || "";
  const pageTitle = cleanText(
    ((md.match(/^Title:\s*(.+)$/m) || [])[1] || "").replace(
      /\s*-\s*Likewise Floors.*$/i,
      "",
    ),
  );
  const h2s = [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => cleanText(m[1]));
  const h1 = cleanText((md.match(/^#\s+(.+)$/m) || [])[1] || "");
  const storeName = decodeHtml(store?.name || "");
  const rejectName = (n) =>
    !n ||
    /^(shop|home|products|explore|browse|carpet|vinyl|laminate|wood)$/i.test(n);

  let name =
    (!rejectName(storeName) && storeName) ||
    (!rejectName(pageTitle) && pageTitle) ||
    h2s.find((n) => !rejectName(n) && n.length < 80) ||
    (!rejectName(h1) && h1) ||
    titleCase(slug);

  // Description: first substantial paragraph after product heading
  let description = "";
  const blocks = md.split(/^#{1,3}\s+/m);
  for (const block of blocks) {
    const heading = cleanText((block.match(/^([^\n]+)/) || [])[1] || "");
    if (rejectName(heading) && heading.toLowerCase() !== name.toLowerCase()) {
      // still allow body paragraphs
    }
    const paras = block
      .split(/\n\n+/)
      .map((p) =>
        cleanText(
          p
            .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
            .replace(/\[[^\]]*\]\([^)]+\)/g, " "),
        ),
      )
      .filter(
        (p) =>
          p.length > 80 &&
          !/Find a Retailer|Related Products|Browse our|Explore |Add character|Affordable luxury|^Shop$|Home|About|Products|Showing \d+/i.test(
            p,
          ) &&
          !/^Title:|^URL Source:|^Markdown/i.test(p),
      );
    if (paras[0]) {
      description = paras[0];
      break;
    }
  }
  if (!description) {
    description =
      cleanText(store?.short_description || store?.description || "") ||
      `${name} from Likewise Floors.`;
  }

  const images = [];
  const push = (raw) => {
    const u = String(raw || "").split("?")[0];
    if (!u || !/^https?:\/\//i.test(u)) return;
    if (/logo|svg|favicon|likewise_light|likewise-logo/i.test(u)) return;
    if (
      !/uploads\.likewisefloors\.co\.uk|wp-content\/uploads/i.test(u)
    ) {
      return;
    }
    if (!images.includes(u)) images.push(u);
  };

  for (const m of md.matchAll(
    /https:\/\/uploads\.likewisefloors\.co\.uk\/uploads\/[^\s)"']+/gi,
  )) {
    push(m[0]);
  }
  for (const m of md.matchAll(
    /https:\/\/likewisefloors\.com\/wp-content\/uploads\/[^\s)"']+/gi,
  )) {
    push(m[0]);
  }
  for (const img of store?.images || []) {
    push(img.src || img.thumbnail || "");
  }

  // Category from breadcrumbs
  let categoryName = store?.categories?.[0]?.name || "";
  let categorySlug = store?.categories?.[0]?.slug || "";
  const crumb = md.match(
    /\[([^\]]+)\]\(https:\/\/likewisefloors\.com\/product-category\/([^)/]+)/i,
  );
  if (crumb) {
    categoryName = categoryName || cleanText(crumb[1]);
    categorySlug = categorySlug || slugify(crumb[2]);
  }
  if (!categorySlug) {
    categorySlug = "likewise-floors";
    categoryName = categoryName || "Likewise Floors";
  }

  const sku = cleanText(store?.sku || "") || slugify(slug).toUpperCase();

  // Range from related / breadcrumb / class hints
  let range = "";
  const rangeLink = md.match(
    /\[View All[^\]]*\]\(https:\/\/likewisefloors\.com\/range\/([^)/]+)/i,
  );
  if (rangeLink) range = titleCase(rangeLink[1]);

  const specs = {};
  if (sku) specs.sku = sku;
  if (range) specs.range = range;
  if (store?.sku) specs.likewiseSku = store.sku;

  return {
    url,
    slug,
    name,
    description: description.slice(0, 8000),
    images: images.slice(0, MAX_IMAGES),
    categoryName,
    categorySlug: slugify(categorySlug),
    sku,
    specs,
    price: Number(store?.prices?.price || 0) / (store?.prices?.currency_minor_unit === 2 ? 100 : 1) || 0,
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
  fs.writeFileSync(LOG, `Likewise import ${new Date().toISOString()}\n`);
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
    `Likewise Floors import${DRY_RUN ? " (DRY RUN)" : ""} concurrency=${CONCURRENCY}`,
  );

  let urls = [];
  let categories = [];
  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    urls = saved.urls || [];
    categories = saved.categories || [];
    log(`Resumed ${urls.length} URLs, ${categories.length} categories`);
  } else {
    categories = await discoverCategories();
    log(`Categories: ${categories.length}`);
    urls = await discoverProductUrls();
    log(`Product URLs: ${urls.length}`);
    fs.writeFileSync(
      CHECKPOINT,
      JSON.stringify(
        { at: new Date().toISOString(), urls, categories },
        null,
        2,
      ),
    );
  }

  if (DISCOVER_ONLY) {
    log("Discover-only done.");
    return;
  }

  if (LIMIT > 0) urls = urls.slice(0, LIMIT);

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");
  const menuCache = new Map();

  // Ensure category menus + images
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    let image = "";
    if (cat.image) {
      try {
        image = await uploadRemoteImage(cat.image, `cat-${cat.slug}`);
      } catch (e) {
        log(`cat image fail ${cat.slug}: ${e.message}`);
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
    menuCache.set(cat.slug, menu);
  }

  let done = new Set();
  if (fs.existsSync(PROGRESS)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []);
    } catch {
      /* ignore */
    }
  }
  const saveProgress = () => {
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );
  };

  const pending = urls.filter((u) => !done.has(u));
  log(`Importing ${pending.length} (skip ${urls.length - pending.length} done)…`);

  let imported = 0;
  let failed = 0;

  await mapPool(pending, CONCURRENCY, async (url, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    try {
      const slug = url.split("/product/")[1]?.replace(/\/$/, "") || "";
      const [md, store] = await Promise.all([
        fetchViaJina(url),
        fetchStoreProductBySlug(slug),
      ]);
      const p = parseProductMarkdown(url, md, store);
      if (!p.name) throw new Error("no name");

      let menu = menuCache.get(p.categorySlug);
      if (!menu) {
        menu = await ensureMenu(db, {
          name: p.categoryName || titleCase(p.categorySlug),
          slug: p.categorySlug,
          parent: null,
          brandId: brand._id,
          order: menuCache.size,
        });
        menuCache.set(p.categorySlug, menu);
      }

      const handle = slugify(p.slug || p.name);
      const uploaded = [];
      for (let i = 0; i < p.images.length; i++) {
        try {
          const cloudUrl = await uploadRemoteImage(
            p.images[i],
            `${handle}-${i + 1}`,
          );
          if (cloudUrl) uploaded.push(cloudUrl);
        } catch (e) {
          log(`${label} image fail: ${e.message}`);
        }
      }

      const specs = {
        ...p.specs,
        sku: p.sku || handle,
        source: SOURCE_TAG,
        sourceUrl: url,
        likewiseSlug: p.slug,
      };

      const doc = {
        name: p.name,
        description: p.description,
        price: p.price || 0,
        images: uploaded,
        category: menu.slug,
        subCategory: "",
        brand: brand._id,
        stock: STOCK_DEFAULT,
        tagline: p.specs.range || "",
        schematicImage: "",
        specs,
        showSpecs: true,
        updatedAt: new Date(),
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] ${p.name} cat=${menu.slug} imgs=${uploaded.length}`,
        );
      } else {
        await productsCol.updateOne(
          {
            brand: brand._id,
            "specs.source": SOURCE_TAG,
            "specs.sku": specs.sku,
          },
          { $set: doc, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        );
        log(
          `${label} ok ${p.name.slice(0, 60)} cat=${menu.slug} imgs=${uploaded.length}`,
        );
      }

      imported += 1;
      done.add(url);
      if (imported % 20 === 0) saveProgress();
      await delay(150);
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${url} ${e.message}`);
      await delay(400);
    }
  });

  saveProgress();
  log(`\nDone. imported=${imported} failed=${failed} totalUrls=${urls.length}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
