/**
 * Enrich / import Fakro products from https://cambridgeskylights.co.uk
 *
 * - Count CSL Fakro catalog
 * - Import products missing from Mongo
 * - For each CSL Fakro product: scrape description, gallery, technical specs,
 *   installation guide, Flashing Finder (+ flashings options if empty)
 * - Size: CSL uses mm; Linx names mostly use cm — match by converting and
 *   store dimensions.widthMm / heightMm (and cm)
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/enrich-fakro-from-cambridge.cjs
 *
 * Options:
 *   DRY_RUN=1 LIMIT=20 CONCURRENCY=2 SKIP_IMAGES=1 IMPORT_MISSING=1
 *   ENRICH_ONLY=1  — do not create missing products
 *   FORCE_OPTIONS=1 — always overwrite finishes / flashings / insulating / installation guide
 *   ONLY_HANDLES=a,b,c  or ONLY_HANDLES_FILE=scripts/_tmp-fakro-csl-failed-handles.json
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
const {
  fetchCloudliftOptionsJs,
  parseCloudliftOptionsJs,
} = require("./lib-cloudlift-options.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BASE = "https://cambridgeskylights.co.uk";
const BRAND_SLUG = "fakro";
const SOURCE_TAG = "cambridge-skylights-fakro";
const CLOUDINARY_FOLDER = "linx-living/products/fakro";
const PUBLIC_DIR = path.join(__dirname, "..", "public", "fakro");
const LOG = path.join(__dirname, "_tmp-fakro-csl-enrich.log");
const REPORT = path.join(__dirname, "_tmp-fakro-csl-enrich-report.json");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const IMPORT_MISSING = process.env.IMPORT_MISSING !== "0";
const ENRICH_ONLY = process.env.ENRICH_ONLY === "1";
/** Always write Finish / Flashing / Insulating / Installation guide when scraped. */
const FORCE_OPTIONS = process.env.FORCE_OPTIONS !== "0";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const REQUEST_GAP_MS = Math.max(0, Number(process.env.REQUEST_GAP_MS || 300));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);
const FETCH_RETRIES = Math.max(1, Number(process.env.FETCH_RETRIES || 5));

function loadOnlyHandles() {
  if (process.env.ONLY_HANDLES) {
    return process.env.ONLY_HANDLES.split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (process.env.ONLY_HANDLES_FILE) {
    const p = path.isAbsolute(process.env.ONLY_HANDLES_FILE)
      ? process.env.ONLY_HANDLES_FILE
      : path.join(process.cwd(), process.env.ONLY_HANDLES_FILE);
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (Array.isArray(raw)) {
      return raw
        .map((x) => (typeof x === "string" ? x : x.handle))
        .filter(Boolean);
    }
  }
  return [];
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, `${line}\n`);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(src) {
  if (!src) return "";
  if (/^https?:/i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  return `${BASE}${src.startsWith("/") ? "" : "/"}${src}`;
}

/** Parse WxH from titles. Returns mm always. */
function parseSizeMm(title) {
  const s = String(title || "");
  let m = s.match(/(\d{2,4})\s*cm\s*[x×]\s*(\d{2,4})\s*cm/i);
  if (m) {
    return {
      widthMm: Number(m[1]) * 10,
      heightMm: Number(m[2]) * 10,
      widthCm: Number(m[1]),
      heightCm: Number(m[2]),
      sourceUnit: "cm",
    };
  }
  m = s.match(/(\d{2,4})\s*[x×]\s*(\d{2,4})\s*mm/i);
  if (m) {
    return {
      widthMm: Number(m[1]),
      heightMm: Number(m[2]),
      widthCm: Number(m[1]) / 10,
      heightCm: Number(m[2]) / 10,
      sourceUnit: "mm",
    };
  }
  m = s.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})(?!\s*cm)/i);
  if (m) {
    return {
      widthMm: Number(m[1]),
      heightMm: Number(m[2]),
      widthCm: Number(m[1]) / 10,
      heightCm: Number(m[2]) / 10,
      sourceUnit: "mm",
    };
  }
  m = s.match(/(\d{2})\s*[x×]\s*(\d{2,3})(?!\d)/);
  if (m && Number(m[1]) < 200) {
    return {
      widthMm: Number(m[1]) * 10,
      heightMm: Number(m[2]) * 10,
      widthCm: Number(m[1]),
      heightCm: Number(m[2]),
      sourceUnit: "cm",
    };
  }
  return null;
}

function modelTokens(title) {
  const t = String(title || "");
  const found = new Set();
  const patterns = [
    /FTP-V\/C/i,
    /FPU-V\/C/i,
    /FTW-V\/C/i,
    /FTP-V/i,
    /FTW-V/i,
    /FPU-V/i,
    /FTU-V/i,
    /PTP-V/i,
    /DXF/i,
    /DEF/i,
    /DMR/i,
    /DMC/i,
    /DW[A-Z0-9-]*/i,
    /LWK[A-Z0-9-]*/i,
    /LST[A-Z0-9-]*/i,
    /ELJ\/C/i,
    /ELV\/C/i,
    /EZV-?A/i,
    /EZJ-?A/i,
    /ELV-?A/i,
    /ELJ-?A/i,
    /EPV/i,
    /EPJ/i,
    /EHN/i,
    /ESA/i,
    /EZV/i,
    /EZJ/i,
    /ELV/i,
    /ELJ/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) found.add(m[0].toUpperCase().replace(/\s+/g, ""));
  }
  return [...found];
}

/** Coarse type so we never map a window PDP onto a flashing kit (or vice versa). */
function productKind(title, productType = "") {
  // Prefer the product title for kind — category/type strings like
  // "roof-windows-with-recessed-flashing" must not reclassify a Flashing Kit.
  const titleOnly = String(title || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ");
  const typeOnly = String(productType || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ");
  const t = `${titleOnly} ${typeOnly}`.trim();

  // Standalone flashing kits (not "roof window with recessed flashing" bundles)
  if (
    /\bflashing kit\b|\bflashings?\b|\(elj|\(elv|\(ezv|\(ezj|\(epv|\(epj|\belj\/|\belv\//.test(
      titleOnly,
    ) &&
    !/roof window|rooflight|centre pivot|center pivot|top hung/.test(titleOnly)
  ) {
    return "flashing";
  }
  // Window PDPs that *include* a flashing in the name are still windows
  if (
    /roof window|rooflight|skylight|centre pivot|center pivot|top hung|walk on|dome window/.test(
      titleOnly,
    )
  ) {
    return "window";
  }
  if (/loft ladder|attic ladder/.test(t)) return "ladder";
  if (/blind|roller|venetian|blackout/.test(t)) return "blind";
  if (/sealant|tape|coating|accessory|fitters? pack/.test(t)) return "accessory";
  if (/lantern|fixed frameless|conservation style.*window|window.*conservation/.test(titleOnly))
    return "window";
  if (/\bwindow\b/.test(titleOnly)) return "window";
  return "other";
}

function sizeKey(sz) {
  if (!sz) return "";
  return `${sz.widthMm}x${sz.heightMm}`;
}

async function fetchWithRetry(url, init = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent": "Mozilla/5.0 LinxFakroCsl/1.0",
          ...(init.headers || {}),
        },
      });
      if (res.status === 429 || res.status === 503) {
        const wait = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
        log(`HTTP ${res.status} ${url} — retry ${attempt}/${FETCH_RETRIES} in ${wait}ms`);
        await delay(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt >= FETCH_RETRIES) break;
      const wait = Math.min(30_000, 1_500 * 2 ** (attempt - 1));
      log(`fetch err ${url}: ${e.message} — retry ${attempt}/${FETCH_RETRIES} in ${wait}ms`);
      await delay(wait);
    }
  }
  throw lastErr || new Error(`fetch failed ${url}`);
}

async function fetchJson(url) {
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json" },
  });
  return res.json();
}

async function fetchText(url) {
  const res = await fetchWithRetry(url);
  return res.text();
}

async function fetchAllCslFakro() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const data = await fetchJson(
      `${BASE}/products.json?limit=250&page=${page}`,
    );
    const rows = (data.products || []).filter((p) =>
      /fakro/i.test(p.vendor || ""),
    );
    out.push(...rows);
    if ((data.products || []).length < 250) break;
  }
  return out;
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = absUrl(imageUrl).split("?")[0];
  if (!clean || !/^https?:/i.test(clean)) return "";
  if (SKIP_IMAGES || DRY_RUN) return clean;
  try {
    const result = await cloudinary.uploader.upload(clean, {
      folder: CLOUDINARY_FOLDER,
      public_id: String(publicId).slice(0, 180),
      overwrite: true,
      resource_type: "image",
    });
    return result.secure_url || clean;
  } catch {
    return clean;
  }
}

function ensurePublicDir(...parts) {
  const dir = path.join(PUBLIC_DIR, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function downloadPdf(fileUrl, handle, name) {
  const clean = absUrl(fileUrl).split("?")[0];
  if (!/\.pdf/i.test(clean)) return "";
  const safe = `${slugify(name || path.basename(clean))}.pdf`;
  const dir = ensurePublicDir("downloads", slugify(handle));
  const dest = path.join(dir, safe);
  const publicPath = `/fakro/downloads/${slugify(handle)}/${safe}`;
  if (DRY_RUN) return publicPath;
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return publicPath;
  try {
    const res = await fetch(clean, {
      headers: { "User-Agent": "Mozilla/5.0 LinxFakroCsl/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return publicPath;
  } catch (e) {
    log(`pdf fail ${clean}: ${e.message}`);
    return "";
  }
}

function extractFlashingFinder(html) {
  const items = [];
  const seen = new Set();
  // blocks: img + strong title + description
  const re =
    /<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][\s\S]{0,400}?<strong>([\s\S]*?)<\/strong>\s*<br\s*\/?>\s*([\s\S]*?)<\/div>\s*<\/div>/gi;
  for (const m of html.matchAll(re)) {
    const title = cleanText(m[3]);
    if (!/flashing|EZV|EZJ|ELV|ELJ|EPV|EPJ|EHN|ESA|ES[AJVZ]/i.test(title))
      continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      title,
      description: cleanText(m[4]).slice(0, 2000),
      imageUrl: absUrl(m[1]),
    });
  }
  // fallback: strong titles only near flashing
  if (!items.length) {
    for (const m of html.matchAll(/<strong>([\s\S]*?Flashing[\s\S]*?)<\/strong>/gi)) {
      const title = cleanText(m[1]);
      if (!title || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      items.push({ title, description: "", imageUrl: "" });
    }
  }
  return items;
}

function extractTabHtml(html, labelRe) {
  const btn = html.match(
    new RegExp(
      `aria-controls="(product-tab--[^"]+)"[\\s\\S]{0,500}?${labelRe}`,
      "i",
    ),
  );
  if (!btn) return "";
  const id = btn[1];
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return "";
  const slice = html.slice(start, start + 50000);
  const endMatch = slice.slice(20).search(/id="product-tab--/);
  const body = endMatch > 0 ? slice.slice(0, endMatch + 20) : slice.slice(0, 20000);
  return body;
}

function extractSpecsFromHtml(html) {
  const specs = {};
  const tech = extractTabHtml(html, "Technical Specs");
  const src = tech || html;
  for (const row of src.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const cells = [...row[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
      (c) => cleanText(c[1]),
    );
    if (cells.length >= 2 && cells[0] && cells[1]) {
      specs[cells[0]] = cells[1];
    }
  }
  for (const m of src.matchAll(
    /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi,
  )) {
    const k = cleanText(m[1]);
    const v = cleanText(m[2]);
    if (k && v) specs[k] = v;
  }
  // Also parse bold label lines in tech tab
  for (const m of src.matchAll(
    /<strong>([\s\S]*?)<\/strong>\s*:?\s*([^<]+)/gi,
  )) {
    const k = cleanText(m[1]).replace(/:$/, "");
    const v = cleanText(m[2]);
    if (k && v && v.length < 200) specs[k] = v;
  }
  return specs;
}

/** Prefer the Installation Guide column body (heading + links), not the raw tab <li>. */
function extractInstallationGuide(html) {
  const headingRe =
    /<h3[^>]*class="[^"]*product-tabs__tab-heading[^"]*"[^>]*>\s*Installation Guide\s*<\/h3>\s*<div[^>]*class="[^"]*product-tabs__tab-text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i;
  let m = html.match(headingRe);
  let inner = m ? m[1] : "";

  if (!inner) {
    const tab = extractTabHtml(html, "Installation Guide");
    if (tab) {
      const innerMatch = tab.match(
        /product-tabs__tab-text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
      );
      inner = innerMatch ? innerMatch[1] : tab;
    }
  }

  if (!inner) return { html: "", text: "", pdfs: [], videos: [] };

  const cleanedHtml = inner
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .trim()
    .slice(0, 50000);
  const text = cleanText(cleanedHtml);
  const pdfs = [
    ...cleanedHtml.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi),
  ].map((x) => absUrl(x[1]));
  const videos = [
    ...cleanedHtml.matchAll(
      /href=["'](https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)[^"']+)["']/gi,
    ),
  ].map((x) => x[1]);

  return { html: cleanedHtml, text, pdfs, videos };
}

function extractInsulatingSetPrice(html, description) {
  const blob = `${html}\n${description}`;
  const m =
    blob.match(/insulating\s*set[^£]{0,40}£\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
    blob.match(/£\s*([0-9]+(?:\.[0-9]{2})?)\s*[^.]{0,20}insulating\s*set/i);
  return m ? Number(m[1]) : null;
}

function extractFinishes(html) {
  // Fallback only — real Finish options come from Cloudlift Live Product Options.
  const items = [];
  const tech = extractTabHtml(html, "Technical Specs") || html;
  const frame =
    tech.match(/Frame Materials?:?\s*<\/strong>\s*:?\s*Option of\s*([^<]+)/i) ||
    tech.match(/Frame Materials?:?\s*:?\s*Option of\s*([^<\n]+)/i);
  if (frame) {
    const parts = frame[1]
      .split(/[\/,]/)
      .map((s) => s.replace(/Option of/i, "").trim())
      .filter(Boolean);
    for (const name of parts) {
      items.push({
        name,
        imageUrl: "",
        priceAdjustment: 0,
        sortOrder: items.length,
      });
    }
  }
  return items;
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

function buildMatchIndex(products) {
  const bySizeModel = new Map();
  for (const p of products) {
    const sz = parseSizeMm(p.name);
    const models = modelTokens(p.name);
    const key = sizeKey(sz);
    if (!key) continue;
    if (!bySizeModel.has(key)) bySizeModel.set(key, []);
    bySizeModel.get(key).push({ p, models });
  }
  return bySizeModel;
}

function sizesMatch(a, b) {
  if (!a || !b) return false;
  return a.widthMm === b.widthMm && a.heightMm === b.heightMm;
}

/**
 * Reject matches when CSL and Linx titles disagree on distinctive product lines
 * (e.g. Z-Wave must not enrich a Conservation pine window of the same size).
 */
function titlesCompat(cslTitle, localName) {
  const a = String(cslTitle || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ");
  const b = String(localName || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ");
  const flags = [
    /z[\s-]*wave|\belectrics?\b|\belectrically\b|\bsolar\b/,
    /conservation/,
    /top\s*hung/,
    /preselect|pre[\s-]*select/,
    /walk[\s-]*on/,
    /loft\s*ladder|attic\s*ladder/,
    /dome|domed/,
    /lantern/,
    /blind|roller|venetian/,
    /manual\s*opening/,
    /scissor/,
    /sliding/,
    /highly\s*insulated/,
    /fire[\s-]*resistant/,
    /economy\s*plus/,
    /energy\s*efficient/,
    /\blux\b/,
  ];
  for (const re of flags) {
    if (re.test(a) !== re.test(b)) return false;
  }
  // Section count for loft ladders (3 vs 4 section)
  const secA = a.match(/(\d)\s*[\s-]*section/);
  const secB = b.match(/(\d)\s*[\s-]*section/);
  if (secA && secB && secA[1] !== secB[1]) return false;
  if (secA && !secB) return false;
  if (!secA && secB) return false;

  // Metal vs wooden loft ladders
  if (/loft\s*ladder|attic\s*ladder/.test(a) || /loft\s*ladder|attic\s*ladder/.test(b)) {
    const metalA = /\bmetal\b/.test(a);
    const metalB = /\bmetal\b/.test(b);
    const woodA = /\bwood(en)?\b/.test(a);
    const woodB = /\bwood(en)?\b/.test(b);
    if (metalA !== metalB) return false;
    if (woodA !== woodB) return false;
  }

  // Centre-pivot vs non-pivot when either side asserts it
  const pivotA = /centre\s*pivot|center\s*pivot/.test(a);
  const pivotB = /centre\s*pivot|center\s*pivot/.test(b);
  if (pivotA && !pivotB && /roof\s*window|rooflight/.test(b)) return false;
  return true;
}

function titleOverlapScore(cslTitle, localName) {
  const stop =
    /^(roof|window|windows|fakro|with|and|for|the|style|natural|pine|mm|cm|recessed|opening|flat)$/;
  const words = String(cslTitle || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !stop.test(w));
  const n = String(localName || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ");
  let score = 0;
  for (const w of words) if (n.includes(w)) score++;
  if (/loft\s*ladder/.test(String(cslTitle).toLowerCase().replace(/[-_]+/g, " ")) && /loft\s*ladder/.test(n))
    score += 2;
  if (/top\s*hung/.test(String(cslTitle).toLowerCase().replace(/[-_]+/g, " ")) && /top\s*hung/.test(n))
    score += 2;
  if (/dome|domed/.test(String(cslTitle).toLowerCase().replace(/[-_]+/g, " ")) && /dome|domed/.test(n))
    score += 2;
  return { score, words: words.length };
}

function matchLocal(cslProduct, bySizeModel, bySku, allProducts = []) {
  const sz = parseSizeMm(cslProduct.title);
  const cslKind = productKind(cslProduct.title, cslProduct.product_type);
  const sku = String(cslProduct.variants?.[0]?.sku || "")
    .trim()
    .toUpperCase();

  // SKU only if size also agrees (CSL kit SKUs are often shared / non-unique)
  if (sku && bySku.has(sku)) {
    const hit = bySku.get(sku);
    const localKind = productKind(hit.name, hit.category);
    const localSize = parseSizeMm(hit.name);
    const kindOk =
      cslKind === "other" || localKind === "other" || cslKind === localKind;
    if (
      kindOk &&
      (!sz || !localSize || sizesMatch(sz, localSize)) &&
      titlesCompat(cslProduct.title, hit.name)
    ) {
      return hit;
    }
  }

  const models = modelTokens(
    `${cslProduct.title} ${cslProduct.variants?.[0]?.sku || ""}`,
  );
  const key = sizeKey(sz);

  if (key) {
    const candidates = (bySizeModel.get(key) || []).filter((c) => {
      const k = productKind(c.p.name, c.p.category);
      return k === cslKind && titlesCompat(cslProduct.title, c.p.name);
    });

    if (candidates.length) {
      if (models.length) {
        const hit = candidates.find((c) =>
          models.some((m) =>
            c.models.some((cm) => cm === m || cm.includes(m) || m.includes(cm)),
          ),
        );
        if (hit) return hit.p;
      }

      const stop =
        /^(roof|window|windows|fakro|with|and|for|the|style|natural|pine|mm|cm|recessed)$/;
      const words = String(cslProduct.title || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3 && !stop.test(w));
      let best = null;
      let bestScore = 0;
      for (const c of candidates) {
        const n = String(c.p.name || "").toLowerCase();
        let score = 0;
        for (const w of words) if (n.includes(w)) score++;
        if (
          /conservation/.test(String(cslProduct.title).toLowerCase()) &&
          /conservation/.test(n)
        )
          score += 2;
        if (
          /centre\s*pivot|center\s*pivot/.test(String(cslProduct.title).toLowerCase()) &&
          /centre\s*pivot|center\s*pivot/.test(n)
        )
          score += 2;
        if (
          /z[\s-]*wave|solar|electric/.test(String(cslProduct.title).toLowerCase()) &&
          /z[\s-]*wave|solar|electric/.test(n)
        )
          score += 3;
        if (score > bestScore) {
          bestScore = score;
          best = c.p;
        }
      }
      if (bestScore >= 3) return best;
    }
  }

  // Title-only fallback (loft ladders have no size; also recovers exact name matches)
  if (allProducts.length) {
    let best = null;
    let bestScore = 0;
    let bestWords = 1;
    for (const p of allProducts) {
      const k = productKind(p.name, p.category);
      if (k !== cslKind) continue;
      if (!titlesCompat(cslProduct.title, p.name)) continue;
      if (sz) {
        const localSize = parseSizeMm(p.name);
        // If both have sizes, require agreement for title-only path
        if (localSize && !sizesMatch(sz, localSize)) continue;
      }
      const { score, words } = titleOverlapScore(cslProduct.title, p.name);
      if (score > bestScore) {
        bestScore = score;
        bestWords = words || 1;
        best = p;
      }
    }
    // Require strong overlap: at least 4 hits, or ≥70% of distinctive words (min 3)
    if (
      best &&
      (bestScore >= 4 || (bestScore >= 3 && bestScore / bestWords >= 0.7))
    ) {
      return best;
    }
  }

  return null;
}

async function scrapePdp(handle, cloudliftById, cloudliftByHandle) {
  const productJs = await fetchJson(`${BASE}/products/${handle}.js`);
  await delay(REQUEST_GAP_MS);
  const html = await fetchText(`${BASE}/products/${handle}`);
  await delay(REQUEST_GAP_MS);

  const galleryRemote = [];
  for (const img of productJs.images || []) {
    const src = typeof img === "string" ? img : img.src;
    if (src) galleryRemote.push(absUrl(src).split("?")[0]);
  }

  const flashingFinder = extractFlashingFinder(html);
  const specsExtra = extractSpecsFromHtml(html);
  const install = extractInstallationGuide(html);
  let finishes = extractFinishes(html);
  let insulatingSetPrice = extractInsulatingSetPrice(
    html,
    productJs.description || "",
  );
  let cloudliftFlashings = [];

  const cl =
    cloudliftById?.get(String(productJs.id)) ||
    cloudliftByHandle?.get(String(handle).toLowerCase());
  if (cl) {
    if (cl.finishes?.length) finishes = cl.finishes;
    if (cl.insulatingSetPrice != null) insulatingSetPrice = cl.insulatingSetPrice;
    if (cl.flashings?.length) cloudliftFlashings = cl.flashings;
  }

  return {
    productJs,
    html,
    galleryRemote,
    flashingFinder,
    specsExtra,
    install,
    finishes,
    insulatingSetPrice,
    cloudliftFlashings,
  };
}

async function main() {
  fs.writeFileSync(LOG, `Fakro CSL enrich ${new Date().toISOString()}\n`);
  ensurePublicDir("downloads");
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");

  log("Fetching Cambridge Skylights Fakro catalog…");
  log("Loading Cloudlift Live Product Options (Finish / Flashing / Insulating)…");
  let cloudliftById = new Map();
  let cloudliftByHandle = new Map();
  try {
    const clJs = await fetchCloudliftOptionsJs("cambridgeskylights.myshopify.com");
    const parsed = parseCloudliftOptionsJs(clJs);
    cloudliftById = parsed.byProductId;
    cloudliftByHandle = parsed.byHandle;
    log(
      `Cloudlift option maps: ${cloudliftById.size} products, ${parsed.optionSets.length} option sets`,
    );
  } catch (e) {
    log(`Cloudlift options load failed: ${e.message}`);
  }

  const onlyHandles = loadOnlyHandles();
  let csl;
  if (onlyHandles.length && process.env.SKIP_CATALOG === "1") {
    csl = onlyHandles.map((h) => ({
      handle: h,
      // Handles are hyphenated; matching expects readable titles.
      title: String(h).replace(/-/g, " "),
      vendor: "FAKRO",
      variants: [],
    }));
    log(`SKIP_CATALOG: using ${csl.length} handles only`);
  } else {
    csl = await fetchAllCslFakro();
    log(`CSL Fakro products: ${csl.length}`);
    if (onlyHandles.length) {
      const want = new Set(onlyHandles.map((h) => h.toLowerCase()));
      csl = csl.filter((p) => want.has(String(p.handle || "").toLowerCase()));
      const have = new Set(csl.map((p) => String(p.handle || "").toLowerCase()));
      for (const h of onlyHandles) {
        if (!have.has(h.toLowerCase())) {
          csl.push({ handle: h, title: h, vendor: "FAKRO", variants: [] });
        }
      }
      log(`ONLY_HANDLES filter: ${csl.length} products`);
    }
  }
  if (LIMIT > 0) csl = csl.slice(0, LIMIT);

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Fakro brand not found");
  const productsCol = db.collection("products");

  const mine = await productsCol.find({ brand: brand._id }).toArray();
  log(`Mongo Fakro products: ${mine.length}`);

  const bySizeModel = buildMatchIndex(mine);
  const bySku = new Map();
  const byHandle = new Map();
  for (const p of mine) {
    for (const s of [p.linxSku, p.productCode, p.manufacturerSku, p.specs?.sku]) {
      const k = String(s || "")
        .trim()
        .toUpperCase();
      if (k) bySku.set(k, p);
    }
    const h = p.specs?.cslHandle || p.specs?.handle;
    if (h) byHandle.set(String(h).toLowerCase(), p);
  }

  const report = {
    cslTotal: csl.length,
    mongoTotal: mine.length,
    matched: 0,
    created: 0,
    updated: 0,
    failed: 0,
    missingCreated: [],
    enrich: [],
  };

  await mapPool(csl, CONCURRENCY, async (cslProduct, idx) => {
    const label = `[${idx + 1}/${csl.length}]`;
    const handle = cslProduct.handle;
    try {
      const cslSize = parseSizeMm(cslProduct.title);
      const cslKind = productKind(cslProduct.title, cslProduct.product_type);
      let local = byHandle.get(String(handle).toLowerCase()) || null;
      if (local) {
        const localKind = productKind(local.name, local.category);
        const localSize = parseSizeMm(local.name);
        const kindOk = cslKind === localKind;
        const sizeOk =
          !cslSize ||
          !localSize ||
          (cslSize.widthMm === localSize.widthMm &&
            cslSize.heightMm === localSize.heightMm);
        const titleOk = titlesCompat(
          cslProduct.title || handle,
          local.name,
        );
        if (!kindOk || !sizeOk || !titleOk) {
          log(
            `${label} ignore stale handle link kind=${localKind}/${cslKind} sizeOk=${sizeOk} titleOk=${titleOk} → ${String(local.name).slice(0, 50)}`,
          );
          local = null;
        }
      }
      if (!local) local = matchLocal(cslProduct, bySizeModel, bySku, mine);
      log(
        `${label} scrape ${handle} kind=${cslKind} match=${local ? local.name.slice(0, 60) : "NEW"}`,
      );
      const scraped = await scrapePdp(handle, cloudliftById, cloudliftByHandle);
      const { productJs } = scraped;
      const price =
        Number(productJs.variants?.[0]?.price || productJs.price || 0) / 100;
      const sku =
        cleanText(productJs.variants?.[0]?.sku || "") ||
        slugify(handle).toUpperCase();
      const size = parseSizeMm(productJs.title || cslProduct.title);

      const gallery = [];
      for (let i = 0; i < scraped.galleryRemote.length; i++) {
        gallery.push(
          await uploadRemoteImage(scraped.galleryRemote[i], `${slugify(handle)}-${i + 1}`),
        );
      }

      // upload flashing finder images
      const finder = [];
      for (let i = 0; i < scraped.flashingFinder.length; i++) {
        const item = scraped.flashingFinder[i];
        let imageUrl = item.imageUrl;
        if (imageUrl) {
          imageUrl = await uploadRemoteImage(
            imageUrl,
            `${slugify(handle)}-flash-${i + 1}`,
          );
        }
        finder.push({ ...item, imageUrl });
      }

      const flashingsFromFinder = finder.map((f, i) => ({
        name: f.title,
        imageUrl: f.imageUrl || "",
        priceAdjustment: 0,
        sortOrder: i,
      }));

      // Prefer Cloudlift priced flashings; upload their images
      let flashings = scraped.cloudliftFlashings?.length
        ? scraped.cloudliftFlashings
        : flashingsFromFinder;
      if (scraped.cloudliftFlashings?.length) {
        const uploaded = [];
        for (let i = 0; i < scraped.cloudliftFlashings.length; i++) {
          const item = scraped.cloudliftFlashings[i];
          let imageUrl = item.imageUrl;
          if (imageUrl) {
            imageUrl = await uploadRemoteImage(
              imageUrl,
              `${slugify(handle)}-cl-flash-${i + 1}`,
            );
          }
          uploaded.push({ ...item, imageUrl });
        }
        flashings = uploaded;
      }

      // Upload finish swatch images
      let finishes = scraped.finishes || [];
      if (finishes.length) {
        const uploaded = [];
        for (let i = 0; i < finishes.length; i++) {
          const item = finishes[i];
          let imageUrl = item.imageUrl;
          if (imageUrl) {
            imageUrl = await uploadRemoteImage(
              imageUrl,
              `${slugify(handle)}-finish-${i + 1}`,
            );
          }
          uploaded.push({ ...item, imageUrl });
        }
        finishes = uploaded;
      }

      const installPdfs = [];
      for (const pdf of scraped.install.pdfs || []) {
        const localPdf = await downloadPdf(pdf, handle, path.basename(pdf));
        if (localPdf) {
          installPdfs.push({
            name: path.basename(pdf).replace(/\.pdf$/i, ""),
            url: localPdf,
          });
        }
      }

      const description =
        String(productJs.description || "")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .trim() || `${productJs.title} from Cambridge Skylights.`;

      const specs = {
        source: SOURCE_TAG,
        sourceUrl: `${BASE}/products/${handle}`,
        cslHandle: handle,
        cslId: productJs.id,
        sku,
        vendorBrand: "FAKRO",
        sizeUnitNote: "Cambridge Skylights lists sizes in mm; Linx titles often use cm (mm/10).",
        ...scraped.specsExtra,
      };
      if (size) {
        specs.widthMm = size.widthMm;
        specs.heightMm = size.heightMm;
        specs.widthCm = size.widthCm;
        specs.heightCm = size.heightCm;
      }

      const dimensions = size
        ? {
            widthMm: size.widthMm,
            heightMm: size.heightMm,
            widthCm: size.widthCm,
            heightCm: size.heightCm,
            displayMm: `${size.widthMm}x${size.heightMm}mm`,
            displayCm: `${size.widthCm}cm x ${size.heightCm}cm`,
          }
        : {};

      const now = new Date();

      if (!local && IMPORT_MISSING && !ENRICH_ONLY) {
        // Prefer mm in name for new CSL imports (source convention)
        const name = cleanText(productJs.title);
        const doc = {
          name,
          description: description.slice(0, 50000),
          price,
          images: gallery,
          category: slugify(productJs.type || "skylights") || "skylights",
          subCategory: "",
          brand: brand._id,
          brands: [brand._id],
          stock: productJs.available === false ? 0 : STOCK_DEFAULT,
          stockStatus: productJs.available === false ? "out_of_stock" : "in_stock",
          linxSku: sku,
          manufacturerSku: sku,
          productCode: sku,
          tagline: "FAKRO",
          flashingFinder: finder,
          flashings,
          finishes,
          insulatingSetPrice: scraped.insulatingSetPrice,
          installationGuide: scraped.install.text || scraped.install.html || "",
          installationMaintenanceGuides: installPdfs,
          downloads: installPdfs.map((f) => ({
            title: f.name,
            url: f.url,
            type: "install",
          })),
          dimensions,
          specs,
          showSpecs: true,
          createdAt: now,
          updatedAt: now,
        };
        if (DRY_RUN) {
          log(`${label} [dry create] ${name} £${price} finder=${finder.length}`);
          report.created++;
        } else {
          const r = await productsCol.insertOne(doc);
          local = { ...doc, _id: r.insertedId };
          // refresh index
          const sz = parseSizeMm(name);
          const key = sizeKey(sz);
          if (key) {
            if (!bySizeModel.has(key)) bySizeModel.set(key, []);
            bySizeModel.get(key).push({ p: local, models: modelTokens(name) });
          }
          if (sku) bySku.set(sku.toUpperCase(), local);
          report.created++;
          report.missingCreated.push({ handle, name, sku });
          log(`${label} + created ${name} finder=${finder.length} imgs=${gallery.length}`);
        }
        return;
      }

      if (!local) {
        log(`${label} missing (not imported) ${handle}`);
        report.missingCreated.push({ handle, title: cslProduct.title, sku, skipped: true });
        return;
      }

      report.matched++;
      const localSize = parseSizeMm(local.name);
      const sizeAligned =
        !size ||
        !localSize ||
        (size.widthMm === localSize.widthMm && size.heightMm === localSize.heightMm);
      const $set = {
        updatedAt: now,
        specs: {
          ...(local.specs || {}),
          ...specs,
          enrichedFromCslAt: now.toISOString(),
        },
      };
      // Only write mm/cm dimensions when sizes agree (or local had none)
      if (sizeAligned && Object.keys(dimensions).length) {
        $set.dimensions = {
          ...(local.dimensions || {}),
          ...dimensions,
        };
      }

      // description if thin
      if (
        !String(local.description || "").trim() ||
        String(local.description).length < 80
      ) {
        $set.description = description.slice(0, 50000);
      } else if (description.length > String(local.description).length + 40) {
        $set.description = description.slice(0, 50000);
      }

      if (gallery.length && (!local.images || local.images.length < gallery.length)) {
        $set.images = gallery;
      }

      if (finder.length) {
        if (FORCE_OPTIONS || !local.flashingFinder?.length) {
          $set.flashingFinder = finder;
        }
      }
      // Prefer Cloudlift priced flashings over finder (price 0)
      if (flashings.length) {
        const localHasPriced = (local.flashings || []).some(
          (f) => Number(f.priceAdjustment) > 0,
        );
        const incomingPriced = flashings.some((f) => Number(f.priceAdjustment) > 0);
        if (
          FORCE_OPTIONS ||
          !local.flashings?.length ||
          (incomingPriced && !localHasPriced)
        ) {
          $set.flashings = flashings;
        }
      }

      if (finishes.length) {
        $set.finishes = finishes;
      }

      if (scraped.insulatingSetPrice != null) {
        $set.insulatingSetPrice = scraped.insulatingSetPrice;
      }

      const guideText =
        scraped.install.text || cleanText(scraped.install.html || "");
      const guideBroken =
        !String(local.installationGuide || "").trim() ||
        /data-tab-item|product-tab--|aria-hidden/i.test(
          String(local.installationGuide || ""),
        );
      if (guideText && (FORCE_OPTIONS || guideBroken)) {
        $set.installationGuide = guideText;
      }
      if (installPdfs.length) {
        $set.installationMaintenanceGuides = installPdfs;
        const existingDownloads = local.downloads || [];
        const extra = installPdfs
          .filter(
            (f) =>
              !existingDownloads.some(
                (d) => d.url === f.url || d.title === f.name,
              ),
          )
          .map((f) => ({
            title: f.name,
            url: f.url,
            type: "install",
          }));
        if (
          FORCE_OPTIONS ||
          extra.length ||
          !(local.installationMaintenanceGuides || []).length
        ) {
          $set.downloads = [...existingDownloads, ...extra];
        }
      }

      // price refresh from CSL when ours is 0
      if ((!local.price || local.price <= 0) && price > 0) $set.price = price;

      const changed = Object.keys($set).filter((k) => k !== "updatedAt" && k !== "specs");
      if (DRY_RUN) {
        log(
          `${label} [dry enrich] ${local.name} <- ${handle} finder=${finder.length} gaps=${changed.join(",")}`,
        );
      } else {
        await productsCol.updateOne({ _id: local._id }, { $set });
        report.updated++;
        log(
          `${label} ✓ ${local.name} <- ${handle} finder=${finder.length} finishes=${finishes.length} insulating=${scraped.insulatingSetPrice ?? "-"} flashings=${flashings.length} imgs=${gallery.length} size=${dimensions.displayMm || "-"}`,
        );
      }
      report.enrich.push({
        handle,
        localId: String(local._id),
        localName: local.name,
        finder: finder.length,
        finishes: finishes.length,
        insulatingSetPrice: scraped.insulatingSetPrice,
        flashings: flashings.length,
        flashingsSet: Boolean($set.flashings),
        finishesSet: Boolean($set.finishes),
        guideSet: Boolean($set.installationGuide),
        size: dimensions,
      });
    } catch (e) {
      report.failed++;
      log(`${label} ✗ ${handle}: ${e.message}`);
    }
  });

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  log(
    `Done. CSL=${report.cslTotal} matched=${report.matched} created=${report.created} updated=${report.updated} failed=${report.failed}`,
  );
  log(`Report: ${REPORT}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
