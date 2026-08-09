/**
 * Scrape https://www.pooky.com → Living Mongo + Cloudinary
 *
 * Brand: "Pooky" (slug: pooky) — brand-scoped menus/products only.
 * Shopify storefront: products.json + Pooky productsDB GraphQL for
 * shade/pendant/base combinations (same "see all" lists as pooky.com).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-pooky.cjs
 *
 * Options:
 *   DRY_RUN=1 LIMIT=20 CONCURRENCY=2 SKIP_IMAGES=1 RESUME=1 DISCOVER_ONLY=1
 *   SKIP_PAIRINGS=1  — skip shade/pendant/base/wall scrape
 *   FIX_GALLERY=1    — re-fetch full image galleries + clear fake colour swatches
 *   FIX_OPTIONS=1    — re-fetch gallery + bases/shades/pendants/wallFittings
 *   ONLY_HANDLE=slug — limit fix/import to one product handle
 *   MAX_PAIRINGS=0   — 0 = no cap (default); set e.g. 24 to truncate combo lists
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

const BASE = "https://www.pooky.com";
/** Pooky private products DB (family + combination "see all" lists). */
const PRODUCTS_DB =
  process.env.POOKY_PRODUCTS_DB ||
  "https://graphql-server-uk-464125e5708d.herokuapp.com/";
const BRAND_SLUG = "pooky";
const BRAND_NAME = "Pooky";
const SOURCE_TAG = "pooky-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/pooky";
const CHECKPOINT = path.join(__dirname, "_tmp-pooky-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-pooky-progress.json");
const LOG = path.join(
  __dirname,
  process.env.POOKY_LOG || "_tmp-pooky-import.log",
);

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const SKIP_PAIRINGS = process.env.SKIP_PAIRINGS === "1";
const DISCOVER_ONLY = process.env.DISCOVER_ONLY === "1";
const FIX_GALLERY = process.env.FIX_GALLERY === "1";
const FIX_OPTIONS = process.env.FIX_OPTIONS === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const ONLY_HANDLE = String(process.env.ONLY_HANDLE || "")
  .trim()
  .toLowerCase();
/** Comma-separated Shopify product_type values for FIX_OPTIONS scope. */
const ONLY_TYPES = String(process.env.ONLY_TYPES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
/** 0 = no cap — keep every gallery image from the source PDP. */
const MAX_IMAGES = Math.max(0, Number(process.env.MAX_IMAGES || 0));
/** 0 = no cap (store full see-all shade/pendant lists). */
const MAX_PAIRINGS = Math.max(0, Number(process.env.MAX_PAIRINGS || 0));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

function capPairings(list) {
  if (!Array.isArray(list)) return [];
  if (MAX_PAIRINGS > 0) return list.slice(0, MAX_PAIRINGS);
  return list;
}

/** Main shopping categories (pooky.com nav / Voyado topCollections). */
const MENU_TREE = [
  {
    name: "Table Lamps",
    slug: "table-lamps",
    tags: ["table lamps", "bedside table lamps", "desk light"],
    types: ["base", "desk light"],
    children: [
      { name: "All Table Lamps", slug: "all-table-lamps" },
      { name: "Bedside", slug: "bedside" },
      { name: "Colourful", slug: "colourful" },
      { name: "Wooden", slug: "wooden" },
    ],
  },
  {
    name: "Floor Lamps",
    slug: "floor-lamps",
    tags: ["floor lamps", "black floor lamps"],
    types: [],
    children: [{ name: "All Floor Lamps", slug: "all-floor-lamps" }],
  },
  {
    name: "Lampshades",
    slug: "lampshades",
    tags: ["lampshades", "lamp shades"],
    types: ["lamp shade", "pendant shade"],
    children: [
      { name: "All Lampshades", slug: "all-lampshades" },
      { name: "Empire", slug: "empire" },
      { name: "Drum", slug: "drum" },
      { name: "Gathered", slug: "gathered" },
    ],
  },
  {
    name: "Ceiling Lights",
    slug: "ceiling-lights",
    tags: ["ceiling lights", "bedroom ceiling lights", "bathroom ceiling lights"],
    types: ["pendant light"],
    children: [
      { name: "All Ceiling Lights", slug: "all-ceiling-lights" },
      { name: "Pendants", slug: "pendants" },
    ],
  },
  {
    name: "Wall Lights",
    slug: "wall-lights",
    tags: ["wall lights", "wall lighting", "bathroom wall lights"],
    types: ["wall light", "wall arm", "wall fittings"],
    children: [{ name: "All Wall Lights", slug: "all-wall-lights" }],
  },
  {
    name: "Chandeliers",
    slug: "chandeliers",
    tags: ["chandeliers", "bedroom chandelier"],
    types: [],
    children: [{ name: "All Chandeliers", slug: "all-chandeliers" }],
  },
  {
    name: "Rechargeable Lighting",
    slug: "rechargeable-lighting",
    tags: ["rechargeable", "bedroom rechargeable lights"],
    types: ["genesis fitting kit", "lantern"],
    children: [{ name: "All Rechargeable", slug: "all-rechargeable" }],
  },
  {
    name: "Sockets & Switches",
    slug: "sockets-and-switches",
    tags: ["sockets", "switches", "black sockets"],
    types: ["socket"],
    children: [{ name: "All Sockets & Switches", slug: "all-sockets-switches" }],
  },
  {
    name: "Bathroom",
    slug: "bathroom",
    tags: ["bathroom", "bathroom lights", "bathroom mirrors"],
    types: [],
    children: [{ name: "All Bathroom", slug: "all-bathroom" }],
  },
  {
    name: "Mirrors",
    slug: "mirrors",
    tags: ["mirrors", "black mirrors"],
    types: ["mirror"],
    children: [{ name: "All Mirrors", slug: "all-mirrors" }],
  },
  {
    name: "Outdoor Lights",
    slug: "outdoor-lights",
    tags: ["outdoor"],
    types: [],
    children: [{ name: "All Outdoor", slug: "all-outdoor" }],
  },
];

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

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(u) {
  if (!u) return "";
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("http")) return u;
  if (u.startsWith("/")) return `${BASE}${u}`;
  return u;
}

function moneyFromShopify(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return 0;
  // Shopify .js / recommendations use cents; products.json uses pounds string
  if (n > 500 && Number.isInteger(n)) return Math.round(n) / 100;
  return Math.round(n * 100) / 100;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; LinxLivingBot/1.0; +https://linxsquare.com)",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; LinxLivingBot/1.0; +https://linxsquare.com)",
      Accept: "text/html,application/json,*/*",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
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

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: BRAND_SLUG });
  const now = new Date();
  if (!brand) {
    const insert = {
      name: BRAND_NAME,
      slug: BRAND_SLUG,
      order: 80,
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
  if (!brandId) throw new Error("ensureMenu requires brandId");
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
    await menus.updateOne(
      { _id: menu._id },
      {
        $set: {
          name,
          brand: brandId,
          isActive: true,
          updatedAt: now,
          order: order ?? menu.order,
        },
      },
    );
  }
  return menu;
}

async function uploadRemoteImage(url, publicId, { force = false } = {}) {
  if (!url) return "";
  const src = absUrl(String(url).replace(/^http:\/\//i, "https://"));
  // Dry-run / skip: keep source URL for logging only (never written when DRY_RUN).
  if (SKIP_IMAGES || DRY_RUN) return src;
  // Keep Linx Cloudinary URLs; re-host anything else (Shopify + pooky-com).
  if (!force && /res\.cloudinary\.com\/diibcfikb\//i.test(src)) return src;
  try {
    const result = await cloudinary.uploader.upload(src, {
      folder: CLOUDINARY_FOLDER,
      public_id: String(publicId).slice(0, 100),
      overwrite: Boolean(force),
      invalidate: Boolean(force),
      resource_type: "image",
    });
    return result.secure_url || "";
  } catch (e) {
    log(`  cloudinary fail ${publicId}: ${e.message || e}`);
    // Last resort: keep an already-Cloudinary URL so the gallery isn't blank.
    if (/res\.cloudinary\.com/i.test(src)) return src;
    return "";
  }
}

/** Classify Pooky Shopify product_type for pairing behaviour. */
function productKind(productType) {
  const t = String(productType || "").trim().toLowerCase();
  if (/pendant\s*shade/.test(t)) return "pendant";
  if (/lamp\s*shade/.test(t)) return "shade";
  if (/wall\s*fitting/.test(t)) return "wall";
  if (/^base$/.test(t) || t === "base") return "base";
  if (/ceiling\s*fitting/.test(t)) return "ceiling";
  if (/wall\s*light/.test(t)) return "wall-light";
  if (/pendant/.test(t)) return "pendant-light";
  return "other";
}

function recType(p) {
  return String(p?.type || p?.product_type || "").trim();
}

async function optionsFromProducts(list, prefix) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const rich = r.handle ? await fetchProductJs(r.handle) : null;
    await delay(30);
    const imgs = collectImageUrls(rich || r).slice(0, 4);
    const up = [];
    for (let j = 0; j < imgs.length; j++) {
      const u = await uploadRemoteImage(
        imgs[j],
        `${prefix}-${r.handle || r.id}-${j + 1}`,
      );
      if (u) up.push(u);
    }
    out.push({ ...toOption(rich || r, up), sortOrder: i });
  }
  return out;
}

function tagList(shopify) {
  if (Array.isArray(shopify.tags)) return shopify.tags.map((t) => String(t));
  return String(shopify.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function resolveCategory(shopify) {
  const tags = tagList(shopify).map((t) => t.toLowerCase());
  const type = String(shopify.product_type || "").toLowerCase();
  const title = String(shopify.title || "").toLowerCase();

  for (const cat of MENU_TREE) {
    const tagHit = (cat.tags || []).some((t) =>
      tags.some((x) => x.includes(t) || t.includes(x)),
    );
    const typeHit = (cat.types || []).some(
      (t) => type === t || type.includes(t),
    );
    if (tagHit || typeHit) {
      let sub = cat.children[0];
      // Prefer a more specific sub from tags/title
      for (const child of cat.children.slice(1)) {
        const needle = child.name.toLowerCase();
        if (
          tags.some((t) => t.includes(needle)) ||
          title.includes(needle) ||
          tags.some((t) => t.includes(child.slug.replace(/-/g, " ")))
        ) {
          sub = child;
          break;
        }
      }
      // Empire / drum shades
      if (cat.slug === "lampshades") {
        if (/empire/i.test(title)) {
          sub = cat.children.find((c) => c.slug === "empire") || sub;
        } else if (/drum/i.test(title)) {
          sub = cat.children.find((c) => c.slug === "drum") || sub;
        } else if (/gather/i.test(title)) {
          sub = cat.children.find((c) => c.slug === "gathered") || sub;
        }
      }
      return {
        categorySlug: cat.slug,
        categoryName: cat.name,
        subSlug: sub.slug,
        subName: sub.name,
      };
    }
  }

  // Fallback by type
  if (/shade/i.test(type)) {
    return {
      categorySlug: "lampshades",
      categoryName: "Lampshades",
      subSlug: "all-lampshades",
      subName: "All Lampshades",
    };
  }
  if (/base/i.test(type)) {
    return {
      categorySlug: "table-lamps",
      categoryName: "Table Lamps",
      subSlug: "all-table-lamps",
      subName: "All Table Lamps",
    };
  }
  return {
    categorySlug: "table-lamps",
    categoryName: "Table Lamps",
    subSlug: "all-table-lamps",
    subName: "All Table Lamps",
  };
}

/**
 * Finish / material phrase after "in …" (e.g. "brass and frosted glass").
 * Used for specs only — NOT as a selectable Colour swatch. Pooky colour
 * variants are separate products; most lights have no Colour option.
 */
function extractFinishFromTitle(title) {
  const m = String(title || "").match(/\bin\s+([a-z][a-z\s-]{2,60})$/i);
  return m ? m[1].trim() : "";
}

/** True only when Shopify exposes a real multi-value Colour/Color option. */
function shopifyColourValues(shopify) {
  const opts = Array.isArray(shopify?.options) ? shopify.options : [];
  const colourOpt = opts.find((o) =>
    /^(colou?r)$/i.test(String(o?.name || "").trim()),
  );
  const values = (colourOpt?.values || [])
    .map((v) => String(v || "").trim())
    .filter((v) => v && !/^default title$/i.test(v));
  return values.length > 1 ? values : [];
}

function collectImageUrls(shopifyLike, extraUrls = []) {
  const out = [];
  const push = (u) => {
    const src = absUrl(
      String(typeof u === "string" ? u : u?.src || "").replace(
        /^http:\/\//i,
        "https://",
      ),
    );
    if (!src) return;
    // Dedupe by filename stem (ignore size/query variants).
    const stem = src.split("?")[0].split("/").pop() || src;
    if (out.some((x) => (x.split("?")[0].split("/").pop() || x) === stem)) {
      return;
    }
    out.push(src);
  };
  for (const img of shopifyLike?.images || []) push(img);
  for (const m of shopifyLike?.media || []) {
    if (m?.media_type && m.media_type !== "image") continue;
    push(m?.src || m?.preview_image?.src || m);
  }
  for (const u of extraUrls || []) push(u);
  if (MAX_IMAGES > 0 && out.length > MAX_IMAGES) return out.slice(0, MAX_IMAGES);
  return out;
}

/**
 * Extra PDP gallery frame Pooky shows beyond product.js (Accentuate T_1 /
 * lightmode). Only one — site gallery is typically product.js + this frame.
 */
async function collectExtraGalleryUrls(handle) {
  const dbProd = await fetchProductsDbProduct(handle);
  const metas = dbProd?.variants?.[0]?.metafields || [];
  const light = cloudinaryFromJsonField(
    metaValue(metas, "lightmode", "image"),
  );
  if (light) return [light];
  const accent = metaValue(metas, "combinations", "image__light_mode");
  const accentUrl = cloudinaryFromJsonField(accent);
  if (accentUrl) return [accentUrl];
  if (accent) {
    try {
      const arr = JSON.parse(accent);
      const src =
        arr?.[0]?.cloudinary_src ||
        arr?.[0]?.src ||
        arr?.[0]?.original_src ||
        "";
      if (src) {
        return [absUrl(String(src).replace(/^http:\/\//i, "https://"))];
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}

async function fetchProductJs(handle) {
  try {
    return await fetchJson(`${BASE}/products/${handle}.js`);
  } catch {
    return null;
  }
}

function extractSizeFromTitle(title) {
  const m = String(title || "").match(/(\d+(?:\.\d+)?)\s*cm/i);
  return m ? `${m[1]}cm` : "";
}

function extractMaterialHints(tags, title) {
  const hay = `${tags.join(" ")} ${title}`.toLowerCase();
  const mats = [];
  for (const m of [
    "brass",
    "bronze",
    "wood",
    "wooden",
    "cotton",
    "linen",
    "glass",
    "ceramic",
    "alabaster",
    "silk",
    "velvet",
    "rattan",
    "marble",
  ]) {
    if (hay.includes(m)) mats.push(m);
  }
  return [...new Set(mats)];
}

function extractStyleHints(tags) {
  const styles = [];
  for (const t of tags) {
    if (
      /art deco|maximalist|modern|traditional|scandi|coastal|vintage|contemporary/i.test(
        t,
      )
    ) {
      styles.push(t);
    }
  }
  return styles.slice(0, 6);
}

async function fetchAllShopifyProducts() {
  const all = [];
  let page = 1;
  for (;;) {
    const url = `${BASE}/products.json?limit=250&page=${page}`;
    log(`Fetching ${url}`);
    const data = await fetchJson(url);
    const batch = data.products || [];
    all.push(...batch);
    log(`  page ${page}: ${batch.length} (total ${all.length})`);
    if (batch.length < 250) break;
    page++;
    await delay(120);
  }
  return all;
}

async function fetchRecommendations(productId) {
  try {
    const data = await fetchJson(
      `${BASE}/recommendations/products.json?product_id=${productId}&limit=20`,
    );
    return data.products || [];
  } catch {
    return [];
  }
}

async function productsDbGql(query, variables = {}) {
  const res = await fetch(PRODUCTS_DB, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: BASE,
      Referer: `${BASE}/`,
      "User-Agent":
        "Mozilla/5.0 (compatible; LinxLivingBot/1.0; +https://linxsquare.com)",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`productsDB HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

function shopifyProductGid(id) {
  const n = String(id || "").replace(/^gid:\/\/shopify\/Product\//, "");
  if (!n || n === "undefined") return "";
  return `gid://shopify/Product/${n}`;
}

function cloudinaryFromJsonField(value) {
  if (!value) return "";
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const url =
      parsed?.secure_url ||
      parsed?.url ||
      (Array.isArray(parsed) ? parsed[0]?.secure_url || parsed[0]?.url : "");
    return absUrl(String(url || "").replace(/^http:\/\//i, "https://"));
  } catch {
    const s = String(value);
    if (/cloudinary\.com/i.test(s)) return absUrl(s.replace(/^http:\/\//i, "https://"));
    return "";
  }
}

function comboImageUrl(images) {
  if (!images) return "";
  const list = Array.isArray(images) ? images : [];
  // Prefer the tagged "BASE" combination frame (fitting + shade/pendant),
  // same composite Pooky shows in the shade/pendant picker.
  const preferred =
    list.find(
      (img) =>
        Array.isArray(img?.tags) &&
        img.tags.some((t) => String(t).toUpperCase() === "BASE"),
    ) || list[0];
  if (!preferred) return "";
  return absUrl(
    String(preferred.secure_url || preferred.url || "").replace(
      /^http:\/\//i,
      "https://",
    ),
  );
}

/**
 * Picker thumbnails must match pooky.com: combination shot of the partner
 * on this fitting — not the shade-alone "stick" / darkmode swatch.
 */
function partnerImageUrl(partner, combo) {
  const comboUrl = comboImageUrl(combo?.images);
  if (comboUrl) return comboUrl;
  const v = (partner?.variants || [])[0] || {};
  const light = cloudinaryFromJsonField(v.lightmodeImage?.value);
  if (light) return light;
  const dark = cloudinaryFromJsonField(v.darkmodeImage?.value);
  if (dark) return dark;
  const stick = v.stickDarkmodeImage?.value || v.stickLightmodeImage?.value || "";
  if (stick && /cloudinary\.com/i.test(stick)) {
    return absUrl(String(stick).replace(/^http:\/\//i, "https://"));
  }
  const img = partner?.images?.[0]?.url || "";
  return absUrl(img);
}

/**
 * Full in-stock combination partners (Pooky "see all" modal lists).
 * productId must be gid://shopify/Product/…
 */
async function fetchCombinationPartners(productGid, targetProductTypes) {
  if (!productGid || !targetProductTypes?.length) return [];
  const query = `
    query (
      $productId: String!
      $filters: CombinationsForProductFacetedFilters!
      $take: Int
      $skip: Int
    ) {
      combinationsForProductFaceted(
        productId: $productId
        filters: $filters
        take: $take
        skip: $skip
      ) {
        total
        combinationProducts {
          handle
          images
          products {
            id
            handle
            title
            productType
            totalInventory
            images(take: 1) { url }
            variants {
              id
              sku
              price
              stickDarkmodeImage: metafield(namespace: "darkmode", key: "stickImageURL") { value }
              stickLightmodeImage: metafield(namespace: "lightmode", key: "stickImageURL") { value }
              darkmodeImage: metafield(namespace: "darkmode", key: "image") { value }
              lightmodeImage: metafield(namespace: "lightmode", key: "image") { value }
              shortLabel: metafield(namespace: "combinations", key: "short_label") { value }
            }
          }
        }
      }
    }
  `;
  const typeSet = new Set(
    targetProductTypes.map((t) => String(t).toLowerCase()),
  );
  const byHandle = new Map();
  let skip = 0;
  let total = Infinity;
  while (skip < total) {
    const data = await productsDbGql(query, {
      productId: productGid,
      filters: { targetProductTypes, inStockOnly: true },
      take: 50,
      skip,
    });
    const block = data.combinationsForProductFaceted;
    total = Number(block?.total || 0);
    for (const combo of block?.combinationProducts || []) {
      for (const p of combo.products || []) {
        const pt = String(p.productType || "").toLowerCase();
        if (!typeSet.has(pt)) continue;
        if (byHandle.has(p.handle)) continue;
        const variant = (p.variants || [])[0] || {};
        const label =
          cleanText(variant.shortLabel?.value || "") ||
          cleanText(p.title) ||
          p.handle;
        byHandle.set(p.handle, {
          name: label,
          handle: p.handle || "",
          sku: variant.sku || "",
          price: moneyFromShopify(variant.price) || 0,
          stock:
            Number(p.totalInventory) > 0
              ? Number(p.totalInventory)
              : STOCK_DEFAULT,
          images: [partnerImageUrl(p, combo)].filter(Boolean),
          sortOrder: byHandle.size,
        });
      }
    }
    skip += 50;
    if (!(block?.combinationProducts || []).length) break;
    await delay(40);
  }
  return capPairings([...byHandle.values()]);
}

async function fetchProductsDbProduct(handle) {
  if (!handle) return null;
  try {
    const data = await productsDbGql(
      `
      query ($handle: [String!]!) {
        productsByHandle(handle: $handle) {
          id
          handle
          title
          productType
          images(take: 20) { url }
          variants {
            id
            sku
            price
            metafields(namespaces: ["attributes", "combinations", "lightmode", "darkmode"]) {
              namespace
              key
              value
            }
          }
        }
      }
    `,
      { handle: [handle] },
    );
    return data.productsByHandle?.[0] || null;
  } catch {
    return null;
  }
}

function metaValue(metafields, namespace, key) {
  const m = (metafields || []).find(
    (x) => x.namespace === namespace && x.key === key,
  );
  return m?.value || "";
}

async function fetchFamilyWallFittings(familyClass, activeHandle) {
  if (!familyClass) return [];
  const query = `
    query (
      $filters: ProductsInFamilyFacetedFilters!
      $activeHandle: String
      $take: Int
      $skip: Int
    ) {
      productsInFamilyFaceted(
        filters: $filters
        activeHandle: $activeHandle
        take: $take
        skip: $skip
      ) {
        total
        products {
          handle
          title
          productType
          images(take: 1) { url }
          variants {
            sku
            price
            shortLabel: metafield(namespace: "combinations", key: "short_label") { value }
            lightmodeImage: metafield(namespace: "lightmode", key: "image") { value }
          }
        }
      }
    }
  `;
  const out = [];
  let skip = 0;
  let total = Infinity;
  while (skip < total) {
    const data = await productsDbGql(query, {
      filters: { familyClass, inStockOnly: true },
      activeHandle: activeHandle || null,
      take: 50,
      skip,
    });
    const block = data.productsInFamilyFaceted;
    total = Number(block?.total || 0);
    for (const p of block?.products || []) {
      const variant = (p.variants || [])[0] || {};
      out.push({
        name:
          cleanText(variant.shortLabel?.value || "") ||
          cleanText(p.title) ||
          p.handle,
        handle: p.handle || "",
        sku: variant.sku || "",
        price: moneyFromShopify(variant.price) || 0,
        stock: STOCK_DEFAULT,
        images: [
          cloudinaryFromJsonField(variant.lightmodeImage?.value) ||
            absUrl(p.images?.[0]?.url || ""),
        ].filter(Boolean),
        sortOrder: out.length,
      });
    }
    skip += 50;
    if (!(block?.products || []).length) break;
    await delay(40);
  }
  return capPairings(out);
}

function toOption(shopifyLike, images = []) {
  const variant = (shopifyLike.variants || [])[0] || {};
  const price =
    moneyFromShopify(shopifyLike.price) ||
    moneyFromShopify(variant.price) ||
    0;
  const available =
    shopifyLike.available === true ||
    variant.available === true ||
    (shopifyLike.variants || []).some((v) => v.available);
  const imgs =
    images.length > 0
      ? images
      : (shopifyLike.images || [])
          .map((img) => absUrl(typeof img === "string" ? img : img.src))
          .filter(Boolean)
          .slice(0, 4);
  return {
    name: cleanText(shopifyLike.title) || shopifyLike.handle,
    images: imgs,
    price,
    stock: available ? STOCK_DEFAULT : 0,
    handle: shopifyLike.handle || "",
    sku: variant.sku || "",
    sortOrder: 0,
  };
}

/**
 * Prefer productsDB combination lists (full see-all). Fall back to Shopify
 * recommendations when the GraphQL call fails or returns nothing.
 */
async function scrapePairings({ shopify, rich, uploaded, handle, productType }) {
  const selfOpt = toOption(shopify || rich || {}, uploaded);
  const kind = productKind(productType);
  const productGid = shopifyProductGid(shopify?.id || rich?.id);
  let bases = [];
  let shades = [];
  let pendants = [];
  let wallFittings = [];

  try {
    if (kind === "wall" || kind === "ceiling" || kind === "base") {
      shades = await fetchCombinationPartners(productGid, ["Lamp Shade"]);
      pendants = await fetchCombinationPartners(productGid, ["Pendant Shade"]);
    }
    if (kind === "shade" || kind === "pendant") {
      bases = await fetchCombinationPartners(productGid, ["Base"]);
      wallFittings = await fetchCombinationPartners(productGid, [
        "Wall Fittings",
      ]);
    }
    if (kind === "base") {
      const dbProd = await fetchProductsDbProduct(handle);
      const family = metaValue(
        dbProd?.variants?.[0]?.metafields,
        "attributes",
        "family",
      );
      const familyBases = family
        ? await fetchFamilyWallFittings(family, handle)
        : [];
      // Family helper is shared; for bases filter productType Base if present.
      const otherBases = familyBases.filter(
        (b) => b.handle && b.handle !== handle,
      );
      bases = [selfOpt, ...otherBases];
    }
    if (kind === "wall" || kind === "ceiling") {
      const dbProd = await fetchProductsDbProduct(handle);
      const family = metaValue(
        dbProd?.variants?.[0]?.metafields,
        "attributes",
        "family",
      );
      wallFittings = family
        ? await fetchFamilyWallFittings(family, handle)
        : [selfOpt];
      if (!wallFittings.length) wallFittings = [selfOpt];
    }
    if (kind === "shade") shades = [selfOpt];
    if (kind === "pendant") pendants = [selfOpt];
  } catch (e) {
    log(`  productsDB pairings fail ${handle}: ${e.message || e}`);
  }

  // Fallback: Shopify recommendations (small related set).
  const needFallback =
    (kind === "wall" || kind === "ceiling" || kind === "base") &&
    !shades.length &&
    !pendants.length;
  if (needFallback || (kind === "shade" && !bases.length)) {
    const productId = shopify?.id || rich?.id;
    const recs = productId ? await fetchRecommendations(productId) : [];
    const lampShadeRecs = capPairings(
      recs.filter((p) => {
        const t = recType(p);
        return /lamp\s*shade/i.test(t) && !/pendant/i.test(t);
      }),
    );
    const pendantRecs = capPairings(
      recs.filter((p) => /pendant\s*shade/i.test(recType(p))),
    );
    const baseRecs = capPairings(
      recs.filter(
        (p) => /^base$/i.test(recType(p)) && String(p.handle) !== handle,
      ),
    );
    const wallRecs = capPairings(
      recs.filter(
        (p) =>
          /wall\s*fitting/i.test(recType(p)) && String(p.handle) !== handle,
      ),
    );
    if (!shades.length && (kind === "wall" || kind === "ceiling" || kind === "base")) {
      shades = await optionsFromProducts(lampShadeRecs, "shade");
    }
    if (!pendants.length && (kind === "wall" || kind === "ceiling" || kind === "base")) {
      pendants = await optionsFromProducts(pendantRecs, "pendant");
    }
    if (!bases.length && (kind === "shade" || kind === "pendant")) {
      bases = await optionsFromProducts(baseRecs, "base");
    }
    if (!wallFittings.length && (kind === "shade" || kind === "pendant")) {
      wallFittings = await optionsFromProducts(wallRecs, "wall");
    }
    if ((kind === "wall" || kind === "ceiling") && wallFittings.length <= 1) {
      wallFittings = [
        selfOpt,
        ...(await optionsFromProducts(wallRecs.slice(0, 6), "wall")),
      ];
    }
    if (kind === "base" && bases.length <= 1) {
      bases = [
        selfOpt,
        ...(await optionsFromProducts(baseRecs.slice(0, 6), "base")),
      ];
    }
  }

  if (kind === "shade" && !shades.length) shades = [selfOpt];
  if (kind === "pendant" && !pendants.length) pendants = [selfOpt];
  if ((kind === "wall" || kind === "ceiling") && !wallFittings.length) {
    wallFittings = [selfOpt];
  }
  if (kind === "base" && !bases.length) bases = [selfOpt];

  return { bases, shades, pendants, wallFittings };
}

async function extractEfficiencyFromPdp(handle) {
  try {
    const html = await fetchText(`${BASE}/products/${handle}`);
    // Look for efficiency tab content blocks if server-rendered
    const m =
      html.match(
        /efficiency[^<]{0,40}details[\s\S]{0,40}?>([\s\S]{20,800}?)<\//i,
      ) ||
      html.match(
        /<[^>]*efficiency[^>]*>([\s\S]{10,600}?)<\/(?:div|section|p)>/i,
      );
    if (m) {
      const details = cleanText(m[1]);
      if (details.length > 20 && !/efficiency details/i.test(details)) {
        return { summary: "", details: details.slice(0, 4000) };
      }
    }
  } catch {
    /* ignore */
  }
  return { summary: "", details: "" };
}

async function main() {
  fs.writeFileSync(LOG, `Pooky import ${new Date().toISOString()}\n`);
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
    `Pooky import${DRY_RUN ? " (DRY RUN)" : ""} concurrency=${CONCURRENCY}`,
  );

  let shopifyProducts = [];
  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    shopifyProducts = saved.shopifyProducts || [];
    log(`Resumed checkpoint: ${shopifyProducts.length} products`);
  } else {
    shopifyProducts = await fetchAllShopifyProducts();
    fs.writeFileSync(
      CHECKPOINT,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          count: shopifyProducts.length,
          shopifyProducts,
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

  if (LIMIT > 0 && !FIX_GALLERY && !FIX_OPTIONS) {
    shopifyProducts = shopifyProducts.slice(0, LIMIT);
  }
  if (ONLY_HANDLE) {
    shopifyProducts = shopifyProducts.filter(
      (p) => String(p.handle || "").toLowerCase() === ONLY_HANDLE,
    );
    log(`ONLY_HANDLE=${ONLY_HANDLE} → ${shopifyProducts.length} products`);
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  if (FIX_GALLERY || FIX_OPTIONS) {
    const byHandle = new Map(
      shopifyProducts.map((p) => [String(p.handle), p]),
    );
    const findFilter = {
      brand: brand._id,
      "specs.source": SOURCE_TAG,
    };
    if (ONLY_HANDLE) findFilter["specs.pookyHandle"] = ONLY_HANDLE;
    if (ONLY_TYPES.length) {
      findFilter.$or = [
        { "specs.productType": { $in: ONLY_TYPES } },
        { "specs.pookyType": { $in: ONLY_TYPES } },
      ];
    }
    let list = await productsCol
      .find(findFilter)
      .project({
        _id: 1,
        name: 1,
        images: 1,
        "specs.pookyHandle": 1,
        "specs.pookyId": 1,
        "specs.productType": 1,
        colorOptions: 1,
      })
      .toArray();
    if (LIMIT > 0) list = list.slice(0, LIMIT);
    log(
      `${FIX_OPTIONS ? "FIX_OPTIONS" : "FIX_GALLERY"}: refreshing ${list.length} products…`,
    );
    let fixed = 0;
    let failedFix = 0;
    await mapPool(list, CONCURRENCY, async (doc, idx) => {
      const label = `[${idx + 1}/${list.length}]`;
      const handle = String(doc.specs?.pookyHandle || "").trim();
      if (!handle) {
        log(`${label} skip (no handle): ${doc.name}`);
        return;
      }
      try {
        const rich = await fetchProductJs(handle);
        await delay(50);
        const shopify = byHandle.get(handle) || rich;
        const colourValues = shopifyColourValues(shopify || {});
        const extras = await collectExtraGalleryUrls(handle);
        await delay(30);
        const urls = collectImageUrls(rich || shopify || {}, extras);
        const uploaded = [];
        for (let i = 0; i < urls.length; i++) {
          // Force re-host so gallery frames aren't blank leftover uploads.
          const u = await uploadRemoteImage(urls[i], `${handle}-${i + 1}`, {
            force: true,
          });
          if (u) uploaded.push(u);
        }
        const finish = extractFinishFromTitle(doc.name || "");
        const colorOptions = colourValues.map((c, i) => ({
          name: c,
          swatchType: "solid",
          colorValue: "#cccccc",
          swatchImage: "",
          imageUrl: uploaded[0] || "",
          sap: "",
          sortOrder: i,
        }));
        const $set = {
          colorOptions,
          colours: colourValues,
          "specs.finish": finish || "",
          updatedAt: new Date(),
        };
        if (uploaded.length) $set.images = uploaded.filter((u) => /cloudinary\.com/i.test(u) || DRY_RUN);
        if (!colourValues.length) {
          $set.colorOptions = [];
          $set.colours = [];
        }

        let bases = [];
        let shades = [];
        let pendants = [];
        let wallFittings = [];
        if (FIX_OPTIONS && !SKIP_PAIRINGS) {
          const productType = String(
            shopify?.product_type ||
              shopify?.type ||
              doc.specs?.productType ||
              "",
          );
          const paired = await scrapePairings({
            shopify,
            rich,
            uploaded,
            handle,
            productType,
          });
          bases = paired.bases;
          shades = paired.shades;
          pendants = paired.pendants;
          wallFittings = paired.wallFittings;
          $set.bases = bases;
          $set.shades = shades;
          $set.pendants = pendants;
          $set.wallFittings = wallFittings;
          $set["specs.productType"] = productType;
          $set["specs.pookyType"] = productType;
        }

        if (DRY_RUN) {
          log(
            `${label} [dry] ${handle} imgs ${(doc.images || []).length}→${uploaded.length} shades=${shades.length} pendants=${pendants.length} walls=${wallFittings.length}`,
          );
          fixed++;
          return;
        }
        await productsCol.updateOne({ _id: doc._id }, { $set });
        fixed++;
        log(
          `${label} ✓ ${handle} imgs ${(doc.images || []).length}→${uploaded.length} bases=${bases.length} shades=${shades.length} pendants=${pendants.length} walls=${wallFittings.length}`,
        );
      } catch (e) {
        failedFix++;
        log(`${label} ✗ ${handle}:`, e.message);
      }
    });
    log(
      `${FIX_OPTIONS ? "FIX_OPTIONS" : "FIX_GALLERY"} done. Fixed ${fixed}, failed ${failedFix}`,
    );
    await mongoose.disconnect();
    return;
  }

  const parentMenus = new Map();
  const subMenus = new Map();
  for (let i = 0; i < MENU_TREE.length; i++) {
    const cat = MENU_TREE[i];
    const menu = await ensureMenu(db, {
      name: cat.name,
      slug: cat.slug,
      parent: null,
      brandId: brand._id,
      order: i,
      image: "",
    });
    parentMenus.set(cat.slug, menu);
    for (let j = 0; j < cat.children.length; j++) {
      const child = cat.children[j];
      const sub = await ensureMenu(db, {
        name: child.name,
        slug: child.slug,
        parent: menu._id,
        brandId: brand._id,
        order: j,
        image: "",
      });
      subMenus.set(`${cat.slug}/${child.slug}`, sub);
    }
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
  const pending = shopifyProducts.filter((p) => !done.has(String(p.id)));
  log(`Importing ${pending.length} products…`);

  await mapPool(pending, CONCURRENCY, async (shopify, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    try {
      const handle = shopify.handle;
      const name = cleanText(shopify.title) || handle;
      const variant = (shopify.variants || [])[0] || {};
      const price =
        Number(variant.price || shopify.variants?.[0]?.price || 0) || 0;
      const compareAt = Number(variant.compare_at_price || 0) || 0;
      const available =
        variant.available === true ||
        (shopify.variants || []).some((v) => v.available);
      const tags = tagList(shopify);
      const cats = resolveCategory(shopify);
      const productType = String(shopify.product_type || "");
      const finish = extractFinishFromTitle(name);
      const size = extractSizeFromTitle(name);
      const materials = extractMaterialHints(tags, name);
      const styles = extractStyleHints(tags);
      const colourValues = shopifyColourValues(shopify);

      // Prefer product.js gallery + productsDB lightmode/T_1 (10th frame on site).
      const rich = await fetchProductJs(handle);
      await delay(40);
      const extras = await collectExtraGalleryUrls(handle);
      await delay(30);
      const imageSource = rich || shopify;
      const images = collectImageUrls(imageSource, extras);
      const uploaded = [];
      for (let i = 0; i < images.length; i++) {
        const url = await uploadRemoteImage(images[i], `${handle}-${i + 1}`);
        if (url && (DRY_RUN || /cloudinary\.com/i.test(url))) uploaded.push(url);
      }

      // Pairings via Pooky productsDB combinations (full see-all lists).
      let bases = [];
      let shades = [];
      let pendants = [];
      let wallFittings = [];
      if (!SKIP_PAIRINGS) {
        const paired = await scrapePairings({
          shopify,
          rich,
          uploaded,
          handle,
          productType,
        });
        bases = paired.bases;
        shades = paired.shades;
        pendants = paired.pendants;
        wallFittings = paired.wallFittings;
      }

      let efficiency = { summary: "", details: "" };
      if (idx < 30 || process.env.SCRAPE_EFFICIENCY === "1") {
        efficiency = await extractEfficiencyFromPdp(handle);
        await delay(40);
      }

      const description =
        cleanText(shopify.body_html || "") ||
        `${name} from Pooky Lighting.`;

      const sizeOptions = size
        ? [{ name: size, imageUrl: uploaded[0] || "", sortOrder: 0 }]
        : [];
      // Only real Shopify Colour options — never invent swatches from "in brass…".
      const colorOptions = colourValues.map((c, i) => ({
        name: c,
        swatchType: "solid",
        colorValue: "#cccccc",
        swatchImage: "",
        imageUrl: uploaded[0] || "",
        sap: "",
        sortOrder: i,
      }));

      const specs = {
        source: SOURCE_TAG,
        sourceUrl: `${BASE}/products/${handle}`,
        pookyId: shopify.id,
        pookyHandle: handle,
        shopifyProductId: String(shopify.id),
        productType,
        pookyType: productType,
        vendor: shopify.vendor || "",
        tags: tags.join(", "),
        sku: variant.sku || "",
        shopifySku: variant.sku || "",
        shopifyVariantId: String(variant.id || ""),
        shopifyListPrice: price,
        shopifyCompareAt: compareAt || null,
        size: size || "",
        finish: finish || "",
        materials: materials.join(", "),
        styles: styles.join(", "),
      };

      const now = new Date();
      const doc = {
        name,
        description: description.slice(0, 12000),
        price,
        images: uploaded,
        category: cats.categorySlug,
        subCategory: cats.subSlug || "",
        department: "lighting",
        brand: brand._id,
        brands: [brand._id],
        stock: available ? STOCK_DEFAULT : 0,
        isOutOfStock: !available,
        tagline: productType || "",
        linxSku: variant.sku || handle,
        manufacturerSku: variant.sku || "",
        specs,
        showSpecs: true,
        materials,
        colours: colourValues,
        colorOptions,
        sizeOptions,
        bases,
        shades,
        pendants,
        wallFittings,
        efficiency,
        updatedAt: now,
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] ${name} £${price} type=${productType} cat=${doc.category}/${doc.subCategory} bases=${bases.length} shades=${shades.length} pendants=${pendants.length} walls=${wallFittings.length} imgs=${uploaded.length}`,
        );
        imported++;
      } else {
        const existing = await productsCol.findOne({
          $or: [
            { "specs.pookyHandle": handle, "specs.source": SOURCE_TAG },
            { "specs.pookyId": shopify.id, "specs.source": SOURCE_TAG },
            { "specs.sourceUrl": specs.sourceUrl, "specs.source": SOURCE_TAG },
          ],
        });
        if (existing) {
          const prev = Array.isArray(existing.images) ? existing.images : [];
          const prevCloud = prev.filter((u) => /cloudinary\.com/i.test(u));
          if (!uploaded.length && prevCloud.length) doc.images = prevCloud;
          else if (!uploaded.length) doc.images = prev;
          else if (uploaded.length < prev.length) {
            // Keep the longer gallery if a partial fetch came back shorter.
            doc.images = prev;
          }
          await productsCol.updateOne({ _id: existing._id }, { $set: doc });
          updated++;
        } else {
          await productsCol.insertOne({ ...doc, createdAt: now });
          imported++;
        }
        log(
          `${label} ✓ ${name} (£${price}) ${doc.category}/${doc.subCategory} bases=${bases.length} shades=${shades.length} pendants=${pendants.length} walls=${wallFittings.length} imgs=${(doc.images || []).length}`,
        );
      }

      done.add(String(shopify.id));
      if ((imported + updated) % 10 === 0) {
        fs.writeFileSync(
          PROGRESS,
          JSON.stringify(
            { at: new Date().toISOString(), done: [...done], imported, updated, failed },
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
      },
      null,
      2,
    ),
  );

  log("\n========== POOKY IMPORT ==========");
  log(`Created:  ${imported}`);
  log(`Updated:  ${updated}`);
  log(`Failed:   ${failed}`);
  log(`Brand:    ${BRAND_NAME} (${brand._id})`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
