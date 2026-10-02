/**
 * Every product whose pictures are missing, broken, or not served from Shopify.
 *
 * The storefront renders `shopifyImages[].shopifyUrl` wherever a product has
 * been mirrored and falls back to the stored `images[]` URL otherwise — so any
 * gallery entry without a Shopify copy is loaded straight from Cloudinary or
 * the supplier's own site. This lists those products, plus the ones with no
 * picture at all, only a "no image" placeholder, or a URL that no longer loads.
 *
 * Read-only. Scans both catalogues (MONGODB_URI and MONGODB_URL2), drafts and
 * live alike, and writes only the products that have an issue.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-product-images.cjs
 *   --db=1|2|both        which catalogue (default both)
 *   --check-urls         also fetch every displayed URL to find broken ones
 *   --concurrency=64     parallel requests for --check-urls
 *   --per-host=24        parallel requests to any one host
 *   --brand=Spectra      only products whose brand name contains this
 *   --limit=500          cap products scanned per catalogue
 *
 * Issue codes:
 *   NO_IMAGES              nothing to show at all
 *   PLACEHOLDER_ONLY       only an SVG / no-image graphic
 *   NOT_ON_SHOPIFY         no gallery image is served from Shopify
 *   PARTLY_NOT_ON_SHOPIFY  some gallery images are, some are not
 *   PENDING_MIRROR         a shopifyImages entry has no shopifyUrl yet
 *   VARIANT_NOT_ON_SHOPIFY a variant's image is not served from Shopify
 *   BROKEN_COVER           the first displayed image does not load (--check-urls)
 *   BROKEN_IMAGE           another displayed image does not load (--check-urls)
 */
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p, quiet: true });
}

const arg = (name, fallback = "") =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=").slice(1).join("=") ||
  fallback;

const DB = arg("db", "both");
const CHECK_URLS = process.argv.includes("--check-urls");
const CONCURRENCY = Number(arg("concurrency", 64));
const PER_HOST = Number(arg("per-host", 24));
const BRAND_FILTER = arg("brand").toLowerCase();
const LIMIT = Number(arg("limit", 0));

const STAMP = new Date().toISOString().slice(0, 10);
const OUT_DIR = path.join(__dirname, "..", "image-audit");
const CACHE_FILE = path.join(OUT_DIR, "url-status-cache.json");

const SHOPIFY_HOST = /(^|\.)cdn\.shopify\.com$|\.myshopify\.com$/i;
const VIDEO = /\/video\/upload\/|\.(mp4|webm|mov|m4v|avi)(\?|$)|^youtube:|^vimeo:|youtube\.com|youtu\.be|vimeo\.com/i;
// Same rule as src/lib/pricedOnly.ts.
const PLACEHOLDER = /\.svg($|\?)|\/no[-_]?image[^/]*$/i;

const say = (s = "") => process.stdout.write(`${s}\n`);
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const isBlank = (v) => !v || v === "-" || /^(null|undefined)$/i.test(v);

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const isShopify = (url) => SHOPIFY_HOST.test(hostOf(url));

function hostLabel(url) {
  const h = hostOf(url);
  if (!h) return url.startsWith("/") ? "local-path" : "invalid-url";
  if (/cloudinary\.com$/.test(h)) return "cloudinary";
  return h;
}

/** Mirrors resolveGalleryImages in src/lib/productImage.ts, minus videos. */
function resolveGallery(images, pairs) {
  const stored = (images || []).map(clean).filter((s) => !isBlank(s));
  const mirrored = (pairs || [])
    .filter((p) => clean(p?.shopifyUrl))
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));

  const out = [];
  const claimed = new Set();
  for (const p of mirrored) {
    out.push(clean(p.shopifyUrl));
    if (clean(p.sourceUrl)) claimed.add(clean(p.sourceUrl));
  }
  for (const src of stored) {
    if (claimed.has(src) || out.includes(src)) continue;
    out.push(src);
  }
  return out.filter((u) => !VIDEO.test(u));
}

/** Stored URL → Shopify copy, across the product and all its variants. */
function shopifyMap(product) {
  const map = new Map();
  const add = (pairs) => {
    for (const p of pairs || []) {
      const shop = clean(p?.shopifyUrl);
      if (!shop) continue;
      map.set(clean(p?.sourceUrl) || shop, shop);
      map.set(shop, shop);
    }
  };
  add(product.shopifyImages);
  for (const v of product.variants || []) {
    add(v.shopifyImages);
    if (clean(v.imageUrl) && clean(v.shopifyImageUrl)) {
      map.set(clean(v.imageUrl), clean(v.shopifyImageUrl));
    }
  }
  return map;
}

function classify(product) {
  const issues = [];
  const gallery = resolveGallery(product.images, product.shopifyImages);
  const real = gallery.filter((u) => !PLACEHOLDER.test(u));
  const external = real.filter((u) => !isShopify(u));
  const shopifyCount = real.length - external.length;

  if (!gallery.length) issues.push("NO_IMAGES");
  else if (!real.length) issues.push("PLACEHOLDER_ONLY");
  else if (external.length && !shopifyCount) issues.push("NOT_ON_SHOPIFY");
  else if (external.length) issues.push("PARTLY_NOT_ON_SHOPIFY");

  const pending = (product.shopifyImages || []).filter(
    (p) => clean(p?.sourceUrl) && !clean(p?.shopifyUrl),
  ).length;
  if (pending) issues.push("PENDING_MIRROR");

  const map = shopifyMap(product);
  const variantExternal = [];
  for (const v of product.variants || []) {
    const urls = [
      clean(v.shopifyImageUrl) || clean(v.imageUrl),
      ...resolveGallery(v.images, v.shopifyImages),
    ].filter((u) => u && !isBlank(u) && !VIDEO.test(u) && !PLACEHOLDER.test(u));
    for (const u of urls) {
      const shown = map.get(u) || u;
      if (!isShopify(shown)) variantExternal.push(shown);
    }
  }
  const variantExternalUnique = [...new Set(variantExternal)];
  if (variantExternalUnique.length) issues.push("VARIANT_NOT_ON_SHOPIFY");

  return {
    issues,
    displayed: real,
    external,
    shopifyCount,
    pending,
    variantExternal: variantExternalUnique,
  };
}

function brandNames(brandField, brandById) {
  const ids = Array.isArray(brandField) ? brandField : brandField ? [brandField] : [];
  return ids
    .map((id) => brandById.get(String(id)) || (typeof id === "string" ? id : ""))
    .filter(Boolean)
    .join(" | ");
}

/**
 * Brand names from every catalogue: DB2 products point at brand ids that only
 * exist in DB1's `brands`, so one catalogue's collection is not enough.
 */
async function loadBrands(uris) {
  const brandById = new Map();
  for (const uri of uris) {
    if (!uri) continue;
    const conn = await connectMongo(uri);
    const brands = await conn.db.collection("brands").find({}).project({ name: 1 }).toArray();
    for (const b of brands) brandById.set(String(b._id), b.name);
    await mongoose.disconnect();
  }
  return brandById;
}

async function scanCatalogue(label, uri, brandById) {
  if (!uri) {
    say(`[${label}] no connection string set — skipped`);
    return null;
  }
  const conn = await connectMongo(uri);
  const db = conn.db;

  const total = await db.collection("products").estimatedDocumentCount();
  say(`\n[${label}] ${db.databaseName} — ${total} products`);

  const cursor = db
    .collection("products")
    .find({})
    .project({
      name: 1,
      sku: 1,
      linxSku: 1,
      brand: 1,
      category: 1,
      price: 1,
      shopifyProductId: 1,
      shopifyHandle: 1,
      images: 1,
      shopifyImages: 1,
      "variants.imageUrl": 1,
      "variants.shopifyImageUrl": 1,
      "variants.images": 1,
      "variants.shopifyImages": 1,
    })
    .batchSize(2000);

  const rows = [];
  let scanned = 0;
  const started = Date.now();
  for await (const p of cursor) {
    const brand = brandNames(p.brand, brandById);
    if (BRAND_FILTER && !brand.toLowerCase().includes(BRAND_FILTER)) continue;
    scanned++;
    if (LIMIT && scanned > LIMIT) break;
    if (scanned % 5000 === 0) say(`  scanned ${scanned}/${total}…`);

    const r = classify(p);
    rows.push({
      db: label,
      id: String(p._id),
      name: p.name || "",
      sku: p.linxSku || p.sku || "",
      brand,
      category: p.category || "",
      draft: !clean(p.category),
      price: p.price ?? "",
      onShopify: Boolean(p.shopifyProductId),
      shopifyHandle: p.shopifyHandle || "",
      ...r,
    });
  }
  say(`  scanned ${Math.min(scanned, LIMIT || scanned)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  await mongoose.disconnect();
  return rows;
}

// ---------- URL checking ----------

function loadCache() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))));
  } catch {
    return new Map();
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)));
}

async function probeOnce(url) {
  const opts = { redirect: "follow", signal: AbortSignal.timeout(10_000) };
  let res = await fetch(url, { ...opts, method: "HEAD" });
  // Plenty of CDNs refuse or mis-answer HEAD; a one-byte GET settles it.
  if (!res.ok) {
    res = await fetch(url, { ...opts, method: "GET", headers: { Range: "bytes=0-0" } });
  }
  res.body?.cancel?.().catch(() => {});
  if (!res.ok) return `HTTP ${res.status}`;
  const type = res.headers.get("content-type") || "";
  if (type && !/^image\/|octet-stream/i.test(type)) return `type ${type.split(";")[0]}`;
  return "ok";
}

async function probe(url) {
  if (!/^https?:\/\//i.test(url)) return "invalid-url";
  for (let attempt = 0; ; attempt++) {
    try {
      const status = await probeOnce(url);
      // Retry only what might be transient.
      if (attempt === 0 && /HTTP (429|5\d\d)/.test(status)) continue;
      return status;
    } catch (e) {
      if (attempt === 0) continue;
      return String(e.cause?.code || e.name || e.message).slice(0, 40);
    }
  }
}

async function checkUrls(urls, cache) {
  const todo = urls.filter((u) => !cache.has(u));
  say(`\nChecking ${todo.length} URLs (${urls.length - todo.length} cached)…`);
  if (!todo.length) return;

  // Group by host so one slow supplier cannot hog every slot.
  const byHost = new Map();
  for (const u of todo) {
    const h = hostOf(u);
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(u);
  }
  const active = new Map();
  let done = 0;
  let broken = 0;
  const started = Date.now();

  const next = () => {
    for (const [h, list] of byHost) {
      if (!list.length) {
        byHost.delete(h);
        continue;
      }
      if ((active.get(h) || 0) < PER_HOST) return [h, list.shift()];
    }
    return null;
  };

  await new Promise((resolve) => {
    let running = 0;
    const pump = () => {
      while (running < CONCURRENCY) {
        const job = next();
        if (!job) break;
        const [h, url] = job;
        running++;
        active.set(h, (active.get(h) || 0) + 1);
        probe(url).then((status) => {
          cache.set(url, status);
          if (status !== "ok") broken++;
          running--;
          active.set(h, active.get(h) - 1);
          if (++done % 1000 === 0) {
            const rate = done / ((Date.now() - started) / 1000);
            say(`  ${done}/${todo.length}  broken ${broken}  ${rate.toFixed(0)}/s`);
            saveCache(cache);
          }
          pump();
        });
      }
      if (!running && !byHost.size) resolve();
    };
    pump();
  });
  saveCache(cache);
  say(`  done: ${done} checked, ${broken} not loading`);
}

// ---------- output ----------

function csvCell(v) {
  const s = Array.isArray(v) ? v.join(" ; ") : String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeOutputs(rows) {
  const flagged = rows.filter((r) => r.issues.length);
  const cols = [
    "db",
    "id",
    "name",
    "sku",
    "brand",
    "category",
    "draft",
    "onShopify",
    "issues",
    "displayedImages",
    "shopifyImages",
    "externalImages",
    "externalHosts",
    "pendingMirror",
    "variantExternalImages",
    "brokenImages",
    "exampleExternalUrl",
    "brokenUrls",
  ];
  const lines = [cols.join(",")];
  for (const r of flagged) {
    lines.push(
      [
        r.db,
        r.id,
        r.name,
        r.sku,
        r.brand,
        r.category,
        r.draft,
        r.onShopify,
        r.issues,
        r.displayed.length,
        r.shopifyCount,
        r.external.length,
        [...new Set(r.external.concat(r.variantExternal).map(hostLabel))],
        r.pending,
        r.variantExternal.length,
        (r.broken || []).length,
        r.external[0] || r.variantExternal[0] || "",
        (r.broken || []).map((b) => `${b.status} ${b.url}`),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const base = path.join(OUT_DIR, `image-issues-${STAMP}`);
  fs.writeFileSync(`${base}.csv`, lines.join("\n"));
  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify(
      flagged.map((r) => ({
        db: r.db,
        id: r.id,
        name: r.name,
        sku: r.sku,
        brand: r.brand,
        category: r.category,
        draft: r.draft,
        onShopify: r.onShopify,
        shopifyHandle: r.shopifyHandle,
        issues: r.issues,
        externalImages: r.external,
        variantExternalImages: r.variantExternal,
        pendingMirror: r.pending,
        brokenImages: r.broken || [],
      })),
      null,
      1,
    ),
  );
  return { flagged, base };
}

function summarise(rows, flagged) {
  const byDb = new Map();
  for (const r of rows) byDb.set(r.db, (byDb.get(r.db) || 0) + 1);

  say("\n=== Summary ===");
  for (const [db, n] of byDb) {
    const f = flagged.filter((r) => r.db === db);
    say(`\n[${db}] ${n} products scanned, ${f.length} with an issue`);
    const counts = new Map();
    for (const r of f) for (const i of r.issues) counts.set(i, (counts.get(i) || 0) + 1);
    for (const [i, c] of [...counts].sort((a, b) => b[1] - a[1])) {
      const drafts = f.filter((r) => r.issues.includes(i) && r.draft).length;
      say(`  ${i.padEnd(24)} ${String(c).padStart(6)}   (${drafts} draft)`);
    }
  }

  const hosts = new Map();
  for (const r of flagged) {
    for (const h of new Set(r.external.concat(r.variantExternal).map(hostLabel))) {
      hosts.set(h, (hosts.get(h) || 0) + 1);
    }
  }
  if (hosts.size) {
    say("\nProducts loading images from outside Shopify, by host:");
    for (const [h, c] of [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      say(`  ${h.padEnd(40)} ${c}`);
    }
  }

  const brands = new Map();
  for (const r of flagged) brands.set(r.brand || "(no brand)", (brands.get(r.brand || "(no brand)") || 0) + 1);
  say("\nTop brands with issues:");
  for (const [b, c] of [...brands].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    say(`  ${b.slice(0, 40).padEnd(40)} ${c}`);
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const targets = [];
  if (DB === "1" || DB === "both") targets.push(["DB1", process.env.MONGODB_URI]);
  if (DB === "2" || DB === "both") targets.push(["DB2", process.env.MONGODB_URL2]);

  const brandById = await loadBrands([process.env.MONGODB_URI, process.env.MONGODB_URL2]);
  const rows = [];
  for (const [label, uri] of targets) {
    rows.push(...((await scanCatalogue(label, uri, brandById)) || []));
  }

  if (CHECK_URLS) {
    const cache = loadCache();
    const urls = new Set();
    for (const r of rows) for (const u of r.displayed.concat(r.variantExternal)) urls.add(u);
    await checkUrls([...urls], cache);
    for (const r of rows) {
      const broken = [];
      r.displayed.concat(r.variantExternal).forEach((u, i) => {
        const status = cache.get(u);
        if (status && status !== "ok") broken.push({ url: u, status, cover: i === 0 });
      });
      if (!broken.length) continue;
      r.broken = broken;
      if (broken.some((b) => b.cover)) r.issues.push("BROKEN_COVER");
      if (broken.some((b) => !b.cover)) r.issues.push("BROKEN_IMAGE");
    }
  }

  const { flagged, base } = writeOutputs(rows);
  summarise(rows, flagged);
  say(`\nWrote ${flagged.length} products to:\n  ${base}.csv\n  ${base}.json`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
