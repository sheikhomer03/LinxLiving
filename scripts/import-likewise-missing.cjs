/**
 * Import Likewise products that exist on the live site but not in Mongo.
 * Then remaps category → collection (subCategory).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-likewise-missing.cjs
 *
 * Options: DRY_RUN=1 SKIP_IMAGES=1 CONCURRENCY=2 LIMIT=0
 */
require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env"),
});
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://likewisefloors.com";
const BRAND_SLUG = "likewisefloors";
const SOURCE_TAG = "likewisefloors-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/likewisefloors";
const LOG = path.join(__dirname, "_tmp-likewise-missing-import.log");
const MISSING_OUT = path.join(__dirname, "_tmp-likewise-missing-urls.json");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);
const UA = "Mozilla/5.0 LinxLivingImporter/1.0";

const MAIN_SLUGS = [
  "carpet",
  "vinyl",
  "laminate",
  "luxury-vinyl-tile",
  "wood",
  "mats-runners",
  "grass",
];

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
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*", ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchViaJina(url) {
  return fetchText(`https://r.jina.ai/${url}`, { Accept: "text/plain" });
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function paginateAllProducts() {
  const perPage = 100;
  const out = [];
  let page = 1;
  for (;;) {
    const url = `${BASE}/wp-json/wp/v2/product?per_page=${perPage}&page=${page}&_fields=id,slug,link,sku,title`;
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!r.ok) break;
    const batch = await r.json();
    if (!Array.isArray(batch) || !batch.length) break;
    for (const p of batch) {
      out.push({
        slug: p.slug,
        sku: p.sku || "",
        name: cleanText(p.title?.rendered || p.slug),
        url: p.link || `${BASE}/product/${p.slug}/`,
      });
    }
    const totalPages = Number(r.headers.get("x-wp-totalpages") || 1);
    log(`Discover page ${page}/${totalPages} (+${batch.length}, total ${out.length})`);
    if (page >= totalPages) break;
    page += 1;
  }
  return out;
}

// Reuse Cloudinary + parse helpers by requiring pieces from import script via spawn
// Inline minimal import path for missing only:

const { v2: cloudinary } = require("cloudinary");
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

function extractImages(md, store) {
  const urls = [];
  const seen = new Set();
  const push = (u) => {
    if (!u || typeof u !== "string") return;
    const clean = u.split("?")[0];
    if (seen.has(clean)) return;
    if (/logo|svg|favicon|likewise_light|likewise-logo/i.test(clean)) return;
    if (
      !/uploads\.likewisefloors\.co\.uk|wp-content\/uploads|likewisefloors\.com/i.test(
        clean,
      )
    ) {
      return;
    }
    seen.add(clean);
    urls.push(clean);
  };
  for (const m of md.matchAll(/!\[[^\]]*\]\((https?:[^)]+)\)/g)) push(m[1]);
  for (const m of md.matchAll(
    /https:\/\/uploads\.likewisefloors\.co\.uk\/uploads\/[^\s)"']+/gi,
  )) {
    push(m[0]);
  }
  for (const img of store?.images || []) push(img.src || img.thumbnail);
  return urls.slice(0, 6);
}

function parseProduct(url, md, store) {
  const slug = url.split("/product/")[1]?.replace(/\/$/, "") || "";
  let name =
    cleanText(store?.name || "") ||
    cleanText((md.match(/^#\s+(.+)$/m) || [])[1] || "");
  const desc =
    cleanText(store?.description || store?.short_description || "") ||
    cleanText(
      (md.match(/## Description([\s\S]*?)(?:##|$)/i) || [])[1] || "",
    ).slice(0, 4000);

  let categorySlug = "carpet";
  const crumb = md.match(
    /\[([^\]]+)\]\(https:\/\/likewisefloors\.com\/product-category\/([^)/]+)/i,
  );
  if (crumb) categorySlug = slugify(crumb[2]);
  if (!MAIN_SLUGS.includes(categorySlug) && categorySlug !== "mats-runners") {
    // keep if known flooring slug else default
  }

  const specs = {};
  const rangeM = md.match(
    /\[View All[^\]]*\]\(https:\/\/likewisefloors\.com\/range\/([^)/]+)/i,
  );
  if (rangeM) specs.range = cleanText(rangeM[1].replace(/-/g, " "));
  if (store?.sku) specs.likewiseSku = store.sku;

  const price =
    Number(store?.prices?.price || 0) /
      (store?.prices?.currency_minor_unit === 2 ? 100 : 1) || 0;

  return {
    slug,
    name,
    description: desc,
    categorySlug,
    images: extractImages(md, store),
    sku: store?.sku || slug,
    specs,
    price,
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
  fs.writeFileSync(LOG, `Likewise missing import ${new Date().toISOString()}\n`);
  log(`Missing import${DRY_RUN ? " (DRY RUN)" : ""} concurrency=${CONCURRENCY}`);

  const siteProducts = await paginateAllProducts();
  log(`Site products: ${siteProducts.length}`);

  const conn = await connectMongo();
  const db = conn.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Brand not found");

  const existing = await db
    .collection("products")
    .find({ brand: brand._id })
    .project({ specs: 1 })
    .toArray();

  const have = new Set();
  for (const p of existing) {
    const s = String(p.specs?.likewiseSlug || "").toLowerCase();
    const sku = String(p.specs?.sku || p.specs?.likewiseSku || "").toLowerCase();
    const fromUrl = (
      String(p.specs?.sourceUrl || "").match(/\/product\/([^/]+)\/?/) || []
    )[1];
    if (s) have.add(s);
    if (sku) have.add(sku);
    if (fromUrl) have.add(fromUrl.toLowerCase());
  }

  let missing = siteProducts.filter((p) => {
    const slug = String(p.slug || "").toLowerCase();
    const sku = String(p.sku || "").toLowerCase();
    return !have.has(slug) && !(sku && have.has(sku));
  });

  if (LIMIT > 0) missing = missing.slice(0, LIMIT);
  fs.writeFileSync(
    MISSING_OUT,
    JSON.stringify({ at: new Date().toISOString(), count: missing.length, missing }, null, 2),
  );
  log(`Missing: ${missing.length} → ${MISSING_OUT}`);

  if (!missing.length) {
    log("Nothing to import.");
    await conn.close?.();
    process.exit(0);
  }

  const productsCol = db.collection("products");
  let imported = 0;
  let failed = 0;

  await mapPool(missing, CONCURRENCY, async (item, idx) => {
    const label = `[${idx + 1}/${missing.length}]`;
    const url = item.url;
    try {
      const [md, store] = await Promise.all([
        fetchViaJina(url),
        fetchStoreProductBySlug(item.slug),
      ]);
      const p = parseProduct(url, md, store);
      if (!p.name) throw new Error("no name");

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
        category: p.categorySlug,
        subCategory: "",
        department: "flooring",
        brand: brand._id,
        stock: STOCK_DEFAULT,
        tagline: p.specs.range || "",
        schematicImage: "",
        specs,
        showSpecs: true,
        updatedAt: new Date(),
      };

      if (DRY_RUN) {
        log(`${label} [dry] ${p.name} cat=${p.categorySlug} imgs=${uploaded.length}`);
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
          `${label} ok ${p.name.slice(0, 60)} cat=${p.categorySlug} imgs=${uploaded.length}`,
        );
      }
      imported += 1;
      await delay(150);
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${url} ${e.message}`);
      await delay(400);
    }
  });

  log(`\nImport done. imported=${imported} failed=${failed}`);

  if (!DRY_RUN && imported > 0) {
    log("Running collection remapping…");
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--require",
          "./scripts/mongo-dns.cjs",
          "scripts/revamp-likewise-collections.cjs",
          "--apply",
        ],
        {
          cwd: path.join(__dirname, ".."),
          stdio: "inherit",
          env: process.env,
        },
      );
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`revamp exit ${code}`)),
      );
    });
  }

  await conn.close?.();
  log("All finished.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
