/**
 * Full re-scrape The Under Floor Heating products from live PDPs:
 * - Gallery (images + YouTube / mp4)
 * - Shopify options / variants (Wattage + Coverage etc.)
 * - Coverage, nested Globo options, Do the Job Right tools
 * - Description, name, vendor, tags, price, availability
 * - PDF / file downloads → public/the-under-floor-heating/downloads/
 * - Measure My Room flag
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/enrich-ufhs-products.cjs
 *   FORCE=1          — re-scrape every product (ignore enrichedAt)
 *   LIMIT=20 CONCURRENCY=2 DRY_RUN=1
 *   UFHS_ONLY_HANDLE=prowarm-electric-underfloor-heating-mat-kit
 *   RESUME=1 CONCURRENCY=1 REQUEST_GAP_MS=400 SKIP_IMAGES=1
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

const BASE = "https://www.theunderfloorheatingstore.com";
const BRAND_SLUG = "the-under-floor-heating";
/** Bump when the scrape starts capturing a new PDP block, to force a re-run. */
const PARITY_VERSION = 6;
const CLOUDINARY_FOLDER = "linx-living/products/the-under-floor-heating";
const PUBLIC_DIR = path.join(
  __dirname,
  "..",
  "public",
  "the-under-floor-heating",
);
const LOG = path.join(__dirname, "_tmp-ufhs-enrich.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const FORCE = process.env.FORCE === "1";
const RESUME = !FORCE && process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const ONLY_HANDLE = String(
  process.env.UFHS_ONLY_HANDLE || process.env.ONLY_HANDLE || "",
).trim();
const REQUEST_GAP_MS = Math.max(0, Number(process.env.REQUEST_GAP_MS || 250));
const MAX_RETRIES = Math.max(1, Number(process.env.MAX_RETRIES || 8));

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, init = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxUfhsEnrich/1.1",
          Accept: init.headers?.Accept || "*/*",
          ...(init.headers || {}),
        },
      });
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get("retry-after") || 0);
        const wait =
          (retryAfter > 0 ? retryAfter * 1000 : 1500 * attempt * attempt) +
          Math.floor(Math.random() * 500);
        log(`rate-limit ${res.status} attempt=${attempt}/${MAX_RETRIES} wait=${wait}ms ${url}`);
        await delay(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (/HTTP 404/.test(String(e.message))) throw e;
      if (attempt >= MAX_RETRIES) break;
      const wait = 800 * attempt * attempt;
      log(`fetch retry attempt=${attempt}/${MAX_RETRIES} wait=${wait}ms ${e.message}`);
      await delay(wait);
    }
  }
  throw lastErr || new Error(`Failed ${url}`);
}

async function fetchText(url) {
  const res = await fetchWithRetry(url);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json" },
  });
  return res.json();
}

function absUrl(src) {
  if (!src) return "";
  if (/^https?:/i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  return `${BASE}${src.startsWith("/") ? "" : "/"}${src}`;
}

function ensurePublicDir(...parts) {
  const dir = path.join(PUBLIC_DIR, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Cloudinary URLs already stored on the product, keyed by public id, so a
 * re-scrape does not re-upload artwork that has not changed.
 */
function buildReuseMap(product) {
  const map = new Map();
  const add = (url) => {
    const s = String(url || "");
    if (!/res\.cloudinary\.com/i.test(s)) return;
    const id = s.split("/").pop().replace(/\.[a-z0-9]+$/i, "");
    if (id && !map.has(id)) map.set(id, s);
  };
  const walk = (nodes) => {
    for (const f of nodes || []) {
      for (const c of f?.choices || []) {
        add(c.imageUrl);
        walk(c.nested);
      }
    }
  };
  for (const u of product.images || []) add(u);
  for (const v of product.variants || []) add(v?.imageUrl);
  for (const t of product.doTheJobRight?.items || []) add(t?.imageUrl);
  for (const c of product.coverage?.values || []) add(c?.imageUrl);
  add(product.promoBanner?.image);
  walk(product.nestedOptions);
  return map;
}

async function uploadRemoteImage(imageUrl, publicId, reuse) {
  const clean = absUrl(imageUrl).split("?")[0];
  if (!clean) return "";
  if (SKIP_IMAGES || DRY_RUN) return clean;
  if (/youtube\.com|youtu\.be/i.test(clean) || /^youtube:/i.test(clean)) {
    return clean;
  }
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
  let clean = absUrl(fileUrl);
  if (!clean) return "";
  clean = clean.split("?")[0];
  const ext = path.extname(clean).toLowerCase() || ".pdf";
  const base =
    slugify(path.parse(fileName || path.basename(clean)).name) || "file";
  const safe = `${base}${ext}`;
  const dir = ensurePublicDir("downloads", slugify(handle) || "misc");
  const dest = path.join(dir, safe);
  const publicPath = `/the-under-floor-heating/downloads/${slugify(handle) || "misc"}/${safe}`;
  if (DRY_RUN) return publicPath;
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0 && !FORCE) {
    return publicPath;
  }
  try {
    const res = await fetchWithRetry(clean);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return publicPath;
  } catch (e) {
    log(`file download fail ${clean}: ${e.message}`);
    return "";
  }
}

function extractPdfLinks(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(
    /<a[^>]+href=["']([^"']+\.pdf[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    let href = absUrl(m[1]);
    href = href.split("?")[0];
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const name =
      String(m[2] || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim() || path.basename(href);
    out.push({ href, name });
  }
  // also bare hrefs in JSON / src
  for (const m of String(html || "").matchAll(
    /https?:\/\/[^"'\\\s>]+\.pdf/gi,
  )) {
    const href = m[0].split("?")[0];
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, name: path.basename(href) });
  }
  return out;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;|&apos;/g, "'")
    .replace(/&pound;/g, "£")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * "More info" copy behind the ⓘ next to an option label, e.g. what 100W /
 * 150W / 200W each suit.  <label class="label">Wattage <span class="tt">…
 * <span role="tooltip" class="tt__box">HTML</span></span></label>
 */
function extractOptionInfo(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(
    /<label[^>]*class="[^"]*\blabel\b[^"]*"[^>]*>([\s\S]*?)<\/label>/gi,
  )) {
    const block = m[1];
    const tip = block.match(
      /class="[^"]*\btt__box\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    if (!tip) continue;
    const name = decodeEntities(block.split(/<span[^>]*class="[^"]*\btt\b/i)[0]);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rawHtml = tip[1].trim();
    const text = decodeEntities(rawHtml);
    if (!text) continue;
    out.push({ name, html: rawHtml.slice(0, 8000), text: text.slice(0, 8000) });
  }
  return out;
}

/** Files listed in the PDP "Manuals" disclosure. */
function extractManualLinks(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(
    /<a[^>]*class="[^"]*pdp_manual_link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = absUrl(m[1]).split("?")[0];
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, name: decodeEntities(m[2]) || path.basename(href) });
  }
  // href may precede class= in the tag
  for (const m of String(html || "").matchAll(
    /<a[^>]*href="([^"]+)"[^>]*class="[^"]*pdp_manual_link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = absUrl(m[1]).split("?")[0];
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, name: decodeEntities(m[2]) || path.basename(href) });
  }
  return out;
}

/** Per-variant merchandising labels: variantId → "OUR PICK". */
function extractVariantBadges(html) {
  const map = {};
  const parts = String(html || "").split(/class="[^"]*\bvariant-label\b[^"]*"/i);
  for (const part of parts.slice(1)) {
    const idMatch = part.match(/data-variant-id="(\d+)"/);
    if (!idMatch) continue;
    const chunk = part.slice(0, 900);
    const badge =
      chunk.match(/data-badge-id="([^"]+)"/)?.[1] ||
      decodeEntities(
        chunk.match(
          /class="[^"]*product-label[^"]*"[^>]*>([\s\S]{0,80}?)<\/span>/i,
        )?.[1] || "",
      );
    const clean = decodeEntities(badge);
    if (clean) map[idMatch[1]] = clean;
  }
  return map;
}

/** Promo strip above the buy box (<div class="product-banner">). */
function extractPromoBanner(html) {
  const block = String(html || "").match(
    /<div[^>]*class="[^"]*\bproduct-banner\b[^"]*"[^>]*>([\s\S]{0,3000}?)<\/div>/i,
  );
  if (!block) return null;
  const inner = block[1];
  const img = inner.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
  if (!img) return null;
  return {
    image: absUrl(img[1]).split("?")[0],
    url: absUrl(inner.match(/<a[^>]+href="([^"]+)"/i)?.[1] || ""),
    alt: decodeEntities(inner.match(/<img[^>]+alt="([^"]*)"/i)?.[1] || ""),
  };
}

async function uploadNestedImages(fields, handle, prefix = "opt", reuse) {
  const out = [];
  for (let i = 0; i < (fields || []).length; i++) {
    const f = fields[i];
    const choices = [];
    for (let j = 0; j < (f.choices || []).length; j++) {
      const c = f.choices[j];
      let imageUrl = c.imageUrl || "";
      if (imageUrl && !/^youtube:/i.test(imageUrl)) {
        imageUrl = await uploadRemoteImage(
          imageUrl,
          `${handle}-${prefix}-${i}-${j}`,
          reuse,
        );
      }
      const nested = await uploadNestedImages(
        c.nested || [],
        handle,
        `${prefix}-${i}-${j}`,
        reuse,
      );
      choices.push({ ...c, imageUrl, nested });
    }
    out.push({ ...f, choices });
  }
  return out;
}

function extractGpoOptionsMap(html) {
  const map = {};
  const re = /GPOConfigs\.options\[(\d+)\]\s*=\s*/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    const start = m.index + m[0].length;
    if (html[start] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = start; j < html.length; j++) {
      const ch = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            map[id] = JSON.parse(html.slice(start, j + 1));
          } catch {
            /* skip */
          }
          break;
        }
      }
    }
  }
  return map;
}

function choiceImage(c) {
  if (!c || typeof c !== "object") return "";
  if (c.asset_name) {
    return `https://www.theunderfloorheatingstore.com/cdn/shop/files/${c.asset_name}`;
  }
  return (
    c.image ||
    c.img ||
    c.src ||
    c.swatch ||
    c.thumbnail ||
    c.image_url ||
    (typeof c.image_src === "string" ? c.image_src : "") ||
    c?.image?.src ||
    c?.value?.src ||
    ""
  );
}

function simplifyElements(elements) {
  const out = [];
  for (const [i, el] of (elements || []).entries()) {
    if (!el || typeof el !== "object") continue;
    const type = String(el.type || "");
    if (/^(spacing|paragraph|html|modal|icon)$/i.test(type)) continue;
    const label = String(el.label || el.label_en || el.name || "").trim();
    if (!label && type !== "group") continue;

    const childElements = Array.isArray(el.elements) ? el.elements : [];
    const rawChoices =
      el.option_values ||
      el.options ||
      el.values ||
      el.swatches ||
      el.items ||
      el.list ||
      [];
    const choices = [];
    for (const c of rawChoices) {
      if (typeof c === "string") {
        if (!c.trim()) continue;
        choices.push({
          label: c.trim(),
          value: c.trim(),
          imageUrl: "",
          priceAdjustment: 0,
          helptext: "",
          nested: [],
        });
        continue;
      }
      if (!c || typeof c !== "object") continue;
      const cLabel = String(
        c.value_en ||
          c.value ||
          c.label ||
          c.label_en ||
          c.name ||
          c.title ||
          "",
      ).trim();
      if (!cLabel || /^\d+$/.test(cLabel)) {
        // name is sometimes a numeric asset id — prefer value fields already tried
        if (!String(c.value_en || c.value || "").trim()) continue;
      }
      const labelFinal = String(c.value_en || c.value || cLabel).trim();
      if (!labelFinal) continue;
      const price =
        Number(
          c.variant_price ??
            c.price ??
            c.price_adjustment ??
            c.amount ??
            c.addon_price ??
            0,
        ) || 0;
      // Option prices arrive in pounds; a "large integers are pennies" guess
      // would turn a £250 add-on into £2.50.
      const priceAdjustment = price;
      const img =
        choiceImage(c) ||
        c?.image?.src ||
        c?.img_url ||
        (Array.isArray(c.images) ? c.images[0] : "") ||
        "";
      choices.push({
        label: labelFinal,
        value: String(c.value ?? c.id ?? labelFinal),
        imageUrl: absUrl(String(img || "")),
        priceAdjustment,
        helptext: String(c.helptext || c.helptext_en || "").trim(),
        nested: simplifyElements(c.elements || c.children || []),
      });
    }

    if (type === "group" && childElements.length) {
      out.push(...simplifyElements(childElements));
      continue;
    }

    out.push({
      id: String(el.id || `field-${i}`),
      label: label || "Options",
      helptext: String(el.helptext || el.helptext_en || "").trim(),
      type: type || "image-swatches",
      required: Boolean(el.required),
      sortOrder: i,
      choices,
    });
  }
  // Globo often repeats the same conditional field (e.g. 4× "Accessory Kit").
  const seen = new Set();
  return out.filter((field) => {
    const sig = `${String(field.label || "")
      .trim()
      .toLowerCase()}::${(field.choices || [])
      .map((c) => `${c.label}|${c.priceAdjustment || 0}`)
      .join("||")}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

function cleanRichText(raw) {
  return String(raw || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .trim();
}

function captureChoices(el) {
  const raw =
    el.option_values || el.options || el.values || el.swatches || el.items || [];
  const out = [];
  for (const c of raw) {
    if (typeof c === "string") {
      if (!c.trim()) continue;
      out.push({
        value: c.trim(),
        label: c.trim(),
        helptext: "",
        color1: "",
        color2: "",
        colorType: "",
        imageUrl: "",
        priceAdjustment: 0,
        productHandle: "",
        variantId: "",
        available: true,
      });
      continue;
    }
    if (!c || typeof c !== "object") continue;
    const value = String(c.value_en ?? c.value ?? c.label ?? c.name ?? "").trim();
    if (!value || /^\d{10,}$/.test(value)) continue;
    const price =
      Number(c.variant_price ?? c.price ?? c.price_adjustment ?? c.amount ?? 0) ||
      0;
    out.push({
      value,
      label: value,
      helptext: String(c.helptext_en || c.helptext || "").trim(),
      color1: String(c.color1 || "").trim(),
      color2: String(c.color2 || "").trim(),
      colorType: String(c.color_type || "").trim(),
      imageUrl: absUrl(String(choiceImage(c) || "")),
      priceAdjustment: price,
      productHandle: String(c.product_handle || "").trim(),
      variantId: String(c.variant_id || "").trim(),
      available: c.available !== false,
    });
  }
  return out;
}

/**
 * Flatten the Globo option tree into an ordered list, keeping everything the
 * supplier PDP renders: paragraphs used as headings, conditional copy, swatch
 * colours, pre-selected defaults and the show/hide rules (`clo`). Group
 * conditions are inherited by their children so the flat list evaluates the
 * same way the nested tree does.
 */
function captureGloboElements(elements, inherited = [], out = []) {
  for (const el of elements || []) {
    if (!el || typeof el !== "object") continue;
    const own =
      el.clo && Array.isArray(el.clo.whens) && el.clo.whens.length
        ? [
            {
              match: String(el.clo.match || "all"),
              display: String(el.clo.display || "show"),
              whens: el.clo.whens.map((w) => ({
                select: String(w.select ?? ""),
                where: String(w.where || "EQUALS"),
                value: String(w.value ?? ""),
              })),
            },
          ]
        : [];
    const conditions = [...inherited, ...own];

    if (String(el.type) === "group") {
      captureGloboElements(el.elements || [], conditions, out);
      continue;
    }

    // Globo marks multi-select with a `_multiple` type suffix (and checkbox).
    const rawType = String(el.type || "").trim();
    const baseType = rawType.replace(/_multiple$/i, "");
    out.push({
      id: String(el.id || `el-${out.length}`),
      type: baseType,
      label: String(el.label_en || el.label || "").trim(),
      labelHidden: Boolean(el.hidden_label),
      required: Boolean(el.required),
      multiple:
        /_multiple$/i.test(rawType) ||
        baseType === "checkbox" ||
        Boolean(el.multiple_selection || el.multiple),
      /** Globo pre-selects (and locks) the first value for these. */
      deselectNotAllowed: Boolean(el.deselect_not_allowed),
      helptext: String(el.helptext_en || el.helptext || "").trim(),
      text: cleanRichText(el.text_en || el.text || el.content || el.html || ""),
      columnWidth: Number(el.columnWidth) || 100,
      style: String(el.style || "").trim(),
      /** "color" renders the swatch colour even when a photo is attached. */
      swatchStyle: String(el.swatch_style || "").trim(),
      swatchesPerRow: Number(el.swatches_per_row) || 0,
      swatchWidth: Number(el.color_width || el.image_width) || 0,
      swatchHeight: Number(el.color_height || el.image_height) || 0,
      defaultValue: (Array.isArray(el.default_value) ? el.default_value : [])
        .map((v) => String(v))
        .filter(Boolean),
      conditions,
      choices: captureChoices(el),
    });
  }
  return out;
}

async function uploadElementImages(elements, handle, reuse) {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    for (let j = 0; j < el.choices.length; j++) {
      const c = el.choices[j];
      if (!c.imageUrl || /^youtube:/i.test(c.imageUrl)) continue;
      c.imageUrl = await uploadRemoteImage(
        c.imageUrl,
        `${handle}-el-${i}-${j}`,
        reuse,
      );
    }
  }
  return elements;
}

/** Globo normalises TITLE/TYPE/VENDOR/TAG comparisons with trim+lowercase. */
function gpoNorm(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/**
 * Mirrors the option app's own product matcher (gpomain.js): a set applies to
 * every product, to an explicit id list, or to automated tag / vendor / type /
 * title / collection / price conditions combined with and / or.
 */
function gpoSetApplies(setObj, productJs, collections) {
  const rule = setObj?.products?.rule;
  if (!rule) return false;
  if (rule.all?.enable) return true;
  if (rule.manual?.enable) {
    return (rule.manual.ids || [])
      .map(String)
      .includes(String(productJs.id || ""));
  }
  if (!rule.automate?.enable) return false;
  const conditions = rule.automate.conditions || [];
  if (!conditions.length) return false;

  const results = conditions.map((cond) => {
    const select = String(cond.select || "").toUpperCase();
    let want = cond.value;
    if (["TITLE", "TYPE", "VENDOR", "TAG"].includes(select)) {
      want = gpoNorm(cond.value);
    } else if (select === "VARIANT_PRICE") {
      want = 100 * parseFloat(cond.value);
    }

    let actual;
    let isList = false;
    switch (select) {
      case "TITLE":
        actual = gpoNorm(productJs.title);
        break;
      case "TYPE":
        actual = gpoNorm(productJs.type);
        break;
      case "VENDOR":
        actual = gpoNorm(productJs.vendor);
        break;
      case "VARIANT_PRICE":
        actual = Number(productJs.price);
        break;
      case "TAG":
        actual = (productJs.tags || []).map(gpoNorm);
        isList = true;
        break;
      case "COLLECTION":
        actual = (collections || []).map(String);
        isList = true;
        break;
      default:
        return false;
    }

    switch (String(cond.where || "EQUALS").toUpperCase()) {
      case "EQUALS":
        return isList ? actual.includes(want) : actual === want;
      case "NOT_EQUALS":
        return isList ? !actual.includes(want) : actual !== want;
      case "STARTS_WITH":
        return String(actual).startsWith(String(want));
      case "ENDS_WITH":
        return String(actual).endsWith(String(want));
      case "GREATER_THAN":
        return actual > want;
      case "LESS_THAN":
        return actual < want;
      case "CONTAINS":
        return isList
          ? actual.includes(want)
          : String(actual).includes(String(want));
      case "NOT_CONTAINS":
        return isList
          ? !actual.includes(want)
          : !String(actual).includes(String(want));
      default:
        return false;
    }
  });

  return String(rule.automate.operator || "and").toLowerCase() === "or"
    ? results.some(Boolean)
    : results.every(Boolean);
}

/**
 * Every *active* option set that targets this product, in set-id order.
 * `status: 0` is live; archived sets keep a `status: 1` copy of the same rules
 * and would otherwise duplicate the whole flow.
 */
function pickGpoSets(map, productJs, collections) {
  const matching = [];
  for (const [setId, obj] of Object.entries(map)) {
    if (Number(obj?.status ?? 0) !== 0) continue;
    if (gpoSetApplies(obj, productJs, collections)) matching.push({ setId, obj });
  }
  matching.sort((a, b) => Number(a.setId) - Number(b.setId));
  return matching;
}

function extractDoTheJob(fields) {
  for (const field of fields || []) {
    if (/do the job right|tools and testing/i.test(field.label || "")) {
      return {
        label: field.label,
        helptext: field.helptext || "",
        items: (field.choices || []).map((c, i) => ({
          name: c.label,
          imageUrl: c.imageUrl || "",
          priceAdjustment: c.priceAdjustment || 0,
          description: c.helptext || "",
          sortOrder: i,
        })),
      };
    }
    for (const choice of field.choices || []) {
      const nested = extractDoTheJob(choice.nested || []);
      if (nested) return nested;
    }
  }
  return null;
}

function stripDoTheJob(fields) {
  return (fields || [])
    .filter((f) => !/do the job right|tools and testing/i.test(f.label || ""))
    .map((f) => ({
      ...f,
      choices: (f.choices || []).map((c) => ({
        ...c,
        nested: stripDoTheJob(c.nested || []),
      })),
    }));
}

function buildGallery(productJs) {
  const urls = [];
  const media = productJs.media || [];
  if (media.length) {
    for (const m of media) {
      if (m.media_type === "external_video" && m.host === "youtube" && m.external_id) {
        urls.push(`youtube:${m.external_id}`);
        continue;
      }
      if (m.media_type === "video") {
        const src = (m.sources || []).find((s) => /mp4/i.test(s.format || s.url || ""))?.url
          || (m.sources || [])[0]?.url;
        if (src) urls.push(src);
        continue;
      }
      const src = m.src || m.preview_image?.src;
      if (src) urls.push(absUrl(src));
    }
  } else {
    for (const img of productJs.images || []) {
      const src = typeof img === "string" ? img : img.src;
      if (src) urls.push(absUrl(src));
    }
  }
  // de-dupe preserve order
  const seen = new Set();
  return urls.filter((u) => {
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function main() {
  if (RESUME) {
    fs.appendFileSync(LOG, `\nUFHS enrich RESUME ${new Date().toISOString()}\n`);
  } else {
    fs.writeFileSync(LOG, `UFHS enrich ${new Date().toISOString()}\n`);
  }
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Brand not found");

  const filter = {
    brand: brand._id,
    ...(ONLY_HANDLE
      ? { "specs.ufhsHandle": ONLY_HANDLE }
      : { "specs.ufhsHandle": { $exists: true, $ne: "" } }),
    ...(RESUME && !ONLY_HANDLE
      ? {
          // Re-enrich anything never scraped, flagged by the parity audit, or
          // captured before the current scrape covered every PDP block.
          $or: [
            { "specs.enrichedAt": { $exists: false } },
            { "specs.enrichedAt": null },
            { "specs.enrichedAt": "" },
            { "specs.parityVersion": { $exists: false } },
            { "specs.parityVersion": { $lt: PARITY_VERSION } },
          ],
        }
      : {}),
  };
  let products = await db.collection("products").find(filter).toArray();
  if (LIMIT > 0) products = products.slice(0, LIMIT);
  ensurePublicDir("downloads");
  log(
    `Enriching ${products.length} products concurrency=${CONCURRENCY} force=${FORCE ? 1 : 0} resume=${RESUME ? 1 : 0} gap=${REQUEST_GAP_MS}ms`,
  );

  let ok = 0;
  let fail = 0;

  await mapPool(products, CONCURRENCY, async (product, idx) => {
    const handle = String(product.specs?.ufhsHandle || "").trim();
    const label = `[${idx + 1}/${products.length}]`;
    if (!handle) {
      log(`${label} skip no handle ${product.name}`);
      return;
    }
    const reuse = buildReuseMap(product);
    try {
      // Sequential fetches reduce burst 429s vs Promise.all
      const productJs = await fetchJson(`${BASE}/products/${handle}.js`);
      await delay(REQUEST_GAP_MS);
      const html = await fetchText(`${BASE}/products/${handle}`);
      await delay(REQUEST_GAP_MS);

      const galleryRemote = buildGallery(productJs);
      const gallery = [];
      /** remote CDN url (query stripped) → hosted url, reused for variants. */
      const hostedByRemote = new Map();
      for (let i = 0; i < galleryRemote.length; i++) {
        const src = galleryRemote[i];
        if (/^youtube:/i.test(src) || /\.mp4(\?|$)/i.test(src)) {
          gallery.push(src);
        } else {
          const hosted = await uploadRemoteImage(
            src,
            `${handle}-g${i + 1}`,
            reuse,
          );
          hostedByRemote.set(src.split("?")[0], hosted);
          gallery.push(hosted);
        }
      }

      const shopifyOptions = (productJs.options || [])
        .map((o, i) => {
          if (typeof o === "string") {
            return { name: o, position: i + 1, values: [] };
          }
          return {
            name: String(o.name || "").trim(),
            position: Number(o.position) || i + 1,
            values: (o.values || []).map((v) => String(v)),
          };
        })
        .filter((o) => o.name && !/^title$/i.test(o.name));

      // Fill option values from variants when missing
      for (const axis of shopifyOptions) {
        if (axis.values.length) continue;
        const set = new Set();
        for (const v of productJs.variants || []) {
          const val =
            axis.position === 1
              ? v.option1
              : axis.position === 2
                ? v.option2
                : v.option3;
          if (val) set.add(String(val));
        }
        axis.values = [...set];
      }

      const variantBadges = extractVariantBadges(html);
      const variants = (productJs.variants || []).map((v, vi) => ({
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
        imageUrl: (() => {
          const src = absUrl(v.featured_image?.src || "").split("?")[0];
          if (!src) return "";
          return hostedByRemote.get(src) || src;
        })(),
        badge: variantBadges[String(v.id)] || "",
        externalId: String(v.id || ""),
        barcode: String(v.barcode || "").trim(),
        weight: Number(v.weight) > 0 ? Number(v.weight) : null,
        position: vi + 1,
        quantityPriceBreaks: (v.quantity_price_breaks || []).map((b) => ({
          minimumQuantity: Number(b.minimum_quantity) || 0,
          price: Number(b.price) > 0 ? Math.round(Number(b.price)) / 100 : 0,
        })),
        options: {
          ...(v.option1 ? { [shopifyOptions[0]?.name || "option1"]: v.option1 } : {}),
          ...(v.option2 ? { [shopifyOptions[1]?.name || "option2"]: v.option2 } : {}),
          ...(v.option3 ? { [shopifyOptions[2]?.name || "option3"]: v.option3 } : {}),
        },
        isDefault: false,
      }));
      if (variants[0]) variants[0].isDefault = true;

      const optionInfo = extractOptionInfo(html);
      const infoFor = (name) =>
        optionInfo.find(
          (i) => i.name.toLowerCase() === String(name || "").toLowerCase(),
        )?.text || "";

      const coverageAxis = shopifyOptions.find((o) =>
        /coverage/i.test(o.name),
      );
      const coverage = coverageAxis
        ? {
            label: coverageAxis.name || "Coverage",
            helptext: infoFor(coverageAxis.name),
            values: coverageAxis.values.map((name, i) => ({
              name,
              imageUrl: "",
              priceAdjustment: 0,
              sku: "",
              sortOrder: i,
            })),
          }
        : { label: "Coverage", helptext: "", values: [] };

      const gpoMap = extractGpoOptionsMap(html);
      const gpoSets = pickGpoSets(
        gpoMap,
        productJs,
        product.specs?.ufhsCollections || [],
      );
      // A product can be targeted by several sets — the app renders them all.
      const gpoElements = gpoSets.flatMap((s) => s.obj.elements || []);
      let nestedOptions = [];
      let doTheJobRight = {
        label: "Do the Job Right - Tools and Testing Equipment",
        helptext: "",
        items: [],
      };
      let optionElements = [];
      if (gpoElements.length) {
        optionElements = await uploadElementImages(
          captureGloboElements(gpoElements),
          handle,
          reuse,
        );
        nestedOptions = simplifyElements(gpoElements);
        const job = extractDoTheJob(nestedOptions);
        if (job) {
          doTheJobRight = job;
          nestedOptions = stripDoTheJob(nestedOptions);
        }
      }
      nestedOptions = await uploadNestedImages(
        nestedOptions,
        handle,
        "gpo",
        reuse,
      );
      if (doTheJobRight.items?.length) {
        for (let ti = 0; ti < doTheJobRight.items.length; ti++) {
          const item = doTheJobRight.items[ti];
          if (item.imageUrl) {
            item.imageUrl = await uploadRemoteImage(
              item.imageUrl,
              `${handle}-tool-${ti + 1}`,
              reuse,
            );
          }
        }
      }

      const description =
        String(productJs.description || "")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .trim() || product.description;

      const price =
        variants.find((v) => v.available && v.price > 0)?.price ||
        variants[0]?.price ||
        product.price;

      const compareAt =
        Number(productJs.compare_at_price) > 0
          ? Math.round(Number(productJs.compare_at_price)) / 100
          : null;

      const hasMeasureMyRoom =
        /Measure My Room|room-calc-modal-app|rmc-open/i.test(html);

      const tags = Array.isArray(productJs.tags)
        ? productJs.tags.map(String)
        : String(productJs.tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);

      // PDFs → public folder + schema downloads / guides / brochures.
      // The "Manuals" disclosure wins on titles; other PDFs on the page follow.
      const manualLinks = extractManualLinks(html);
      const manualHrefs = new Set(manualLinks.map((f) => f.href));
      const pdfLinks = [
        ...manualLinks,
        ...extractPdfLinks(html).filter((f) => !manualHrefs.has(f.href)),
      ];
      const manuals = [];
      const downloads = [];
      const installationMaintenanceGuides = [];
      const brochures = [];
      for (const f of pdfLinks.slice(0, 20)) {
        const local = await downloadFileToPublic(f.href, handle, f.name);
        if (!local) continue;
        const title = f.name.replace(/\.pdf$/i, "").trim() || "Download";
        if (manualHrefs.has(f.href)) manuals.push({ name: title, url: local });
        const isInstall = /install|guide|manual|instruction/i.test(title + f.href);
        const isBrochure = /brochure|catalogue|catalog|range/i.test(
          title + f.href,
        );
        downloads.push({
          title,
          url: local,
          type: isInstall ? "install" : "pdf",
        });
        if (isInstall) {
          installationMaintenanceGuides.push({ name: title, url: local });
        } else if (isBrochure) {
          brochures.push({ name: title, url: local });
        } else {
          installationMaintenanceGuides.push({ name: title, url: local });
        }
      }

      const bannerRaw = extractPromoBanner(html);
      const promoBanner = bannerRaw
        ? {
            image: await uploadRemoteImage(
              bannerRaw.image,
              `${handle}-banner`,
              reuse,
            ),
            url: bannerRaw.url,
            alt: bannerRaw.alt,
          }
        : { image: "", url: "", alt: "" };

      const badges = [
        ...new Set(variants.map((v) => v.badge).filter(Boolean)),
      ];

      const videos = gallery.filter(
        (u) => /^youtube:/i.test(u) || /\.mp4(\?|$)/i.test(u),
      );
      const available = productJs.available !== false;
      const stock = available
        ? Math.max(Number(product.stock) || 0, 25)
        : 0;

      const specs = {
        ...(product.specs || {}),
        ufhsHandle: handle,
        ufhsId: productJs.id,
        sourceUrl: `${BASE}/products/${handle}`,
        vendorBrand: productJs.vendor || product.specs?.vendorBrand || "",
        productType: productJs.type || "",
        tags: tags.slice(0, 60),
        gpoSetIds: gpoSets.map((s) => s.setId),
        gpoSetId: gpoSets[0]?.setId || "",
        galleryHasVideo: videos.length > 0,
        hasMeasureMyRoom,
        shopifyCompareAt: compareAt,
        available,
        priceMin:
          Number(productJs.price_min) > 0
            ? Math.round(Number(productJs.price_min)) / 100
            : price,
        priceMax:
          Number(productJs.price_max) > 0
            ? Math.round(Number(productJs.price_max)) / 100
            : price,
        enrichedAt: new Date().toISOString(),
        fullParityAt: new Date().toISOString(),
        parityVersion: PARITY_VERSION,
      };

      const $set = {
        name: String(productJs.title || product.name).trim() || product.name,
        description: description.slice(0, 50000),
        tagline: String(productJs.vendor || product.tagline || "").trim(),
        price,
        images: gallery.length ? gallery : product.images,
        videos,
        shopifyOptions,
        variants,
        coverage,
        nestedOptions,
        optionElements,
        doTheJobRight,
        optionInfo,
        manuals,
        badges,
        promoBanner,
        downloads,
        installationMaintenanceGuides,
        brochures,
        keywords: tags.slice(0, 40),
        stock,
        stockStatus: available ? "in_stock" : "out_of_stock",
        isOutOfStock: !available,
        stockAvailabilityText: available ? "In stock" : "Out of stock",
        specs,
        showSpecs: true,
        updatedAt: new Date(),
        priceSyncedAt: new Date(),
        stockSyncedAt: new Date(),
      };

      log(
        `${label} ${DRY_RUN ? "[dry] " : ""}${$set.name} opts=${shopifyOptions.map((o) => o.name).join("+") || "-"} vars=${variants.length} media=${gallery.length} nested=${nestedOptions.length} tools=${doTheJobRight.items.length} files=${downloads.length} manuals=${manuals.length} info=${optionInfo.length} badges=${badges.length} banner=${promoBanner.image ? 1 : 0} measure=${hasMeasureMyRoom ? 1 : 0} gpo=${gpoSets.map((s) => s.setId).join("+") || "-"}`,
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
