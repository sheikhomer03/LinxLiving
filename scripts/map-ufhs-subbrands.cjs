/**
 * Map The Underfloor Heating Store vendor brands → Linx subBrands
 * under parent brand "The Under Floor Heating".
 *
 * - Collects Shop-by-Brand vendors from site nav + product.vendor + brand collections
 * - Sets brand.subBrands
 * - Sets product.subBrand from specs.vendorBrand / vendor
 * - Sets menu.subBrand when a menu is a vendor/brand collection
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/map-ufhs-subbrands.cjs
 *   DRY_RUN=1 node --require ./scripts/mongo-dns.cjs scripts/map-ufhs-subbrands.cjs
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
const REPORT = path.join(__dirname, "_tmp-ufhs-subbrand-map-report.json");

/** Known Shop-by-Brand entries from theunderfloorheatingstore.com nav */
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
  "The Underfloor Heating Store",
];

const SKIP_VENDOR = /^(unknown|n\/?a|null)$/i;

/** Canonical manufacturer handles from the site Shop-by-Brand / vendor collections. */
const BRAND_ROOT_HANDLES = {
  prowarm: "ProWarm",
  "prowarm-edlp": "ProWarm",
  floorwarmers: "Floorwarmers",
  "floorwarmers-range": "Floorwarmers",
  "floorwarmers-products": "Floorwarmers",
  warmup: "Warmup",
  wavin: "Wavin",
  polypipe: "Polypipe",
  "john-guest": "John Guest",
  "heatmiser-thermostats": "Heatmiser",
  salus: "Salus",
  "hive-thermostats": "Hive",
  "ultra-tile": "Ultra Tile",
  "ultra-tile-edlp": "Ultra Tile",
  mapei: "Mapei",
  bal: "BAL",
  "no-more-ply": "NoMorePly",
};

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
    await delay(100);
  }
  return out;
}

async function fetchAllProductVendors() {
  const counts = new Map();
  let page = 1;
  while (page <= 80) {
    const data = await fetchJson(
      `${BASE}/products.json?limit=250&page=${page}`,
    );
    const rows = data.products || [];
    if (!rows.length) break;
    for (const p of rows) {
      const v = cleanText(p.vendor || "");
      if (!v || SKIP_VENDOR.test(v)) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    console.log(`products page ${page}: +${rows.length} vendors=${counts.size}`);
    if (rows.length < 250) break;
    page += 1;
    await delay(120);
  }
  return counts;
}

function normalizeVendorName(name) {
  const n = cleanText(name);
  if (!n) return "";
  // Canonical spellings
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
    "ultra tile fix": "Ultra Tile",
    mapei: "Mapei",
    bal: "BAL",
    nomoreply: "NoMorePly",
    "no more ply": "NoMorePly",
    "no-more-ply": "NoMorePly",
    "the underfloor heating store": "The Underfloor Heating Store",
    "underfloor heating store": "The Underfloor Heating Store",
    ufhs: "The Underfloor Heating Store",
  };
  const key = n.toLowerCase();
  return map[key] || n;
}

function buildSubBrands({ navBrands, vendorCounts, collections }) {
  const bySlug = new Map();

  function add(name, source) {
    const canonical = normalizeVendorName(name);
    if (!canonical || SKIP_VENDOR.test(canonical)) return;
    const slug = slugify(canonical);
    if (!slug) return;
    if (bySlug.has(slug)) {
      bySlug.get(slug).sources.add(source);
      return;
    }
    bySlug.set(slug, {
      name: canonical,
      slug,
      sources: new Set([source]),
    });
  }

  // 1) Shop-by-Brand nav (from theunderfloorheatingstore.com)
  for (const n of navBrands) add(n, "nav");

  // 2) Every product vendor on the site (= manufacturer brands)
  for (const [v] of vendorCounts) add(v, "product-vendor");

  // 3) Root brand collections only (not "ProWarm Thermostats" promo lines)
  for (const c of collections) {
    const handle = String(c.handle || "");
    const mapped = BRAND_ROOT_HANDLES[handle];
    if (mapped) add(mapped, `collection:${handle}`);
  }

  return [...bySlug.values()]
    .map(({ name, slug, sources }) => {
      let siteCount = 0;
      for (const [v, n] of vendorCounts) {
        if (slugify(normalizeVendorName(v)) === slug) siteCount += n;
      }
      return {
        name,
        slug,
        sources: [...sources],
        productCountOnSite: siteCount,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function matchSubBrandSlug(raw, subBrands) {
  const name = normalizeVendorName(raw);
  if (!name) return "";
  const slug = slugify(name);
  const exact = subBrands.find((s) => s.slug === slug);
  if (exact) return exact.slug;
  const byName = subBrands.find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  );
  if (byName) return byName.slug;
  // fuzzy contains
  const soft = subBrands.find(
    (s) =>
      name.toLowerCase().includes(s.name.toLowerCase()) ||
      s.name.toLowerCase().includes(name.toLowerCase()),
  );
  return soft ? soft.slug : "";
}

async function main() {
  console.log(`UFHS sub-brand map${DRY_RUN ? " (DRY_RUN)" : ""}`);

  const [collections, vendorCounts] = await Promise.all([
    fetchAllCollections(),
    fetchAllProductVendors(),
  ]);

  console.log(`collections=${collections.length} uniqueVendors=${vendorCounts.size}`);

  const discovered = buildSubBrands({
    navBrands: NAV_BRANDS,
    vendorCounts,
    collections,
  });

  console.log("Discovered sub-brands:");
  for (const sb of discovered) {
    console.log(
      `  - ${sb.name} (${sb.slug}) sources=${sb.sources.join(",")} siteProducts≈${sb.productCountOnSite}`,
    );
  }

  const conn = await connectMongo();
  const db = conn.db;
  const brands = db.collection("brands");
  const menus = db.collection("menus");
  const products = db.collection("products");

  const brand = await brands.findOne({ slug: BRAND_SLUG });
  if (!brand) {
    throw new Error(
      `Brand slug "${BRAND_SLUG}" not found. Run the UFHS import first.`,
    );
  }

  const subBrands = discovered.map(({ name, slug }) => ({ name, slug }));
  const now = new Date();

  if (!DRY_RUN) {
    await brands.updateOne(
      { _id: brand._id },
      { $set: { subBrands, updatedAt: now, isActive: true } },
    );
  }
  console.log(
    `${DRY_RUN ? "[dry] would set" : "Set"} ${subBrands.length} subBrands on ${brand.name}`,
  );

  // --- Products ---
  const brandProducts = await products
    .find({ brand: brand._id })
    .project({
      name: 1,
      category: 1,
      subCategory: 1,
      subBrand: 1,
      specs: 1,
    })
    .toArray();

  let productsUpdated = 0;
  let productsUnmatched = 0;
  const productBySub = {};
  const unmatchedVendors = new Map();

  for (const p of brandProducts) {
    const vendor =
      cleanText(p.specs?.vendorBrand || "") ||
      cleanText(p.specs?.vendor || "") ||
      "";
    const slug = matchSubBrandSlug(vendor, subBrands);
    if (!slug) {
      productsUnmatched += 1;
      const key = vendor || "(empty)";
      unmatchedVendors.set(key, (unmatchedVendors.get(key) || 0) + 1);
      // clear invalid / empty
      if (p.subBrand) {
        if (!DRY_RUN) {
          await products.updateOne(
            { _id: p._id },
            { $set: { subBrand: "", updatedAt: now } },
          );
        }
        productsUpdated += 1;
      }
      continue;
    }
    productBySub[slug] = (productBySub[slug] || 0) + 1;
    if (p.subBrand !== slug) {
      if (!DRY_RUN) {
        await products.updateOne(
          { _id: p._id },
          { $set: { subBrand: slug, updatedAt: now } },
        );
      }
      productsUpdated += 1;
    }
  }

  console.log(
    `Products: total=${brandProducts.length} updated=${productsUpdated} unmatched=${productsUnmatched}`,
  );

  // --- Menus / categories ---
  // 1) Menus whose slug/name matches a sub-brand → set that subBrand
  // 2) Otherwise: set menu.subBrand to the dominant product vendor under that category
  //    (only when ≥60% of products share one sub-brand; else leave empty)
  const brandMenus = await menus.find({ brand: brand._id }).toArray();
  let menusUpdated = 0;
  const menuMap = [];

  for (const menu of brandMenus) {
    let slug = matchSubBrandSlug(menu.name, subBrands);
    if (!slug) slug = matchSubBrandSlug(menu.slug, subBrands);

    let reason = slug ? "name/slug-match" : "";

    if (!slug) {
      // Dominant vendor among products in this category or subcategory
      const filter = {
        brand: brand._id,
        $or: [
          { category: menu.slug },
          { category: menu.name },
          { subCategory: menu.slug },
          { subCategory: menu.name },
        ],
      };
      const related = await products
        .find(filter)
        .project({ subBrand: 1, specs: 1 })
        .toArray();

      const counts = new Map();
      for (const p of related) {
        const sb =
          p.subBrand ||
          matchSubBrandSlug(p.specs?.vendorBrand || p.specs?.vendor || "", subBrands);
        if (!sb) continue;
        counts.set(sb, (counts.get(sb) || 0) + 1);
      }
      if (related.length > 0 && counts.size > 0) {
        const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        const [topSlug, topN] = ranked[0];
        const ratio = topN / related.length;
        if (ratio >= 0.6) {
          slug = topSlug;
          reason = `dominant-vendor ${(ratio * 100).toFixed(0)}% of ${related.length}`;
        } else {
          reason = `mixed-vendors top=${topSlug}@${(ratio * 100).toFixed(0)}%`;
        }
      } else {
        reason = related.length ? "no-vendor-on-products" : "no-products";
      }
    }

    const next = slug || "";
    menuMap.push({
      name: menu.name,
      slug: menu.slug,
      parent: menu.parent || null,
      previous: menu.subBrand || "",
      next,
      reason,
    });

    if ((menu.subBrand || "") !== next) {
      if (!DRY_RUN) {
        await menus.updateOne(
          { _id: menu._id },
          { $set: { subBrand: next, updatedAt: now } },
        );
      }
      menusUpdated += 1;
    }
  }

  console.log(
    `Menus: total=${brandMenus.length} updated=${menusUpdated}`,
  );

  const report = {
    at: new Date().toISOString(),
    dryRun: DRY_RUN,
    brand: { id: String(brand._id), name: brand.name, slug: brand.slug },
    subBrands,
    products: {
      total: brandProducts.length,
      updated: productsUpdated,
      unmatched: productsUnmatched,
      bySubBrand: productBySub,
      unmatchedVendors: Object.fromEntries(unmatchedVendors),
    },
    menus: {
      total: brandMenus.length,
      updated: menusUpdated,
      map: menuMap,
    },
    siteVendorCounts: Object.fromEntries(
      [...vendorCounts.entries()].sort((a, b) => b[1] - a[1]),
    ),
  };

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`Report → ${REPORT}`);

  await conn.close?.();
  // mongoose.disconnect if connection came from mongoose
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
