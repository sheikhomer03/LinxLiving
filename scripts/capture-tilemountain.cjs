/**
 * Capture tilemountain.co.uk into a JSONL store (crawl only — no Mongo writes).
 *
 * Two-stage like the other retailer importers here: this script only fetches
 * and parses, so `import-tilemountain.cjs` can be re-run against the capture
 * without re-crawling the shop.
 *
 * Three things about this site shape the crawl:
 *
 *  - Product pages are fully server-rendered. There is no product API call to
 *    borrow, so the PDP is parsed out of HTML, but everything needed is in it.
 *  - `?page=N` on a category is CUMULATIVE — page 3 contains pages 1-3 — so a
 *    category's whole product list comes from one request at its last page
 *    rather than one request per page.
 *  - Their own /i/site_map lists every category, which is how product URLs are
 *    told apart from category URLs: both are single-segment slugs.
 *
 * Tiles are sold by the square metre with a box quantity and a tiles-per-m²
 * figure. Those three numbers are what the storefront's area calculator needs,
 * so they are captured as first-class fields rather than left in the attribute
 * bag.
 *
 * Env:
 *   LIMIT=n        stop after n products (smoke test)
 *   CONCURRENCY=n  parallel fetches (default 3 — be polite, it is a live shop)
 *   FRESH=1        ignore an existing capture and start over
 *   CATS_ONLY=1    stop after the category/product-URL enumeration
 *   SKIP_SALE=1    drop products the site is discounting (default: keep)
 */
const path = require("path");
const fs = require("fs");

const ORIGIN = "https://www.tilemountain.co.uk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DATA =
  process.env.TM_DATA ||
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/a167de67-d47a-4f6e-aa8a-c11dee9e30bc/scratchpad";

const LIMIT = Number(process.env.LIMIT) || Infinity;
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 3, 6));
const FRESH = process.env.FRESH === "1";
const CATS_ONLY = process.env.CATS_ONLY === "1";
const SKIP_SALE = process.env.SKIP_SALE === "1";

const PDP_FILE = path.join(DATA, "tm-pdp.jsonl");
const CAT_FILE = path.join(DATA, "tm-cats.json");
const URLS_FILE = path.join(DATA, "tm-urls.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * fetching
 * ------------------------------------------------------------------ */

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-GB,en;q=0.9",
        },
        signal: AbortSignal.timeout(45000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) {
      if (i === tries) throw e;
      await sleep(800 * i);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * small HTML helpers
 * ------------------------------------------------------------------ */

const ENTITIES = {
  "&amp;": "&", "&pound;": "\u00a3", "&#163;": "\u00a3", "&quot;": '"',
  "&apos;": "'", "&#39;": "'", "&nbsp;": " ", "&lt;": "<", "&gt;": ">",
  "&rsquo;": "\u2019", "&lsquo;": "\u2018", "&ldquo;": "\u201c",
  "&rdquo;": "\u201d", "&ndash;": "\u2013", "&mdash;": "\u2014",
  "&deg;": "\u00b0", "&times;": "\u00d7", "&reg;": "\u00ae", "&trade;": "\u2122",
};

function decode(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => (m in ENTITIES ? ENTITIES[m] : m));
}

function stripTags(s) {
  return decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function jsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const v = JSON.parse(m[1].trim());
      Array.isArray(v) ? out.push(...v) : out.push(v);
    } catch { /* a malformed block is not worth failing the page over */ }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * stage 1 — the category universe
 * ------------------------------------------------------------------ */

/**
 * Every category page, from the shop's own site map plus the mega menu.
 *
 * This doubles as the test for "is this URL a product?" — categories and
 * products are both single-segment slugs, and nothing else distinguishes
 * them without fetching.
 */
async function collectCategories() {
  const html = await get(ORIGIN + "/i/site_map");
  const set = new Set();

  const add = (href) => {
    if (!href || !href.startsWith("/")) return;
    const p = href.split(/[?#]/)[0].replace(/\/$/, "");
    if (!p || p === "/") return;
    if (/^\/(i|customer|checkout|cart|account|review|search|catalogsearch)\b/.test(p)) return;
    set.add(p);
  };

  for (const m of (html || "").matchAll(/href="(\/[^"#?]{2,90})"/g)) add(m[1]);

  // The site map omits a few menu-only landing pages.
  const home = await get(ORIGIN + "/");
  for (const m of (home || "").matchAll(/href="(\/[^"#?]{2,90})"/g)) {
    const p = m[1];
    if (/^\/(flooring|accessories|tile-colours|wall-tiles-by-colour|sale)\//.test(p)) add(p);
  }

  return [...set].sort();
}

/** `599 Results` → 599, and the grid's page size, so the last page is known. */
function readResultCount(html) {
  const m = /([\d,]+)\s*Results?/i.exec(html || "");
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}

const PAGE_SIZE = 48;

/**
 * One category's product slugs.
 *
 * Asks for the last page directly: the listing is cumulative, so that one
 * response carries every product in the category.
 */
async function crawlCategory(catPath, categorySlugs) {
  const first = await get(ORIGIN + catPath);
  if (!first) return null;

  const total = readResultCount(first);
  const label =
    stripTags((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(first) || [])[1] || "") ||
    catPath.split("/").pop().replace(/-/g, " ");

  let html = first;
  if (total > PAGE_SIZE) {
    const last = Math.ceil(total / PAGE_SIZE);
    const full = await get(ORIGIN + catPath + "?page=" + last);
    if (full) html = full;
  }

  const slugs = new Set();
  for (const m of html.matchAll(/href="(\/[a-z0-9][a-z0-9\-]{6,90})"/g)) {
    const p = m[1];
    if (categorySlugs.has(p)) continue; // it is a category, not a product
    slugs.add(p);
  }

  return { path: catPath, label, total, products: [...slugs] };
}

/* ------------------------------------------------------------------ *
 * stage 2 — the product page
 * ------------------------------------------------------------------ */

/**
 * The Product Details table.
 *
 * The label is sometimes wrapped in a `.capitalize` span and sometimes bare
 * text in the row, so the name is taken as whatever precedes the value span
 * rather than from a fixed element. "Box Coverage" is one of the rows that
 * uses the bare form, and it is the figure the area calculator needs.
 */
function parseAttributes(html) {
  const attrs = {};
  const re = /<span class="text-pdp-productDetails-value[^"]*"[^>]*>([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const value = stripTags(m[1]);
    if (!value) continue;
    /*
     * The label is whatever text opens this row.
     *
     * Reading backwards a fixed number of characters does not work: the
     * label sits in a `.capitalize` span on some rows and bare on others,
     * and a plain look-behind runs into the previous row's value. Anchoring
     * on the row container keeps the two apart.
     */
    const rowStart = html.lastIndexOf('<div class="gap-3', m.index);
    const from =
      rowStart === -1 || m.index - rowStart > 900
        ? Math.max(0, m.index - 160)
        : rowStart;
    const k = stripTags(html.slice(from, m.index)).replace(/[:\s]+$/, "").trim();
    if (k && k.length < 40 && !(k in attrs)) attrs[k] = value;
  }
  return attrs;
}


/** Full-resolution gallery, in the order the page shows it. */
function parseGallery(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(
    /href="(https:\/\/m2\.tilemountain\.co\.uk\/media\/catalog\/2300X2300\/[^"]+)"/g,
  )) {
    const u = decode(m[1]);
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  if (out.length) return out;

  // A few products only ship the smaller renditions; take the largest present.
  for (const m of html.matchAll(
    /https:\/\/m2\.tilemountain\.co\.uk\/media\/catalog\/650X650\/[^"'\s\\]+/g,
  )) {
    const u = decode(m[0]);
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

/**
 * The "> …" bullets above the description.
 *
 * The page renders the block more than once (a desktop copy and a mobile
 * one, and only one of them carries the list), so every occurrence is parsed
 * and the fullest wins.
 */
function parseKeyFeatures(html) {
  let best = [];
  let from = 0;
  for (;;) {
    const i = html.indexOf("Key Features", from);
    if (i === -1) break;
    from = i + 12;
    const seg = html.slice(i, i + 9000);
    const ul = /<ul[^>]*>([\s\S]*?)<\/ul>/.exec(seg);
    if (!ul) continue;
    const out = [];
    for (const m of ul[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
      // One <li> often holds every bullet, each introduced by "> ".
      for (const part of stripTags(m[1]).split(/\s*>\s*/)) {
        const t = part.replace(/^[•\s]+/, "").trim();
        if (t && t.length < 220) out.push(t);
      }
    }
    if (out.length > best.length) best = out;
  }
  return [...new Set(best)].slice(0, 25);
}

/** Colour swatches and design buttons — labels only; the site links them in JS. */
function parseVariants(html) {
  const out = {};

  const colours = [...html.matchAll(/alt="Color:\s*([^"]{1,40})"/g)].map((m) =>
    decode(m[1]).trim(),
  );
  if (colours.length) out.Colour = [...new Set(colours)];

  for (const key of ["Design"]) {
    const i = html.indexOf(key + ": ");
    if (i === -1) continue;
    const seg = html.slice(i, i + 4000);
    const chosen = stripTags((/<span class="text-base font-gillSans[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(seg) || [])[1] || "");
    if (chosen) out[key + "Selected"] = chosen;
    if (key === "Design" || key === "Size" || key === "Finish") {
      const opts = [...seg.matchAll(/data-testid="button[^"]*"[^>]*>([\s\S]{1,40}?)<\/button>/g)]
        .map((m) => stripTags(m[1]))
        .filter((t) => t && t.length < 30);
      if (opts.length) out[key] = [...new Set(opts)];
    }
  }
  return out;
}

/** "180 sqm in Stock" / "12 in Stock" */
function parseStock(html) {
  const m = /([\d,.]+)\s*(sqm|m2|m²)?\s*in Stock/i.exec(html);
  if (!m) return { stock: null, stockUnit: null };
  return {
    stock: Number(String(m[1]).replace(/,/g, "")),
    stockUnit: m[2] ? "sqm" : "each",
  };
}

async function capturePdp(slug) {
  const url = ORIGIN + slug;
  const html = await get(url);
  if (!html) return null;

  const ld = jsonLd(html).find((x) => x && x["@type"] === "Product");
  if (!ld) return null; // not a product page after all

  const attrs = parseAttributes(html);
  const images = parseGallery(html);
  const { stock, stockUnit } = parseStock(html);

  // Sold per square metre or per item — the page says "/ sqm" beside the price.
  const perSqm = /\/\s*<\/?[^>]*>?\s*sqm/i.test(html) || /\/sqm/i.test(html);

  const price = Number(ld.offers?.price) || null;
  const rrp = (() => {
    const m = /RRP[^\d£]{0,20}£\s*([\d.,]+)/i.exec(html);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  })();

  const boxQty = Number(attrs["Box Quantity"]) || null;
  const perSqmCount = Number(attrs["Tiles Per Square Metre"]) || null;

  /*
   * What one box covers — the figure the area calculator divides by.
   *
   * The published "Box Coverage" is authoritative where it exists. Deriving
   * it as boxQty / tilesPerSqm only holds for tiles: on plank flooring
   * "Tiles Per Square Metre" carries a per-plank figure instead, and the
   * division produced 68 m² a box. So the derived value is used only as a
   * fallback and only when it lands in a believable range.
   */
  const published = parseFloat(String(attrs["Box Coverage"] || "").replace(/[^\d.]/g, ""));
  let sqmPerBox = Number.isFinite(published) && published > 0 ? published : null;
  if (sqmPerBox == null && boxQty && perSqmCount) {
    const derived = boxQty / perSqmCount;
    if (derived >= 0.2 && derived <= 6) sqmPerBox = Number(derived.toFixed(4));
  }

  const sizeText =
    (/Size:\s*<\/?[^>]*>?\s*([0-9]+x[0-9]+(?:x[0-9.]+)?mm)/i.exec(html) || [])[1] ||
    (attrs.Height && attrs.Width
      ? attrs.Height + "x" + attrs.Width + (attrs.Thickness ? "x" + attrs.Thickness : "")
      : null);

  const description =
    (() => {
      const i = html.indexOf(">Description<");
      if (i === -1) return null;
      const seg = html.slice(i, i + 4000);
      const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(seg);
      return p ? stripTags(p[1]) : null;
    })() || stripTags(ld.description || "");

  // "Customers also liked" — the only place a PDP links other PDPs.
  const related = (() => {
    const i = html.indexOf("Customers also liked");
    if (i === -1) return [];
    const seg = html.slice(i, i + 40000);
    const out = new Set();
    for (const m of seg.matchAll(/href="(\/[a-z0-9][a-z0-9\-]{10,90})"/g)) {
      if (m[1] !== slug) out.add(m[1]);
    }
    return [...out].slice(0, 12);
  })();

  return {
    slug,
    url,
    sku: String(ld.sku || "").trim() || null,
    name: decode(ld.name || "").trim(),
    description,
    keyFeatures: parseKeyFeatures(html),
    price,
    rrp,
    priceUnit: perSqm ? "sqm" : "each",
    currency: ld.offers?.priceCurrency || "GBP",
    availability: String(ld.offers?.availability || "").split("/").pop() || null,
    stock,
    stockUnit,
    images,
    attributes: attrs,
    size: sizeText,
    boxQuantity: boxQty,
    tilesPerSqm: perSqmCount,
    sqmPerBox,
    variants: parseVariants(html),
    related,
    onSale: rrp != null && price != null && rrp > price,
    capturedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * driver
 * ------------------------------------------------------------------ */

function readDone() {
  if (FRESH || !fs.existsSync(PDP_FILE)) return new Set();
  const done = new Set();
  for (const line of fs.readFileSync(PDP_FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).slug); } catch { /* half-written line */ }
  }
  return done;
}

async function pool(items, worker, n) {
  let i = 0;
  const runners = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  if (FRESH) {
    for (const f of [PDP_FILE, CAT_FILE, URLS_FILE]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }

  // ---- categories ------------------------------------------------------
  let cats;
  if (!FRESH && fs.existsSync(CAT_FILE)) {
    cats = JSON.parse(fs.readFileSync(CAT_FILE, "utf8"));
    console.log("categories: reusing " + cats.length + " from " + path.basename(CAT_FILE));
  } else {
    const paths = await collectCategories();
    console.log("categories: " + paths.length + " candidate pages");
    const catSet = new Set(paths);
    cats = [];
    let n = 0;
    await pool(paths, async (p) => {
      try {
        const c = await crawlCategory(p, catSet);
        if (c && c.products.length) cats.push(c);
        if (++n % 25 === 0) console.log("  crawled " + n + "/" + paths.length);
      } catch (e) {
        console.error("  category failed " + p + ": " + e.message);
      }
    }, CONCURRENCY);
    fs.writeFileSync(CAT_FILE, JSON.stringify(cats, null, 1));
    console.log("categories: kept " + cats.length + " with products");
  }

  // ---- product URL universe -------------------------------------------
  const urls = new Set();
  for (const c of cats) for (const p of c.products) urls.add(p);
  fs.writeFileSync(URLS_FILE, JSON.stringify([...urls].sort(), null, 1));
  console.log("products  : " + urls.size + " distinct URLs");
  if (CATS_ONLY) { console.log("CATS_ONLY set — stopping"); return; }

  // ---- product pages ---------------------------------------------------
  const done = readDone();
  const todo = [...urls].filter((u) => !done.has(u)).slice(0, LIMIT);
  console.log("already captured: " + done.size + ", to fetch: " + todo.length);

  const out = fs.createWriteStream(PDP_FILE, { flags: "a" });
  let ok = 0, miss = 0, skipped = 0, failed = 0;

  await pool(todo, async (slug, i) => {
    try {
      const rec = await capturePdp(slug);
      if (!rec) { miss++; return; }
      if (SKIP_SALE && rec.onSale) { skipped++; return; }
      out.write(JSON.stringify(rec) + "\n");
      ok++;
    } catch (e) {
      failed++;
      console.error("  pdp failed " + slug + ": " + e.message);
    }
    if ((i + 1) % 100 === 0) {
      console.log("  " + (i + 1) + "/" + todo.length + "  ok=" + ok + " notProduct=" + miss + " failed=" + failed);
    }
  }, CONCURRENCY);

  out.end();
  console.log("");
  console.log("captured  : " + ok);
  console.log("not a PDP : " + miss);
  if (SKIP_SALE) console.log("sale skipped: " + skipped);
  console.log("failed    : " + failed);
  console.log("file      : " + PDP_FILE);
}

main().catch((e) => { console.error(e); process.exit(1); });
