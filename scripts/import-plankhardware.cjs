/**
 * Scrape https://plankhardware.com → Linx Living Mongo + Cloudinary
 *
 * Brand: "Plank Hardware" (slug: plankhardware)
 *
 * Notes:
 * - Excludes the explicit sale collection URL with on-discount filter.
 * - Best-effort parsing for the requested Plankhardware PDP sections:
 *   Finish Guide (incl. Pairs Well With), Maintenance, Material & Care,
 *   Responsibility & Compliance.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/import-plankhardware.cjs
 *
 * Options:
 *   DRY_RUN=1 LIMIT=50 CONCURRENCY=2 SKIP_IMAGES=1 RESUME=1 DISCOVER_ONLY=1
 *   HANDLES="handle-a,handle-b"  (skip discovery; import only these handles)
 *   UA="custom user-agent"
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
const BRAND_NAME = "Plank Hardware";
const BRAND_UI_NAME = "Plank Hardware";
const SOURCE_TAG = "plankhardware-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/plankhardware";
const CHECKPOINT = path.join(__dirname, "_tmp-plankhardware-progress.json");
const LOG = path.join(__dirname, "_tmp-plankhardware-import.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const DISCOVER_ONLY = process.env.DISCOVER_ONLY === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const HANDLES = String(process.env.HANDLES || "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const ua =
  process.env.UA ||
  "Mozilla/5.0 (compatible; LinxLivingBot/1.0; +https://linxsquare.com)";

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cleanText(s) {
  return String(s || "")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(u) {
  if (!u) return "";
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("http")) return u;
  if (u.startsWith("/")) return `${BASE}${u}`;
  return u;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url) {
  const maxAttempts = 6;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": ua,
          Accept: "text/html,application/xhtml+xml,*/*",
        },
      });
      if (res.ok) return res.text();
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") || "0");
        const waitMs =
          (Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 1500) + attempt * 500;
        lastErr = new Error(`HTTP 429 ${url}`);
        log(`429 rate-limit. retrying in ${waitMs}ms (${attempt}/${maxAttempts})`);
        await delay(waitMs);
        continue;
      }
      if (res.status >= 500 && res.status <= 599) {
        const waitMs = 1000 + attempt * 800;
        lastErr = new Error(`HTTP ${res.status} ${url}`);
        log(`Server error ${res.status}. retrying in ${waitMs}ms (${attempt}/${maxAttempts})`);
        await delay(waitMs);
        continue;
      }
      throw new Error(`HTTP ${res.status} ${url}`);
    } catch (e) {
      lastErr = e;
      if (attempt >= maxAttempts) break;
      const waitMs = 800 + attempt * 600;
      log(`fetchText fail retry in ${waitMs}ms (${attempt}/${maxAttempts})`);
      await delay(waitMs);
    }
  }
  throw lastErr || new Error(`fetchText failed ${url}`);
}

async function fetchJson(url) {
  const maxAttempts = 6;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": ua, Accept: "application/json" },
      });
      if (res.ok) return res.json();
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") || "0");
        const waitMs =
          (Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 1500) + attempt * 500;
        lastErr = new Error(`HTTP 429 ${url}`);
        log(`429 rate-limit (json). retrying in ${waitMs}ms (${attempt}/${maxAttempts})`);
        await delay(waitMs);
        continue;
      }
      if (res.status >= 500 && res.status <= 599) {
        const waitMs = 1000 + attempt * 800;
        lastErr = new Error(`HTTP ${res.status} ${url}`);
        log(`Server error ${res.status} (json). retrying in ${waitMs}ms (${attempt}/${maxAttempts})`);
        await delay(waitMs);
        continue;
      }
      throw new Error(`HTTP ${res.status} ${url}`);
    } catch (e) {
      lastErr = e;
      if (attempt >= maxAttempts) break;
      const waitMs = 800 + attempt * 600;
      log(`fetchJson fail retry in ${waitMs}ms (${attempt}/${maxAttempts})`);
      await delay(waitMs);
    }
  }
  throw lastErr || new Error(`fetchJson failed ${url}`);
}

function ensurePublicDir(...parts) {
  const dir = path.join(__dirname, "..", "public", "plankhardware", ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function uploadRemoteImage(imageUrl, publicId) {
  const src = absUrl(String(imageUrl || "").split("?")[0]);
  if (!src || !/^https?:\/\//i.test(src)) return "";
  if (SKIP_IMAGES || DRY_RUN) return src;

  try {
    const result = await cloudinary.uploader.upload(src, {
      folder: CLOUDINARY_FOLDER,
      public_id: String(publicId).slice(0, 180),
      overwrite: true,
      invalidate: true,
      resource_type: "image",
    });
    return result.secure_url || "";
  } catch (e) {
    log(`cloudinary fail ${publicId}: ${e.message || e}`);
    // Last resort: keep original URL.
    return src;
  }
}

function extractOgText(html, property) {
  const re = new RegExp(
    `meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const m = html.match(re);
  return m ? String(m[1]).trim() : "";
}

function extractOgPriceAmount(html) {
  const raw = extractOgText(html, "og:price:amount");
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function extractStockFlag(html) {
  const lc = String(html || "").toLowerCase();
  if (/out of stock|rupture de stock/i.test(lc)) return { stock: 0, inStock: false };
  // Plank pages tend to include "In stock and ready for delivery".
  if (/in stock|ready for delivery/i.test(lc)) return { stock: Number(process.env.STOCK_DEFAULT || 25), inStock: true };
  return { stock: Number(process.env.STOCK_DEFAULT || 25), inStock: true };
}

function collectImageUrls(html) {
  const out = [];
  const seen = new Set();
  const re = /https?:\/\/plankhardware\.com\/cdn\/shop\/files\/[^"'\\s]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\s]+)?/gi;
  for (const m of String(html || "").matchAll(re)) {
    const src = String(m[0]).split("?")[0];
    if (seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  // Also support protocol-relative.
  const re2 = /\/\/plankhardware\.com\/cdn\/shop\/files\/[^"'\\s]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\s]+)?/gi;
  for (const m of String(html || "").matchAll(re2)) {
    const src = absUrl(String(m[0]).split("?")[0]);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  return out.slice(0, 20);
}

function findSectionBlock(html, startNeedle, endNeedle) {
  const lc = String(html || "").toLowerCase();
  const start = lc.indexOf(String(startNeedle).toLowerCase());
  if (start < 0) return "";
  const end = endNeedle ? lc.indexOf(String(endNeedle).toLowerCase(), start) : -1;
  if (end > start) return html.slice(start, end);
  return html.slice(start);
}

function extractFinishGuide(html) {
  const slice = findSectionBlock(html, "finish guide", "maintenance");
  if (!slice) return [];

  const items = [];
  const lc = slice.toLowerCase();

  // Finish swatch images are present in the tab toggles before the tab content.
  const swatchByName = new Map();
  const toggleRe =
    /<button[\s\S]*?id="tab_[^"]+"[\s\S]*?<img[^>]+src=["']([^"']+)["'][\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/gi;
  for (const m of slice.matchAll(toggleRe)) {
    const img = absUrl(String(m[1] || "").split("?")[0]);
    const labelHtml = String(m[2] || "");
    const name = cleanText(labelHtml);
    if (name && img && !swatchByName.has(name)) swatchByName.set(name, img);
  }

  // Each finish tab content contains:
  //  <div class="flexible-tab-heading-image_with_text_..."><p>FINISH</p></div>
  //  <div class="flexible-tab-text-image_with_text_..."><p>DESCRIPTION</p></div>
  const headingRe = /flexible-tab-heading-image_with_text_[\s\S]*?<p>([^<]{2,120})<\/p>/gi;
  const matches = [...slice.matchAll(headingRe)];
  for (let mi = 0; mi < matches.length; mi++) {
    const finishName = cleanText(matches[mi][1]);
    if (!finishName) continue;

    const blockStart = matches[mi].index;
    const blockEnd =
      mi < matches.length - 1 ? matches[mi + 1].index : slice.length;
    const block = slice.slice(blockStart, blockEnd);

    // Description after the finish header.
    let desc = "";
    const descMatch = block.match(
      /flexible-tab-text-image_with_text_[\s\S]*?<p>([\s\S]*?)<\/p>/i,
    );
    if (descMatch && descMatch[1]) desc = cleanText(descMatch[1]);

    // Pairs well with.
    let pairsDescription = "";
    const pairsDescMatch = block.match(
      /pairs well with[\s\S]{0,400}?flexible-tab-text-heading_text_[\s\S]*?<p>([\s\S]*?)<\/p>/i,
    );
    if (pairsDescMatch && pairsDescMatch[1]) {
      pairsDescription = cleanText(pairsDescMatch[1]);
    } else {
      // Fallback: first <p> after the heading.
      const pb = block.match(/pairs well with[\s\S]{0,800}?<p>([\s\S]*?)<\/p>/i);
      if (pb && pb[1]) pairsDescription = cleanText(pb[1]);
    }

    const images = [];
    for (const m of block.matchAll(
      /src=["'](https?:\/\/plankhardware\.com\/cdn\/shop\/files\/[^"'\\s]+?\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi,
    )) {
      const src = String(m[1]).split("?")[0];
      if (src && !images.includes(src)) images.push(src);
    }
    // protocol-relative
    for (const m of block.matchAll(
      /src=["'](\/\/plankhardware\.com\/cdn\/shop\/files\/[^"'\\s]+?\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi,
    )) {
      const src = absUrl(String(m[1]).split("?")[0]);
      if (src && !images.includes(src)) images.push(src);
    }

    items.push({
      name: finishName,
      imageUrl: swatchByName.get(finishName) || "",
      description: desc,
      pairsWellWith: { description: pairsDescription, images: images.slice(0, 8) },
    });
  }

  // De-dupe by name (content extraction may repeat headings).
  const byName = new Map();
  for (const it of items) {
    if (!it.name || byName.has(it.name)) continue;
    byName.set(it.name, it);
  }
  return [...byName.values()];
}

function extractSingleHtmlSection(html, headingText) {
  const lc = String(html || "").toLowerCase();
  const start = lc.indexOf(`<p>${headingText}`.toLowerCase());
  let start2 = lc.indexOf(String(headingText).toLowerCase());
  if (start < 0) start2 = start2;
  if (start < 0 && start2 < 0) return "";

  // Capture the next <p> after the heading label in the flexible tab.
  const from = Math.max(0, start > 0 ? start : start2);
  const seg = html.slice(from, from + 3000);
  const p = seg.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  return p && p[1] ? cleanText(p[1]) : "";
}

function extractMaintenance(html) {
  // Prefer a literal <p> within the maintenance tab text.
  const slice = findSectionBlock(html, "maintenance", "delivery");
  if (!slice) return { html: "", images: [] };
  const m = slice.match(
    /flexible-tab-text-heading_text_[\s\S]*?<p>([\s\S]*?)<\/p>/i,
  );
  const text = m?.[1] ? cleanText(m[1]) : extractSingleHtmlSection(slice, "Maintenance");
  return { html: text, images: [] };
}

function extractDelivery(html) {
  const slice = findSectionBlock(html, "delivery", "how");
  if (!slice) return "";
  const m = slice.match(
    /flexible-tab-text-heading_text_[\s\S]*?<p>([\s\S]*?)<\/p>/i,
  );
  if (m?.[1]) return cleanText(m[1]);
  // Fallback: first <p> after the Delivery heading label.
  const fallback = slice.match(/delivery[\s\S]{0,400}?<p>([\s\S]*?)<\/p>/i);
  return fallback?.[1] ? cleanText(fallback[1]) : "";
}

function extractMaterialAndCare(html) {
  const start = html.toLowerCase().indexOf("material");
  if (start < 0) return { html: "", images: [] };
  // Best-effort: pull the first big flexible text block following "Material".
  const seg = html.slice(start, start + 6000);
  const m = seg.match(/flexible-tab-text-heading_text_[\s\S]*?<p>([\s\S]*?)<\/p>/i);
  const text = m?.[1] ? cleanText(m[1]) : "";
  return { html: text, images: [] };
}

function extractResponsibilityAndCompliance(html) {
  const lc = html.toLowerCase();
  const start = lc.indexOf("responsibility");
  if (start < 0) return { html: "", images: [] };
  const seg = html.slice(start, start + 6000);
  const m = seg.match(
    /flexible-tab-text-heading_text_[\s\S]*?<p>([\s\S]*?)<\/p>/i,
  );
  const text = m?.[1] ? cleanText(m[1]) : "";
  return { html: text, images: [] };
}

function extractTypeOptions(_html) {
  // Type parsing on plankhardware is not consistently expressed as a single
  // server-rendered block. For now, we return [] and can iterate once
  // we confirm which DOM section represents "Type" on your desired pages.
  return [];
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: BRAND_SLUG });
  const now = new Date();
  if (!brand) {
    const insert = {
      name: BRAND_NAME,
      uiName: BRAND_UI_NAME,
      slug: BRAND_SLUG,
      order: 80,
      isActive: true,
      image: "",
      subBrands: [],
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      brand = { ...insert, _id: "dry-plankhardware-brand" };
      log("[dry] create brand", BRAND_NAME);
    } else {
      const r = await brands.insertOne(insert);
      brand = { ...insert, _id: r.insertedId };
      log(`Created brand ${BRAND_NAME} (${brand._id})`);
    }
  } else if (!DRY_RUN) {
    await brands.updateOne(
      { _id: brand._id },
      { $set: { isActive: true, name: BRAND_NAME, updatedAt: now, uiName: BRAND_UI_NAME } },
    );
    brand = { ...brand, ...{ isActive: true, name: BRAND_NAME, uiName: BRAND_UI_NAME } };
  }
  return brand;
}

async function ensureMenu(db, { name, slug, parentId, brandId, order = 0, image = "" }) {
  const menus = db.collection("menus");
  const query = {
    slug,
    brand: brandId,
    parent: parentId ?? null,
  };
  let menu = DRY_RUN ? null : await menus.findOne(query);
  const now = new Date();
  if (!menu) {
    const insert = {
      name,
      slug,
      parent: parentId ?? null,
      brand: brandId,
      order,
      isActive: true,
      image,
      level: parentId ? "subcategory" : "category",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      menu = { ...insert, _id: `dry-menu-${slug}-${parentId || "root"}` };
    } else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
    }
  } else if (!DRY_RUN) {
    await menus.updateOne(
      { _id: menu._id },
      { $set: { name, order, isActive: true, updatedAt: now, ...(image ? { image } : {}) } },
    );
    menu = { ...menu, name, order };
  }
  return menu;
}

/**
 * Top-level navbar items that carry no mega panel ("New In", "Sale") render as
 * a plain <a class="menu__item">. They sit after the last panel, so a block
 * that runs to </nav> would otherwise adopt them as children of the last main.
 */
function parseTopLevelNoDropdown(html) {
  const rx =
    /<a\s+href="(?:https:\/\/plankhardware\.com)?\/collections\/([^"?#]+)[^"]*"\s+class="menu__item/gi;
  return new Set([...html.matchAll(rx)].map((m) => slugify(m[1])));
}

function parseMainMenusFromHomepage(html) {
  const out = [];
  const lc = html.toLowerCase();
  const marker = 'summary data-link="';
  const excluded = parseTopLevelNoDropdown(html);

  // Panel boundaries: each main owns everything up to the next <summary>, and
  // the last runs to </nav>. A fixed window truncates them — the widest panel
  // (Knobs & Handles) is ~48k chars.
  const offsets = [];
  for (let i = 0; ; ) {
    const s = lc.indexOf(marker, i);
    if (s < 0) break;
    offsets.push(s);
    i = s + marker.length;
  }
  const navEnd = offsets.length ? html.indexOf("</nav>", offsets[offsets.length - 1]) : -1;

  for (let k = 0; k < offsets.length; k++) {
    const s = offsets[k];
    const block = html.slice(s, k + 1 < offsets.length ? offsets[k + 1] : navEnd);

    const hrefM = block.match(/data-link="([^"]*\/collections\/[^"]*)"/i);
    if (!hrefM) continue;
    const href = hrefM[1];
    if (/collections\/sale|on-discount\s*=\s*on\s*sale/i.test(href)) continue;
    const slugPart = href.split("/collections/")[1] || "";
    const mainSlug = slugify(slugPart.split("?")[0]);
    if (!mainSlug) continue;

    // Grab the visible label for the main menu.
    const labelM =
      block.match(/menu__item-text[^>]*>([\s\S]*?)<svg/i) ||
      block.match(/reversed-link__text[^>]*>([\s\S]*?)</i);
    const mainName = labelM ? cleanText(labelM[1]) : mainSlug.replace(/-/g, " ");

    // The sidebar <h6> groupings inside a panel are presentation only, so
    // every collection in the panel is a direct child of the main.
    const children = [];
    const seen = new Set();
    const add = (raw, label) => {
      const subSlug = slugify(String(raw).split("?")[0]);
      if (!subSlug || subSlug === mainSlug || seen.has(subSlug)) return;
      if (/sale/.test(subSlug) || excluded.has(subSlug)) return;
      seen.add(subSlug);
      children.push({ slug: subSlug, label: cleanText(label) });
    };
    // Labelled links first so children keep the navbar's own wording. The
    // label has to fall inside the link's own <a>…</a>, or a card with no
    // label would borrow the next card's.
    for (const m of block.matchAll(
      /href=["']\/collections\/([^"'?#]+)[^"']*["']((?:(?!<\/a>)[\s\S])*?)reversed-link__text[^>]*>([\s\S]*?)</gi,
    ))
      add(m[1], m[3]);
    for (const m of block.matchAll(/href=["']\/collections\/([^"'?#]+)[^"']*["']/gi))
      add(m[1], "");

    out.push({ name: mainName, slug: mainSlug, children });
  }

  // Eight finish collections hang off both "Knobs & Handles" (inside its
  // "By Finish" sidebar group) and the dedicated "By Finish" main. A menu row
  // holds one parent, so the dedicated hub wins and the duplicate is dropped —
  // otherwise a re-run inserts the same slug once per parent. Matches
  // scripts/reparent-plank-menus.cjs.
  const OWNER_PRIORITY = ["shop-by-finish"];
  const linkedFrom = new Map();
  for (const main of out)
    for (const c of main.children) {
      if (!linkedFrom.has(c.slug)) linkedFrom.set(c.slug, []);
      linkedFrom.get(c.slug).push(main.slug);
    }
  for (const [slug, mains] of linkedFrom) {
    if (mains.length < 2) continue;
    const owner = OWNER_PRIORITY.find((p) => mains.includes(p)) || mains[0];
    for (const main of out) {
      if (main.slug === owner) continue;
      main.children = main.children.filter((c) => c.slug !== slug);
    }
  }

  return out;
}

function extractProductHandlesFromCollectionHtml(html) {
  const handles = new Set();
  for (const m of String(html || "").matchAll(/\/products\/([a-z0-9-]+)(?:["'\\s?#/]|\\?)/gi)) {
    const h = String(m[1] || "").trim();
    if (!h) continue;
    if (/sale/i.test(h)) continue;
    handles.add(h);
  }
  return [...handles];
}

async function discoverProductsForCollection(collectionSlug, { limitHandles = 0 } = {}) {
  const handles = [];
  const seen = new Set();
  let page = 1;
  for (; page <= 60; page++) {
    const url = `${BASE}/collections/${collectionSlug}?page=${page}`;
    let html = "";
    try {
      html = await fetchText(url);
    } catch (e) {
      // Some collections can 404 page>1; stop after first failure.
      // 429 is already retried in fetchText; if we still fail, stop this collection.
      if (page > 1) break;
      throw e;
    }
    const batch = extractProductHandlesFromCollectionHtml(html);
    const added = batch.filter((h) => !seen.has(h));
    for (const h of added) {
      seen.add(h);
      handles.push(h);
      if (limitHandles > 0 && handles.length >= limitHandles) return handles.slice(0, limitHandles);
    }
    if (!added.length) break;
    await new Promise((r) => setTimeout(r, 80));
  }
  return handles;
}

async function scrapeProductByHandle(handle) {
  const url = `${BASE}/products/${handle}`;
  const html = await fetchText(url);

  const title = extractOgText(html, "og:title") || cleanText(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]);
  const name = cleanText(title.replace(/\s*\|\s*Plank Hardware.*$/i, "") || handle);

  const price = extractOgPriceAmount(html);
  const { stock } = extractStockFlag(html);
  const outOfStock = stock <= 0;

  const ogDesc = extractOgText(html, "og:description");
  const description = cleanText(ogDesc) || `${name} from Plank Hardware.`;

  const images = collectImageUrls(html);

  const finishGuide = extractFinishGuide(html);
  const materialAndCare = extractMaterialAndCare(html);
  const responsibilityAndCompliance = extractResponsibilityAndCompliance(html);
  const maintenance = extractMaintenance(html);
  const delivery = extractDelivery(html);
  const typeOptions = extractTypeOptions(html);

  return {
    handle,
    url,
    name,
    price,
    stock,
    isOutOfStock: outOfStock,
    description,
    images,
    finishGuide,
    materialAndCare,
    responsibilityAndCompliance,
    maintenance,
    delivery,
    typeOptions,
  };
}

async function main() {
  log(`Plankhardware import${DRY_RUN ? " (DRY RUN)" : ""} concurrency=${CONCURRENCY}`);
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (!SKIP_IMAGES && !DRY_RUN) {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      throw new Error("Missing Cloudinary credentials");
    }
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);

  // Discover menu tree from homepage navbar.
  const homeHtml = await fetchText(BASE);
  const mainMenus = parseMainMenusFromHomepage(homeHtml);
  if (!mainMenus.length) {
    throw new Error("Failed to discover menus from homepage");
  }

  // Ensure menus in Mongo.
  for (let i = 0; i < mainMenus.length; i++) {
    const main = mainMenus[i];
    // Keep the inserted/updated main — re-querying it here once cost us the
    // whole tree: `await db.collection(…).findOne(…)?._id` binds as
    // `await (promise?._id)`, which is always undefined, so every child was
    // written with parent null and became a main category.
    const mainMenu = await ensureMenu(db, {
      name: main.name,
      slug: main.slug,
      parentId: null,
      brandId: brand._id,
      order: i,
    });
    for (let j = 0; j < main.children.length; j++) {
      const child = main.children[j];
      await ensureMenu(db, {
        name: child.label || child.slug.replace(/-/g, " "),
        slug: child.slug,
        parentId: mainMenu._id,
        brandId: brand._id,
        order: j,
      });
    }
  }

  if (DISCOVER_ONLY) return;

  // Discover product handles per subcategory.
  const pendingProducts = [];
  const seen = new Set();
  if (HANDLES.length) {
    const fallbackMain = mainMenus[0]?.slug || "hardware";
    const fallbackSub = mainMenus[0]?.children?.[0]?.slug || fallbackMain;
    for (const h of HANDLES) {
      if (seen.has(h)) continue;
      seen.add(h);
      pendingProducts.push({ handle: h, mainSlug: fallbackMain, subSlug: fallbackSub });
    }
  } else {
    for (const main of mainMenus) {
      for (const child of main.children) {
        const subSlug = child.slug;
        const handles = await discoverProductsForCollection(subSlug);
        for (const h of handles) {
          if (seen.has(h)) continue;
          seen.add(h);
          pendingProducts.push({ handle: h, mainSlug: main.slug, subSlug });
        }
        if (LIMIT > 0 && pendingProducts.length >= LIMIT) break;
      }
      if (LIMIT > 0 && pendingProducts.length >= LIMIT) break;
    }
  }

  let finalList = pendingProducts;
  if (LIMIT > 0) finalList = pendingProducts.slice(0, LIMIT);

  log(`Scraping ${finalList.length} unique products…`);

  const productsCol = db.collection("products");

  let done = new Set();
  if (RESUME && fs.existsSync(CHECKPOINT)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
      for (const h of saved.done || []) done.add(String(h));
    } catch {
      // ignore
    }
  }

  let processed = 0;
  let failed = 0;

  const pool = finalList.filter((p) => !done.has(p.handle));
  log(`Remaining after resume: ${pool.length}`);

  let i = 0;
  async function worker() {
    while (i < pool.length) {
      const idx = i++;
      const p = pool[idx];
      try {
        const scraped = await scrapeProductByHandle(p.handle);
        const uploaded = [];
        for (let pi = 0; pi < scraped.images.length; pi++) {
          const up = await uploadRemoteImage(scraped.images[pi], `${scraped.handle}-${pi + 1}`);
          if (up) uploaded.push(up);
        }

        const now = new Date();
        const doc = {
          name: scraped.name,
          description: scraped.description,
          price: Number(scraped.price) || 0,
          stock: Number(scraped.stock) || 0,
          images: uploaded.length ? uploaded : scraped.images,
          category: p.mainSlug,
          subCategory: p.subSlug,
          brand: brand._id,
          brands: [brand._id],
          isOutOfStock: scraped.isOutOfStock,
          showSpecs: true,
          specs: {
            source: SOURCE_TAG,
            sourceUrl: scraped.url,
            plankHandle: scraped.handle,
          },
          finishGuide: scraped.finishGuide,
          materialAndCare: scraped.materialAndCare,
          responsibilityAndCompliance: scraped.responsibilityAndCompliance,
          maintenance: scraped.maintenance,
          typeOptions: scraped.typeOptions,
          delivery: scraped.delivery || "",
          updatedAt: now,
        };

        if (!DRY_RUN) {
          const existing = await productsCol.findOne({
            $or: [
              { "specs.source": SOURCE_TAG, "specs.plankHandle": scraped.handle },
              { "specs.sourceUrl": scraped.url },
            ],
          });
          if (existing) {
            await productsCol.updateOne({ _id: existing._id }, { $set: doc });
          } else {
            await productsCol.insertOne({ ...doc, createdAt: now });
          }
        }

        done.add(p.handle);
        processed++;
        if (processed % 5 === 0) {
          fs.writeFileSync(
            CHECKPOINT,
            JSON.stringify({ done: [...done], at: new Date().toISOString() }, null, 2),
          );
        }

        log(`[${idx + 1}/${pool.length}] ✓ ${scraped.handle} £${doc.price} stock=${doc.stock}`);
      } catch (e) {
        failed++;
        log(`[${idx + 1}/${pool.length}] ✗ ${p.handle}: ${e.message || e}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  fs.writeFileSync(CHECKPOINT, JSON.stringify({ done: [...done], at: new Date().toISOString(), failed }, null, 2));
  log(`Done. processed=${processed} failed=${failed} brand=${brand._id}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

