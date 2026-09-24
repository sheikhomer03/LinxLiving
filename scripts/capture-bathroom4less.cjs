/**
 * Capture bathroom4less.co.uk into a JSONL store (crawl only — no Mongo writes).
 *
 * Two-stage, like capture-al-murad.cjs, so import-bathroom4less.cjs can be
 * re-run against the capture without re-crawling the shop.
 *
 * This site is a plain Shopify storefront (no bot-check interstitial like
 * Al Murad), which makes stage A much simpler: every collection exposes
 * `/collections/<handle>/products.json?limit=250&page=N`, a JSON array with
 * full variant/price/image data — no HTML parsing needed for that part.
 * A product is cross-listed under many collections (by room, style, price
 * band), so the product URL set is built as a dedup-by-numeric-id map, and
 * every collection (from the 550-entry seed file) the product was seen
 * under is recorded in `collectionTitles` — that set is the raw material
 * for category mapping later, not a single "first collection wins" pick.
 *
 * Stage B fetches each product's own page HTML once, purely for the
 * "Specifications" card, which products.json does not carry: a set of
 * `<div class="DescriptionList">` blocks, each with its own `<h3>` group
 * label (Dimensions / Features / Components / ...) and `dt`/`dd` pairs
 * inside. That block is anchored on the "Specifications" card's own title
 * text, not on CSS class alone or its position on the page (a sibling card,
 * "Delivery Information", shares the same `card__collapsible` wrapper
 * class and appears right after it).
 *
 * Env:
 *   LIMIT=n        stop stage B after n products (smoke test)
 *   CONCURRENCY=n  parallel fetches (default 4)
 *   FRESH=1        ignore existing checkpoints and start over
 *   CATS_ONLY=1    stop after stage A (category-tree discovery)
 */
const path = require("path");
const fs = require("fs");

const ORIGIN = "https://www.bathroom4less.co.uk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DATA =
  process.env.B4L_DATA ||
  "/Users/niazig/Desktop/linxliving/LinxLiving/.scratch/bathroom4less";
fs.mkdirSync(DATA, { recursive: true });

const LIMIT = Number(process.env.LIMIT) || Infinity;
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 4, 8));
const FRESH = process.env.FRESH === "1";
const CATS_ONLY = process.env.CATS_ONLY === "1";

const PRODUCTS_FILE = path.join(DATA, "b4l-products.json"); // stage A: id -> merged product summary
const CATS_DONE_FILE = path.join(DATA, "b4l-cats-done.json"); // stage A: collection handles fully crawled
const PDP_FILE = path.join(DATA, "b4l-pdp.jsonl"); // stage B: detail records
const PDP_DONE_FILE = path.join(DATA, "b4l-pdp-done.json"); // stage B: ids already detail-scraped (ok or error)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(800 * (i + 1));
        continue;
      }
      return res;
    } catch {
      await sleep(800 * (i + 1));
    }
  }
  return null;
}

async function getJson(url) {
  const res = await get(url);
  if (!res || !res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function getText(url) {
  const res = await get(url);
  if (!res || !res.ok) return null;
  return res.text();
}

/* ------------------------------------------------------------------ *
 * simple concurrency pool
 * ------------------------------------------------------------------ */
async function pool(items, limit, worker) {
  let i = 0;
  let active = 0;
  return new Promise((resolve) => {
    let doneCount = 0;
    if (items.length === 0) return resolve();
    const next = () => {
      if (i >= items.length && active === 0) return resolve();
      while (active < limit && i < items.length) {
        const item = items[i++];
        active++;
        Promise.resolve(worker(item))
          .catch((e) => console.error("worker error:", e && e.message))
          .finally(() => {
            active--;
            doneCount++;
            if (doneCount % 50 === 0) console.log(`  progress ${doneCount}/${items.length}`);
            next();
          });
      }
    };
    next();
  });
}

/* ------------------------------------------------------------------ *
 * stage A: category-tree discovery crawl
 * ------------------------------------------------------------------ */

function loadJson(file, fallback) {
  if (!FRESH && fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function saveJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj));
}

function collectionHandleFromLink(link) {
  const m = /\/collections\/([^/?#]+)/.exec(link);
  return m ? m[1] : null;
}

async function crawlCategory(handle, title, productsById) {
  let page = 1;
  let total = 0;
  for (;;) {
    const url = `${ORIGIN}/collections/${handle}/products.json?limit=250&page=${page}`;
    const json = await getJson(url);
    if (!json || !Array.isArray(json.products)) break;
    if (json.products.length === 0) break;
    for (const p of json.products) {
      total++;
      let rec = productsById.get(p.id);
      if (!rec) {
        rec = { product: p, collectionTitles: new Set(), collectionHandles: new Set() };
        productsById.set(p.id, rec);
      } else {
        // Keep the most recently seen product payload (price/stock can move
        // between crawls of different collections) — cheap and harmless
        // since collections are crawled within one run.
        rec.product = p;
      }
      rec.collectionTitles.add(title);
      rec.collectionHandles.add(handle);
    }
    if (json.products.length < 250) break;
    page++;
    if (page > 60) break; // safety valve — no real collection is this deep
  }
  return total;
}

async function stageA() {
  const seedFile = path.join(__dirname, "..", "bathroom4less_categories.json");
  const seeds = JSON.parse(fs.readFileSync(seedFile, "utf8"));

  const productsRaw = loadJson(PRODUCTS_FILE, null);
  const productsById = new Map();
  if (productsRaw) {
    for (const [id, rec] of Object.entries(productsRaw)) {
      productsById.set(Number(id), {
        product: rec.product,
        collectionTitles: new Set(rec.collectionTitles),
        collectionHandles: new Set(rec.collectionHandles),
      });
    }
    console.log(`resuming stage A with ${productsById.size} products already captured`);
  }

  const catsDone = new Set(loadJson(CATS_DONE_FILE, []));
  console.log(`${catsDone.size}/${seeds.length} categories already crawled`);

  const todo = seeds.filter((s) => {
    const handle = collectionHandleFromLink(s.link);
    return handle && !catsDone.has(handle);
  });

  let processed = 0;
  for (const seed of todo) {
    const handle = collectionHandleFromLink(seed.link);
    if (!handle) continue;
    const n = await crawlCategory(handle, seed.title, productsById);
    catsDone.add(handle);
    processed++;
    if (processed % 20 === 0 || processed === todo.length) {
      console.log(
        `  [${processed}/${todo.length}] ${seed.title} (${handle}): ${n} products — total unique so far: ${productsById.size}`,
      );
      // checkpoint
      const out = {};
      for (const [id, rec] of productsById) {
        out[id] = {
          product: rec.product,
          collectionTitles: [...rec.collectionTitles],
          collectionHandles: [...rec.collectionHandles],
        };
      }
      saveJson(PRODUCTS_FILE, out);
      saveJson(CATS_DONE_FILE, [...catsDone]);
    }
  }

  // final checkpoint
  const out = {};
  for (const [id, rec] of productsById) {
    out[id] = {
      product: rec.product,
      collectionTitles: [...rec.collectionTitles],
      collectionHandles: [...rec.collectionHandles],
    };
  }
  saveJson(PRODUCTS_FILE, out);
  saveJson(CATS_DONE_FILE, [...catsDone]);

  console.log(`\nstage A done: ${catsDone.size}/${seeds.length} categories crawled, ${productsById.size} unique products`);
  return productsById;
}

/* ------------------------------------------------------------------ *
 * stage B: detail scrape
 * ------------------------------------------------------------------ */

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * Pull the "Specifications" card's own content, anchored on the card
 * title text `>Specifications<` (not CSS class — "Delivery Information"
 * and "Store Information" use the identical `card`/`card__collapsible`
 * wrapper right next to it, and card order is not guaranteed stable).
 * Returns { groups: {groupTitle: {label: value}}, rawText }.
 */
function parseSpecifications(html) {
  const titleIdx = html.indexOf(">Specifications<");
  if (titleIdx === -1) return { groups: {}, rawText: "" };
  // The collapsible content starts at the next `card__collapsible-content`
  // after the title, and ends at the next `product-block-list__item`
  // sibling (the next card).
  const contentIdx = html.indexOf('card__collapsible-content', titleIdx);
  if (contentIdx === -1) return { groups: {}, rawText: "" };
  const nextItemIdx = html.indexOf("product-block-list__item", contentIdx);
  const endIdx = nextItemIdx === -1 ? Math.min(html.length, contentIdx + 20000) : nextItemIdx;
  const segment = html.slice(contentIdx, endIdx);

  const groups = {};
  // Each <div class="Specifications-descriptionList"> ... <h3>Group</h3> ... dt/dd pairs
  const blockRe = /<div class="Specifications-descriptionList">([\s\S]*?)<\/div>\s*<\/div>(?=<div class="Specifications-descriptionList">|<\/div>\s*<\/div>\s*<\/div>|$)/g;
  // Simpler & more robust: split on h3 groups directly.
  const h3Re = /<h3>([^<]+)<\/h3>([\s\S]*?)(?=<h3>|$)/g;
  let m;
  while ((m = h3Re.exec(segment))) {
    const groupTitle = clean(m[1]);
    const body = m[2];
    const pairs = {};
    const dtddRe = /<dt[^>]*>[\s\S]*?class="DescriptionList-item">([^<]*)<[\s\S]*?<dd[^>]*>[\s\S]*?class="DescriptionList-item">([^<]*)</g;
    let p;
    while ((p = dtddRe.exec(body))) {
      const label = clean(p[1]);
      const value = clean(p[2]);
      if (label) pairs[label] = value;
    }
    if (Object.keys(pairs).length) groups[groupTitle] = pairs;
  }

  const rawText = clean(segment.replace(/<[^>]+>/g, " "));
  return { groups, rawText };
}

async function scrapeDetail(handle) {
  const url = `${ORIGIN}/products/${handle}`;
  const html = await getText(url);
  if (!html) return { error: "fetch-failed", url };
  const { groups, rawText } = parseSpecifications(html);
  const vatNote = /priced Inc\.?\s*VAT/i.test(html);
  return { url, specGroups: groups, rawSpecsText: rawText, vatIncluded: vatNote };
}

async function stageB(productsById) {
  const doneIds = new Set(loadJson(PDP_DONE_FILE, []));
  const all = [...productsById.entries()];
  const todo = all.filter(([id]) => !doneIds.has(id)).slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`stage B: ${doneIds.size} already scraped, ${todo.length} to go (of ${all.length} total)`);

  const outStream = fs.createWriteStream(PDP_FILE, { flags: "a" });
  let count = 0;
  let errors = 0;

  await pool(todo, CONCURRENCY, async ([id, rec]) => {
    const p = rec.product;
    const detail = await scrapeDetail(p.handle);
    if (detail.error) errors++;

    const images = (p.images || []).map((im) => im.src).filter(Boolean);
    const variants = (p.variants || []).map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      price: v.price != null ? Number(v.price) : null,
      compareAtPrice: v.compare_at_price != null ? Number(v.compare_at_price) : null,
      available: !!v.available,
    }));
    const firstVariant = variants[0] || {};

    const rec2 = {
      id: p.id,
      handle: p.handle,
      sourceUrl: `${ORIGIN}/products/${p.handle}`,
      name: p.title,
      vendor: p.vendor,
      productType: p.product_type,
      tags: p.tags || [],
      bodyHtml: p.body_html || "",
      options: p.options || [],
      images,
      variants,
      price: firstVariant.price ?? null,
      compareAtPrice: firstVariant.compareAtPrice ?? null,
      available: variants.some((v) => v.available),
      collectionTitles: [...rec.collectionTitles],
      collectionHandles: [...rec.collectionHandles],
      specGroups: detail.specGroups || {},
      rawSpecsText: detail.rawSpecsText || "",
      vatIncluded: !!detail.vatIncluded,
      error: detail.error || null,
      scrapedAt: new Date().toISOString(),
    };

    outStream.write(JSON.stringify(rec2) + "\n");
    doneIds.add(id);
    count++;
    if (count % 100 === 0) {
      console.log(`  stage B progress: ${count}/${todo.length} (errors so far: ${errors})`);
      saveJson(PDP_DONE_FILE, [...doneIds]);
    }
  });

  saveJson(PDP_DONE_FILE, [...doneIds]);
  outStream.end();
  console.log(`\nstage B done: ${count} scraped this run, ${errors} errors, ${doneIds.size} total done`);
}

async function main() {
  console.log("=== stage A: category-tree discovery ===");
  const productsById = await stageA();
  if (CATS_ONLY) return;

  console.log("\n=== stage B: detail scrape ===");
  await stageB(productsById);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
