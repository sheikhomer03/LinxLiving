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
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const REQUEST_GAP_MS = Math.max(0, Number(process.env.REQUEST_GAP_MS || 300));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

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
  const t = `${title} ${productType}`.toLowerCase().replace(/[-_]+/g, " ");
  // Flashings first — titles often include "Conservation Style"
  if (
    /flashing kit|\bflashings?\b|\(elj|\(elv|\(ezv|\(ezj|\(epv|\(epj|\belj\/|\belv\//.test(
      t,
    ) &&
    !/roof window|rooflight|with recessed flashing/.test(t)
  ) {
    return "flashing";
  }
  // Window PDPs that *include* a flashing in the name are still windows
  if (
    /roof window|rooflight|skylight|centre pivot|center pivot|top hung|walk on|dome window/.test(
      t,
    )
  ) {
    return "window";
  }
  if (/loft ladder|attic ladder/.test(t)) return "ladder";
  if (/blind|roller|venetian|blackout/.test(t)) return "blind";
  if (/sealant|tape|coating|accessory|fitters? pack/.test(t)) return "accessory";
  if (/lantern|fixed frameless|conservation style.*window|window.*conservation/.test(t))
    return "window";
  if (/\bwindow\b/.test(t)) return "window";
  return "other";
}

function sizeKey(sz) {
  if (!sz) return "";
  return `${sz.widthMm}x${sz.heightMm}`;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxFakroCsl/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 LinxFakroCsl/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
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
  // take until next product-tab id or product-tabs end
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
  // dt/dd
  for (const m of src.matchAll(
    /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi,
  )) {
    const k = cleanText(m[1]);
    const v = cleanText(m[2]);
    if (k && v) specs[k] = v;
  }
  return specs;
}

function extractInstallationGuide(html) {
  const tab = extractTabHtml(html, "Installation Guide");
  if (!tab) return { html: "", pdfs: [] };
  const text = cleanText(tab);
  const pdfs = [...tab.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)].map((m) =>
    absUrl(m[1]),
  );
  return { html: tab.replace(/<script[\s\S]*?<\/script>/gi, " ").slice(0, 50000), text, pdfs };
}

function extractInsulatingSetPrice(html, description) {
  const blob = `${html}\n${description}`;
  const m =
    blob.match(/insulating\s*set[^£]{0,40}£\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
    blob.match(/£\s*([0-9]+(?:\.[0-9]{2})?)\s*[^.]{0,20}insulating\s*set/i);
  return m ? Number(m[1]) : null;
}

function extractFinishes(html) {
  // rare — look for finish option cards
  const items = [];
  const tab = extractTabHtml(html, "Finish(?:es)?");
  const src = tab || "";
  for (const m of src.matchAll(
    /<strong>([\s\S]*?)<\/strong>\s*<br\s*\/?>\s*([\s\S]*?)<\/div>/gi,
  )) {
    const name = cleanText(m[1]);
    if (!name || /flashing/i.test(name)) continue;
    items.push({
      name,
      imageUrl: "",
      priceAdjustment: 0,
      sortOrder: items.length,
    });
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

function matchLocal(cslProduct, bySizeModel, bySku) {
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
    if (kindOk && (!sz || !localSize || sizesMatch(sz, localSize))) {
      return hit;
    }
  }

  const models = modelTokens(
    `${cslProduct.title} ${cslProduct.variants?.[0]?.sku || ""}`,
  );
  const key = sizeKey(sz);
  if (!key) return null;

  const candidates = (bySizeModel.get(key) || []).filter((c) => {
    const k = productKind(c.p.name, c.p.category);
    // Never cross window ↔ flashing (etc). "other" may only match "other".
    return k === cslKind;
  });
  if (!candidates.length) return null;

  if (models.length) {
    const hit = candidates.find((c) =>
      models.some((m) =>
        c.models.some((cm) => cm === m || cm.includes(m) || m.includes(cm)),
      ),
    );
    if (hit) return hit.p;
  }

  // Strong title overlap within the same size only
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
    if (score > bestScore) {
      bestScore = score;
      best = c.p;
    }
  }
  return bestScore >= 3 ? best : null;
}

async function scrapePdp(handle) {
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
  const finishes = extractFinishes(html);
  const insulatingSetPrice = extractInsulatingSetPrice(
    html,
    productJs.description || "",
  );

  return {
    productJs,
    html,
    galleryRemote,
    flashingFinder,
    specsExtra,
    install,
    finishes,
    insulatingSetPrice,
  };
}

async function main() {
  fs.writeFileSync(LOG, `Fakro CSL enrich ${new Date().toISOString()}\n`);
  ensurePublicDir("downloads");
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");

  log("Fetching Cambridge Skylights Fakro catalog…");
  let csl = await fetchAllCslFakro();
  log(`CSL Fakro products: ${csl.length}`);
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
        if (!kindOk || !sizeOk) {
          log(
            `${label} ignore stale handle link kind=${localKind}/${cslKind} sizeOk=${sizeOk} → ${String(local.name).slice(0, 50)}`,
          );
          local = null;
        }
      }
      if (!local) local = matchLocal(cslProduct, bySizeModel, bySku);
      log(
        `${label} scrape ${handle} kind=${cslKind} match=${local ? local.name.slice(0, 60) : "NEW"}`,
      );
      const scraped = await scrapePdp(handle);
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
          flashings: flashingsFromFinder,
          finishes: scraped.finishes,
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
        if (!local.flashingFinder?.length) $set.flashingFinder = finder;
        if (!local.flashings?.length) $set.flashings = flashingsFromFinder;
      }

      if (scraped.finishes.length && !local.finishes?.length) {
        $set.finishes = scraped.finishes;
      }

      if (
        scraped.insulatingSetPrice != null &&
        local.insulatingSetPrice == null
      ) {
        $set.insulatingSetPrice = scraped.insulatingSetPrice;
      }

      if (scraped.install.text || scraped.install.html) {
        if (!String(local.installationGuide || "").trim()) {
          $set.installationGuide =
            scraped.install.text || cleanText(scraped.install.html);
        }
      }
      if (installPdfs.length && !(local.installationMaintenanceGuides || []).length) {
        $set.installationMaintenanceGuides = installPdfs;
        $set.downloads = [
          ...(local.downloads || []),
          ...installPdfs.map((f) => ({
            title: f.name,
            url: f.url,
            type: "install",
          })),
        ];
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
          `${label} ✓ ${local.name} <- ${handle} finder=${finder.length} imgs=${gallery.length} size=${dimensions.displayMm || "-"}`,
        );
      }
      report.enrich.push({
        handle,
        localId: String(local._id),
        finder: finder.length,
        flashingsSet: Boolean($set.flashings),
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
