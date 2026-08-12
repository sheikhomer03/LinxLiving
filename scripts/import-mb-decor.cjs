/**
 * Scrape https://mbdecor.co.uk → Living Mongo + Cloudinary
 *
 * Brand: "MB Decor" (slug: mb-decor)
 * Extra product lines → Brand.subBrands[]
 * Categories/subcategories from site nav + WooCommerce taxonomy
 * Products stay brand-scoped (Fakro/Sterlingbuild shared-slug pattern)
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-mb-decor.cjs
 *   DRY_RUN=1 LIMIT=5 SKIP_IMAGES=1 CONCURRENCY=3 RESUME=1
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

const BASE = "https://mbdecor.co.uk";
const BRAND_SLUG = "mb-decor";
const BRAND_NAME = "MB Decor";
const SOURCE_TAG = "mb-decor-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/mb-decor";
const CHECKPOINT = path.join(__dirname, "_tmp-mb-decor-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-mb-decor-progress.json");
const LOG = path.join(__dirname, "_tmp-mb-decor-import.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 8));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

/** Manufacturer / product-line sub-brands from mbdecor.co.uk nav */
const SUB_BRANDS = [
  { name: "Decorwall", slug: "decorwall" },
  { name: "Decorceil", slug: "decorceil" },
  { name: "Panel Stone", slug: "panel-stone" },
  { name: "Dumaplast", slug: "dumaplast" },
  { name: "VOX", slug: "vox" },
  { name: "Vilo", slug: "vilo" },
  { name: "Decorfloor", slug: "decorfloor" },
  { name: "Extruda", slug: "extruda" },
  { name: "Moduleo", slug: "moduleo" },
  { name: "Prisma", slug: "prisma" },
  { name: "Hardex", slug: "hardex" },
  { name: "Tradeline", slug: "tradeline" },
  { name: "CREATE-A-SLAT", slug: "create-a-slat" },
  { name: "Thermo Slat", slug: "thermo-slat" },
  { name: "Vari-Slat", slug: "vari-slat" },
  { name: "Vari-Wave", slug: "vari-wave" },
  { name: "Maxi Panels", slug: "maxi-panels" },
  { name: "Natura Deck", slug: "natura-deck" },
  { name: "Kerradeco", slug: "kerradeco" },
  { name: "Linerio", slug: "linerio" },
];

/**
 * Site nav → menus. `wcSlugs` match WooCommerce category slugs.
 * department = product.department string + menu Department ObjectId slug.
 */
const NAV_TREE = [
  {
    name: "Decorwall",
    slug: "decorwall",
    subBrand: "decorwall",
    department: "bathrooms",
    wcSlugs: ["decorwall"],
    children: [
      { name: "Classic", slug: "classic", wcSlugs: ["classic"] },
      {
        name: "Elite",
        slug: "elite",
        wcSlugs: ["elite"],
        children: [
          { name: "Elite Foil", slug: "foil", wcSlugs: ["foil"] },
          { name: "Elite Print", slug: "print", wcSlugs: ["print"] },
        ],
      },
      {
        name: "Elegance Mineral",
        slug: "elegance-mineral",
        wcSlugs: ["elegance-mineral"],
      },
      {
        name: "Elegance Mineral Tile",
        slug: "elegance-mineral-tile",
        wcSlugs: ["elegance-mineral-tile"],
      },
      {
        name: "Elegance Damask",
        slug: "elegance-damask",
        wcSlugs: ["elegance-damask"],
      },
      {
        name: "Elegance Abstract",
        slug: "elegance-abstract",
        wcSlugs: ["elegance-abstract"],
      },
      {
        name: "Elegance Woodgrain",
        slug: "elegance-woodgrain",
        wcSlugs: ["elegance-woodgrain"],
      },
      {
        name: "Elegance Ultimo Tile",
        slug: "elegance-ultimo-tile",
        wcSlugs: ["elegance-ultimo-tile"],
      },
      {
        name: "Elegance Contempo Tile",
        slug: "elegance-contempo-tile",
        wcSlugs: ["elegance-contempo-tile"],
      },
      {
        name: "Elegance Contempo Smooth",
        slug: "elegance-contempo-smooth",
        wcSlugs: ["elegance-contempo-smooth"],
      },
      {
        name: "CREATE-A-SLAT",
        slug: "create-a-slat",
        subBrand: "create-a-slat",
        wcSlugs: ["create-a-slat"],
      },
      {
        name: "Thermo Slat",
        slug: "thermo-slat",
        subBrand: "thermo-slat",
        wcSlugs: ["thermo-slat"],
      },
      {
        name: "Vari-Slat",
        slug: "vari-slat",
        subBrand: "vari-slat",
        wcSlugs: ["vari-slat"],
      },
      {
        name: "Vari-Wave",
        slug: "vari-wave",
        subBrand: "vari-wave",
        wcSlugs: ["vari-wave"],
      },
      {
        name: "Tradeline",
        slug: "tradeline",
        subBrand: "tradeline",
        wcSlugs: ["tradeline"],
      },
      {
        name: "Hardex",
        slug: "hardex-panels",
        subBrand: "hardex",
        wcSlugs: ["hardex-panels", "hardex-v-groove"],
      },
      {
        name: "Maxi Panels",
        slug: "maxi-shower-panel",
        subBrand: "maxi-panels",
        wcSlugs: ["maxi-shower-panel"],
      },
    ],
  },
  {
    name: "Decorceil",
    slug: "ceiling-panel",
    subBrand: "decorceil",
    department: "bathrooms",
    wcSlugs: ["ceiling-panel"],
    children: [],
  },
  {
    name: "Panel Stone",
    slug: "panel-stone",
    subBrand: "panel-stone",
    department: "bathrooms",
    wcSlugs: ["panel-stone", "panel-stone-kits"],
    children: [
      {
        name: "Panel Stone Kits",
        slug: "panel-stone-kits",
        wcSlugs: ["panel-stone-kits"],
      },
    ],
  },
  {
    name: "Dumaplast",
    slug: "dumaplast",
    subBrand: "dumaplast",
    department: "bathrooms",
    wcSlugs: [
      "inspiro-tile",
      "dumawall-plus",
      "dumawall-plus-glossy",
      "dumawall-plus-wood",
      "dumawall-plus-large-tile",
      "dumawall-xl",
    ],
    children: [
      { name: "Inspiro Tile", slug: "inspiro-tile", wcSlugs: ["inspiro-tile"] },
      {
        name: "Dumawall+ Stone",
        slug: "dumawall-plus",
        wcSlugs: ["dumawall-plus"],
      },
      {
        name: "Dumawall+ High Gloss",
        slug: "dumawall-plus-glossy",
        wcSlugs: ["dumawall-plus-glossy"],
      },
      {
        name: "Dumawall+ Wood",
        slug: "dumawall-plus-wood",
        wcSlugs: ["dumawall-plus-wood"],
      },
      {
        name: "Dumawall+ Large",
        slug: "dumawall-plus-large-tile",
        wcSlugs: ["dumawall-plus-large-tile"],
      },
      { name: "Dumawall XL", slug: "dumawall-xl", wcSlugs: ["dumawall-xl"] },
    ],
  },
  {
    name: "VOX",
    slug: "vox",
    subBrand: "vox",
    department: "bathrooms",
    wcSlugs: [
      "linerio-slat-panels",
      "kerradeco",
      "vox-fronto",
      "kerrafront",
      "vox-solvo",
    ],
    children: [
      {
        name: "Linerio Slat Panels",
        slug: "linerio-slat-panels",
        subBrand: "linerio",
        wcSlugs: ["linerio-slat-panels"],
      },
      {
        name: "Kerradeco",
        slug: "kerradeco",
        subBrand: "kerradeco",
        wcSlugs: ["kerradeco"],
      },
      {
        name: "Fronto External",
        slug: "vox-fronto",
        department: "outdoor-living",
        wcSlugs: ["vox-fronto"],
      },
      {
        name: "Kerrafront External",
        slug: "kerrafront",
        department: "outdoor-living",
        wcSlugs: ["kerrafront"],
      },
      {
        name: "Solvo External",
        slug: "vox-solvo",
        department: "outdoor-living",
        wcSlugs: ["vox-solvo"],
      },
    ],
  },
  {
    name: "Vilo",
    slug: "vilo",
    subBrand: "vilo",
    department: "bathrooms",
    wcSlugs: [
      "vilo-tile",
      "vilo-brick",
      "vilo-wood",
      "vilo-modern",
      "vilo-spc-tile-panel",
      "vilo-fronto-v-black",
    ],
    children: [
      { name: "Vilo Motivo Tile", slug: "vilo-tile", wcSlugs: ["vilo-tile"] },
      { name: "Vilo Motivo Brick", slug: "vilo-brick", wcSlugs: ["vilo-brick"] },
      { name: "Vilo Motivo Wood", slug: "vilo-wood", wcSlugs: ["vilo-wood"] },
      {
        name: "Vilo Motivo Modern",
        slug: "vilo-modern",
        wcSlugs: ["vilo-modern"],
      },
      {
        name: "Vilo SPC Tile Panel",
        slug: "vilo-spc-tile-panel",
        wcSlugs: ["vilo-spc-tile-panel"],
      },
      {
        name: "Vilo Fronto V Black",
        slug: "vilo-fronto-v-black",
        department: "outdoor-living",
        wcSlugs: ["vilo-fronto-v-black"],
      },
    ],
  },
  {
    name: "Flooring",
    slug: "mb-flooring",
    subBrand: "decorfloor",
    department: "flooring",
    wcSlugs: [
      "decorfloor-elegance-range",
      "natural-collection",
      "dumafloor",
      "vilo-spc-flooring",
      "prisma",
      "moduleo",
      "moduleo-herringbone",
      "moduleo-layred",
      "solida-spc",
    ],
    children: [
      {
        name: "Decorfloor Elegance Range",
        slug: "decorfloor-elegance-range",
        wcSlugs: ["decorfloor-elegance-range"],
      },
      {
        name: "Decorfloor Natural Collection",
        slug: "natural-collection",
        wcSlugs: ["natural-collection"],
      },
      {
        name: "Dumafloor",
        slug: "dumafloor",
        subBrand: "dumaplast",
        wcSlugs: ["dumafloor"],
      },
      {
        name: "Vilo SPC Flooring",
        slug: "vilo-spc-flooring",
        subBrand: "vilo",
        wcSlugs: ["vilo-spc-flooring"],
      },
      {
        name: "Prisma",
        slug: "prisma",
        subBrand: "prisma",
        wcSlugs: ["prisma"],
      },
      {
        name: "Moduleo",
        slug: "moduleo",
        subBrand: "moduleo",
        wcSlugs: ["moduleo", "moduleo-herringbone", "moduleo-layred"],
      },
    ],
  },
  {
    name: "Outdoor",
    slug: "mb-outdoor",
    subBrand: "extruda",
    department: "outdoor-living",
    wcSlugs: [
      "vox-fronto",
      "kerrafront",
      "vox-solvo",
      "natura-deck",
      "decking",
      "extruda-fence",
      "extruda-clad",
      "vilo-fronto-v-black",
    ],
    children: [
      {
        name: "Natura Deck",
        slug: "natura-deck",
        subBrand: "natura-deck",
        wcSlugs: ["natura-deck"],
      },
      {
        name: "Extruda Deck",
        slug: "decking",
        subBrand: "extruda",
        wcSlugs: ["decking"],
      },
      {
        name: "Extruda Fence",
        slug: "extruda-fence",
        subBrand: "extruda",
        wcSlugs: ["extruda-fence"],
      },
      {
        name: "Extruda Clad",
        slug: "extruda-clad",
        subBrand: "extruda",
        wcSlugs: ["extruda-clad"],
      },
    ],
  },
  {
    name: "Accessories",
    slug: "mb-accessories",
    department: "accessories",
    wcSlugs: ["finishing-touches", "metal-trims"],
    children: [
      {
        name: "Internal Trims",
        slug: "finishing-touches",
        wcSlugs: ["finishing-touches"],
      },
      {
        name: "Metal Decortrim",
        slug: "metal-trims",
        wcSlugs: [
          "metal-trims",
          "5mm-metal-trims",
          "8-5mm-metal-trims",
          "10-5mm-metal-trims",
          "11-5mm-metal-trims",
          "20mm-metal-angle-trims",
        ],
      },
      {
        name: "Skirting Board",
        slug: "skirting-board",
        wcSlugs: [
          "hollow-pvc-skirting-board",
          "solid-pvc-skirting-board",
          "vox-skirting",
          "mb-solid-pvc-skirting-board",
        ],
      },
      {
        name: "PVC Window Sill",
        slug: "pvc-window-sill",
        wcSlugs: ["pvc-window-sill", "window-sill"],
      },
      {
        name: "Pipe Covers",
        slug: "pipe-covers",
        wcSlugs: ["pipe-covers"],
      },
      {
        name: "Fitting Accessories",
        slug: "fitting-accessories",
        wcSlugs: ["fitting-accessories"],
      },
      {
        name: "External Trims",
        slug: "external-trims",
        department: "outdoor-living",
        wcSlugs: ["fronto-trim", "kerrafront-trim"],
      },
    ],
  },
];

const SKIP_WC = new Set([
  "discontinued",
  "uncategorized",
  "point-of-sale",
  "sample-box",
  "samples",
  "hygiene-panels",
]);

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, `${line}\n`);
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
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function delay(ms) {
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
  return { data: await res.json(), headers: res.headers };
}

function parsePrice(prices) {
  if (!prices) return 0;
  const minor = Number(prices.currency_minor_unit ?? 2);
  const raw = Number(prices.price || prices.regular_price || 0);
  if (!(raw > 0)) return 0;
  return Number((raw / Math.pow(10, minor)).toFixed(2));
}

async function uploadRemoteImage(imageUrl, publicId) {
  if (SKIP_IMAGES || DRY_RUN) return String(imageUrl || "").split("?")[0];
  const clean = String(imageUrl).split("?")[0];
  if (!clean) return "";
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
  } catch {
    const result = await cloudinary.uploader.upload(clean, {
      folder: CLOUDINARY_FOLDER,
      public_id: String(publicId).slice(0, 180),
      overwrite: true,
      resource_type: "image",
    });
    return result.secure_url;
  }
}

async function fetchAllCategories() {
  const out = [];
  let page = 1;
  while (page <= 20) {
    const { data, headers } = await fetchJson(
      `${BASE}/wp-json/wc/store/v1/products/categories?per_page=100&page=${page}`,
    );
    if (!Array.isArray(data) || !data.length) break;
    out.push(...data);
    const pages = Number(headers.get("x-wp-totalpages") || 1);
    if (page >= pages) break;
    page += 1;
    await delay(80);
  }
  return out;
}

async function fetchAllProducts() {
  const out = [];
  let page = 1;
  while (page <= 50) {
    const { data, headers } = await fetchJson(
      `${BASE}/wp-json/wc/store/v1/products?per_page=100&page=${page}`,
    );
    if (!Array.isArray(data) || !data.length) break;
    out.push(...data);
    const pages = Number(headers.get("x-wp-totalpages") || 1);
    log(`  products page ${page}/${pages} (+${data.length}, total ${out.length})`);
    if (page >= pages) break;
    page += 1;
    await delay(120);
  }
  return out;
}

function buildWcSlugIndex(navTree) {
  /** wcSlug → { category, subCategory, subBrand, department } */
  const map = new Map();

  function walk(node, inherited) {
    const subBrand = node.subBrand || inherited.subBrand || "";
    const department = node.department || inherited.department || "bathrooms";
    const category = inherited.category || node.slug;
    const subCategory = inherited.category ? node.slug : "";
    for (const s of node.wcSlugs || [node.slug]) {
      if (!map.has(s)) {
        map.set(s, { category, subCategory, subBrand, department, menuSlug: node.slug });
      }
    }
    for (const child of node.children || []) {
      walk(child, {
        category: inherited.category || node.slug,
        subBrand,
        department,
      });
    }
  }

  for (const root of navTree) walk(root, {});
  return map;
}

function assignFromProduct(product, wcIndex) {
  const catSlugs = (product.categories || [])
    .map((c) => String(c.slug || "").toLowerCase())
    .filter(Boolean)
    .filter((s) => !SKIP_WC.has(s));

  // Prefer deepest / most specific mapping
  let best = null;
  for (const s of catSlugs) {
    const hit = wcIndex.get(s);
    if (hit) {
      if (!best || (hit.subCategory && !best.subCategory)) best = hit;
    }
  }

  if (!best) {
    // Heuristic from name
    const name = cleanText(product.name).toLowerCase();
    if (/vilo/.test(name))
      best = {
        category: "vilo",
        subCategory: "",
        subBrand: "vilo",
        department: "bathrooms",
      };
    else if (/duma/.test(name))
      best = {
        category: "dumaplast",
        subCategory: "",
        subBrand: "dumaplast",
        department: "bathrooms",
      };
    else if (/vox|linerio|kerra/.test(name))
      best = {
        category: "vox",
        subCategory: "",
        subBrand: "vox",
        department: "bathrooms",
      };
    else if (/extruda|deck|fence/.test(name))
      best = {
        category: "mb-outdoor",
        subCategory: "",
        subBrand: "extruda",
        department: "outdoor-living",
      };
    else if (/floor|moduleo|prisma|decorfloor/.test(name))
      best = {
        category: "mb-flooring",
        subCategory: "",
        subBrand: "decorfloor",
        department: "flooring",
      };
    else if (/trim|skirting|sill|pipe cover|silicone|adhesive/.test(name))
      best = {
        category: "mb-accessories",
        subCategory: "",
        subBrand: "",
        department: "accessories",
      };
    else
      best = {
        category: "decorwall",
        subCategory: "",
        subBrand: "decorwall",
        department: "bathrooms",
      };
  }

  // Woo brands plugin (e.g. Tradeline)
  const brandTerms = product.brands || [];
  if (brandTerms.length) {
    const b = brandTerms[0];
    const slug = slugify(b.slug || b.name);
    if (slug) best.subBrand = slug;
  }

  return best;
}

function specsFromProduct(product) {
  const specs = {
    sku: cleanText(product.sku || ""),
    source: SOURCE_TAG,
    sourceUrl: product.permalink || `${BASE}/product/${product.slug}/`,
    mbDecorId: product.id,
    mbDecorSlug: product.slug,
    vendorBrand: "MB Decor",
    productType: product.type || "simple",
    mbDecorCategories: (product.categories || []).map((c) => c.slug),
    tags: (product.tags || []).map((t) => cleanText(t.name || t)).slice(0, 40),
  };

  for (const attr of product.attributes || []) {
    const key = cleanText(attr.name || attr.taxonomy || "");
    const terms = (attr.terms || []).map((t) => cleanText(t.name || t));
    if (key && terms.length) specs[key] = terms.join(", ");
  }

  if (product.weight?.value) {
    specs.Weight = `${product.weight.value}${product.weight.unit || ""}`;
  }
  if (product.dimensions) {
    const d = product.dimensions;
    const parts = [d.length, d.width, d.height].filter(Boolean);
    if (parts.length) specs.dimensions = parts.join(" × ");
  }

  // Pull common dimensions from description text
  const desc = `${product.short_description || ""} ${product.description || ""}`;
  const dimPairs = [
    ["Width", /Width:\s*([0-9.]+)\s*mm/i],
    ["Length", /Length:\s*([0-9.]+)\s*mm/i],
    ["Depth", /Depth:\s*([0-9.]+)\s*mm/i],
    ["Thickness", /Thickness:\s*([0-9.]+)\s*mm/i],
  ];
  for (const [k, re] of dimPairs) {
    const m = desc.match(re);
    if (m && !specs[k]) specs[k] = `${m[1]} mm`;
  }

  return specs;
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: BRAND_SLUG });
  const now = new Date();
  const subBrands = SUB_BRANDS.map(({ name, slug }) => ({ name, slug }));
  if (!brand) {
    const insert = {
      name: BRAND_NAME,
      slug: BRAND_SLUG,
      order: 55,
      isActive: true,
      image: "",
      subBrands,
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
      {
        $set: {
          name: BRAND_NAME,
          isActive: true,
          subBrands,
          updatedAt: now,
        },
      },
    );
    brand = { ...brand, subBrands };
    log(`Updated brand ${BRAND_NAME} with ${subBrands.length} subBrands`);
  }
  return brand;
}

async function ensureDepartments(db) {
  const depts = await db
    .collection("departments")
    .find({ isActive: { $ne: false } })
    .project({ _id: 1, slug: 1, name: 1 })
    .toArray();
  const bySlug = new Map(depts.map((d) => [String(d.slug), d]));
  return bySlug;
}

async function ensureMenu(
  db,
  { name, slug, parent, brandId, departmentId, order, image, subBrand },
) {
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
      department: departmentId || null,
      order: order ?? 0,
      isActive: true,
      image: image || "",
      level: parent ? "subcategory" : "category",
      subBrand: subBrand || "",
      subBrands: subBrand ? [subBrand] : [],
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) menu = { ...insert, _id: `dry-${slug}` };
    else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
      log(`Created menu ${name} (${slug})`);
    }
  } else if (!DRY_RUN) {
    const set = {
      name,
      isActive: true,
      order: order ?? menu.order,
      updatedAt: now,
    };
    if (departmentId) set.department = departmentId;
    if (image) set.image = image;
    if (subBrand) {
      set.subBrand = subBrand;
      const prev = Array.isArray(menu.subBrands) ? menu.subBrands : [];
      set.subBrands = [...new Set([...prev.map(String), subBrand])];
    }
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

async function createMenus(db, brand, deptBySlug, wcCats) {
  const keep = new Set();
  const wcBySlug = new Map(
    wcCats.map((c) => [String(c.slug).toLowerCase(), c]),
  );
  let order = 0;

  async function createNode(node, parentId, inheritedDept, inheritedSub) {
    const deptSlug = node.department || inheritedDept || "bathrooms";
    const dept = deptBySlug.get(deptSlug);
    const subBrand = node.subBrand || inheritedSub || "";
    let image = "";
    const coverSlug = (node.wcSlugs || [node.slug])[0];
    const wc = wcBySlug.get(coverSlug);
    if (wc?.image?.src) {
      try {
        image = await uploadRemoteImage(wc.image.src, `menu-${node.slug}`);
      } catch (e) {
        log(`menu img fail ${node.slug}: ${e.message}`);
      }
    }
    const menu = await ensureMenu(db, {
      name: node.name,
      slug: node.slug,
      parent: parentId,
      brandId: brand._id,
      departmentId: dept?._id || null,
      order: order++,
      image,
      subBrand,
    });
    keep.add(String(menu._id));
    for (const child of node.children || []) {
      await createNode(child, menu._id, deptSlug, subBrand);
    }
  }

  for (const root of NAV_TREE) {
    await createNode(root, null, root.department, root.subBrand);
  }

  // Only delete obsolete menus for THIS brand
  if (!DRY_RUN) {
    const all = await db
      .collection("menus")
      .find({ brand: brand._id })
      .toArray();
    for (const m of all) {
      if (!keep.has(String(m._id))) {
        await db.collection("menus").deleteOne({
          _id: m._id,
          brand: brand._id,
        });
        log(`Deleted obsolete menu ${m.slug}`);
      }
    }
  }
  return keep.size;
}

async function main() {
  fs.writeFileSync(LOG, `MB Decor import ${new Date().toISOString()}\n`);
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

  log(
    `MB Decor import${DRY_RUN ? " (DRY)" : ""} concurrency=${CONCURRENCY} skipImages=${SKIP_IMAGES}`,
  );

  let wcCats = [];
  let products = [];

  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    wcCats = saved.categories || [];
    products = saved.products || [];
    log(`Resumed checkpoint: cats=${wcCats.length} products=${products.length}`);
  } else {
    wcCats = await fetchAllCategories();
    log(`WC categories: ${wcCats.length}`);
    products = await fetchAllProducts();
    log(`WC products: ${products.length}`);
    fs.writeFileSync(
      CHECKPOINT,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          categories: wcCats.map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            parent: c.parent,
            count: c.count,
            image: c.image?.src || null,
          })),
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            sku: p.sku,
            type: p.type,
            permalink: p.permalink,
            short_description: p.short_description,
            description: p.description,
            prices: p.prices,
            images: (p.images || []).map((img) => ({
              src: img.src,
              alt: img.alt,
            })),
            categories: (p.categories || []).map((c) => ({
              id: c.id,
              name: c.name,
              slug: c.slug,
            })),
            brands: p.brands || [],
            tags: p.tags || [],
            attributes: p.attributes || [],
            is_in_stock: p.is_in_stock,
            weight: p.weight,
            dimensions: p.dimensions,
          })),
        },
        null,
        2,
      ),
    );
    log(`Wrote checkpoint ${CHECKPOINT}`);
  }

  // Drop fuel surcharge / discontinued-only junk
  products = products.filter((p) => {
    const slug = String(p.slug || "");
    if (/fuel-surcharge/i.test(slug)) return false;
    const cats = (p.categories || []).map((c) => c.slug);
    if (cats.length && cats.every((c) => SKIP_WC.has(c))) return false;
    return true;
  });

  if (LIMIT > 0) products = products.slice(0, LIMIT);

  const wcIndex = buildWcSlugIndex(NAV_TREE);

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const deptBySlug = await ensureDepartments(db);
  const menuCount = await createMenus(db, brand, deptBySlug, wcCats);
  log(`Menus ready: ${menuCount}`);

  const productsCol = db.collection("products");
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

  const pending = products.filter((p) => !done.has(String(p.id || p.slug)));
  log(`Importing ${pending.length} products…`);

  let imported = 0;
  let failed = 0;

  await mapPool(pending, CONCURRENCY, async (product, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    const key = String(product.id || product.slug);
    try {
      const assign = assignFromProduct(product, wcIndex);
      const name = cleanText(product.name);
      const description =
        cleanText(product.description || product.short_description || "") ||
        `${name} from MB Decor.`;
      const price = parsePrice(product.prices);
      const specs = specsFromProduct(product);
      if (assign.subBrand) {
        specs.vendorBrand = SUB_BRANDS.find((s) => s.slug === assign.subBrand)
          ?.name || assign.subBrand;
      }

      const sources = (product.images || [])
        .map((img) => (typeof img === "string" ? img : img?.src))
        .filter(Boolean)
        .slice(0, MAX_IMAGES);

      const uploaded = [];
      for (let i = 0; i < sources.length; i++) {
        try {
          const url = await uploadRemoteImage(
            sources[i],
            `${slugify(product.slug)}-${i + 1}`,
          );
          if (url) uploaded.push(url);
        } catch (e) {
          log(`${label} img fail: ${e.message}`);
        }
      }

      const stock = product.is_in_stock === false ? 0 : STOCK_DEFAULT;

      const doc = {
        name,
        description,
        price: price > 0 ? price : 0,
        stock,
        images: uploaded,
        category: assign.category,
        subCategory: assign.subCategory || "",
        department: assign.department || "bathrooms",
        brand: brand._id,
        subBrand: assign.subBrand || "",
        specs,
        updatedAt: new Date(),
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] ${name.slice(0, 55)} £${doc.price} cat=${doc.category}/${doc.subCategory || "-"} sub=${doc.subBrand || "-"} imgs=${uploaded.length}`,
        );
      } else {
        const existing = await productsCol.findOne({
          brand: brand._id,
          "specs.mbDecorId": product.id,
        });
        if (existing) {
          // Preserve already-uploaded Cloudinary images if re-run with SKIP_IMAGES
          if (SKIP_IMAGES && (existing.images || []).length) {
            doc.images = existing.images;
          }
          await productsCol.updateOne(
            { _id: existing._id, brand: brand._id },
            { $set: doc },
          );
        } else {
          await productsCol.insertOne({ ...doc, createdAt: new Date() });
        }
        log(
          `${label} ok ${name.slice(0, 55)} £${doc.price} cat=${doc.category}/${doc.subCategory || "-"} sub=${doc.subBrand || "-"} imgs=${uploaded.length}`,
        );
      }

      imported += 1;
      done.add(key);
      if (imported % 15 === 0) saveProgress();
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${product.slug}: ${e.message}`);
    }
  });

  saveProgress();

  // Brand cover from first Decorwall image
  if (!DRY_RUN && !SKIP_IMAGES) {
    try {
      const coverProd = await productsCol.findOne(
        {
          brand: brand._id,
          "images.0": { $exists: true },
          category: "decorwall",
        },
        { projection: { images: 1 } },
      );
      const src = (coverProd?.images || [])[0] || "";
      if (src) {
        await db.collection("brands").updateOne(
          { _id: brand._id },
          { $set: { image: src, updatedAt: new Date() } },
        );
        log(`Set brand cover from product image`);
      }
    } catch (e) {
      log(`brand cover fail: ${e.message}`);
    }
  }

  log(`Done. imported=${imported} failed=${failed}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
