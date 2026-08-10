/**
 * Sync Spectra product price + size from https://spectratileandhome.com/collections/all
 *
 * Uses Shopify storefront JSON (VAT-inclusive box prices shown on the site).
 * Only updates brand slug `spectra`.
 *
 *   node scripts/sync-spectra-prices-sizes.cjs
 *   DRY_RUN=1 node scripts/sync-spectra-prices-sizes.cjs
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://spectratileandhome.com";
const BRAND_SLUG = "spectra";
const MATCH_THRESHOLD = 55;
const DRY_RUN = process.env.DRY_RUN === "1";

const HANDLE_ALIASES = {
  "casa vanesia": "casa-venesia",
  "casa vanesia (matt)": "casa-venesia",
  "casa-vanesia": "casa-venesia",
  "cosima satvario": "cosima-statuario",
  "cosima-satvario": "cosima-statuario",
  "norway bianco": "norway-bianco",
  "norwy bianco": "norway-bianco",
  "traventine grey": "travertine-grey",
  "traventine moca satin matt": "travertine-moca",
  "traventine moca": "travertine-moca",
  "plaza white gloss": "plaza-white",
  "ananas blue onyx": "ananas-blue-onyx",
};

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/creama/g, "crema")
    .replace(/florin/g, "florian")
    .replace(/traventine/g, "travertine")
    .replace(/[^\w\s]/g, " ")
    .replace(
      /\b(glossy|gloss|high|matt|satin|carving|collection|non|rectified|thick|6mm|mm|outdoor)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function tokenScore(a, b) {
  const ta = normalizeName(a).split(" ").filter(Boolean);
  const tb = normalizeName(b).split(" ").filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  const inter = ta.filter((t) => setB.has(t)).length;
  return (inter / Math.max(ta.length, tb.length)) * 100;
}

function matchScore(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (nb.includes(na) || na.includes(nb)) return 90;
  return tokenScore(a, b);
}

/** Normalize any Spectra size label to millimetre form "600x1200". */
function normalizeSizeMm(raw) {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/,/g, ".")
    .trim();
  if (!s || s === "n/a") return "";

  let m = s.match(/(\d+(?:\.\d+)?)\s*mm\s*x\s*(\d+(?:\.\d+)?)\s*mm?/);
  if (m) {
    return `${Math.round(Number(m[1]))}x${Math.round(Number(m[2]))}`;
  }

  m = s.match(/(\d+(?:\.\d+)?)\s*cm\s*x\s*(\d+(?:\.\d+)?)\s*cm?/);
  if (m) {
    return `${Math.round(Number(m[1]) * 10)}x${Math.round(Number(m[2]) * 10)}`;
  }

  m = s.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
  if (!m) return "";
  let w = Number(m[1]);
  let h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "";
  // Spectra variant labels like "60 X 120" are centimetres
  if (w < 200 && h < 200) {
    w *= 10;
    h *= 10;
  }
  return `${Math.round(w)}x${Math.round(h)}`;
}

function sizeFromProduct(sp) {
  const fromOption = (sp.options || []).find((o) =>
    /^size$/i.test(String(o.name || "")),
  );
  const optionValues = fromOption?.values || [];
  const tags = (sp.tags || [])
    .flatMap((t) => String(t).split(","))
    .map((t) => t.trim())
    .filter(Boolean);

  for (const v of optionValues) {
    const n = normalizeSizeMm(v);
    if (n) return n;
  }
  for (const tag of tags) {
    const n = normalizeSizeMm(tag);
    if (n && /^\d+x\d+$/.test(n)) return n;
  }
  for (const variant of sp.variants || []) {
    const n = normalizeSizeMm(variant.option1 || variant.title);
    if (n) return n;
  }
  return "";
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchAllSpectraProducts() {
  const out = [];
  let page = 1;
  while (page <= 20) {
    const data = await fetchJson(
      `${BASE}/collections/all/products.json?limit=250&page=${page}`,
    );
    const rows = data.products || [];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < 250) break;
    page += 1;
  }
  return out;
}

function pickVariant(sp, wantedSizeMm) {
  const variants = sp.variants || [];
  if (!variants.length) return null;
  if (variants.length === 1) return variants[0];

  const wanted = normalizeSizeMm(wantedSizeMm);
  if (wanted) {
    const hit = variants.find(
      (v) => normalizeSizeMm(v.option1 || v.title) === wanted,
    );
    if (hit) return hit;
  }
  return variants[0];
}

function resolveSiteProduct(local, catalog, byHandle) {
  const nameKey = normalizeName(local.name);
  const stored = String(local.specs?.spectraHandle || "").trim();

  if (HANDLE_ALIASES[nameKey]) {
    const aliased = byHandle.get(HANDLE_ALIASES[nameKey]);
    if (aliased) return { site: aliased, score: 100, via: "alias" };
  }
  if (stored && HANDLE_ALIASES[stored]) {
    const aliased = byHandle.get(HANDLE_ALIASES[stored]);
    if (aliased) return { site: aliased, score: 100, via: "handle-alias" };
  }
  if (stored && byHandle.has(stored)) {
    return { site: byHandle.get(stored), score: 100, via: "handle" };
  }

  let best = null;
  let bestScore = 0;
  for (const c of catalog) {
    const s = Math.max(
      matchScore(local.name, c.title),
      matchScore(local.specs?.spectraTitle || "", c.title),
      matchScore(local.specs?.baseTitle || "", c.title),
      matchScore(local.name, c.handle.replace(/-/g, " ")),
    );
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (best && bestScore >= MATCH_THRESHOLD) {
    return { site: best, score: bestScore, via: "name" };
  }
  return { site: null, score: bestScore, via: "none" };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");

  console.log(`Fetching Spectra catalogue from ${BASE}/collections/all …`);
  const catalog = await fetchAllSpectraProducts();
  const byHandle = new Map(catalog.map((p) => [p.handle, p]));
  console.log(`Site products: ${catalog.length}`);

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Spectra brand not found");

  const locals = await db
    .collection("products")
    .find({ brand: brand._id })
    .project({
      name: 1,
      price: 1,
      specs: 1,
      stock: 1,
      stockStatus: 1,
      isOutOfStock: 1,
    })
    .toArray();
  console.log(`Local Spectra products: ${locals.length}`);
  console.log(DRY_RUN ? "DRY_RUN=1 — no writes" : "Applying updates…");

  const report = {
    updated: 0,
    unchanged: 0,
    unmatched: [],
    changes: [],
  };

  for (const local of locals) {
    const { site, score, via } = resolveSiteProduct(local, catalog, byHandle);
    if (!site) {
      report.unmatched.push({
        name: local.name,
        handle: local.specs?.spectraHandle || "",
        score,
      });
      continue;
    }

    const localSize =
      normalizeSizeMm(local.specs?.size || local.specs?.Size || "") ||
      normalizeSizeMm(local.name);
    const variant = pickVariant(site, localSize);
    if (!variant) {
      report.unmatched.push({
        name: local.name,
        handle: site.handle,
        reason: "no-variant",
      });
      continue;
    }

    // Prefer the full list price (Shopify compare-at) when the site is on sale.
    // Never store the discounted sell price as our catalogue price.
    const salePrice = round2(Number(variant.price));
    const compareAtRaw = variant.compare_at_price
      ? round2(Number(variant.compare_at_price))
      : null;
    const compareAt =
      compareAtRaw != null && compareAtRaw > 0 ? compareAtRaw : null;
    const newPrice =
      compareAt != null && compareAt > salePrice ? compareAt : salePrice;
    const newSize =
      normalizeSizeMm(variant.option1 || variant.title) ||
      sizeFromProduct(site) ||
      localSize;

    if (!(newPrice > 0)) {
      report.unmatched.push({
        name: local.name,
        handle: site.handle,
        reason: "no-price",
      });
      continue;
    }

    const oldPrice = round2(Number(local.price) || 0);
    const oldSize = normalizeSizeMm(
      local.specs?.size || local.specs?.Size || "",
    );
    const priceChanged = oldPrice !== newPrice;
    const sizeChanged = Boolean(newSize) && oldSize !== newSize;

    const available = variant.available !== false;

    if (!priceChanged && !sizeChanged) {
      report.unchanged += 1;
    }

    const set = {
      price: newPrice,
      priceSyncedAt: new Date(),
      updatedAt: new Date(),
      "specs.spectraHandle": site.handle,
      "specs.spectraTitle": site.title,
      "specs.sourceUrl": `${BASE}/products/${site.handle}`,
      "specs.shopifyListPrice": newPrice,
      "specs.shopifySalePrice": salePrice,
      "specs.shopifyCompareAt": null,
      "specs.salePercent": null,
      "specs.shopifySalePercent":
        compareAt != null && compareAt > salePrice
          ? Math.round((1 - salePrice / compareAt) * 1000) / 10
          : null,
      "specs.shopifySku": variant.sku || "",
      "specs.shopifyVariantId": String(variant.id),
      "specs.sizeSource": "spectratileandhome.com",
      "specs.priceSource": "spectratileandhome.com/list-price",
    };

    if (newSize) {
      set["specs.size"] = newSize;
      set["specs.Size"] = newSize;
    }

    // Keep stock in sync with site availability when clearly out of stock
    if (!available) {
      set.stock = 0;
      set.isOutOfStock = true;
      set.stockStatus = "out_of_stock";
    }

    if (priceChanged || sizeChanged) {
      report.updated += 1;
      report.changes.push({
        name: local.name,
        handle: site.handle,
        via,
        score: Math.round(score),
        price: { from: oldPrice, to: newPrice },
        siteSalePrice: salePrice,
        siteListPrice: newPrice,
        size: { from: oldSize || null, to: newSize || null },
        available,
      });
    }

    if (!DRY_RUN) {
      await db.collection("products").updateOne(
        { _id: local._id, brand: brand._id },
        { $set: set },
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        siteProducts: catalog.length,
        localProducts: locals.length,
        updated: report.updated,
        unchanged: report.unchanged,
        unmatchedCount: report.unmatched.length,
        unmatched: report.unmatched,
        sampleChanges: report.changes.slice(0, 25),
        allChanges: report.changes,
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
