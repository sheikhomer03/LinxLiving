/**
 * Full re-scrape of Pooky products from the live PDP data sources:
 * - Shopify /products/<handle>.js  → gallery, variants, price, options, tags
 * - Pooky productsDB GraphQL       → dimensions, reviews, filters, upsells
 * - Embedded PDP payload           → badge, button label, preorder, light/dark
 *                                    images, upsell + cross-sell lists
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/enrich-pooky-products.cjs
 *   RESUME=1 CONCURRENCY=4 LIMIT=200 DRY_RUN=1 SKIP_IMAGES=1
 *   POOKY_ONLY_HANDLE=whinny-table-lamp-in-green-resin
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
const PRODUCTS_DB =
  process.env.POOKY_PRODUCTS_DB ||
  "https://graphql-server-uk-464125e5708d.herokuapp.com/";
const BRAND_SLUG = "pooky";
const CLOUDINARY_FOLDER = "linx-living/products/pooky";
const PUBLIC_DIR = path.join(__dirname, "..", "public", "pooky");
const LOG = path.join(__dirname, "_tmp-pooky-enrich.log");
/** Bump when the scrape starts capturing a new PDP block. */
const PARITY_VERSION = 1;

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const FORCE = process.env.FORCE === "1";
const RESUME = !FORCE && process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 4));
const GQL_BATCH = Math.max(1, Number(process.env.GQL_BATCH || 20));
const ONLY_HANDLE = String(process.env.POOKY_ONLY_HANDLE || "").trim();
const REQUEST_GAP_MS = Math.max(0, Number(process.env.REQUEST_GAP_MS || 150));
const MAX_RETRIES = Math.max(1, Number(process.env.MAX_RETRIES || 6));

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxPookyEnrich/1.0";

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
      await delay(600 * attempt * attempt);
    }
  }
  throw lastErr || new Error(`Failed ${url}`);
}

async function gql(query, variables = {}) {
  const res = await fetchWithRetry(PRODUCTS_DB, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: BASE,
      Referer: `${BASE}/`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

const PRODUCT_QUERY = `
  query ($handles: [String!]!) {
    productsByHandle(handle: $handles, take: 60) {
      id
      handle
      title
      productType
      description
      tags
      totalInventory
      collections { handle title }
      metafields { namespace key type value }
      variants {
        id
        sku
        title
        price
        compareAtPrice
        metafields { namespace key type value }
      }
    }
  }
`;

function absUrl(src) {
  if (!src) return "";
  if (/^https?:/i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  return `${BASE}${src.startsWith("/") ? "" : "/"}${src}`;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Cloudinary URLs already on the product, so re-scrapes skip re-uploading. */
function buildReuseMap(product) {
  const map = new Map();
  const add = (url) => {
    const s = String(url || "");
    if (!/res\.cloudinary\.com/i.test(s)) return;
    const id = s.split("/").pop().replace(/\.[a-z0-9]+$/i, "");
    if (id && !map.has(id)) map.set(id, s);
  };
  for (const u of product.images || []) add(u);
  add(product.hoverImage);
  add(product.lightModeImage);
  add(product.darkModeImage);
  return map;
}

async function uploadRemoteImage(imageUrl, publicId, reuse) {
  const clean = absUrl(imageUrl).split("?")[0];
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

async function downloadFileToPublic(fileUrl, handle, fileName) {
  const clean = absUrl(fileUrl).split("?")[0];
  if (!clean) return "";
  const ext = path.extname(clean).toLowerCase() || ".pdf";
  const base = slugify(path.parse(fileName || path.basename(clean)).name) || "file";
  const dir = path.join(PUBLIC_DIR, "downloads", slugify(handle) || "misc");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${base}${ext}`);
  const publicPath = `/pooky/downloads/${slugify(handle) || "misc"}/${base}${ext}`;
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

/** Pooky embeds the PDP's own config as a JSON <script> in the page. */
function extractPdpPayload(html) {
  const anchor = String(html || "").indexOf("product_attributes");
  if (anchor < 0) return null;
  const scriptStart = html.lastIndexOf("<script", anchor);
  const openEnd = html.indexOf(">", scriptStart) + 1;
  const scriptEnd = html.indexOf("</script>", anchor);
  if (scriptStart < 0 || scriptEnd < 0) return null;
  try {
    return JSON.parse(html.slice(openEnd, scriptEnd).trim());
  } catch {
    return null;
  }
}

function metaMap(list) {
  const out = {};
  for (const m of list || []) out[`${m.namespace}.${m.key}`] = m.value;
  return out;
}

function jsonMaybe(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function accentuateImageUrl(value) {
  const parsed = jsonMaybe(value);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const url = first?.src || first?.secure_url || first?.url || "";
  return absUrl(String(url).replace(/^http:\/\//i, "https://"));
}

/** Human labels for the supplier's dimension keys, in display order. */
const DIMENSION_LABELS = [
  ["height", "Height"],
  ["Width", "Width"],
  ["width", "Width"],
  ["depth", "Depth"],
  ["length", "Length"],
  ["diameter", "Diameter"],
  ["top", "Top diameter"],
  ["base", "Base diameter"],
  ["drop", "Drop"],
  ["max_width", "Max width"],
  ["wingspan", "Wingspan"],
  ["chain_length", "Chain length"],
  ["max_distance_from_wall", "Max distance from wall"],
  ["wall_mount_diameter", "Wall mount diameter"],
  ["ceiling_rose_diameter", "Ceiling rose diameter"],
  ["backbox-dimensions", "Back box dimensions"],
  ["stormlantern_total_height", "Total height"],
  ["stormlantern_base_width", "Base width"],
  ["stormlantern_base_height", "Base height"],
  ["weight", "Weight"],
  ["material", "Material"],
  ["fitting_type", "Fitting"],
  ["bulb_type", "Bulb"],
  ["bulbs", "Number of bulbs"],
  ["wattage", "Wattage"],
  ["brightness", "Brightness"],
  ["lumens", "Lumens"],
  ["kelvin_rating", "Colour temperature"],
  ["cri", "CRI"],
  ["dimmable", "Dimmable"],
  ["volts", "Volts"],
  ["voltage", "Voltage"],
  ["amperage", "Amperage"],
  ["ip_rating", "IP rating"],
  ["number_of_ways", "Number of ways"],
  ["flex", "Flex"],
  ["battery_life", "Battery life"],
  ["charge_time", "Charge time"],
  ["charger_type", "Charger"],
  ["burn_time", "Burn time"],
  ["number_of_candles", "Number of candles"],
];

function buildDimensions(vmeta) {
  const rows = [];
  const seen = new Set();
  for (const [key, label] of DIMENSION_LABELS) {
    const value = String(vmeta[`dimensions.${key}`] || "").trim();
    if (!value || seen.has(label)) continue;
    seen.add(label);
    rows.push({ label, value, key: `dimensions.${key}` });
  }
  // Anything the supplier adds later still lands in the table.
  for (const [k, v] of Object.entries(vmeta)) {
    if (!k.startsWith("dimensions.")) continue;
    const short = k.slice("dimensions.".length);
    if (short === "product_instructions") continue;
    if (DIMENSION_LABELS.some(([key]) => key === short)) continue;
    const value = String(v || "").trim();
    if (!value) continue;
    const label = short.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    if (seen.has(label)) continue;
    seen.add(label);
    rows.push({ label, value, key: k });
  }
  return rows;
}

const ATTRIBUTE_LABELS = [
  ["colour", "Colour"],
  ["material", "Material"],
  ["style", "Style"],
  ["product_type", "Product type"],
  ["fitting_type", "Fitting type"],
  ["location", "Room"],
  ["power_source", "Power source"],
  ["size", "Size"],
  ["shape", "Shape"],
  ["pattern", "Pattern"],
  ["construction", "Construction"],
  ["voltage", "Voltage"],
  ["range", "Range"],
  ["type", "Type"],
];

function buildAttributes(vmeta) {
  const rows = [];
  for (const [key, label] of ATTRIBUTE_LABELS) {
    const raw = vmeta[`voyadoFilters.${key}`];
    if (raw == null) continue;
    const parsed = jsonMaybe(raw, raw);
    const value = Array.isArray(parsed)
      ? parsed.join(", ")
      : String(parsed || "").trim();
    if (!value) continue;
    rows.push({ label, value, key: `voyadoFilters.${key}` });
  }
  return rows;
}

function splitHandles(raw) {
  return String(raw || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
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

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  fs.appendFileSync(LOG, `\nPooky enrich ${new Date().toISOString()}\n`);
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Pooky brand not found");

  const filter = {
    brand: brand._id,
    ...(ONLY_HANDLE
      ? { "specs.pookyHandle": ONLY_HANDLE }
      : { "specs.pookyHandle": { $exists: true, $ne: "" } }),
    ...(RESUME && !ONLY_HANDLE
      ? {
          $or: [
            { "specs.parityVersion": { $exists: false } },
            { "specs.parityVersion": { $lt: PARITY_VERSION } },
          ],
        }
      : {}),
  };
  let products = await db.collection("products").find(filter).toArray();
  if (LIMIT > 0) products = products.slice(0, LIMIT);
  log(
    `Enriching ${products.length} Pooky products concurrency=${CONCURRENCY} batch=${GQL_BATCH}`,
  );

  // GraphQL is batched — one round trip covers many products.
  const byHandle = new Map();
  const handles = products.map((p) => String(p.specs?.pookyHandle || "")).filter(Boolean);
  for (let i = 0; i < handles.length; i += GQL_BATCH) {
    const batch = handles.slice(i, i + GQL_BATCH);
    try {
      const data = await gql(PRODUCT_QUERY, { handles: batch });
      for (const row of data.productsByHandle || []) byHandle.set(row.handle, row);
    } catch (e) {
      log(`gql batch ${i} failed: ${e.message}`);
    }
    await delay(REQUEST_GAP_MS);
  }
  log(`productsDB returned ${byHandle.size}/${handles.length}`);

  let ok = 0;
  let fail = 0;

  await mapPool(products, CONCURRENCY, async (product, idx) => {
    const handle = String(product.specs?.pookyHandle || "").trim();
    const label = `[${idx + 1}/${products.length}]`;
    if (!handle) return;
    const reuse = buildReuseMap(product);
    try {
      const js = await fetchWithRetry(`${BASE}/products/${handle}.js`, {
        headers: { Accept: "application/json" },
      }).then((r) => r.json());
      await delay(REQUEST_GAP_MS);
      const html = await fetchWithRetry(`${BASE}/products/${handle}`).then((r) =>
        r.text(),
      );
      const pdp = extractPdpPayload(html) || {};
      const dbRow = byHandle.get(handle) || null;

      const pmeta = metaMap(dbRow?.metafields);
      const v0 = (dbRow?.variants || [])[0] || {};
      const vmeta = metaMap(v0.metafields);

      // Gallery
      const galleryRemote = [];
      for (const m of js.media || []) {
        if (m.media_type === "external_video" && m.external_id) {
          galleryRemote.push(`youtube:${m.external_id}`);
          continue;
        }
        const src = m.src || m.preview_image?.src;
        if (src) galleryRemote.push(absUrl(src));
      }
      if (!galleryRemote.length) {
        for (const img of js.images || []) {
          const src = typeof img === "string" ? img : img.src;
          if (src) galleryRemote.push(absUrl(src));
        }
      }
      const gallery = [];
      const seenImg = new Set();
      for (const [i, src] of galleryRemote.entries()) {
        if (seenImg.has(src)) continue;
        seenImg.add(src);
        // Same public-id convention as the original import, so gallery art
        // already on Cloudinary is reused rather than uploaded again.
        gallery.push(
          /^youtube:/i.test(src)
            ? src
            : await uploadRemoteImage(src, `${handle}-${gallery.length + 1}`, reuse),
        );
      }

      const shopifyOptions = (js.options || [])
        .map((o, i) =>
          typeof o === "string"
            ? { name: o, position: i + 1, values: [] }
            : {
                name: String(o.name || "").trim(),
                position: Number(o.position) || i + 1,
                values: (o.values || []).map(String),
              },
        )
        .filter((o) => o.name && !/^title$/i.test(o.name));

      const variants = (js.variants || []).map((v, vi) => ({
        name: String(v.title || v.name || "").trim(),
        sku: String(v.sku || "").trim(),
        option1: String(v.option1 || "").trim(),
        option2: String(v.option2 || "").trim(),
        option3: String(v.option3 || "").trim(),
        price: Number(v.price) > 0 ? Math.round(Number(v.price)) / 100 : 0,
        compareAtPrice:
          Number(v.compare_at_price) > 0
            ? Math.round(Number(v.compare_at_price)) / 100
            : null,
        available: v.available !== false,
        imageUrl: "",
        externalId: String(v.id || ""),
        barcode: String(v.barcode || "").trim(),
        weight: Number(v.weight) > 0 ? Number(v.weight) : null,
        position: vi + 1,
        isDefault: vi === 0,
      }));

      const price =
        variants.find((v) => v.available && v.price > 0)?.price ||
        variants[0]?.price ||
        product.price;

      const dimensions = buildDimensions(vmeta);
      const attributes = buildAttributes(vmeta);

      // Instruction sheet → local download
      const manuals = [];
      const instructions = String(vmeta["dimensions.product_instructions"] || "");
      if (instructions) {
        const local = await downloadFileToPublic(
          instructions,
          handle,
          `${handle}-instructions`,
        );
        if (local) manuals.push({ name: "Product instructions", url: local });
      }

      const ratingRaw = jsonMaybe(pmeta["reviews.rating"]);
      const reviewSummary = {
        rating:
          Number(ratingRaw?.value ?? pmeta["reviewscouk.rating"] ?? 0) || null,
        count:
          Number(pmeta["reviews.rating_count"] ?? pmeta["reviewscouk.total"] ?? 0) ||
          0,
        source: "reviews.io",
      };

      const hoverImage = await uploadRemoteImage(
        accentuateImageUrl(pmeta["images.hover_image"]),
        `${handle}-hover`,
        reuse,
      );
      const lightModeImage = await uploadRemoteImage(
        accentuateImageUrl(pdp.light_mode_image) ||
          accentuateImageUrl(vmeta["lightmode.image"]),
        `${handle}-lightmode`,
        reuse,
      );
      const darkModeImage = await uploadRemoteImage(
        accentuateImageUrl(pdp.dark_mode_image) ||
          accentuateImageUrl(vmeta["darkmode.image"]),
        `${handle}-darkmode`,
        reuse,
      );

      const upsellHandles = splitHandles(pmeta["upsell.upsell_products"]);
      const relatedHandles = splitHandles(pmeta["related.related_products"]);

      const shortDescription = String(
        pdp.short_description || pmeta["product_details.short_description"] || "",
      ).trim();

      const available = js.available !== false;
      const specs = {
        ...(product.specs || {}),
        pookyHandle: handle,
        pookyId: js.id,
        sourceUrl: `${BASE}/products/${handle}`,
        productType: js.type || product.specs?.productType || "",
        vendor: js.vendor || "",
        tags: (Array.isArray(js.tags) ? js.tags : []).slice(0, 60),
        collections: (dbRow?.collections || []).map((c) => c.handle),
        badge: String(pdp.badge || ""),
        buttonLabel: String(pdp.button_label || ""),
        preorder: pdp.preorder || null,
        dueDate: pdp.due_date || null,
        largeDelivery: Boolean(pdp.large_delivery),
        deliveryInfo: String(vmeta["product_details.delivery_info"] || ""),
        likelyCourier: (jsonMaybe(pmeta["accentuate.likely_courier"], []) || []).join(", "),
        totalInventory: Number(dbRow?.totalInventory ?? 0),
        available,
        enrichedAt: new Date().toISOString(),
        parityVersion: PARITY_VERSION,
      };

      const $set = {
        name: String(js.title || product.name).trim() || product.name,
        description: String(js.description || product.description || "").trim(),
        shortDescription,
        price,
        images: gallery.length ? gallery : product.images,
        shopifyOptions,
        variants,
        dimensionRows: dimensions,
        attributes,
        manuals,
        reviewSummary,
        hoverImage,
        lightModeImage,
        darkModeImage,
        hasDarkModeToggle:
          String(pmeta["lights_out.include_dark_mode_toggle"] || "").toUpperCase() ===
            "TRUE" || Boolean(darkModeImage),
        soldCount: Number(vmeta["trackers.soldCount"] || 0) || null,
        upsellHandles,
        relatedHandles,
        stock: available ? Math.max(Number(specs.totalInventory) || 0, 0) : 0,
        stockStatus: available ? "in_stock" : "out_of_stock",
        isOutOfStock: !available,
        specs,
        showSpecs: true,
        updatedAt: new Date(),
      };

      log(
        `${label} ${DRY_RUN ? "[dry] " : ""}${$set.name.slice(0, 46)} media=${gallery.length} vars=${variants.length} dims=${dimensions.length} attrs=${attributes.length} manuals=${manuals.length} rating=${reviewSummary.rating || "-"}(${reviewSummary.count}) upsell=${upsellHandles.length} dark=${darkModeImage ? 1 : 0}`,
      );

      if (!DRY_RUN) {
        await db.collection("products").updateOne({ _id: product._id }, { $set });
      }
      ok++;
    } catch (e) {
      fail++;
      log(`${label} ✗ ${handle}: ${e.message}`);
    }
  });

  log(`Done. ok=${ok} fail=${fail}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
