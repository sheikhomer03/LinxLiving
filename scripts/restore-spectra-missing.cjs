/**
 * Restore missing Spectra product/menu data from https://spectratileandhome.com/
 * - Missing / Shopify-only images → Cloudinary
 * - Missing / £0 prices → Shopify product JSON
 * - Thin/empty descriptions & basic specs
 * - Missing category menu images
 *
 * Only touches brand slug `spectra`. Never writes other brands.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/restore-spectra-missing.cjs
 *   DRY_RUN=1 CONCURRENCY=2
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

const BASE = "https://spectratileandhome.com";
const BRAND_SLUG = "spectra";
const CLOUDINARY_FOLDER = "linx-living/products/spectra";
const LOG = path.join(__dirname, "_tmp-spectra-restore.log");
const PROGRESS = path.join(__dirname, "_tmp-spectra-restore-progress.json");

const DRY_RUN = process.env.DRY_RUN === "1";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 6));
const MATCH_THRESHOLD = 55;
/** Force-retry products even if progress file marked them done. */
const FORCE = process.env.FORCE === "1";

/** Local name / handle → Spectra product handle (site spellings differ). */
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
  // note: site handle "plain-white" is Alaska White Gloss — do not alias Plain White
  "plaza white gloss": "plaza-white",
  "ananas blue onyx": "ananas-blue-onyx",
};

/** Menu slug → homepage collection handle (covers live on homepage, not collections.json). */
const MENU_COVER_HANDLES = {
  gloss: "glossy",
  "high-gloss": "high-gloss",
  matt: "matt",
  "matt-carving": "matt-carving-1",
  outdoor: "outdoor-tiles",
  "60-x-60": "600x600-tiles",
  "600x600": "600x600-tiles",
};

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function cleanText(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasCloudinary(images) {
  return (images || []).some(
    (u) => typeof u === "string" && /cloudinary\.com/i.test(u),
  );
}

function needsProductFix(p) {
  const priceMissing = !(Number(p.price) > 0);
  const imagesMissing = !hasCloudinary(p.images);
  const descMissing =
    !String(p.description || "").trim() ||
    String(p.description).trim().length < 40;
  const specsThin =
    !p.specs ||
    (!p.specs.spectraHandle && !p.specs.size && !p.specs.sku);
  return priceMissing || imagesMissing || descMissing || specsThin;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = String(imageUrl).split("?")[0];
  if (DRY_RUN) return clean;
  const result = await cloudinary.uploader.upload(clean, {
    folder: CLOUDINARY_FOLDER,
    public_id: String(publicId).slice(0, 180),
    overwrite: true,
    resource_type: "image",
  });
  return result.secure_url;
}

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/creama/g, "crema")
    .replace(/[^\w\s]/g, " ")
    .replace(
      /\b(glossy|gloss|high|matt|satin|carving|collection|non|rectified|thick|6mm|mm)\b/g,
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

async function fetchProductDetail(handle) {
  const data = await fetchJson(
    `${BASE}/products/${encodeURIComponent(handle)}.json`,
  );
  return data.product || null;
}

async function fetchAllCollections() {
  const out = [];
  let page = 1;
  while (page <= 10) {
    const data = await fetchJson(
      `${BASE}/collections.json?limit=250&page=${page}`,
    );
    const rows = data.collections || [];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < 250) break;
    page += 1;
  }
  return out;
}

function absUrl(u) {
  let s = String(u || "")
    .replace(/&amp;/g, "&")
    .trim();
  if (!s) return "";
  if (s.startsWith("//")) s = `https:${s}`;
  if (s.startsWith("/")) s = `${BASE}${s}`;
  return s;
}

/** Homepage "Six focused tile collections" cover images (collections.json has none). */
async function fetchHomepageCategoryCovers() {
  const res = await fetch(`${BASE}/`, {
    headers: { "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0" },
  });
  if (!res.ok) throw new Error(`homepage HTTP ${res.status}`);
  const html = await res.text();
  const blocks = [
    ...html.matchAll(
      /<a class="sp-category" href="(\/collections\/[^"]+)"([\s\S]*?)<\/a>/gi,
    ),
  ];
  const covers = new Map();
  const usedUrls = new Set();
  for (const block of blocks) {
    const handle = block[1].replace("/collections/", "");
    if (covers.has(handle)) continue;
    const body = block[2];
    const imgs = [...body.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi)].map(
      (im) => {
        const tag = im[0];
        return {
          url: absUrl(im[1]).split("&width=")[0],
          alt: tag.match(/alt="([^"]*)"/i)?.[1] || "",
          active: /is-active/i.test(tag),
        };
      },
    );
    const ordered = [
      ...imgs.filter((i) => i.active),
      ...imgs.filter((i) => !i.active),
    ];
    // Spectra reuses the same Calacatta file for Gloss + Matt — pick next unique slide
    const chosen =
      ordered.find((i) => i.url && !usedUrls.has(i.url)) || ordered[0];
    if (!chosen?.url) continue;
    usedUrls.add(chosen.url);
    covers.set(handle, {
      handle,
      label: chosen.alt || handle,
      url: chosen.url,
    });
  }
  return covers;
}

function resolveHandle(product, catalog, byHandle) {
  const nameKey = normalizeName(product.name);
  const stored = String(product.specs?.spectraHandle || "").trim();

  if (HANDLE_ALIASES[nameKey]) return HANDLE_ALIASES[nameKey];
  if (stored && HANDLE_ALIASES[stored]) return HANDLE_ALIASES[stored];

  // Prefer stored handle only if it still exists in the live catalogue
  if (stored && byHandle?.has(stored)) return stored;

  const name = product.name || "";
  let best = null;
  let bestScore = 0;
  for (const c of catalog) {
    const s = matchScore(name, c.title);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (best && bestScore >= MATCH_THRESHOLD) {
    return best.handle;
  }
  // Last resort: keep stored handle so we can still try Shopify CDN on the product doc
  return stored || "";
}

function existingShopifyImages(product) {
  return (product.images || [])
    .filter(
      (u) =>
        typeof u === "string" &&
        /cdn\.shopify\.com|spectratileandhome\.com\/cdn/i.test(u) &&
        !/cloudinary\.com/i.test(u),
    )
    .map(absUrl)
    .filter(Boolean);
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
  fs.writeFileSync(LOG, `Spectra restore ${new Date().toISOString()}\n`);
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (
    !DRY_RUN &&
    (!process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET)
  ) {
    throw new Error("Missing Cloudinary credentials");
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Spectra brand not found");

  log(`Loading Spectra catalogue from ${BASE}…`);
  const catalog = await fetchAllSpectraProducts();
  const byHandle = new Map(catalog.map((p) => [p.handle, p]));
  log(`Catalogue products: ${catalog.length}`);

  // Fix menus missing images (brand-scoped only) — prefer homepage covers
  const menus = await db
    .collection("menus")
    .find({ brand: brand._id })
    .toArray();
  const collections = await fetchAllCollections();
  const colByHandle = new Map(collections.map((c) => [c.handle, c]));
  let homepageCovers = new Map();
  try {
    homepageCovers = await fetchHomepageCategoryCovers();
    log(`Homepage category covers: ${homepageCovers.size}`);
    for (const [h, c] of homepageCovers) {
      log(`  cover ${h}: ${c.url}`);
    }
  } catch (e) {
    log(`Homepage cover scrape failed: ${e.message}`);
  }

  let menusFixed = 0;
  for (const menu of menus) {
    if (String(menu.image || "").trim() && /cloudinary\.com/i.test(menu.image))
      continue;

    const coverHandle =
      MENU_COVER_HANDLES[menu.slug] ||
      MENU_COVER_HANDLES[slugify(menu.name)] ||
      menu.slug;
    const homeCover =
      homepageCovers.get(coverHandle) ||
      [...homepageCovers.values()].find(
        (c) =>
          normalizeName(c.label) === normalizeName(menu.name) ||
          c.handle === menu.slug,
      );

    const col =
      colByHandle.get(coverHandle) ||
      colByHandle.get(menu.slug) ||
      collections.find(
        (c) =>
          slugify(c.title) === menu.slug ||
          normalizeName(c.title) === normalizeName(menu.name),
      );

    const src = homeCover?.url || col?.image?.src || "";
    if (!src) {
      log(`menu skip ${menu.slug}: no cover source`);
      continue;
    }
    try {
      const url = await uploadRemoteImage(src, `menu-${menu.slug}`);
      if (!DRY_RUN) {
        await db.collection("menus").updateOne(
          { _id: menu._id, brand: brand._id },
          { $set: { image: url, updatedAt: new Date() } },
        );
      }
      menusFixed += 1;
      log(`menu ok ${menu.slug} ← ${homeCover ? "homepage" : "collections.json"}`);
    } catch (e) {
      log(`menu fail ${menu.slug}: ${e.message}`);
    }
  }
  log(`Menus fixed: ${menusFixed}`);

  let products = await db
    .collection("products")
    .find({ brand: brand._id })
    .toArray();
  products = products.filter(needsProductFix);
  log(`Products needing restore: ${products.length}`);

  let done = new Set();
  if (!FORCE && fs.existsSync(PROGRESS)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []);
    } catch {
      /* ignore */
    }
  }
  if (FORCE) log("FORCE=1 — ignoring previous progress file");
  const saveProgress = () =>
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );

  const pending = products.filter((p) => !done.has(String(p._id)));
  let updated = 0;
  let failed = 0;
  let stillMissing = 0;

  await mapPool(pending, CONCURRENCY, async (p, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    try {
      const handle = resolveHandle(p, catalog, byHandle);
      let detail = handle ? byHandle.get(handle) : null;
      if (handle) {
        try {
          detail = (await fetchProductDetail(handle)) || detail;
        } catch {
          /* use lite / offline images */
        }
      }

      const set = { updatedAt: new Date() };
      const specs = { ...(p.specs || {}) };
      if (handle) {
        specs.spectraHandle = handle;
        specs.sourceUrl = `${BASE}/products/${handle}`;
      }

      if (detail) {
        specs.spectraTitle = detail.title;
        if (specs.matchScore == null) {
          specs.matchScore = matchScore(p.name, detail.title);
        }

        const variant = (detail.variants || [])[0] || {};
        const price = Number(variant.price);
        if (price > 0 && !(Number(p.price) > 0)) {
          set.price = price;
        }

        const desc = cleanText(detail.body_html || "");
        if (
          desc.length >= 40 &&
          (!String(p.description || "").trim() ||
            String(p.description).trim().length < 40)
        ) {
          set.description = desc.slice(0, 8000);
        }

        if (detail.product_type)
          specs.productType = cleanText(detail.product_type);
        if (detail.vendor) specs.vendor = cleanText(detail.vendor);
        if (variant.sku) specs.sku = cleanText(variant.sku);
        for (const opt of detail.options || []) {
          const key = cleanText(opt.name);
          const val = cleanText((opt.values || [])[0]);
          if (key && val && !specs[key]) specs[key] = val;
        }
      }

      if (!hasCloudinary(p.images)) {
        const fromDetail = (detail?.images || [])
          .map((img) => (typeof img === "string" ? img : img?.src))
          .filter(Boolean)
          .map(absUrl);
        const fromDoc = existingShopifyImages(p);
        const sources = [...new Set([...fromDetail, ...fromDoc])].slice(
          0,
          MAX_IMAGES,
        );
        const uploaded = [];
        const pidBase = slugify(handle || p.name || String(p._id));
        for (let i = 0; i < sources.length; i++) {
          try {
            const url = await uploadRemoteImage(
              sources[i],
              `fix-${pidBase}-${i + 1}`,
            );
            if (url) uploaded.push(url);
          } catch (e) {
            log(`${label} img fail: ${e.message}`);
          }
        }
        if (uploaded.length) set.images = uploaded;
      }

      set.specs = specs;

      const gotImages = Boolean(set.images?.length) || hasCloudinary(p.images);
      if (!handle && !gotImages && !set.price) {
        stillMissing += 1;
        log(`${label} NO MATCH ${String(p.name).slice(0, 60)}`);
        done.add(String(p._id));
        return;
      }

      if (DRY_RUN) {
        log(
          `${label} [dry] ${String(p.name).slice(0, 50)} handle=${handle || "-"} price=${set.price ?? "-"} imgs=${set.images?.length ?? "-"} detail=${detail ? "y" : "n"}`,
        );
      } else {
        await db.collection("products").updateOne(
          { _id: p._id, brand: brand._id },
          { $set: set },
        );
        log(
          `${label} ok ${String(p.name).slice(0, 50)} handle=${handle || "-"} price=${set.price ?? p.price} imgs=${set.images?.length ?? (p.images || []).length}${gotImages ? "" : " (still no images)"}`,
        );
      }

      if (!gotImages) stillMissing += 1;
      updated += 1;
      done.add(String(p._id));
      if (updated % 20 === 0) saveProgress();
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${e.message}`);
    }
  });

  saveProgress();
  log(
    `\nDone updated=${updated} failed=${failed} stillMissing=${stillMissing} menusFixed=${menusFixed}`,
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
