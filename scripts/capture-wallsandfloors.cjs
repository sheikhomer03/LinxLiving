/**
 * Two-stage crawler/scraper for wallsandfloors.co.uk (Magento 2 + Nuxt SSR).
 *
 * Unlike Al Murad, this site needs no bot-check bypass and publishes real
 * public prices — but has its own quirks, found by hand before writing this:
 *
 *  - No `/sitemap.xml` — the real one is at `/sitemap/sitemap.xml`
 *    (robots.txt points to it). A flat <urlset> of ~2,300 URLs, each with a
 *    <priority> that cleanly buckets page type: 0.9 = category/facet page,
 *    0.8 = individual product, 0.5/1 = info/home pages. Used as the
 *    authoritative, exhaustive product URL list — no crawl needed to reach
 *    every product.
 *  - Category pages ALSO paginate via `?page=N`, but in SSR mode this is
 *    CUMULATIVE, not a page-2-replaces-page-1 offset: `?page=2` returns
 *    page 1 AND page 2's items concatenated, capping exactly at the
 *    category's true total (verified: /floor-tiles capped at 276 products
 *    on both page=6 and page=7 — 276 is the real total). Used to recover
 *    each product's category membership (a product can — and usually
 *    does — belong to more than one category page), which JSON-LD/sitemap
 *    alone don't give.
 *  - Product pages carry a single-Product JSON-LD block for the core
 *    fields (name, image, description, sku, gtin, price, currency,
 *    availability) — but NOT the full spec table, gallery, or category.
 *    Those come from parsing the rendered DOM directly:
 *      - specs: `<span class="capitalize">Label</span>...<span
 *        class="...pdp-productDetails-value...">Value</span>` pairs,
 *        clean and consistent (Weight, Product ID, Sale by, Grade,
 *        Material Type, Product color, Finish, Size, Thickness,
 *        Rectified Edge, Tiles Per SQM, Space Usage, Shape, Style, Pack
 *        Coverage, PTV Rating, Wear Layer, Made In — not every product has
 *        every field).
 *      - gallery: the JSON-LD `image` field only carries ONE photo; the
 *        real gallery is `\/media\/catalog\/product\/cache\/<hash>\/m\/o\/
 *        <slug>-<n>.jpg` for n = 1..N, JSON-string-escaped (`/` for
 *        `/`) inside an embedded Nuxt payload blob — recovered by finding
 *        every `<basename>-<n>.jpg` occurrence sharing the JSON-LD image's
 *        own cache hash and basename, deduped by n.
 *
 * Env:
 *   FRESH=1     ignore any existing checkpoint, start over
 *   LIMIT=n     stop after n products (debugging)
 */
const path = require("path");
const fs = require("fs");

const ORIGIN = "https://www.wallsandfloors.co.uk";
const DATA_DIR = path.join(__dirname, "..", ".scratch", "wallsandfloors");
const SITEMAP_FILE = path.join(DATA_DIR, "sitemap.xml");
const URL_LIST_FILE = path.join(DATA_DIR, "wf-urls.json");
const CAT_MEMBERSHIP_FILE = path.join(DATA_DIR, "wf-cat-membership.json");
const PDP_FILE = path.join(DATA_DIR, "wf-pdp.jsonl");
const FRESH = process.env.FRESH === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;

fs.mkdirSync(DATA_DIR, { recursive: true });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function get(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
    if (!res.ok) throw new Error("HTTP " + res.status + " on " + url);
    return await res.text();
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 1200 * Math.pow(2, attempt)));
    return get(url, attempt + 1);
  }
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/* ---------- Stage 0: sitemap ---------- */

async function fetchSitemap() {
  if (!FRESH && fs.existsSync(SITEMAP_FILE)) return fs.readFileSync(SITEMAP_FILE, "utf8");
  const xml = await get(ORIGIN + "/sitemap/sitemap.xml");
  fs.writeFileSync(SITEMAP_FILE, xml);
  return xml;
}

function parseSitemap(xml) {
  const entries = [];
  const re = /<url>\s*<loc>(.*?)<\/loc>\s*<priority>([\d.]+)<\/priority>/g;
  let m;
  while ((m = re.exec(xml))) {
    entries.push({ url: decodeEntities(m[1]), priority: parseFloat(m[2]) });
  }
  return entries;
}

/* ---------- Stage 1: category membership crawl ---------- */

/** Every `"@type":"Product"` block inside an `ItemList`/category page's
 *  JSON-LD, giving product URL (canonical) per category page. */
function parseCategoryProductUrls(html) {
  const urls = new Set();
  const ldBlocks = [...html.matchAll(/type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => m[1]);
  for (const raw of ldBlocks) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      const list = item.itemListElement || (item["@type"] === "ItemList" ? item.itemListElement : null);
      if (Array.isArray(list)) {
        for (const li of list) {
          const u = li.url || li.item?.url || (li.item && li.item["@id"]);
          if (u) urls.add(u.split("?")[0]);
        }
      }
      if (item["@type"] === "Product" && item.offers?.url) {
        urls.add(item.offers.url.split("?")[0]);
      }
    }
  }
  return [...urls];
}

function productCountOnPage(html) {
  return (html.match(/"@type":"Product"/g) || []).length;
}

async function crawlCategory(categoryUrl) {
  const membership = new Set();
  let page = 1;
  let lastCount = -1;
  for (;;) {
    const url = page === 1 ? categoryUrl : categoryUrl + (categoryUrl.includes("?") ? "&" : "?") + "page=" + page;
    let html;
    try {
      html = await get(url);
    } catch {
      break;
    }
    const count = productCountOnPage(html);
    for (const u of parseCategoryProductUrls(html)) membership.add(u);
    if (count <= lastCount) break; // stopped growing — reached the true total
    lastCount = count;
    page += 1;
    if (page > 40) break; // sanity cap
  }
  return [...membership];
}

async function discoverCategoryMembership(categoryUrls) {
  if (!FRESH && fs.existsSync(CAT_MEMBERSHIP_FILE)) {
    return JSON.parse(fs.readFileSync(CAT_MEMBERSHIP_FILE, "utf8"));
  }
  const membership = {}; // productUrl -> Set of category slugs (as array once saved)
  let done = 0;
  for (const catUrl of categoryUrls) {
    done += 1;
    const slug = new URL(catUrl).pathname.replace(/^\//, "");
    let productUrls;
    try {
      productUrls = await crawlCategory(catUrl);
    } catch (e) {
      console.log("  [cat error] " + slug + " -> " + e.message);
      continue;
    }
    for (const pu of productUrls) {
      const key = new URL(pu, ORIGIN).pathname;
      if (!membership[key]) membership[key] = [];
      if (!membership[key].includes(slug)) membership[key].push(slug);
    }
    if (done % 20 === 0 || done === categoryUrls.length) {
      console.log("  category " + done + "/" + categoryUrls.length + "  (" + slug + ": " + productUrls.length + " products)");
    }
  }
  fs.writeFileSync(CAT_MEMBERSHIP_FILE, JSON.stringify(membership));
  return membership;
}

/* ---------- Stage 2: product detail scrape ---------- */

function parseProductJsonLd(html) {
  const ldBlocks = [...html.matchAll(/type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => m[1]);
  for (const raw of ldBlocks) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    if (data["@type"] === "Product") return data;
  }
  return null;
}

/** Structured `<span class="capitalize">Label</span>...value...</span>`
 *  pairs from the product-details panel — clean, no free-text parsing
 *  needed on this site (unlike Al Murad). */
function parseSpecPairs(html) {
  const out = {};
  const re = /<span class="capitalize">([^<]*)<\/span>[\s\S]*?text-pdp-productDetails-value[^>]*>([^<]*)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const label = decodeEntities(m[1]).trim();
    const value = decodeEntities(m[2]).trim();
    if (label && value) out[label] = value;
  }
  return out;
}

/**
 * Full gallery — template-independent, unlike a first version that assumed
 * every product's images share a `<basename>-<n>.<ext>` numbered-suffix
 * naming scheme (true for some ranges, e.g. `monoedge-white-100x100-1..7`)
 * and silently missed the OTHER naming convention this site also uses
 * (`oasis-beige-main-1000`, `oasis-beige-cameo-1..4`, `oasis-beige-
 * tile-1000_1` — no shared numbered suffix at all), leaving 1,148/1,562
 * products (73%) down to just their hero shot.
 *
 * Every gallery image — regardless of naming convention — appears in a
 * Nuxt payload array at the `650X650` resized-image size bucket (`2300X2300`
 * exists for some but not as `.jpg`, so isn't universal; `650X650` is,
 * confirmed against both naming conventions). JSON-string-escaped
 * (`/` for `/`) inside the page; collecting every distinct URL at that
 * bucket, independent of filename shape, recovers the real gallery size
 * every time.
 */
function parseGallery(html) {
  const unescaped = html.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  const re = /https:\/\/m2\.wallsandfloors\.co\.uk\/media\/catalog\/650X650\/[a-z0-9]\/[a-z0-9]\/[A-Za-z0-9_.-]+\.jpg/gi;
  return [...new Set(unescaped.match(re) || [])];
}

async function crawlProduct(productUrl, categories) {
  const html = await get(productUrl);
  const ld = parseProductJsonLd(html);
  const specs = parseSpecPairs(html);
  const images = parseGallery(html);
  if (!images.length && ld?.image) images.push(ld.image);

  return {
    url: productUrl,
    name: ld?.name || "",
    description: decodeEntities(ld?.description || ""),
    sku: ld?.sku || "",
    gtin: ld?.gtin || "",
    price: ld?.offers?.price ?? null,
    priceCurrency: ld?.offers?.priceCurrency || "GBP",
    availability: ld?.offers?.availability || "",
    images,
    specs,
    categories: categories || [],
  };
}

/* ---------- main ---------- */

async function main() {
  console.log("fetching sitemap...");
  const xml = await fetchSitemap();
  const entries = parseSitemap(xml);
  const categoryUrls = entries.filter((e) => e.priority === 0.9).map((e) => e.url);
  const productUrls = entries.filter((e) => e.priority === 0.8).map((e) => e.url);
  console.log("sitemap: " + entries.length + " urls  (" + categoryUrls.length + " category, " + productUrls.length + " product)");

  console.log("\ndiscovering category membership (crawl, cumulative pagination)...");
  const membership = await discoverCategoryMembership(categoryUrls);
  console.log("category membership resolved for " + Object.keys(membership).length + " product paths");

  const already = new Set();
  if (!FRESH && fs.existsSync(PDP_FILE)) {
    for (const line of fs.readFileSync(PDP_FILE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        already.add(JSON.parse(line).url);
      } catch {}
    }
  }
  console.log("already captured: " + already.size);

  const out = fs.createWriteStream(PDP_FILE, { flags: FRESH ? "w" : "a" });
  let done = 0, errors = 0;
  const started = Date.now();

  for (const pu of productUrls) {
    if (done >= LIMIT) break;
    if (already.has(pu)) continue;
    done += 1;
    const path_ = new URL(pu).pathname;
    const cats = membership[path_] || [];
    try {
      const rec = await crawlProduct(pu, cats);
      out.write(JSON.stringify(rec) + "\n");
    } catch (e) {
      errors += 1;
      out.write(JSON.stringify({ url: pu, error: String(e.message || e) }) + "\n");
    }
    if (done % 100 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      const left = Math.round((productUrls.length - already.size - done) / Math.max(rate, 0.001) / 60);
      console.log("  " + done + " captured this run, " + errors + " errors, ~" + left + "m left");
    }
  }
  out.end();
  console.log("\ndone. captured " + done + " this run (" + errors + " errors), total in file: " + (already.size + done));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
