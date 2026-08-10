/**
 * Attach TransferNow zip product images to Likewise Floors DuraCORE SKUs,
 * and refresh name/description/category from https://likewisefloors.com/
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-transfernow-likewise.cjs
 *
 * Options: DRY_RUN=1 SKIP_IMAGES=1
 */
const path = require("path");
const fs = require("fs");
const dns = require("dns");
const os = require("os");

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
const CLOUDINARY_FOLDER = "linx-living/products/likewisefloors/duracore-transfernow";
const LOG = path.join(__dirname, "_tmp-transfernow-likewise.log");
const EXTRACT_DIR = path.join(__dirname, "_tmp-transfernow");

const ZIP_PATHS = [
  path.join(__dirname, "..", "TransferNow-20260722AlXp6ZwX.zip"),
  path.join(__dirname, "..", "TransferNow-20260722yaxrLuBP.zip"),
];

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

/** Zip BBL code → Likewise product slug (from likewisefloors.com) */
const PRODUCTS = [
  {
    zipKeys: ["BBL2112L-6", "BBL2112-6"],
    slug: "rustic-oak-2112-6",
    colorCode: "2112-6",
  },
  {
    zipKeys: ["BBL2117L-1", "BBL2117-1"],
    slug: "natural-oak-2117l-1",
    colorCode: "2117L-1",
  },
  {
    zipKeys: ["BBL2117L-5", "BBL2117-5"],
    slug: "artic-oak-2117l-5",
    colorCode: "2117L-5",
  },
  {
    zipKeys: ["BBL2105L-6", "BBL2105-6"],
    slug: "ashen-oak-2105l-6",
    colorCode: "2105L-6",
  },
  {
    zipKeys: ["BBL966L-3", "BBL966-3"],
    slug: "carriage-oak-966l-3",
    colorCode: "966L-3",
  },
  {
    zipKeys: ["BBL974L-10", "BBL974-10"],
    slug: "blond-oak-974l-10",
    colorCode: "974L-10",
  },
  {
    zipKeys: ["BBL2105L-5", "BBL2105-5"],
    slug: "warm-oak-921051-5",
    colorCode: "921051-5",
  },
  {
    zipKeys: ["BBL966L-6", "BBL966-6"],
    slug: "silver-oak-9661-6",
    colorCode: "9661-6",
  },
  {
    zipKeys: ["BBL2117L-8", "BBL2117-8"],
    slug: "select-oak-921171-8",
    colorCode: "921171-8",
  },
  {
    zipKeys: ["BBL2024L-1", "BBL2024-1"],
    slug: "european-oak-92024l-1",
    colorCode: "92024L-1",
  },
];

const IMAGE_RANK = [
  [/decor/i, 10],
  [/plank/i, 20],
  [/\bset\b/i, 30],
  [/hb\s*set/i, 40],
  [/hb\+/i, 50],
  [/hb/i, 55],
];

function log(...args) {
  const line = args.map(String).join(" ");
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/&#822[01];|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

async function fetchStoreProductBySlug(slug) {
  const data = await fetchJson(
    `${BASE}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`,
  );
  return Array.isArray(data) ? data[0] : null;
}

function imageRank(filename) {
  const name = path.basename(filename);
  let best = 100;
  for (const [re, rank] of IMAGE_RANK) {
    if (re.test(name) && rank < best) best = rank;
  }
  // Prefer room/set shots slightly after decor/plank for gallery variety
  if (/630x126/i.test(name)) best = 90; // banner-ish
  return best;
}

function matchZipKey(filename) {
  const base = path.basename(filename, path.extname(filename));
  // e.g. "BBL2117L-5 Decor", "BBL966-3-HB+", "BBL2117L-8 (630x126)."
  const m = base.match(/^(BBL\d+[A-Z]?-?\d+)/i);
  if (!m) return null;
  let key = m[1].toUpperCase();
  // Normalize BBL2117L-5 / BBL2117-5 style
  if (!/-/.test(key) && /L\d+$/i.test(key) === false) {
    // already fine
  }
  return key;
}

function normalizeKey(key) {
  return String(key || "")
    .toUpperCase()
    .replace(/\s+/g, "");
}

function extractZips() {
  // Prefer PowerShell Expand-Archive via child_process if adm-zip unavailable
  const { execFileSync } = require("child_process");
  if (fs.existsSync(EXTRACT_DIR)) {
    fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });

  const files = [];
  for (const zip of ZIP_PATHS) {
    if (!fs.existsSync(zip)) throw new Error(`Missing zip: ${zip}`);
    const dest = path.join(EXTRACT_DIR, path.basename(zip, ".zip"));
    fs.mkdirSync(dest, { recursive: true });
    log(`Extracting ${path.basename(zip)} → ${dest}`);
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit" },
    );
    for (const name of fs.readdirSync(dest)) {
      const full = path.join(dest, name);
      if (!fs.statSync(full).isFile()) continue;
      if (!/\.(jpe?g|png|webp|gif)$/i.test(name)) continue;
      files.push(full);
    }
  }
  return files;
}

function groupImagesByProduct(files) {
  const byProduct = new Map();
  for (const p of PRODUCTS) {
    byProduct.set(p.slug, { ...p, files: [] });
  }

  for (const file of files) {
    const rawKey = matchZipKey(file);
    if (!rawKey) {
      log(`  unmatched file: ${path.basename(file)}`);
      continue;
    }
    const key = normalizeKey(rawKey);
    const product = PRODUCTS.find((p) =>
      p.zipKeys.some((k) => normalizeKey(k) === key),
    );
    if (!product) {
      // try softer match: strip trailing L before hyphen variants already covered
      log(`  no product map for key ${rawKey} (${path.basename(file)})`);
      continue;
    }
    byProduct.get(product.slug).files.push(file);
  }

  for (const entry of byProduct.values()) {
    entry.files.sort((a, b) => {
      const ra = imageRank(a);
      const rb = imageRank(b);
      if (ra !== rb) return ra - rb;
      return path.basename(a).localeCompare(path.basename(b));
    });
  }
  return byProduct;
}

async function prepareUploadPath(filePath) {
  const maxBytes = 10 * 1024 * 1024 - 50_000;
  const size = fs.statSync(filePath).size;
  if (size <= maxBytes) return filePath;
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    throw new Error(`File too large (${size} bytes) and sharp is not installed`);
  }
  const out = path.join(
    EXTRACT_DIR,
    `${path.basename(filePath, path.extname(filePath))}-compressed.jpg`,
  );
  let quality = 82;
  let width = 2400;
  for (let attempt = 0; attempt < 4; attempt++) {
    await sharp(filePath)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toFile(out);
    if (fs.statSync(out).size <= maxBytes) return out;
    quality -= 10;
    width = Math.round(width * 0.85);
  }
  return out;
}

async function uploadLocalImage(filePath, publicId) {
  if (SKIP_IMAGES || DRY_RUN) return `dry://${path.basename(filePath)}`;
  const uploadPath = await prepareUploadPath(filePath);
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      uploadPath,
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
  });
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
    if (DRY_RUN) return { ...insert, _id: "dry-brand" };
    const r = await brands.insertOne(insert);
    brand = { ...insert, _id: r.insertedId };
    log(`Created brand ${BRAND_NAME}`);
  } else {
    await brands.updateOne(
      { _id: brand._id },
      { $set: { name: BRAND_NAME, isActive: true, updatedAt: now } },
    );
    log(`Using brand ${brand.name} (${brand._id})`);
  }
  return brand;
}

async function ensureMenu(db, brandId, { name, slug }) {
  const menus = db.collection("menus");
  let menu = await menus.findOne({ slug, parent: null, brand: brandId });
  const now = new Date();
  if (!menu) {
    const insert = {
      name,
      slug,
      parent: null,
      brand: brandId,
      order: 10,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) return { ...insert, _id: `dry-${slug}` };
    const r = await menus.insertOne(insert);
    menu = { ...insert, _id: r.insertedId };
    log(`Created menu ${name}`);
  }
  return menu;
}

async function main() {
  fs.writeFileSync(LOG, `TransferNow → Likewise ${new Date().toISOString()}\n`);
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

  const files = extractZips();
  log(`Extracted ${files.length} image files`);
  const grouped = groupImagesByProduct(files);

  for (const entry of grouped.values()) {
    log(
      `  ${entry.slug}: ${entry.files.length} images → ${entry.files
        .map((f) => path.basename(f))
        .join(" | ")}`,
    );
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  let updated = 0;
  let failed = 0;

  for (const entry of grouped.values()) {
    try {
      if (!entry.files.length) {
        log(`SKIP ${entry.slug}: no zip images`);
        continue;
      }

      const store = await fetchStoreProductBySlug(entry.slug);
      if (!store) throw new Error(`Product not found on site: ${entry.slug}`);

      const name = cleanText(store.name) || entry.slug;
      const description =
        cleanText(store.short_description || store.description) ||
        `${name} from Likewise Floors. DuraCORE Rigid SPC flooring.`;
      const likewiseSku = cleanText(store.sku) || entry.slug.toUpperCase();
      const categorySlug = slugify(
        store.categories?.[0]?.slug || "luxury-vinyl-tile",
      );
      const categoryName = cleanText(
        store.categories?.[0]?.name || "Luxury Vinyl Tile",
      );
      const sourceUrl =
        store.permalink || `${BASE}/product/${entry.slug}/`;

      const menu = await ensureMenu(db, brand._id, {
        name: categoryName,
        slug: categorySlug,
      });

      const uploaded = [];
      for (let i = 0; i < entry.files.length; i++) {
        const file = entry.files[i];
        const base = slugify(path.basename(file, path.extname(file)));
        const publicId = `${entry.slug}-${i + 1}-${base}`.slice(0, 180);
        try {
          const url = await uploadLocalImage(file, publicId);
          if (url) uploaded.push(url);
          log(`  uploaded ${path.basename(file)}`);
        } catch (e) {
          log(`  image fail ${path.basename(file)}: ${e.message}`);
        }
      }
      if (!uploaded.length) throw new Error("no images uploaded");

      const specs = {
        sku: likewiseSku,
        likewiseSku,
        likewiseSlug: entry.slug,
        colorCode: entry.colorCode,
        zipKeys: entry.zipKeys,
        range: "DuraCORE",
        source: SOURCE_TAG,
        sourceUrl,
        mediaSource: "transfernow-zip",
      };

      const doc = {
        name,
        description,
        price: 0,
        images: uploaded,
        category: menu.slug,
        subCategory: "",
        brand: brand._id,
        stock: STOCK_DEFAULT,
        tagline: "DuraCORE Rigid SPC",
        schematicImage: "",
        specs,
        showSpecs: true,
        updatedAt: new Date(),
      };

      if (DRY_RUN) {
        log(
          `[dry] ${name} sku=${likewiseSku} cat=${menu.slug} imgs=${uploaded.length} desc=${description.slice(0, 60)}…`,
        );
      } else {
        // Prefer canonical WC SKU (JIA007*); also refresh any JIA018 duplicate by slug
        const filter = {
          brand: brand._id,
          $or: [
            { "specs.sku": likewiseSku },
            { "specs.likewiseSku": likewiseSku },
            { "specs.likewiseSlug": entry.slug },
            {
              "specs.likewiseSlug": `${entry.slug}-2`,
            },
          ],
        };
        const existing = await productsCol.find(filter).project({ _id: 1, "specs.sku": 1 }).toArray();
        if (existing.length) {
          for (const ex of existing) {
            await productsCol.updateOne(
              { _id: ex._id },
              { $set: doc },
            );
            log(`UPDATED ${name} (${ex.specs?.sku || ex._id}) imgs=${uploaded.length}`);
          }
        } else {
          await productsCol.insertOne({ ...doc, createdAt: new Date() });
          log(`CREATED ${name} sku=${likewiseSku} imgs=${uploaded.length}`);
        }
      }
      updated += 1;
    } catch (e) {
      failed += 1;
      log(`FAIL ${entry.slug}: ${e.message}`);
    }
  }

  log(`\nDone. products=${updated} failed=${failed}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
