/**
 * Remap The Under Floor Heating from theunderfloorheatingstore.com
 *
 * Rules (do NOT mix categories with sub-brands):
 * 1. Sub-brands = manufacturer brands only (Shop by Brand + product.vendor)
 * 2. Categories stay product-type collections (Electric / Water / Thermostats / …)
 * 3. For each site category, collect every vendor that has products in it
 * 4. If our menu slug matches that category, set menu.subBrands[] to ALL those vendors
 *    (shared categories are associated with every brand that sells into them)
 * 5. Products get product.subBrand from specs.vendorBrand / vendor
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/remap-ufhs-subbrands-categories.cjs
 *   DRY_RUN=1 node --require ./scripts/mongo-dns.cjs scripts/remap-ufhs-subbrands-categories.cjs
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

const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://www.theunderfloorheatingstore.com";
const BRAND_SLUG = "the-under-floor-heating";
const DRY_RUN = process.env.DRY_RUN === "1";
const REPORT = path.join(
  __dirname,
  "_tmp-ufhs-subbrand-category-remap-report.json",
);

/** Shop-by-Brand manufacturers from theunderfloorheatingstore.com nav */
const NAV_BRANDS = [
  "ProWarm",
  "Floorwarmers",
  "Warmup",
  "Wavin",
  "Polypipe",
  "John Guest",
  "Heatmiser",
  "Salus",
  "Hive",
  "Ultra Tile",
  "Mapei",
  "BAL",
  "NoMorePly",
];

/** Top-level product-type categories (NOT brands) from site nav */
const CATEGORY_HANDLES = new Set([
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
  // common nested / accessory type collections
  "underfloor-heating-mats",
  "underfloor-heating-cables",
  "underfloor-heating-foil",
  "in-screed-underfloor-heating",
  "insulation-boards",
  "decoupling-mats",
  "thermal-imaging-cameras",
  "electrical-components",
  "installation-tools",
  "low-profile-kits",
  "standard-output-kits",
  "high-output-kits",
  "multi-room-kits",
  "fixing-systems",
  "pipes",
  "manifolds",
  "wiring-centres",
  "couplings-valves",
  "actuators",
  "pumps",
  "tools",
  "wifi-thermostats",
  "digital-thermostats",
  "manual-dial-thermostats",
  "wireless-thermostats",
  "programmable-thermostats",
  "hot-water-programmers",
  "smart-heating",
  "tile-adhesives",
  "self-levelling-compound",
  "floor-primer",
  "tiling-grout",
  "spray-adhesives",
  "tiling-tools",
  "air-source-heat-pump-kits",
  "hot-water-cylinders",
  "ev-chargers",
  "electric-water-boilers",
  "solar-thermal-water",
  "skirting-board-heating",
  "air-conditioning",
  "solar-pv-panels",
  "solar-pv-accessories",
  "solar-pv-inverters",
  "solar-pv-storage-units",
  "wet-room-shower-trays",
  "wetroom-shower-screens",
  "bathroom-wall-panels",
  "tiles",
  "wet-room-installation-tools",
  "towel-radiators",
  "plastic-pipe",
  "plastic-connectors-fittings",
  "copper-brass-connectors-fittings",
  "steel-connectors-fittings",
  "heating-pipe",
  "plumbing-tools",
]);

/** Collection handles that ARE manufacturer brand pages (not categories) */
const BRAND_COLLECTION_HANDLES = new Set([
  "prowarm",
  "prowarm-edlp",
  "all-prowarm-products",
  "floorwarmers",
  "floorwarmers-range",
  "floorwarmers-products",
  "all-floorwarmers",
  "warmup",
  "wavin",
  "polypipe",
  "john-guest",
  "heatmiser-thermostats",
  "salus",
  "hive-thermostats",
  "ultra-tile",
  "ultra-tile-edlp",
  "mapei",
  "bal",
  "no-more-ply",
]);

const SKIP_COLLECTION =
  /^(frontpage|all|all-products|home-page|featured|sale|best-sellers)$/i;

const SKIP_VENDOR =
  /^(unknown|n\/?a|null|the underfloor heating store|underfloor heating store|ufhs)$/i;

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
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVendorName(name) {
  const n = cleanText(name);
  if (!n) return "";
  const map = {
    prowarm: "ProWarm",
    "pro warm": "ProWarm",
    floorwarmers: "Floorwarmers",
    "floor warmers": "Floorwarmers",
    warmup: "Warmup",
    "warm up": "Warmup",
    wavin: "Wavin",
    polypipe: "Polypipe",
    "john guest": "John Guest",
    johnguest: "John Guest",
    heatmiser: "Heatmiser",
    salus: "Salus",
    hive: "Hive",
    "ultra tile": "Ultra Tile",
    ultratile: "Ultra Tile",
    "ultra-tile": "Ultra Tile",
    mapei: "Mapei",
    bal: "BAL",
    nomoreply: "NoMorePly",
    "no more ply": "NoMorePly",
    "no-more-ply": "NoMorePly",
  };
  return map[n.toLowerCase()] || n;
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
    await delay(80);
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
    console.log(`products page ${page}: +${rows.length} (total ${out.length})`);
    if (rows.length < 250) break;
    page += 1;
    await delay(100);
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
    await delay(70);
  }
  return handles;
}

function isBrandCollection(handle) {
  const h = String(handle || "").toLowerCase();
  if (BRAND_COLLECTION_HANDLES.has(h)) return true;
  // promo / brand-line collections
  if (
    /^(prowarm|floorwarmers|warmup|wavin|polypipe|john-guest|heatmiser|salus|hive|ultra-tile|mapei|bal|no-more-ply|nomoreply)/i.test(
      h,
    )
  ) {
    return true;
  }
  return false;
}

function isCategoryCollection(handle, title) {
  const h = String(handle || "").toLowerCase();
  if (isBrandCollection(h)) return false;
  if (CATEGORY_HANDLES.has(h)) return true;
  // allow unknown product-type collections that are not brand pages
  if (/brand|vendor|edlp|offer|%|off-|bundle/i.test(h)) return false;
  if (/brand|shop by brand/i.test(title || "")) return false;
  return true;
}

function buildSubBrandList(navBrands, vendorCounts) {
  const bySlug = new Map();
  const add = (name, source) => {
    const canonical = normalizeVendorName(name);
    if (!canonical || SKIP_VENDOR.test(canonical)) return;
    const slug = slugify(canonical);
    if (!slug) return;
    if (bySlug.has(slug)) {
      bySlug.get(slug).sources.add(source);
      return;
    }
    bySlug.set(slug, { name: canonical, slug, sources: new Set([source]) });
  };

  for (const n of navBrands) add(n, "nav");
  for (const [v] of vendorCounts) add(v, "product-vendor");

  return [...bySlug.values()]
    .map(({ name, slug, sources }) => ({
      name,
      slug,
      sources: [...sources],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  console.log(
    `UFHS category↔sub-brand remap${DRY_RUN ? " (DRY_RUN)" : ""}`,
  );

  const [collections, products] = await Promise.all([
    fetchAllCollections(),
    fetchAllProductsLite(),
  ]);

  const productByHandle = new Map();
  const vendorCounts = new Map();
  for (const p of products) {
    if (!p?.handle) continue;
    productByHandle.set(p.handle, p);
    const vendor = normalizeVendorName(p.vendor || "");
    if (!vendor || SKIP_VENDOR.test(vendor)) continue;
    vendorCounts.set(vendor, (vendorCounts.get(vendor) || 0) + 1);
  }

  const subBrandDefs = buildSubBrandList(NAV_BRANDS, vendorCounts);
  const subBrandSlugSet = new Set(subBrandDefs.map((s) => s.slug));
  console.log(
    `collections=${collections.length} products=${products.length} subBrands=${subBrandDefs.length}`,
  );

  // categoryHandle → Set<subBrandSlug>
  const categoryToSubBrands = new Map();
  // subBrandSlug → { categories: Set, productHandles: Set }
  const subBrandStats = new Map();
  for (const sb of subBrandDefs) {
    subBrandStats.set(sb.slug, {
      name: sb.name,
      categories: new Set(),
      productHandles: new Set(),
    });
  }

  const categoryCollections = collections.filter((c) =>
    isCategoryCollection(c.handle, c.title),
  );

  console.log(
    `Scanning ${categoryCollections.length} category collections for vendor membership…`,
  );

  let scanned = 0;
  for (const col of categoryCollections) {
    const handle = col.handle;
    let productHandles;
    try {
      productHandles = await fetchCollectionProductHandles(handle);
    } catch (err) {
      console.warn(`skip collection ${handle}:`, err.message);
      continue;
    }
    scanned += 1;
    if (scanned % 10 === 0) {
      console.log(`  scanned ${scanned}/${categoryCollections.length}`);
    }

    for (const ph of productHandles) {
      const p = productByHandle.get(ph);
      if (!p) continue;
      const vendorName = normalizeVendorName(p.vendor || "");
      if (!vendorName || SKIP_VENDOR.test(vendorName)) continue;
      const vendorSlug = slugify(vendorName);
      if (!subBrandSlugSet.has(vendorSlug)) continue;

      if (!categoryToSubBrands.has(handle)) {
        categoryToSubBrands.set(handle, new Set());
      }
      categoryToSubBrands.get(handle).add(vendorSlug);

      const st = subBrandStats.get(vendorSlug);
      if (st) {
        st.categories.add(handle);
        st.productHandles.add(ph);
      }
    }
  }

  // Also map from product tags / product_type when collection membership is thin
  for (const p of products) {
    const vendorName = normalizeVendorName(p.vendor || "");
    if (!vendorName || SKIP_VENDOR.test(vendorName)) continue;
    const vendorSlug = slugify(vendorName);
    if (!subBrandSlugSet.has(vendorSlug)) continue;
    const st = subBrandStats.get(vendorSlug);
    if (st) st.productHandles.add(p.handle);
  }

  const conn = await connectMongo();
  const db = conn.db;
  const brands = db.collection("brands");
  const menus = db.collection("menus");
  const productsCol = db.collection("products");

  const brand = await brands.findOne({ slug: BRAND_SLUG });
  if (!brand) {
    throw new Error(`Brand "${BRAND_SLUG}" not found`);
  }

  const now = new Date();
  const subBrandsPayload = subBrandDefs.map(({ name, slug }) => ({
    name,
    slug,
  }));

  if (!DRY_RUN) {
    await brands.updateOne(
      { _id: brand._id },
      {
        $set: {
          subBrands: subBrandsPayload,
          isActive: true,
          updatedAt: now,
        },
      },
    );
  }
  console.log(
    `${DRY_RUN ? "[dry] would set" : "Set"} ${subBrandsPayload.length} manufacturer subBrands on ${brand.name}`,
  );

  // --- Products ---
  const brandProducts = await productsCol
    .find({ brand: brand._id })
    .project({ name: 1, category: 1, subCategory: 1, subBrand: 1, specs: 1 })
    .toArray();

  let productsUpdated = 0;
  let productsUnmatched = 0;
  const productBySub = {};

  for (const p of brandProducts) {
    const raw =
      cleanText(p.specs?.vendorBrand || "") ||
      cleanText(p.specs?.vendor || "") ||
      "";
    const vendorName = normalizeVendorName(raw);
    const slug =
      vendorName && !SKIP_VENDOR.test(vendorName)
        ? slugify(vendorName)
        : "";
    const next = subBrandSlugSet.has(slug) ? slug : "";
    if (!next) productsUnmatched += 1;
    else productBySub[next] = (productBySub[next] || 0) + 1;

    if ((p.subBrand || "") !== next) {
      if (!DRY_RUN) {
        await productsCol.updateOne(
          { _id: p._id },
          { $set: { subBrand: next, updatedAt: now } },
        );
      }
      productsUpdated += 1;
    }
  }

  console.log(
    `Products: total=${brandProducts.length} updated=${productsUpdated} unmatched=${productsUnmatched}`,
  );

  // --- Menus / categories ---
  const brandMenus = await menus.find({ brand: brand._id }).toArray();
  let menusUpdated = 0;
  const menuMap = [];

  for (const menu of brandMenus) {
    const slug = String(menu.slug || "")
      .trim()
      .toLowerCase();
    const nameSlug = slugify(menu.name);

    // Match site category handles → associated manufacturer sub-brands
    const associated = new Set();
    const sources = [];

    for (const [catHandle, vendors] of categoryToSubBrands) {
      if (
        catHandle === slug ||
        catHandle === nameSlug ||
        // child menus sometimes use slightly different slugs
        slug.endsWith(catHandle) ||
        catHandle.endsWith(slug)
      ) {
        for (const v of vendors) associated.add(v);
        sources.push(catHandle);
      }
    }

    // Fallback: derive from our products already in this category
    if (!associated.size) {
      const related = brandProducts.filter(
        (p) =>
          p.category === menu.slug ||
          p.category === menu.name ||
          p.subCategory === menu.slug ||
          p.subCategory === menu.name,
      );
      for (const p of related) {
        const raw =
          cleanText(p.specs?.vendorBrand || "") ||
          cleanText(p.specs?.vendor || "") ||
          "";
        const vendorName = normalizeVendorName(raw);
        const vSlug =
          vendorName && !SKIP_VENDOR.test(vendorName)
            ? slugify(vendorName)
            : "";
        if (vSlug && subBrandSlugSet.has(vSlug)) associated.add(vSlug);
      }
      if (associated.size) sources.push("from-local-products");
    }

    const nextList = [...associated].sort();
    // Keep legacy single field empty — multi-brand categories must use the array
    // so we never pretend a shared category "belongs" to only one manufacturer.
    const nextSingle = nextList.length === 1 ? nextList[0] : "";

    menuMap.push({
      name: menu.name,
      slug: menu.slug,
      previous: {
        subBrand: menu.subBrand || "",
        subBrands: menu.subBrands || [],
      },
      next: { subBrand: nextSingle, subBrands: nextList },
      sources,
    });

    const prevList = Array.isArray(menu.subBrands)
      ? [...menu.subBrands].map(String).sort()
      : [];
    const changed =
      (menu.subBrand || "") !== nextSingle ||
      JSON.stringify(prevList) !== JSON.stringify(nextList);

    if (changed) {
      if (!DRY_RUN) {
        await menus.updateOne(
          { _id: menu._id },
          {
            $set: {
              subBrand: nextSingle,
              subBrands: nextList,
              updatedAt: now,
            },
          },
        );
      }
      menusUpdated += 1;
    }
  }

  console.log(`Menus: total=${brandMenus.length} updated=${menusUpdated}`);

  const report = {
    at: new Date().toISOString(),
    dryRun: DRY_RUN,
    brand: { id: String(brand._id), name: brand.name, slug: brand.slug },
    subBrands: subBrandsPayload,
    site: {
      categoryToSubBrands: Object.fromEntries(
        [...categoryToSubBrands.entries()].map(([k, v]) => [k, [...v].sort()]),
      ),
      subBrandStats: Object.fromEntries(
        [...subBrandStats.entries()].map(([k, v]) => [
          k,
          {
            name: v.name,
            categoryCount: v.categories.size,
            categories: [...v.categories].sort(),
            productCount: v.productHandles.size,
          },
        ]),
      ),
    },
    products: {
      total: brandProducts.length,
      updated: productsUpdated,
      unmatched: productsUnmatched,
      bySubBrand: productBySub,
    },
    menus: {
      total: brandMenus.length,
      updated: menusUpdated,
      map: menuMap,
    },
  };

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`Report → ${REPORT}`);

  try {
    const mongoose = require("mongoose");
    if (mongoose.connection?.readyState) await mongoose.disconnect();
  } catch {
    /* ignore */
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
