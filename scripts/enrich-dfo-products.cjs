/**
 * Re-scrape Direct Flooring Online products from the live PDP sources:
 * - WooCommerce Store API  → price, images, attributes, categories, brand,
 *                            stock, rating, short/long description
 * - PDP HTML               → the m² calculator (PEWC add-on groups) and any
 *                            spec sheets linked on the page
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/enrich-dfo-products.cjs
 *   RESUME=1 CONCURRENCY=4 LIMIT=50 DRY_RUN=1 SKIP_IMAGES=1
 *   DFO_ONLY_SLUG=alsa-allure-464-jasmine-oak-plank-laminate-flooring
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

const BASE = "https://directflooringonline.co.uk";
const STORE_API = `${BASE}/wp-json/wc/store/v1/products`;
const BRAND_SLUG = "direct-flooring-online";
const CLOUDINARY_FOLDER = "linx-living/products/direct-flooring-online";
const PUBLIC_DIR = path.join(__dirname, "..", "public", "direct-flooring-online");
const LOG = path.join(__dirname, "_tmp-dfo-enrich.log");
/** Bump when the scrape starts capturing a new PDP block. */
const PARITY_VERSION = 1;

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const FORCE = process.env.FORCE === "1";
const RESUME = !FORCE && process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 4));
const ONLY_SLUG = String(process.env.DFO_ONLY_SLUG || "").trim();
const REQUEST_GAP_MS = Math.max(0, Number(process.env.REQUEST_GAP_MS || 150));
const MAX_RETRIES = Math.max(1, Number(process.env.MAX_RETRIES || 5));

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxDfoEnrich/1.0";

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
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "£")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;|&ndash;/g, "–")
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
  const publicPath = `/direct-flooring-online/downloads/${slugify(slug) || "misc"}/${base}${ext}`;
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

const attr = (tag, name) =>
  (tag.match(new RegExp(`${name}="([^"]*)"`, "i")) || [])[1] || "";

/**
 * The PDP add-on form (Product Extras for WooCommerce): the m² calculator and
 * any option groups, captured in render order with their conditions.
 */
function extractAddonGroups(html) {
  const out = [];
  const groups = [];
  const re = /<div id="pewc-group-(\d+)"([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    groups.push({ id: m[1], tag: m[0], index: m.index });
  }
  for (const [i, g] of groups.entries()) {
    const end = i + 1 < groups.length ? groups[i + 1].index : html.length;
    const body = html.slice(g.index, end);
    const heading = stripTags(
      body.match(/class="pewc-group-heading"[^>]*>([\s\S]{0,160}?)<\/h3>/i)?.[1] || "",
    );
    const fields = [];
    for (const f of body.matchAll(/<li[^>]*class="pewc-item[^"]*"[^>]*>/gi)) {
      const tag = f[0];
      const label = decode(attr(tag, "data-field-label"));
      const type = attr(tag, "data-field-type");
      if (!label && !type) continue;
      const chunk = body.slice(f.index, f.index + 4000);
      const options = [
        ...new Set(
          [...chunk.matchAll(/data-option-label="([^"]*)"/gi)].map((o) => decode(o[1])),
        ),
      ].filter(Boolean);
      fields.push({
        id: attr(tag, "data-field-id"),
        type,
        label,
        required: /required-field/.test(tag),
        price: Number(attr(tag, "data-field-price")) || 0,
        defaultValue: decode(attr(tag, "data-default-value")),
        triggers: attr(tag, "data-trigger-calculations") || "",
        options,
      });
    }
    if (!heading && !fields.length) continue;
    out.push({
      id: g.id,
      heading,
      conditionAction: attr(g.tag, "data-condition-action"),
      conditionMatch: attr(g.tag, "data-condition-match"),
      conditions: attr(g.tag, "data-conditions") || "[]",
      fields,
    });
  }
  return out;
}

function extractSpecFiles(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(
    /<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]{0,140}?)<\/a>/gi,
  )) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, name: stripTags(m[2]) || path.basename(href) });
  }
  return out;
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

function slugFromUrl(url) {
  const m = String(url || "").match(/\/product\/([^/?#]+)/);
  return m ? m[1] : "";
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  fs.appendFileSync(LOG, `\nDFO enrich ${new Date().toISOString()}\n`);
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Direct Flooring Online brand not found");

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
      (p) => slugFromUrl(p.specs?.sourceUrl) === ONLY_SLUG,
    );
  }
  if (LIMIT > 0) products = products.slice(0, LIMIT);
  log(`Enriching ${products.length} DFO products concurrency=${CONCURRENCY}`);

  let ok = 0;
  let fail = 0;

  await mapPool(products, CONCURRENCY, async (product, idx) => {
    const label = `[${idx + 1}/${products.length}]`;
    let slug = slugFromUrl(product.specs?.sourceUrl);
    if (!slug) {
      log(`${label} skip — no source slug: ${product.name}`);
      return;
    }
    const reuse = buildReuseMap(product);
    try {
      let rows = await fetchWithRetry(
        `${STORE_API}?slug=${encodeURIComponent(slug)}`,
        { headers: { Accept: "application/json" } },
      ).then((r) => r.json());
      let api = Array.isArray(rows) ? rows[0] : null;

      // Renamed products keep a 301 from the old URL — follow it and adopt
      // the new slug rather than dropping the product.
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

      const html = await fetchWithRetry(`${BASE}/product/${slug}/`).then((r) =>
        r.text(),
      );

      // Gallery
      const gallery = [];
      for (const [i, img] of (api.images || []).entries()) {
        const src = img.src || img.thumbnail;
        if (!src) continue;
        gallery.push(await uploadRemoteImage(src, `${slug}-${i + 1}`, reuse));
      }

      // Attributes → spec rows, in the supplier's order
      const attributes = [];
      for (const a of api.attributes || []) {
        const value = (a.terms || []).map((t) => decode(t.name)).join(", ");
        if (!a.name || !value) continue;
        attributes.push({ label: decode(a.name), value, key: a.taxonomy || "" });
      }

      const addonGroups = extractAddonGroups(html);

      // Spec sheets / guides linked on the PDP
      const manuals = [];
      for (const f of extractSpecFiles(html).slice(0, 8)) {
        const local = await downloadFileToPublic(f.href, slug, f.name);
        if (local) manuals.push({ name: f.name || "Specification", url: local });
      }

      /**
       * The supplier figure is recorded, never used as our selling price:
       * `price` is owned by the uplift pipeline (listPriceBeforeUplift ×
       * upliftPercent), so overwriting it here would wipe the margin.
       */
      const supplierPrice = Number(api.prices?.price || 0) / 100 || null;
      const regular = Number(api.prices?.regular_price || 0) / 100 || null;
      const sale = Number(api.prices?.sale_price || 0) / 100 || null;

      const reviewSummary = {
        rating: Number(api.average_rating) || null,
        count: Number(api.review_count) || 0,
        source: "directflooringonline.co.uk",
      };

      const specs = {
        ...(product.specs || {}),
        dfoId: api.id,
        dfoSlug: slug,
        sourceUrl: `${BASE}/product/${slug}/`,
        dfoSku: decode(api.sku) || product.specs?.dfoSku || "",
        productType: api.type || "",
        categories: (api.categories || []).map((c) => decode(c.name)),
        manufacturerBrand:
          decode((api.brands || [])[0]?.name || "") ||
          product.specs?.manufacturerBrand ||
          "",
        tags: (api.tags || []).map((t) => decode(t.name)).slice(0, 40),
        stockAvailability: decode(api.stock_availability?.text || ""),
        inStock: api.is_in_stock !== false,
        onSale: Boolean(api.on_sale),
        dfoLivePrice: supplierPrice,
        regularPrice: regular,
        salePrice: sale,
        priceHtml: stripTags(api.price_html).slice(0, 120),
        weight: decode(api.formatted_weight || ""),
        dimensions: decode(api.formatted_dimensions || ""),
        enrichedAt: new Date().toISOString(),
        parityVersion: PARITY_VERSION,
      };

      const $set = {
        name: decode(api.name) || product.name,
        description: String(api.description || product.description || "").trim(),
        shortDescription: String(api.short_description || "").trim(),
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
      if (manuals.length) $set.manuals = manuals;

      log(
        `${label} ${DRY_RUN ? "[dry] " : ""}${$set.name.slice(0, 44)} supplier£${supplierPrice ?? "-"} imgs=${gallery.length} attrs=${attributes.length} addons=${addonGroups.length}(${addonGroups.reduce((n, g) => n + g.fields.length, 0)}) manuals=${manuals.length} rating=${reviewSummary.rating || "-"}(${reviewSummary.count})`,
      );

      if (!DRY_RUN) {
        await db.collection("products").updateOne({ _id: product._id }, { $set });
      }
      ok++;
    } catch (e) {
      fail++;
      log(`${label} ✗ ${slug}: ${e.message}`);
    }
  });

  log(`Done. ok=${ok} fail=${fail}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
