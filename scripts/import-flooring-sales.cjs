/**
 * Scrape https://www.flooringsales.co.uk → Living Mongo + Cloudinary
 *
 * Brand name: "Flooring sales"  |  UI name: "Linx Square"  |  slug: flooring-sales
 *
 * Main nav categories only (site mega-menu):
 *   Wood Floors, Laminate, LVT, Accessories, Thresholds, Finishes, Tools, Abrasives
 *
 * Primary source: WooCommerce Store API. Optional login via
 * FLOORING_SALES_USER/PASS when HTML pages are not WAF-blocked.
 * Downloads saved under public/flooring-sales/.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-flooring-sales.cjs
 *
 * Options:
 *   DRY_RUN=1 LIMIT=20 CONCURRENCY=2 SKIP_IMAGES=1 RESUME=1 DISCOVER_ONLY=1
 *   SKIP_PDP_ENRICH=1  — skip Jina/HTML enrichment for downloads
 *   ONLY_SLUG=holt-arden-lacquered
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

const BASE = "https://www.flooringsales.co.uk";
const BRAND_SLUG = "flooring-sales";
const BRAND_NAME = "Flooring sales";
const BRAND_UI_NAME = "Linx Square";
const SOURCE_TAG = "flooring-sales-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/flooring-sales";
const PUBLIC_DIR = path.join(__dirname, "..", "public", "flooring-sales");
const CHECKPOINT = path.join(__dirname, "_tmp-fsl-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-fsl-progress.json");
const LOG = path.join(__dirname, "_tmp-fsl-import.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const SKIP_PDP_ENRICH = process.env.SKIP_PDP_ENRICH === "1";
const DISCOVER_ONLY = process.env.DISCOVER_ONLY === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 12));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);
const ONLY_SLUG = String(process.env.ONLY_SLUG || "")
  .trim()
  .toLowerCase();
const FSL_USER = process.env.FLOORING_SALES_USER || "LIN08";
const FSL_PASS = process.env.FLOORING_SALES_PASS || "changeme";
const REQUEST_GAP_MS = Math.max(0, Number(process.env.REQUEST_GAP_MS || 200));
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxFslImporter/1.0";

/**
 * Exact main categories from flooringsales.co.uk header nav.
 * `apiSlugs` = WooCommerce top-level category slug(s) that feed this nav item.
 * Finishes is a nav label that wraps both lacquer trees.
 */
const MAIN_NAV = [
  { name: "Wood Floors", slug: "wood-floors", apiSlugs: ["flooring"], order: 0 },
  { name: "Laminate", slug: "laminate", apiSlugs: ["laminate"], order: 1 },
  { name: "LVT", slug: "lvt", apiSlugs: ["lvt-flooring"], order: 2 },
  { name: "Accessories", slug: "accessories", apiSlugs: ["accessories"], order: 3 },
  {
    name: "Thresholds",
    slug: "thresholds",
    apiSlugs: ["thresholds-scotia"],
    order: 4,
  },
  {
    name: "Finishes",
    slug: "finishes",
    apiSlugs: ["lacquers-oils-by-brand", "lacquers-oils-by-type"],
    order: 5,
  },
  {
    name: "Tools",
    slug: "tools",
    apiSlugs: ["tools-machinery"],
    order: 6,
  },
  { name: "Abrasives", slug: "abrasives", apiSlugs: ["abrasives"], order: 7 },
];

const MAIN_API_SLUG_TO_NAV = new Map();
for (const nav of MAIN_NAV) {
  for (const s of nav.apiSlugs) MAIN_API_SLUG_TO_NAV.set(s, nav);
}

const jar = {};

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, `${line}\n`);
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
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/&#822[01];|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function storeCookies(res) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
  for (const c of raw) {
    const [nv] = String(c).split(";");
    const i = nv.indexOf("=");
    if (i > 0) jar[nv.slice(0, i)] = nv.slice(i + 1);
  }
}

function cookieHeader() {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function fetchRes(url, init = {}) {
  const headers = {
    "User-Agent": UA,
    Accept: init.accept || "*/*",
    ...(init.headers || {}),
  };
  if (Object.keys(jar).length) headers.Cookie = cookieHeader();
  const res = await fetch(url, {
    ...init,
    headers,
    redirect: init.redirect || "manual",
  });
  storeCookies(res);
  return res;
}

async function fetchJsonDirect(url) {
  const res = await fetchRes(url, {
    accept: "application/json",
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return { data: await res.json(), headers: res.headers };
}

async function fetchJsonViaJina(url) {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { Accept: "text/plain", "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`Jina HTTP ${res.status} ${url}`);
  const text = await res.text();
  const start = text.indexOf("[");
  const startObj = text.indexOf("{");
  let jsonStart = -1;
  if (start >= 0 && (startObj < 0 || start < startObj)) jsonStart = start;
  else if (startObj >= 0) jsonStart = startObj;
  if (jsonStart < 0) throw new Error(`Jina JSON not found for ${url}`);
  const slice = text.slice(jsonStart);
  // Trim trailing markdown noise after last ] or }
  const lastArr = slice.lastIndexOf("]");
  const lastObj = slice.lastIndexOf("}");
  const end = Math.max(lastArr, lastObj);
  const payload = end >= 0 ? slice.slice(0, end + 1) : slice;
  return { data: JSON.parse(payload), headers: res.headers };
}

async function fetchJson(url) {
  try {
    return await fetchJsonDirect(url);
  } catch (e) {
    log(`direct json fail → jina: ${e.message}`);
    return fetchJsonViaJina(url);
  }
}

async function fetchTextMaybe(url) {
  try {
    const res = await fetchRes(url, {
      accept: "text/html,application/xhtml+xml",
      redirect: "follow",
    });
    if (res.ok) return await res.text();
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain", "User-Agent": UA },
    });
    if (res.ok) return await res.text();
  } catch {
    /* ignore */
  }
  return "";
}

async function tryLogin() {
  try {
    let res = await fetchRes(`${BASE}/login-to-your-account/`);
    if (!res.ok) res = await fetchRes(`${BASE}/my-account/`);
    if (!res.ok) {
      log(`login page blocked HTTP ${res.status} — using Store API prices`);
      return false;
    }
    const html = await res.text();
    const nonce =
      (html.match(
        /name=["']woocommerce-login-nonce["'][^>]*value=["']([^"']+)["']/,
      ) || [])[1] ||
      (html.match(
        /value=["']([^"']+)["'][^>]*name=["']woocommerce-login-nonce["']/,
      ) || [])[1];
    if (!nonce) {
      log("login nonce missing — using Store API prices");
      return false;
    }
    const body = new URLSearchParams({
      username: FSL_USER,
      password: FSL_PASS,
      "woocommerce-login-nonce": nonce,
      _wp_http_referer: "/my-account/",
      login: "Log in",
    });
    res = await fetchRes(`${BASE}/my-account/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: `${BASE}/my-account/`,
      },
      body: body.toString(),
    });
    let loc = res.headers.get("location");
    for (let i = 0; i < 4 && loc; i++) {
      if (loc.startsWith("/")) loc = `${BASE}${loc}`;
      res = await fetchRes(loc);
      loc = res.headers.get("location");
    }
    const check = await fetchRes(`${BASE}/my-account/`, { redirect: "follow" });
    const page = await check.text();
    const ok =
      /log\s*out|woocommerce-MyAccount/i.test(page) &&
      !/To see our prices, please log in/i.test(page);
    log(ok ? "Logged in to Flooring Sales" : "Login failed — API prices only");
    return ok;
  } catch (e) {
    log(`login error: ${e.message}`);
    return false;
  }
}

function ensurePublicDir(...parts) {
  const dir = path.join(PUBLIC_DIR, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function downloadToPublic(fileUrl, relDir, fileName) {
  const clean = String(fileUrl || "")
    .replace(/[\u0000-\u001F\u007F]+/g, "")
    .trim()
    .split("?")[0];
  if (!clean || !/^https?:\/\//i.test(clean)) return "";
  const rawName = String(fileName || path.basename(clean))
    .replace(/[\u0000-\u001F\u007F]+/g, "")
    .trim();
  let ext = path.extname(clean).toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (!ext || ext.length > 12) {
    ext = path.extname(rawName).toLowerCase().replace(/[^a-z0-9.]/g, "") || "";
  }
  const base =
    slugify(path.parse(rawName).name) ||
    slugify(path.parse(clean).name) ||
    "file";
  const safeName = `${base}${ext || ""}`;
  if (!safeName || safeName === ".") return "";
  const safeRelDir = String(relDir || "")
    .split(/[/\\]+/)
    .map((p) => slugify(p) || p)
    .filter(Boolean)
    .join("/");
  const dir = ensurePublicDir(...safeRelDir.split("/"));
  const dest = path.join(dir, safeName);
  const publicPath = `/flooring-sales/${safeRelDir}/${safeName}`.replace(
    /\\/g,
    "/",
  );
  if (DRY_RUN) return publicPath;
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return publicPath;
  try {
    const res = await fetchRes(clean, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return publicPath;
  } catch (e) {
    log(`public download fail ${clean}: ${e.message}`);
    return "";
  }
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = String(imageUrl || "").split("?")[0];
  if (!clean || !/^https?:\/\//i.test(clean)) return "";
  if (SKIP_IMAGES || DRY_RUN) return clean;
  // Also mirror into public/
  await downloadToPublic(clean, "images", `${publicId}${path.extname(clean) || ".jpg"}`);
  try {
    const result = await cloudinary.uploader.upload(clean, {
      folder: CLOUDINARY_FOLDER,
      public_id: String(publicId).slice(0, 180),
      overwrite: true,
      resource_type: "image",
    });
    return result.secure_url;
  } catch (e) {
    log(`cloudinary fail ${publicId}: ${e.message}`);
    return clean;
  }
}

async function discoverCategories() {
  const cats = [];
  const seen = new Set();
  for (let page = 1; page <= 40; page++) {
    const { data: rows, headers } = await fetchJson(
      `${BASE}/wp-json/wc/store/v1/products/categories?per_page=100&page=${page}`,
    );
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      const slug = slugify(row.slug || row.name);
      if (!slug || seen.has(`${row.id}`)) continue;
      if (slug === "default-category" || slug === "uncategorized") continue;
      seen.add(`${row.id}`);
      cats.push({
        id: row.id,
        name: cleanText(row.name) || titleCase(slug),
        slug,
        parentId: row.parent || 0,
        description: cleanText(row.description || ""),
        count: Number(row.count) || 0,
        image: row.image?.src || "",
        url: row.permalink || `${BASE}/product-category/${slug}/`,
      });
    }
    const totalPages = Number(headers.get?.("x-wp-totalpages") || 0);
    log(`Categories page ${page}: +${rows.length} (total ${cats.length})`);
    if (totalPages && page >= totalPages) break;
    if (rows.length < 100) break;
    await delay(REQUEST_GAP_MS);
  }
  return cats;
}

/** Keep only categories under the 8 main nav roots (+ synthetic Finishes/Wood Floors). */
function filterToMainNavCategories(allCats) {
  const byId = new Map(allCats.map((c) => [c.id, c]));
  const bySlug = new Map(allCats.map((c) => [c.slug, c]));

  const rootApiIds = new Set();
  for (const nav of MAIN_NAV) {
    for (const s of nav.apiSlugs) {
      const cat = bySlug.get(s);
      if (cat) rootApiIds.add(cat.id);
      else log(`warn: main nav API slug missing: ${s}`);
    }
  }

  function rootApiIdFor(cat) {
    let cur = cat;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (rootApiIds.has(cur.id)) return cur.id;
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return null;
  }

  const kept = [];
  for (const cat of allCats) {
    const rootId = rootApiIdFor(cat);
    if (!rootId) continue;
    const root = byId.get(rootId);
    const nav = MAIN_API_SLUG_TO_NAV.get(root?.slug);
    if (!nav) continue;
    kept.push({
      ...cat,
      mainNavSlug: nav.slug,
      mainNavName: nav.name,
      mainNavOrder: nav.order,
      apiRootSlug: root.slug,
      apiRootId: rootId,
    });
  }

  // Synthetic main-nav roots (display names from the site header)
  for (const nav of MAIN_NAV) {
    if (kept.some((c) => c.id === `nav-${nav.slug}`)) continue;
    kept.unshift({
      id: `nav-${nav.slug}`,
      name: nav.name,
      slug: nav.slug,
      parentId: 0,
      description: "",
      count: 0,
      image: "",
      url: "",
      mainNavSlug: nav.slug,
      mainNavName: nav.name,
      mainNavOrder: nav.order,
      apiRootSlug: nav.apiSlugs[0],
      apiRootId: bySlug.get(nav.apiSlugs[0])?.id || null,
      isNavRoot: true,
    });
  }

  log(
    `Main-nav categories kept: ${kept.length} (roots: ${MAIN_NAV.map((n) => n.name).join(", ")})`,
  );
  return kept;
}

async function discoverProductsForCategoryId(categoryId) {
  const products = [];
  for (let page = 1; page <= 100; page++) {
    const { data: rows, headers } = await fetchJson(
      `${BASE}/wp-json/wc/store/v1/products?category=${categoryId}&per_page=100&page=${page}&orderby=id&order=asc`,
    );
    if (!Array.isArray(rows) || !rows.length) break;
    products.push(...rows);
    const totalPages = Number(headers.get?.("x-wp-totalpages") || 0);
    if (totalPages && page >= totalPages) break;
    if (rows.length < 100) break;
    await delay(REQUEST_GAP_MS);
  }
  return products;
}

/** Discover products only under the 8 main nav API roots. */
async function discoverProductsViaMainNav(allCats) {
  const bySlug = new Map(allCats.map((c) => [c.slug, c]));
  const byId = new Map();
  const products = [];

  for (const nav of MAIN_NAV) {
    for (const apiSlug of nav.apiSlugs) {
      const cat = bySlug.get(apiSlug);
      if (!cat?.id) {
        log(`skip products — missing category ${apiSlug}`);
        continue;
      }
      log(`Fetching products for ${nav.name} ← ${apiSlug} (id=${cat.id})…`);
      const rows = await discoverProductsForCategoryId(cat.id);
      log(`  ${nav.name}/${apiSlug}: ${rows.length} products`);
      for (const row of rows) {
        if (byId.has(row.id)) continue;
        byId.set(row.id, row);
        products.push(row);
      }
    }
  }
  log(`Unique products under main nav: ${products.length}`);
  return products;
}

function parseStockQty(text) {
  const m = String(text || "").match(/(\d+)\s+in stock/i);
  if (m) return Number(m[1]);
  return null;
}

function resolveMainNavForStoreCats(storeCats, catById) {
  const list = Array.isArray(storeCats) ? storeCats : [];
  for (const c of list) {
    let cur = catById.get(c.id);
    // climb using parentId when we have full cat records
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.mainNavSlug) {
        return MAIN_NAV.find((n) => n.slug === cur.mainNavSlug) || null;
      }
      if (MAIN_API_SLUG_TO_NAV.has(cur.slug)) {
        return MAIN_API_SLUG_TO_NAV.get(cur.slug);
      }
      cur = cur.parentId ? catById.get(cur.parentId) : null;
    }
    // fallback: match API slug from product category payload
    const slug = slugify(c.slug);
    if (MAIN_API_SLUG_TO_NAV.has(slug)) return MAIN_API_SLUG_TO_NAV.get(slug);
  }
  // link path fallback
  for (const c of list) {
    const link = String(c.link || "");
    for (const nav of MAIN_NAV) {
      for (const api of nav.apiSlugs) {
        if (link.includes(`/product-category/${api}/`) || link.endsWith(`/${api}/`)) {
          return nav;
        }
      }
    }
  }
  return null;
}

function pickCategoryAssignment(storeCats, catById) {
  const list = Array.isArray(storeCats) ? storeCats : [];
  const nav = resolveMainNavForStoreCats(list, catById) || MAIN_NAV[0];

  // Prefer deepest path under this main nav
  let best = null;
  for (const c of list) {
    const link = String(c.link || "");
    const m = link.match(/\/product-category\/(.+?)\/?$/i);
    let parts = m
      ? m[1]
          .split("/")
          .map((p) => slugify(p))
          .filter(Boolean)
      : [slugify(c.slug)];
    // Rewrite API root slug → nav display slug
    if (parts.length && MAIN_API_SLUG_TO_NAV.has(parts[0])) {
      const n = MAIN_API_SLUG_TO_NAV.get(parts[0]);
      parts = [n.slug, ...parts.slice(1)];
    } else if (!parts.includes(nav.slug)) {
      parts = [nav.slug, ...parts.filter((p) => p !== nav.slug)];
    }
    if (!best || parts.length > best.parts.length) {
      best = {
        parts,
        leafSlug: slugify(c.slug),
        leafName: cleanText(c.name),
      };
    }
  }

  const parts = best?.parts?.length ? best.parts : [nav.slug];
  if (parts[0] !== nav.slug) parts.unshift(nav.slug);
  const leafSlug = best?.leafSlug || parts[parts.length - 1];
  const leafName =
    best?.leafName ||
    cleanText(list.find((c) => slugify(c.slug) === leafSlug)?.name || "") ||
    titleCase(leafSlug);

  return {
    categorySlug: nav.slug,
    categoryName: nav.name,
    subSlug: leafSlug !== nav.slug ? leafSlug : "",
    subName: leafSlug !== nav.slug ? leafName : "",
    path: parts,
  };
}

function attrsToEntries(attrs) {
  const entries = [];
  for (const attr of attrs || []) {
    const label = cleanText(String(attr.name || "").replace(/:$/, ""));
    const vals = (attr.terms || [])
      .map((t) => cleanText(t.name))
      .filter(Boolean);
    if (label && vals.length) entries.push({ label, value: vals.join(", ") });
  }
  return entries;
}

function extractDownloadsFromHtml(html, productSlug) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(
    /\[([^\]]+)\]\((https?:\/\/[^)]+\.(?:pdf|docx?|xlsx?|zip|dwg|dxf)[^)]*)\)/gi,
  )) {
    const name = cleanText(m[1]);
    const href = String(m[2] || "")
      .replace(/[\u0000-\u001F\u007F]+/g, "")
      .trim()
      .split("?")[0];
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ name: name || path.basename(href), href });
  }
  for (const m of String(html || "").matchAll(
    /<a[^>]+href=["']([^"']+\.(?:pdf|docx?|xlsx?|zip|dwg|dxf)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    let href = String(m[1] || "")
      .replace(/[\u0000-\u001F\u007F]+/g, "")
      .trim();
    if (href.startsWith("//")) href = `https:${href}`;
    if (href.startsWith("/")) href = `${BASE}${href}`;
    href = href.split("?")[0];
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const name = cleanText(m[2]) || path.basename(href);
    out.push({ name, href });
  }
  return out;
}

function mapStoreProduct(store, catById) {
  const slug =
    store.slug ||
    String(store.permalink || "")
      .split("/product/")[1]
      ?.replace(/\/$/, "") ||
    "";
  const name = cleanText(store.name) || titleCase(slug);
  const shortDescription = cleanText(store.short_description || "");
  const longDescription = cleanText(store.description || "");
  const description =
    [shortDescription, longDescription].filter(Boolean).join("\n\n") ||
    `${name} from Flooring Sales.`;

  const images = [];
  for (const img of store.images || []) {
    const src = String(img.src || "").split("?")[0];
    if (!src || !/^https?:\/\//i.test(src)) continue;
    if (/logo|favicon|\.svg$|holt_brand|no.?image/i.test(src)) continue;
    if (!images.includes(src)) images.push(src);
  }

  const cats = pickCategoryAssignment(store.categories, catById);
  const minor = store.prices?.currency_minor_unit === 2 ? 100 : 1;
  const price =
    Number(store.prices?.sale_price || store.prices?.price || 0) / minor || 0;
  const regular =
    Number(store.prices?.regular_price || 0) / minor || price;

  const featureEntries = attrsToEntries(store.attributes);
  const warrantyEntry = featureEntries.find((e) => /warranty/i.test(e.label));
  const dimEntry = featureEntries.find((e) => /dimension/i.test(e.label));
  const stockText = cleanText(store.stock_availability?.text || "");
  const stockQty = parseStockQty(stockText);

  const manufacturerBrand = cleanText(store.brands?.[0]?.name || "");
  const packMatch = name.match(/\(([^)]*pack[^)]*)\)/i);

  const specs = {
    source: SOURCE_TAG,
    sourceUrl: store.permalink || `${BASE}/product/${slug}/`,
    fslId: store.id,
    fslSku: store.sku || "",
    sku: store.sku || "",
    fslSlug: slug,
    fslType: store.type || "simple",
    categoryPath: cats.path,
    manufacturerBrand,
    stockAvailability: stockText,
    leadTimeLabel: stockText,
    packSize: packMatch ? packMatch[1] : "",
    currency: store.prices?.currency_code || "GBP",
    pricesExcludeVat: true,
  };
  for (const e of featureEntries) {
    specs[e.label] = e.value;
  }

  let stockStatus = "in_stock";
  if (store.is_in_stock === false) stockStatus = "out_of_stock";
  else if (store.is_on_backorder) stockStatus = "preorder";

  // Upsell IDs from _links
  const upsellHref = store._links?.upsells?.[0]?.href || "";
  const upsellIds = [];
  const includeM = upsellHref.match(/include=([0-9,]+)/i);
  if (includeM) {
    for (const id of includeM[1].split(",")) {
      const n = Number(id);
      if (n) upsellIds.push(n);
    }
  }

  return {
    id: store.id,
    url: store.permalink || `${BASE}/product/${slug}/`,
    slug,
    name,
    shortDescription,
    description: description.slice(0, 20000),
    images: images.slice(0, MAX_IMAGES),
    price,
    tradePrice: price > 0 ? price : null,
    regularPrice: regular,
    stock:
      stockQty != null
        ? stockQty
        : store.is_in_stock === false
          ? 0
          : STOCK_DEFAULT,
    stockStatus,
    stockAvailabilityText: stockText,
    warranty: warrantyEntry?.value || "",
    dimensions: dimEntry?.value
      ? { raw: dimEntry.value }
      : store.dimensions || {},
    featureEntries,
    manufacturerBrand,
    subBrand: manufacturerBrand ? slugify(manufacturerBrand) : "",
    sku: cleanText(store.sku || "") || slugify(slug).toUpperCase(),
    upsellIds,
    ...cats,
    specs,
  };
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: BRAND_SLUG });
  const now = new Date();
  const payload = {
    name: BRAND_NAME,
    uiName: BRAND_UI_NAME,
    slug: BRAND_SLUG,
    isActive: true,
    updatedAt: now,
  };
  if (!brand) {
    const insert = { ...payload, order: 75, image: "", createdAt: now, subBrands: [] };
    if (DRY_RUN) {
      brand = { ...insert, _id: "dry-brand" };
      log("[dry] create brand", BRAND_NAME, "uiName=", BRAND_UI_NAME);
    } else {
      const r = await brands.insertOne(insert);
      brand = { ...insert, _id: r.insertedId };
      log(`Created brand ${BRAND_NAME} (UI: ${BRAND_UI_NAME}) ${brand._id}`);
    }
  } else if (!DRY_RUN) {
    await brands.updateOne({ _id: brand._id }, { $set: payload });
    brand = { ...brand, ...payload };
    log(`Using brand ${brand.name} uiName=${BRAND_UI_NAME} (${brand._id})`);
  }
  return brand;
}

async function ensureSubBrand(db, brand, name) {
  if (!name || DRY_RUN) return slugify(name);
  const slug = slugify(name);
  const list = Array.isArray(brand.subBrands) ? brand.subBrands : [];
  if (list.some((s) => s.slug === slug)) return slug;
  await db.collection("brands").updateOne(
    { _id: brand._id },
    {
      $addToSet: { subBrands: { name, slug } },
      $set: { updatedAt: new Date() },
    },
  );
  brand.subBrands = [...list, { name, slug }];
  return slug;
}

async function ensureMenu(db, { name, slug, parent, brandId, order, image }) {
  const menus = db.collection("menus");
  const query = parent
    ? { slug, parent, brand: brandId }
    : { slug, parent: null, brand: brandId };
  let menu = DRY_RUN ? null : await menus.findOne(query);
  const now = new Date();
  if (!menu) {
    const insert = {
      name,
      slug,
      parent: parent || null,
      brand: brandId,
      order: order ?? 0,
      isActive: true,
      image: image || "",
      level: parent ? "subcategory" : "category",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      menu = { ...insert, _id: `dry-${slug}-${parent || "root"}` };
    } else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
      log(`+ menu ${parent ? "sub" : "cat"} ${name}`);
    }
  } else if (!DRY_RUN) {
    const set = {
      name,
      isActive: true,
      updatedAt: now,
      order: order ?? menu.order,
    };
    if (image && (!menu.image || process.env.FORCE_MENU_IMAGE === "1")) {
      set.image = image;
    }
    await menus.updateOne({ _id: menu._id }, { $set: set });
    menu = { ...menu, ...set };
  }
  return menu;
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
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () =>
      run(),
    ),
  );
}

function saveProgress(done) {
  fs.writeFileSync(
    PROGRESS,
    JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
  );
}

async function main() {
  fs.writeFileSync(LOG, `Flooring Sales import ${new Date().toISOString()}\n`);
  ensurePublicDir("images");
  ensurePublicDir("downloads");

  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (!SKIP_IMAGES && !DRY_RUN) {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      throw new Error("Missing Cloudinary credentials");
    }
  }

  log(
    `Flooring Sales → Linx Square import${DRY_RUN ? " (DRY RUN)" : ""} concurrency=${CONCURRENCY}`,
  );
  log(
    `Main nav only: ${MAIN_NAV.map((n) => n.name).join(" | ")}`,
  );

  await tryLogin();

  let categories = [];
  let storeProducts = [];
  let allCategories = [];

  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    categories = saved.categories || [];
    storeProducts = saved.storeProducts || [];
    allCategories = saved.allCategories || categories;
    log(
      `Resumed checkpoint: ${storeProducts.length} products, ${categories.length} categories`,
    );
  } else {
    allCategories = await discoverCategories();
    log(`All WC categories: ${allCategories.length}`);
    categories = filterToMainNavCategories(allCategories);
    storeProducts = await discoverProductsViaMainNav(allCategories);
    log(`Products under main nav: ${storeProducts.length}`);
    fs.writeFileSync(
      CHECKPOINT,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          mainNav: MAIN_NAV,
          categories,
          allCategories,
          storeProducts,
          count: storeProducts.length,
        },
        null,
        2,
      ),
    );
  }

  if (ONLY_SLUG) {
    storeProducts = storeProducts.filter(
      (p) => String(p.slug || "").toLowerCase() === ONLY_SLUG,
    );
    log(`ONLY_SLUG=${ONLY_SLUG} → ${storeProducts.length}`);
  }

  if (DISCOVER_ONLY) {
    log("Discover-only done.");
    return;
  }

  if (LIMIT > 0) storeProducts = storeProducts.slice(0, LIMIT);

  const catById = new Map(categories.map((c) => [c.id, c]));
  // Also index full API cats for parent climbs
  for (const c of allCategories || []) {
    if (!catById.has(c.id)) catById.set(c.id, c);
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  // Deactivate menus outside the 8 main-nav roots (from earlier full scrape)
  const allowedRootSlugs = new Set(MAIN_NAV.map((n) => n.slug));
  if (!DRY_RUN) {
    const oldMenus = await db
      .collection("menus")
      .find({ brand: brand._id, parent: null })
      .toArray();
    for (const m of oldMenus) {
      if (allowedRootSlugs.has(m.slug)) continue;
      await db.collection("menus").updateOne(
        { _id: m._id },
        { $set: { isActive: false, updatedAt: new Date() } },
      );
      log(`deactivated non-nav root menu: ${m.name} (${m.slug})`);
    }
  }

  // Build menus: 8 main nav roots, then subcats under the matching nav root
  const menuByCatId = new Map();
  const menuByNavSlug = new Map();

  for (const nav of MAIN_NAV) {
    const navCat = categories.find((c) => c.isNavRoot && c.slug === nav.slug);
    const menu = await ensureMenu(db, {
      name: nav.name,
      slug: nav.slug,
      parent: null,
      brandId: brand._id,
      order: nav.order,
      image: navCat?.image || "",
    });
    menuByNavSlug.set(nav.slug, menu);
    if (navCat) menuByCatId.set(navCat.id, menu);
  }

  // Attach API-root children under the synthetic nav root
  for (const cat of categories) {
    if (cat.isNavRoot) continue;
    if (!cat.parentId) {
      // API top-level (e.g. flooring, laminate) → child of nav root
      const navMenu = menuByNavSlug.get(cat.mainNavSlug);
      if (!navMenu) continue;
      // Skip duplicate when API slug == nav slug (laminate/accessories/abrasives)
      if (cat.slug === cat.mainNavSlug) {
        menuByCatId.set(cat.id, navMenu);
        continue;
      }
      let image = "";
      if (cat.image) {
        try {
          image = await uploadRemoteImage(cat.image, `menu-${cat.slug}`);
        } catch (e) {
          log(`menu image fail ${cat.slug}: ${e.message}`);
        }
      }
      const menu = await ensureMenu(db, {
        name: cat.name,
        slug: cat.slug,
        parent: navMenu._id,
        brandId: brand._id,
        order: 0,
        image,
      });
      menuByCatId.set(cat.id, menu);
    }
  }

  // Nested children in waves
  let guard = 0;
  while (guard++ < 20) {
    let created = 0;
    for (const cat of categories) {
      if (cat.isNavRoot || !cat.parentId || menuByCatId.has(cat.id)) continue;
      let parentMenu = menuByCatId.get(cat.parentId);
      if (!parentMenu) {
        // parent may be API root already mapped to nav
        const parentCat = catById.get(cat.parentId);
        if (parentCat?.mainNavSlug && parentCat.slug === parentCat.mainNavSlug) {
          parentMenu = menuByNavSlug.get(parentCat.mainNavSlug);
        }
      }
      if (!parentMenu) continue;
      let image = "";
      if (cat.image) {
        try {
          image = await uploadRemoteImage(cat.image, `menu-${cat.slug}`);
        } catch {
          /* ignore */
        }
      }
      const menu = await ensureMenu(db, {
        name: cat.name,
        slug: cat.slug,
        parent: parentMenu._id,
        brandId: brand._id,
        order: 0,
        image,
      });
      menuByCatId.set(cat.id, menu);
      created++;
    }
    if (!created) break;
  }
  log(`Menus ready: ${menuByCatId.size} (main nav roots: ${MAIN_NAV.length})`);

  const done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    try {
      const prog = JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
      for (const id of prog.done || []) done.add(String(id));
      log(`Resume progress: ${done.size} already done`);
    } catch {
      /* ignore */
    }
  }

  let imported = 0;
  let updated = 0;
  let failed = 0;
  const idToMongo = new Map();

  const pending = storeProducts.filter((p) => !done.has(String(p.id)));
  log(`Importing ${pending.length} products…`);

  await mapPool(pending, CONCURRENCY, async (store, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    try {
      const p = mapStoreProduct(store, catById);
      if (!p.name) {
        log(`${label} skip empty name ${store.id}`);
        return;
      }

      // Ensure menus for path
      let parentMenuId = null;
      for (let depth = 0; depth < p.path.length; depth++) {
        const part = p.path[depth];
        const cat =
          categories.find((c) => c.slug === part) ||
          ({ name: titleCase(part), slug: part, id: `path-${part}` });
        const existing = [...menuByCatId.values()].find(
          (m) =>
            m.slug === part &&
            String(m.parent || "") === String(parentMenuId || ""),
        );
        if (existing) {
          parentMenuId = existing._id;
          continue;
        }
        const menu = await ensureMenu(db, {
          name: cat.name || titleCase(part),
          slug: part,
          parent: parentMenuId,
          brandId: brand._id,
          order: depth,
          image: "",
        });
        if (cat.id) menuByCatId.set(cat.id, menu);
        parentMenuId = menu._id;
      }

      if (p.manufacturerBrand) {
        p.subBrand = await ensureSubBrand(db, brand, p.manufacturerBrand);
      }

      const handle = slugify(p.slug || p.name) || `fsl-${p.id}`;
      const uploaded = [];
      for (let i = 0; i < p.images.length; i++) {
        try {
          const url = await uploadRemoteImage(p.images[i], `${handle}-${i + 1}`);
          if (url) uploaded.push(url);
        } catch (e) {
          log(`${label} image fail: ${e.message}`);
        }
      }

      // Downloads / datasheets from PDP (best-effort; HTML may be WAF-blocked)
      const downloads = [];
      if (!SKIP_PDP_ENRICH) {
        const html = await fetchTextMaybe(p.url);
        const files = extractDownloadsFromHtml(html, handle);
        for (const f of files.slice(0, 12)) {
          const local = await downloadToPublic(
            f.href,
            path.join("downloads", handle),
            f.name,
          );
          if (local) {
            downloads.push({
              name: f.name,
              url: local,
              type: path.extname(f.href).replace(".", "").toLowerCase(),
            });
          }
        }
      }

      const now = new Date();
      const doc = {
        name: p.name,
        description: p.description,
        shortDescription: p.shortDescription,
        price: p.price,
        tradePrice: p.tradePrice,
        images: uploaded,
        category: p.categorySlug || "flooring",
        subCategory: p.subSlug || "",
        brand: brand._id,
        brands: [brand._id],
        subBrand: p.subBrand || "",
        stock: p.stock,
        stockStatus: p.stockStatus,
        stockAvailabilityText: p.stockAvailabilityText,
        isOutOfStock: p.stockStatus === "out_of_stock",
        warranty: p.warranty,
        dimensions: p.dimensions,
        featureEntries: p.featureEntries,
        tagline: p.specs.packSize || "",
        linxSku: p.sku || "",
        manufacturerSku: p.sku || "",
        productCode: p.sku || "",
        schematicImage: "",
        specs: {
          ...p.specs,
          upsellFslIds: p.upsellIds,
          importedAt: now.toISOString(),
        },
        downloads,
        showSpecs: true,
        vatRate: 20,
        updatedAt: now,
        priceSyncedAt: now,
        stockSyncedAt: now,
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] ${p.name} £${p.price} imgs=${p.images.length} cat=${doc.category}/${doc.subCategory} attrs=${p.featureEntries.length}`,
        );
        imported++;
      } else {
        const existing = await productsCol.findOne({
          $or: [
            { "specs.fslId": p.id, "specs.source": SOURCE_TAG },
            { "specs.sourceUrl": p.url, "specs.source": SOURCE_TAG },
            ...(p.sku
              ? [{ "specs.fslSku": p.sku, "specs.source": SOURCE_TAG }]
              : []),
          ],
        });

        if (existing) {
          const prev = Array.isArray(existing.images) ? existing.images : [];
          const prevCloud = prev.filter((u) => /cloudinary\.com/i.test(u));
          if (!uploaded.length && prevCloud.length) doc.images = prevCloud;
          else if (!uploaded.length) doc.images = prev;
          if (!downloads.length && Array.isArray(existing.downloads)) {
            doc.downloads = existing.downloads;
          }
          await productsCol.updateOne({ _id: existing._id }, { $set: doc });
          idToMongo.set(p.id, existing._id);
          updated++;
        } else {
          const r = await productsCol.insertOne({ ...doc, createdAt: now });
          idToMongo.set(p.id, r.insertedId);
          imported++;
        }
        log(
          `${label} ✓ ${p.name} (£${p.price}) imgs=${doc.images.length} attrs=${p.featureEntries.length} dl=${downloads.length}`,
        );
      }

      done.add(String(store.id));
      if (done.size % 25 === 0) saveProgress(done);
      await delay(REQUEST_GAP_MS);
    } catch (e) {
      failed++;
      log(`${label} ✗ ${store.slug || store.id}: ${e.message}`);
    }
  });

  saveProgress(done);

  // Wire upsells → relatedProductIds
  if (!DRY_RUN) {
    let linked = 0;
    for (const store of storeProducts) {
      const p = mapStoreProduct(store, catById);
      if (!p.upsellIds.length) continue;
      const selfId =
        idToMongo.get(p.id) ||
        (
          await productsCol.findOne(
            { "specs.fslId": p.id, "specs.source": SOURCE_TAG },
            { projection: { _id: 1 } },
          )
        )?._id;
      if (!selfId) continue;
      const related = [];
      for (const uid of p.upsellIds) {
        const rid =
          idToMongo.get(uid) ||
          (
            await productsCol.findOne(
              { "specs.fslId": uid, "specs.source": SOURCE_TAG },
              { projection: { _id: 1 } },
            )
          )?._id;
        if (rid) related.push(rid);
      }
      if (!related.length) continue;
      await productsCol.updateOne(
        { _id: selfId },
        { $set: { relatedProductIds: related, updatedAt: new Date() } },
      );
      linked++;
    }
    log(`Related/upsell links: ${linked}`);
  }

  log("========== FLOORING SALES IMPORT ==========");
  log(`Created:  ${imported}`);
  log(`Updated:  ${updated}`);
  log(`Failed:   ${failed}`);
  log(`Brand:    ${BRAND_NAME} / UI ${BRAND_UI_NAME}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
