/**
 * Full re-scrape of Plank Hardware (plankhardware.com — Shopify) from zero:
 * updates existing products by handle and inserts any that are missing.
 *
 * - Gallery + variant images → Cloudinary
 * - Files (PDF / spec sheets)  → public/plank-hardware/downloads/
 * - Variants, options, tags, product type, collections, description
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/enrich-plank-products.cjs
 *   RESUME=1 CONCURRENCY=4 LIMIT=20 DRY_RUN=1 SKIP_IMAGES=1
 *   PLANK_ONLY_HANDLE=<handle>   FORCE=1 (re-upload images)
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

const BASE = "https://plankhardware.com";
const BRAND_SLUG = "plankhardware";
const CLOUDINARY_FOLDER = "linx-living/products/plank-hardware";
const PUBLIC_DIR = path.join(__dirname, "..", "public", "plank-hardware");
const LOG = path.join(__dirname, "_tmp-plank-enrich.log");
/** Bump when the scrape starts capturing a new PDP block. */
const PARITY_VERSION = 3;

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const FORCE = process.env.FORCE === "1";
const RESUME = !FORCE && process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 4));
const ONLY_HANDLE = String(process.env.PLANK_ONLY_HANDLE || "").trim();
const REQUEST_GAP_MS = Math.max(0, Number(process.env.REQUEST_GAP_MS || 200));
const MAX_RETRIES = Math.max(1, Number(process.env.MAX_RETRIES || 5));
const TIMEOUT_MS = Number(process.env.PLANK_TIMEOUT_MS || 45000);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxPlankEnrich/1.0";

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
        signal: AbortSignal.timeout(TIMEOUT_MS),
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

const decode = (s) =>
  String(s || "")
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&#8211;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "£")
    .replace(/&nbsp;/g, " ")
    .trim();

const stripTags = (s) =>
  decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Same, but block tags become line breaks so paragraphs survive. */
const blockText = (s) =>
  decode(
    String(s || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|h[1-6]|li|div|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const absUrl = (src) => {
  if (!src) return "";
  if (/^https?:/i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  return `${BASE}${src.startsWith("/") ? "" : "/"}${src}`;
};

/** Cloudinary URLs already on the product, keyed by public id. */
function buildReuseMap(product) {
  const map = new Map();
  const add = (url) => {
    const s = String(url || "");
    if (!/res\.cloudinary\.com/i.test(s)) return;
    const id = s.split("/").pop().replace(/\.[a-z0-9]+$/i, "");
    if (id && !map.has(id)) map.set(id, s);
  };
  for (const u of product?.images || []) add(u);
  for (const v of product?.variants || []) add(v?.imageUrl);
  for (const c of product?.colorOptions || []) add(c?.imageUrl);
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
  } catch (e) {
    log(`image upload fail ${clean}: ${e.message}`);
    // Cloudinary caps images at 10MB; oversized animations (their product GIFs)
    // are served from our own public folder rather than a supplier URL.
    const local = await downloadMediaToPublic(clean, publicId);
    if (local) return local;
    return clean;
  }
}

/** Save a media file under public/ and return its site-relative path. */
async function downloadMediaToPublic(fileUrl, publicId) {
  const clean = absUrl(fileUrl).split("?")[0];
  if (!clean) return "";
  const ext = path.extname(clean).toLowerCase() || ".jpg";
  const name = `${slugify(publicId) || "media"}${ext}`;
  const dir = path.join(PUBLIC_DIR, "media");
  const publicPath = `/plank-hardware/media/${name}`;
  if (DRY_RUN) return publicPath;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return publicPath;
    const res = await fetchWithRetry(clean);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return publicPath;
  } catch (e) {
    log(`media download fail ${clean}: ${e.message}`);
    return "";
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
  const publicPath = `/plank-hardware/downloads/${slugify(handle) || "misc"}/${base}${ext}`;
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

/** Files linked anywhere on the PDP or in the description. */
function extractFiles(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(
    /<a[^>]+href="([^"]+\.(?:pdf|docx?|zip|dwg))[^"]*"[^>]*>([\s\S]{0,140}?)<\/a>/gi,
  )) {
    const href = absUrl(m[1]).split("?")[0];
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, name: stripTags(m[2]) || path.basename(href) });
  }
  for (const m of String(html || "").matchAll(/https?:\/\/[^"'\s>]+\.pdf/gi)) {
    const href = m[0].split("?")[0];
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, name: path.basename(href) });
  }
  return out;
}

/**
 * Label/value rows inside a metafield-driven accordion, e.g. Specifications.
 * Rows the theme hides (an empty variant metafield) are skipped, exactly as
 * the live page does.
 */
function extractMetafieldRows(blockHtml) {
  const rows = [];
  const src = String(blockHtml || "");
  for (const m of src.matchAll(
    /<div class="metafield-name"([^>]*)>([\s\S]*?)<\/div>\s*<\/div>/gi,
  )) {
    if (/display\s*:\s*none/i.test(m[1] || "")) continue;
    const inner = m[2] || "";
    const label = stripTags(
      (inner.match(/metafield_name--title"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "",
    );
    const value = stripTags(
      (inner.match(/metafield_name--value"[^>]*>([\s\S]*?)$/i) || [])[1] || "",
    );
    if (!label || !value) continue;
    if (rows.some((r) => r.label.toLowerCase() === label.toLowerCase())) continue;
    rows.push({ label, value });
  }
  return rows;
}

/**
 * The PDP accordions the supplier attaches to the buy box. Only
 * `product__block--collapsible_tab` blocks count — the same <details> markup is
 * also used by the mega menu, which is not product copy.
 */
function extractSections(html) {
  const out = [];
  const seen = new Set();
  const src = String(html || "");
  let from = 0;
  while (out.length < 20) {
    const at = src.indexOf('product__block--collapsible_tab" data-block-id="', from);
    if (at < 0) break;
    const blockId = (src.slice(at, at + 200).match(/data-block-id="([^"]+)"/) || [])[1] || "";
    const open = src.indexOf("<details", at);
    const close = src.indexOf("</details>", open);
    from = close > 0 ? close + 10 : at + 60;
    if (open < 0 || close < 0) continue;
    const block = src.slice(open, close);
    const sumClose = block.indexOf("</summary>");
    if (sumClose < 0) continue;
    const heading = stripTags(block.slice(0, sumClose));
    const body = block
      .slice(sumClose + 10)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .trim();
    const text = blockText(body);
    const rows = extractMetafieldRows(body);
    if (!heading || (!text && !rows.length)) continue;
    if (seen.has(heading.toLowerCase())) continue;
    seen.add(heading.toLowerCase());
    out.push({
      blockId,
      heading,
      html: body.slice(0, 12000),
      text: text.slice(0, 6000),
      rows,
    });
  }
  return out;
}

/**
 * Older PDPs carry the same copy as a tab strip ("Product Information",
 * "Delivery & Returns") instead of accordions under the buy box.
 */
function extractTabSections(html) {
  const src = String(html || "");
  const names = new Map();
  for (const m of src.matchAll(
    /<button[^>]*class="tabs__tab[^"]*"[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/button>/gi,
  )) {
    names.set(m[1], stripTags(m[2]));
  }
  const out = [];
  let from = 0;
  while (out.length < 12) {
    const at = src.indexOf('class="tabs__content"', from);
    if (at < 0) break;
    const openEnd = src.indexOf(">", at);
    const id = (src.slice(at, openEnd).match(/id="tab-([^"]+)"/) || [])[1] || "";
    // Panels are flat siblings; the next panel (or the panel wrapper's end)
    // bounds this one.
    const next = src.indexOf('class="tabs__content"', openEnd);
    const stop = next > 0 ? next : Math.min(src.length, openEnd + 40000);
    const body = src
      .slice(openEnd + 1, stop)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ");
    from = stop;
    const heading = names.get(id) || "";
    const rows = extractMetafieldRows(body);
    const text = blockText(body);
    if (!heading || (!rows.length && !text)) continue;
    out.push({
      blockId: id,
      heading,
      html: body.slice(0, 12000),
      text: text.slice(0, 6000),
      rows,
    });
  }
  return out;
}

/**
 * Finish swatches. Plank sells each finish as its own product and links them
 * with the Rubik swatch app, which drops the whole group into a JSON island.
 */
function extractSwatchGroups(html, handle) {
  const src = String(html || "");
  const out = [];
  for (const m of src.matchAll(
    /<script type="application\/json" data-rubik-swatch-product-id="[^"]*" data-rubik-swatch-product-handle="([^"]*)"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    if (handle && m[1] && m[1] !== handle) continue;
    let parsed;
    try {
      parsed = JSON.parse(m[2]);
    } catch {
      continue;
    }
    for (const group of parsed?.groups || []) {
      const swatches = (group.swatches || [])
        .map((s) => ({
          label: decode(s.optionValue || s.productTitle || ""),
          handle: handleFromUrl(s.productUrl),
          colorValue: String(s.color || "").trim(),
          secondaryColor: String(s.secondaryColor || "").trim(),
          swatchImageRemote: absUrl(s.image || ""),
          previewImageRemote: absUrl(s.mainFeaturedImage || s.featuredImage || ""),
          price: parsePrice(s.productPrice),
          compareAtPrice: parsePrice(s.productCompareAtPrice),
          available: s.productAvailable !== false,
          isCurrent: s.isCurrent === true,
        }))
        .filter((s) => s.label && s.handle);
      // Live shows the chip even when a finish has no siblings.
      if (swatches.length) {
        out.push({ optionName: decode(group.optionName || "Finish"), swatches });
      }
    }
    if (out.length) break;
  }
  return out;
}

const parsePrice = (s) => {
  const n = Number(String(s || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Small explainer dropdowns beside the option picker, e.g. the light switches'
 * "Switch types explained".
 */
function extractInfoDropdowns(html) {
  const out = [];
  const src = String(html || "");
  for (const m of src.matchAll(
    /<details[^>]*class="switch-info[^"]*"[^>]*>([\s\S]*?)<\/details>/gi,
  )) {
    const block = m[1] || "";
    const name = stripTags(
      (block.match(/switch-info__label"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "",
    );
    const bodyHtml = String(
      (block.match(/switch-info__content"[^>]*>([\s\S]*)/i) || [])[1] || "",
    )
      .trim()
      .replace(/<\/div>\s*$/i, "");
    const text = stripTags(bodyHtml);
    if (!name || !text) continue;
    if (out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({
      name,
      html: String(bodyHtml || "").trim().slice(0, 4000),
      text: text.slice(0, 2000),
      /** Term/definition pairs, so we can lay them out like the supplier does. */
      items: [...String(bodyHtml || "").matchAll(
        /<p>\s*<span class="switch-info__type-label">([\s\S]*?)<\/span>([\s\S]*?)<\/p>/gi,
      )].map((p) => ({
        term: stripTags(p[1]).replace(/:$/, ""),
        text: stripTags(p[2]),
      })),
    });
  }
  return out;
}

/** Stock line under the buy box, e.g. "Hurry up, only 8 items left in stock." */
function extractInventoryLabel(html) {
  const m = String(html || "").match(
    /product__inventory-text"[^>]*>([\s\S]*?)<\/span>/i,
  );
  return m ? stripTags(m[1]) : "";
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

/** Every product on the storefront, paged. */
async function fetchAllHandles() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const data = await fetchWithRetry(
      `${BASE}/products.json?limit=250&page=${page}`,
      { headers: { Accept: "application/json" } },
    ).then((r) => r.json());
    const rows = data.products || [];
    if (!rows.length) break;
    for (const p of rows) out.push(p.handle);
    await delay(REQUEST_GAP_MS);
  }
  return [...new Set(out)];
}

const handleFromUrl = (url) =>
  (String(url || "").match(/\/products\/([^/?#]+)/) || [])[1] || "";

/** Finish chips are the same files across the catalogue — upload each once. */
const swatchChipCache = new Map();

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  fs.appendFileSync(LOG, `\nPlank enrich ${new Date().toISOString()}\n`);
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const products = db.collection("products");
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Plank Hardware brand not found");

  // Index what we already hold, however the handle was stored.
  const existing = await products.find({ brand: brand._id }).toArray();
  const byHandle = new Map();
  for (const p of existing) {
    const h =
      p.specs?.plankHandle ||
      p.specs?.handle ||
      handleFromUrl(p.specs?.sourceUrl) ||
      slugify(p.name);
    if (h && !byHandle.has(h)) byHandle.set(h, p);
  }

  let handles = ONLY_HANDLE
    ? ONLY_HANDLE.split(",").map((h) => h.trim()).filter(Boolean)
    : await fetchAllHandles();
  log(`live handles: ${handles.length} | in db: ${existing.length}`);

  if (RESUME && !ONLY_HANDLE) {
    handles = handles.filter((h) => {
      const p = byHandle.get(h);
      return !p || Number(p.specs?.parityVersion || 0) < PARITY_VERSION;
    });
    log(`resuming: ${handles.length} still to do`);
  }
  if (LIMIT > 0) handles = handles.slice(0, LIMIT);

  let updated = 0;
  let inserted = 0;
  let fail = 0;

  await mapPool(handles, CONCURRENCY, async (handle, idx) => {
    const label = `[${idx + 1}/${handles.length}]`;
    const current = byHandle.get(handle) || null;
    const reuse = buildReuseMap(current);
    try {
      const js = await fetchWithRetry(`${BASE}/products/${handle}.js`, {
        headers: { Accept: "application/json" },
      }).then((r) => r.json());
      await delay(REQUEST_GAP_MS);
      const html = await fetchWithRetry(`${BASE}/products/${handle}`).then((r) =>
        r.text(),
      );

      // Full gallery, in the supplier's order, videos kept as-is.
      const remote = [];
      for (const m of js.media || []) {
        if (m.media_type === "external_video" && m.external_id) {
          remote.push(`youtube:${m.external_id}`);
          continue;
        }
        if (m.media_type === "video") {
          const src =
            (m.sources || []).find((s) => /mp4/i.test(s.format || s.url || ""))?.url ||
            (m.sources || [])[0]?.url;
          if (src) remote.push(absUrl(src));
          continue;
        }
        const src = m.src || m.preview_image?.src;
        if (src) remote.push(absUrl(src));
      }
      if (!remote.length) {
        for (const img of js.images || []) {
          const src = typeof img === "string" ? img : img.src;
          if (src) remote.push(absUrl(src));
        }
      }
      const gallery = [];
      const hostedByRemote = new Map();
      const seenImg = new Set();
      for (const src of remote) {
        const key = src.split("?")[0];
        if (seenImg.has(key)) continue;
        seenImg.add(key);
        if (/^youtube:/i.test(src) || /\.mp4(\?|$)/i.test(src)) {
          gallery.push(src);
          continue;
        }
        const hosted = await uploadRemoteImage(
          src,
          `${handle}-${gallery.length + 1}`,
          reuse,
        );
        hostedByRemote.set(key, hosted);
        gallery.push(hosted);
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
      for (const axis of shopifyOptions) {
        if (axis.values.length) continue;
        const set = new Set();
        for (const v of js.variants || []) {
          const val =
            axis.position === 1 ? v.option1 : axis.position === 2 ? v.option2 : v.option3;
          if (val) set.add(String(val));
        }
        axis.values = [...set];
      }

      /**
       * Variant art is hosted too — reuse the gallery upload when it is the
       * same file, otherwise upload it, so no supplier URL is ever served.
       */
      const variantImage = async (v, vi) => {
        const src = absUrl(v.featured_image?.src || "").split("?")[0];
        if (!src) return "";
        const hosted = hostedByRemote.get(src);
        if (hosted) return hosted;
        const uploaded = await uploadRemoteImage(
          src,
          `${handle}-variant-${vi + 1}`,
          reuse,
        );
        hostedByRemote.set(src, uploaded);
        return uploaded;
      };

      const variants = [];
      for (const [vi, v] of (js.variants || []).entries()) {
        variants.push({
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
        imageUrl: await variantImage(v, vi),
        externalId: String(v.id || ""),
        barcode: String(v.barcode || "").trim(),
        weight: Number(v.weight) > 0 ? Number(v.weight) : null,
        position: vi + 1,
        isDefault: vi === 0,
        });
      }

      const price =
        variants.find((v) => v.available && v.price > 0)?.price ||
        variants[0]?.price ||
        (Number(js.price) > 0 ? Math.round(Number(js.price)) / 100 : 0);

      const files = [];
      for (const f of extractFiles(html).slice(0, 12)) {
        const local = await downloadFileToPublic(f.href, handle, f.name);
        if (local) {
          files.push({ title: f.name.replace(/\.[a-z0-9]+$/i, ""), url: local, type: "pdf" });
        }
      }

      const accordionSections = extractSections(html);
      const allSections = accordionSections.length
        ? accordionSections
        : extractTabSections(html);
      /**
       * Description and Specifications belong to the page's own description and
       * spec panels, so they never become a second dropdown.
       */
      const descBlock = allSections.find((s) =>
        /^description$/i.test(s.heading),
      );
      const specBlock = allSections.find(
        (s) =>
          /^specifications?$/i.test(s.heading) ||
          // Tab-strip PDPs label the same metafield table differently.
          (/^product information$/i.test(s.heading) && s.rows.length > 0),
      );
      const sections = allSections.filter(
        (s) => s !== descBlock && s !== specBlock,
      );
      const attributes = specBlock ? specBlock.rows : [];

      const swatchGroups = [];
      for (const group of extractSwatchGroups(html, handle)) {
        const swatches = [];
        for (const s of group.swatches) {
          // Chip art is shared between siblings — upload it once per finish.
          const chipKey = path
            .basename(s.swatchImageRemote.split("?")[0])
            .replace(/\.[a-z0-9]+$/i, "");
          let chip = swatchChipCache.get(chipKey);
          if (chip === undefined && s.swatchImageRemote) {
            chip = await uploadRemoteImage(
              s.swatchImageRemote,
              `swatch-${slugify(chipKey)}`,
              reuse,
            );
            swatchChipCache.set(chipKey, chip);
          }
          swatches.push({
            label: s.label,
            handle: s.handle,
            colorValue: s.colorValue,
            secondaryColor: s.secondaryColor,
            swatchImage: chip || "",
            price: s.price,
            compareAtPrice: s.compareAtPrice,
            available: s.available,
            isCurrent: s.isCurrent || s.handle === handle,
          });
        }
        swatchGroups.push({ optionName: group.optionName, swatches });
      }

      const infoDropdowns = extractInfoDropdowns(html);
      const inventoryLabel = extractInventoryLabel(html);
      const available = js.available !== false;
      const tags = Array.isArray(js.tags)
        ? js.tags.map(String)
        : String(js.tags || "").split(",").map((t) => t.trim()).filter(Boolean);

      const specs = {
        ...(current?.specs || {}),
        source: "plank-scrape",
        plankHandle: handle,
        plankId: js.id,
        sourceUrl: `${BASE}/products/${handle}`,
        productType: js.type || js.product_type || "",
        vendor: js.vendor || "",
        tags: tags.slice(0, 60),
        sku: variants[0]?.sku || current?.specs?.sku || "",
        available,
        priceMin: Number(js.price_min) > 0 ? Math.round(js.price_min) / 100 : price,
        priceMax: Number(js.price_max) > 0 ? Math.round(js.price_max) / 100 : price,
        inventoryLabel,
        enrichedAt: new Date().toISOString(),
        parityVersion: PARITY_VERSION,
      };

      const $set = {
        name: decode(js.title) || current?.name || handle,
        /**
         * The Description accordion is the copy the PDP actually shows. Stored
         * as text — injecting the supplier's wrapper markup caused a hydration
         * mismatch — with bullets kept as characters.
         */
        description:
          (descBlock ? blockText(descBlock.html) : "") ||
          blockText(js.description || "") ||
          String(current?.description || "").trim(),
        price,
        images: gallery.length ? gallery : current?.images || [],
        videos: gallery.filter((u) => /^youtube:/i.test(u) || /\.mp4(\?|$)/i.test(u)),
        shopifyOptions,
        variants,
        productSections: sections,
        attributes,
        swatchGroups,
        infoDropdowns,
        stockAvailabilityText: inventoryLabel,
        keywords: tags.slice(0, 40),
        tagline: decode(js.vendor || ""),
        stock: available ? Math.max(Number(current?.stock) || 0, 25) : 0,
        stockStatus: available ? "in_stock" : "out_of_stock",
        isOutOfStock: !available,
        specs,
        showSpecs: true,
        updatedAt: new Date(),
      };
      if (files.length) $set.downloads = files;

      log(
        `${label} ${DRY_RUN ? "[dry] " : ""}${current ? "update" : "INSERT"} ${$set.name.slice(0, 40)} £${price} imgs=${gallery.length} vars=${variants.length} files=${files.length} sections=${sections.length} specs=${attributes.length} swatches=${swatchGroups.reduce((n, g) => n + g.swatches.length, 0)} info=${infoDropdowns.length}`,
      );

      if (!DRY_RUN) {
        if (current) {
          await products.updateOne({ _id: current._id }, { $set });
          updated++;
        } else {
          await products.insertOne({
            ...$set,
            brand: brand._id,
            brands: [brand._id],
            category: slugify(js.type || js.product_type || "plank-hardware"),
            subCategory: "",
            createdAt: new Date(),
          });
          inserted++;
        }
      } else if (current) updated++;
      else inserted++;
    } catch (e) {
      fail++;
      log(`${label} ✗ ${handle}: ${e.name === "TimeoutError" ? "timeout" : e.message}`);
    }
  });

  log(`Done. updated=${updated} inserted=${inserted} fail=${fail}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
