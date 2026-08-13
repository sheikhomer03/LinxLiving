/**
 * Re-scrape Flooring Sales products from the live PDP sources:
 * - WooCommerce Store API → price, images, attributes, categories, brand,
 *                           stock, rating, short/long description
 * - PDP HTML              → spec sheets / guides linked on the page
 *
 * Prices are the supplier's ex-VAT figures (specs.pricesExcludeVat), matching
 * how this brand is already stored; there is no uplift to preserve.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/enrich-flooring-sales-products.cjs
 *   RESUME=1 CONCURRENCY=6 LIMIT=50 DRY_RUN=1 SKIP_IMAGES=1
 *   FSL_ONLY_SLUG=classic-clm5801-sandy-oak-1-6
 *
 * A trade login IS required: prices and the measurement price calculator are
 * only rendered for logged-in accounts. Set FSL_USERNAME / FSL_PASSWORD in the
 * environment — never in the source.
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
const { createSession } = require("./fsl-session.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BASE = "https://www.flooringsales.co.uk";
const STORE_API = `${BASE}/wp-json/wc/store/v1/products`;
const BRAND_SLUG = "flooring-sales";
const CLOUDINARY_FOLDER = "linx-living/products/flooring-sales";
const PUBLIC_DIR = path.join(__dirname, "..", "public", "flooring-sales");
const LOG = path.join(__dirname, "_tmp-fsl-enrich.log");
/** Bump when the scrape starts capturing a new PDP block. */
const PARITY_VERSION = 2;

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const FORCE = process.env.FORCE === "1";
const RESUME = !FORCE && process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 5));
const ONLY_SLUG = String(process.env.FSL_ONLY_SLUG || "").trim();
const REQUEST_GAP_MS = Math.max(0, Number(process.env.REQUEST_GAP_MS || 150));
const MAX_RETRIES = Math.max(1, Number(process.env.MAX_RETRIES || 5));

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxFslEnrich/1.0";

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, init = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(Number(process.env.FSL_TIMEOUT_MS || 45000)),
        ...init,
        headers: { "User-Agent": UA, ...(init.headers || {}) },
      });
      if (res.status === 429 || res.status === 503) {
        await delay(1200 * attempt * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (/HTTP 404/.test(String(e.message))) throw e;
      if (attempt >= MAX_RETRIES) break;
      await delay(500 * attempt * attempt);
    }
  }
  throw lastErr || new Error(`Failed ${url}`);
}

const decode = (s) =>
  String(s || "")
    .replace(/&#8217;|&#039;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&times;/g, "×")
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "£")
    .replace(/&nbsp;/g, " ")
    .trim();

const stripTags = (s) =>
  decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildReuseMap(product) {
  const map = new Map();
  for (const url of product.images || []) {
    const s = String(url || "");
    if (!/res\.cloudinary\.com/i.test(s)) continue;
    const id = s.split("/").pop().replace(/\.[a-z0-9]+$/i, "");
    if (id && !map.has(id)) map.set(id, s);
  }
  return map;
}

async function uploadRemoteImage(imageUrl, publicId, reuse) {
  const clean = String(imageUrl || "").split("?")[0];
  if (!clean) return "";
  if (SKIP_IMAGES || DRY_RUN) return clean;
  if (!FORCE && reuse) {
    const hit = reuse.get(String(publicId).slice(0, 180));
    if (hit) return hit;
  }
  try {
    const result = await cloudinary.uploader.upload(clean, {
      folder: CLOUDINARY_FOLDER,
      public_id: String(publicId).slice(0, 180),
      overwrite: FORCE,
      invalidate: FORCE,
      resource_type: "image",
    });
    return result.secure_url || clean;
  } catch {
    return clean;
  }
}

async function downloadFileToPublic(fileUrl, slug, fileName) {
  const clean = String(fileUrl || "").split("?")[0];
  if (!clean) return "";
  const ext = path.extname(clean).toLowerCase() || ".pdf";
  const base = slugify(path.parse(fileName || path.basename(clean)).name) || "file";
  const dir = path.join(PUBLIC_DIR, "downloads", slugify(slug) || "misc");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${base}${ext}`);
  const publicPath = `/flooring-sales/downloads/${slugify(slug) || "misc"}/${base}${ext}`;
  if (DRY_RUN) return publicPath;
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0 && !FORCE) return publicPath;
  try {
    const res = await fetchWithRetry(clean);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return publicPath;
  } catch (e) {
    log(`file download fail ${clean}: ${e.message}`);
    return "";
  }
}

/** Spec sheets and guides linked on the PDP. */
function extractDocs(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(
    /<a[^>]+href="([^"]+\.(?:pdf|docx?|zip))"[^>]*>([\s\S]{0,140}?)<\/a>/gi,
  )) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, name: stripTags(m[2]) || path.basename(href) });
  }
  // Bare links (some sit inside buttons without anchor text)
  for (const m of String(html || "").matchAll(
    /https?:\/\/[^"'\s>]+\.pdf/gi,
  )) {
    const href = m[0];
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, name: path.basename(href) });
  }
  return out;
}

/**
 * The trade-only buy box: a WooCommerce Measurement Price Calculator —
 * enter an area, it rounds up to whole packs and prices them.
 */
function extractCalculator(html) {
  const table = String(html || "").match(
    /<table[^>]*id="price_calculator"[^>]*class="([^"]*)"[\s\S]*?<\/table>/i,
  );
  if (!table) return [];
  const block = table[0];
  const label = (re) => stripTags((block.match(re) || [])[1] || "");
  const areaInput = block.match(/name="area_needed"[^>]*data-unit="([^"]*)"/i);
  const actual = block.match(
    /id="area_actual"[^>]*data-unit="([^"]*)"[^>]*>([\s\S]{0,40}?)<\/span>/i,
  );
  const packsLabel = stripTags(
    (String(html).match(/id="pack_qty"[^>]*>\s*<h4[^>]*>([\s\S]{0,60}?)<\/h4>/i) || [])[1] || "",
  );

  const fields = [
    {
      id: "area_needed",
      type: "number",
      label: label(/<label[^>]*for="area_needed"[^>]*>([\s\S]{0,80}?)<\/label>/i),
      required: true,
      unit: areaInput ? areaInput[1] : "",
      options: [],
    },
    {
      id: "area_actual",
      type: "calculation",
      label: label(/class="price-table-row total-amount"[^>]*>\s*<td>([\s\S]{0,80}?)<\/td>/i),
      required: false,
      unit: actual ? actual[1] : "",
      defaultValue: actual ? stripTags(actual[2]) : "",
      options: [],
    },
    {
      id: "total_price",
      type: "calculation",
      label: label(/class="price-table-row calculated-price"[^>]*>\s*<td>([\s\S]{0,80}?)<\/td>/i),
      required: false,
      options: [],
    },
  ].filter((f) => f.label);

  if (packsLabel) {
    fields.push({ id: "quantity", type: "number", label: packsLabel, required: false, options: [] });
  }
  if (!fields.length) return [];
  return [
    {
      id: "price_calculator",
      heading: "",
      mode: /quantity-based-mode/.test(table[1]) ? "quantity-based" : "area-based",
      fields,
    },
  ];
}

/** "Explore more" / "Related products" handles shown under the PDP. */
function extractRelatedSlugs(html, selfSlug) {
  const out = [];
  const seen = new Set([selfSlug]);
  for (const m of String(html || "").matchAll(
    /href="https:\/\/www\.flooringsales\.co\.uk\/product\/([^/"?#]+)\/?"/gi,
  )) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out.slice(0, 24);
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx], idx);
      }
    }),
  );
}

const slugFromUrl = (url) =>
  (String(url || "").match(/\/product\/([^/?#]+)/) || [])[1] || "";

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  fs.appendFileSync(LOG, `\nFSL enrich ${new Date().toISOString()}\n`);
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Flooring sales brand not found");

  // Prices and the calculator only render for a logged-in trade account.
  const session = createSession();
  const signedIn = await session.login(
    process.env.FSL_USERNAME,
    process.env.FSL_PASSWORD,
  );
  log(`trade login: ${signedIn ? "ok" : "FAILED — prices/calculator will be hidden"}`);

  /**
   * WordPress can clear the session cookie on any response, which would
   * silently drop prices and the calculator for every product after it.
   * Re-authenticate on demand, one worker at a time.
   */
  let relogin = null;
  async function ensureSession() {
    if (session.isLoggedIn()) return;
    if (!relogin) {
      relogin = session
        .login(process.env.FSL_USERNAME, process.env.FSL_PASSWORD)
        .then((ok) => {
          log(`re-authenticated: ${ok ? "ok" : "FAILED"}`);
          relogin = null;
          return ok;
        })
        .catch((e) => {
          relogin = null;
          log(`re-auth error: ${e.message}`);
          return false;
        });
    }
    await relogin;
  }

  const filter = {
    brand: brand._id,
    ...(RESUME && !ONLY_SLUG
      ? {
          $or: [
            { "specs.parityVersion": { $exists: false } },
            { "specs.parityVersion": { $lt: PARITY_VERSION } },
          ],
        }
      : {}),
  };
  let products = await db.collection("products").find(filter).toArray();
  if (ONLY_SLUG) {
    products = products.filter(
      (p) =>
        p.specs?.fslSlug === ONLY_SLUG ||
        slugFromUrl(p.specs?.sourceUrl) === ONLY_SLUG,
    );
  }
  if (LIMIT > 0) products = products.slice(0, LIMIT);
  log(`Enriching ${products.length} Flooring Sales products concurrency=${CONCURRENCY}`);

  let ok = 0;
  let fail = 0;
  const CHUNK = Math.max(1, Number(process.env.CHUNK || 25));
  let pending = [];

  /** The supplier throttles hard, so never hold a Mongo socket while waiting. */
  async function flush() {
    if (!pending.length || DRY_RUN) {
      pending = [];
      return;
    }
    await connectMongo(process.env.MONGODB_URI);
    const col = mongoose.connection.db.collection("products");
    await col.bulkWrite(
      pending.map((u) => ({
        updateOne: { filter: { _id: u._id }, update: { $set: u.$set } },
      })),
      { ordered: false },
    );
    await mongoose.disconnect();
    log(`  wrote ${pending.length} (${ok}/${products.length} done)`);
    pending = [];
  }

  await mongoose.disconnect();

  await mapPool(products, CONCURRENCY, async (product, idx) => {
    const label = `[${idx + 1}/${products.length}]`;
    let slug = product.specs?.fslSlug || slugFromUrl(product.specs?.sourceUrl);
    if (!slug) {
      log(`${label} skip — no slug: ${product.name}`);
      return;
    }
    const reuse = buildReuseMap(product);
    try {
      let rows = await fetchWithRetry(
        `${STORE_API}?slug=${encodeURIComponent(slug)}`,
        { headers: { Accept: "application/json" } },
      ).then((r) => r.json());
      let api = Array.isArray(rows) ? rows[0] : null;

      // Renamed products keep a 301 from the old URL.
      if (!api) {
        const hop = await fetch(`${BASE}/product/${slug}/`, {
          headers: { "User-Agent": UA },
          redirect: "manual",
        });
        const moved = slugFromUrl(hop.headers.get("location") || "");
        if (moved && moved !== slug) {
          log(`${label} slug moved: ${slug} → ${moved}`);
          slug = moved;
          rows = await fetchWithRetry(
            `${STORE_API}?slug=${encodeURIComponent(slug)}`,
            { headers: { Accept: "application/json" } },
          ).then((r) => r.json());
          api = Array.isArray(rows) ? rows[0] : null;
        }
      }
      if (!api) throw new Error("not found in Store API");
      await delay(REQUEST_GAP_MS);

      // A logged-out page silently omits prices and the calculator, and the
      // cookie can look valid while the server has dropped it — so verify the
      // response and fetch again after re-authenticating.
      await ensureSession();
      let html = await session.get(`/product/${slug}/`).then((r) => r.text());
      if (/Login for price/i.test(html)) {
        await session
          .login(process.env.FSL_USERNAME, process.env.FSL_PASSWORD)
          .catch(() => false);
        html = await session.get(`/product/${slug}/`).then((r) => r.text());
      }

      const gallery = [];
      for (const [i, img] of (api.images || []).entries()) {
        const src = img.src || img.thumbnail;
        if (!src) continue;
        gallery.push(await uploadRemoteImage(src, `${slug}-${i + 1}`, reuse));
      }

      const attributes = [];
      for (const a of api.attributes || []) {
        const value = (a.terms || []).map((t) => decode(t.name)).join(", ");
        if (!a.name || !value) continue;
        attributes.push({ label: decode(a.name), value, key: a.taxonomy || "" });
      }

      // Files linked in the description count too, not just the page chrome.
      const fileSources = `${html}
${api.description || ""}
${api.short_description || ""}`;
      const docs = [];
      for (const f of extractDocs(fileSources).slice(0, 12)) {
        const local = await downloadFileToPublic(f.href, slug, f.name);
        if (local) {
          docs.push({ title: f.name || "Datasheet", url: local, type: "pdf" });
        }
      }

      const relatedSlugs = extractRelatedSlugs(html, slug);
      const addonGroups = extractCalculator(html);

      // Supplier prices are ex-VAT for this brand; sales use
      // raise-was-keep-price, so the selling price tracks the supplier.
      const price = Number(api.prices?.price || 0) / 100 || product.price;
      const regular = Number(api.prices?.regular_price || 0) / 100 || null;

      const reviewSummary = {
        rating: Number(api.average_rating) || null,
        count: Number(api.review_count) || 0,
        source: "flooringsales.co.uk",
      };

      const specs = {
        ...(product.specs || {}),
        fslId: api.id,
        fslSlug: slug,
        fslSku: decode(api.sku) || product.specs?.fslSku || "",
        sourceUrl: `${BASE}/product/${slug}/`,
        fslType: api.type || "",
        categories: (api.categories || []).map((c) => decode(c.name)),
        manufacturerBrand:
          decode((api.brands || [])[0]?.name || "") ||
          product.specs?.manufacturerBrand ||
          "",
        tags: (api.tags || []).map((t) => decode(t.name)).slice(0, 40),
        stockAvailability: decode(api.stock_availability?.text || ""),
        inStock: api.is_in_stock !== false,
        onSale: Boolean(api.on_sale),
        regularPrice: regular,
        weight: decode(api.formatted_weight || ""),
        formattedDimensions: decode(api.formatted_dimensions || ""),
        relatedSlugs,
        pricesExcludeVat: true,
        enrichedAt: new Date().toISOString(),
        parityVersion: PARITY_VERSION,
      };

      const $set = {
        name: decode(api.name) || product.name,
        description: String(api.description || product.description || "").trim(),
        shortDescription: String(api.short_description || "").trim(),
        price,
        tradePrice: price,
        images: gallery.length ? gallery : product.images,
        attributes,
        addonGroups,
        reviewSummary,
        stock: api.is_in_stock === false ? 0 : Math.max(Number(product.stock) || 0, 10),
        stockStatus: api.is_in_stock === false ? "out_of_stock" : "in_stock",
        isOutOfStock: api.is_in_stock === false,
        stockAvailabilityText: specs.stockAvailability,
        specs,
        showSpecs: true,
        updatedAt: new Date(),
      };
      if (docs.length) $set.downloads = docs;
      if (api.dimensions && (api.dimensions.length || api.dimensions.width)) {
        $set.dimensions = {
          length: String(api.dimensions.length || ""),
          width: String(api.dimensions.width || ""),
          height: String(api.dimensions.height || ""),
        };
      }

      log(
        `${label} ${DRY_RUN ? "[dry] " : ""}${$set.name.slice(0, 44)} £${price} imgs=${gallery.length} attrs=${attributes.length} docs=${docs.length} calc=${addonGroups.reduce((n, g) => n + g.fields.length, 0)} related=${relatedSlugs.length} rating=${reviewSummary.rating || "-"}(${reviewSummary.count})`,
      );

      ok++;
      pending.push({ _id: product._id, $set });
      if (pending.length >= CHUNK) await flush();
    } catch (e) {
      fail++;
      log(`${label} ✗ ${slug}: ${e.name === "TimeoutError" ? "timeout" : e.message}`);
    }
  });

  await flush();
  log(`Done. ok=${ok} fail=${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
