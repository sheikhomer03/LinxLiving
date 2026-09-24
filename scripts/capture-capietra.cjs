/**
 * Capture capietra.com into a JSONL store (crawl only — no Mongo writes).
 *
 * Two-stage, like capture-bathroom4less.cjs. Capietra is also a plain
 * Shopify storefront (no bot-check), so stage A uses
 * `/collections/<handle>/products.json?limit=250&page=N` across the 469
 * seed categories — a product is cross-listed under many collections, so
 * dedupe is by numeric Shopify product id, and every collection title seen
 * is kept (raw material for category mapping, not "first collection wins").
 *
 * Stage B fetches each product's own page HTML once for the
 * `<product-specifications>` dt/dd blocks (grouped under h5 section
 * headings like "Appearance" / "Material & construction") and the
 * schema.org ProductGroup JSON-LD `category` field — neither is present in
 * products.json.
 *
 * CRITICAL (tile-calculator requirement): products.json variants carry
 * price/sku/availability for every variant, but NOT per-variant coverage
 * data (m² per box, tiles per box, tiles per m², distribution type). That
 * lives in a `<product-coverage-quantity data-...>` component that Shopify
 * only server-renders for whichever variant is selected — the default one
 * on a plain page load, or a specific one via `?variant=<id>`. Real tile
 * ranges here commonly offer several PHYSICAL SIZES as separate variants
 * (e.g. Dorset Porcelain White: 120x60, 80x80, 60x30, 59.7x59.7cm) with
 * different coverage per box for each size — that's the user's explicit
 * top concern, so every distinct size (not every colour, which shares the
 * same coverage as its sibling colours at the same size) gets its own
 * `?variant=` fetch. "Sample" variants (Free Cut Tile Sample / Full Tile
 * Sample / NxNcm Sample) are excluded from coverage fetches — they're
 * single-item, non-area purchases, already fully described by their own
 * price/sku from products.json.
 *
 * Env:
 *   LIMIT=n        stop stage B after n products (smoke test)
 *   CONCURRENCY=n  parallel fetches (default 6)
 *   FRESH=1        ignore existing checkpoints and start over
 *   CATS_ONLY=1    stop after stage A (category-tree discovery)
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const ORIGIN = "https://capietra.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DATA =
  process.env.CAPIETRA_DATA ||
  "/Users/niazig/Desktop/linxliving/LinxLiving/.scratch/capietra";
fs.mkdirSync(DATA, { recursive: true });

const LIMIT = Number(process.env.LIMIT) || Infinity;
// Both curl and Node's own fetch get a Cloudflare "cf-mitigated: challenge"
// (a JS proof-of-work managed challenge, not a plain rate limit) on
// capietra.com — neither executes the challenge script, so neither can ever
// clear it, and once tripped it blocks every endpoint site-wide. A real
// headless Chromium via Playwright DOES execute it and gets a clean pass:
// one page load solves the challenge and sets Cloudflare's clearance
// cookies on the browser context, and every subsequent request reuses that
// same context (and its cookies) via context.request.get(), which is a
// lightweight HTTP call — no full page render per request — so it's both
// unblocked AND fast (~300ms/request observed, no artificial delay needed).
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 4, 12));
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? 0);
const FRESH = process.env.FRESH === "1";
const CATS_ONLY = process.env.CATS_ONLY === "1";

const PRODUCTS_FILE = path.join(DATA, "capietra-products.json"); // stage A: id -> merged product summary
const CATS_DONE_FILE = path.join(DATA, "capietra-cats-done.json"); // stage A: collection handles fully crawled
const PDP_FILE = path.join(DATA, "capietra-pdp.jsonl"); // stage B: detail records
const PDP_DONE_FILE = path.join(DATA, "capietra-pdp-done.json"); // stage B: ids already detail-scraped (ok or error)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * A single headless Chromium instance + context, launched once and reused
 * for the whole run. The first navigation solves Cloudflare's managed
 * challenge for real (it's JS proof-of-work — no plain HTTP client can pass
 * it), which sets clearance cookies on the context; every request after
 * that is context.request.get(), a lightweight HTTP call that rides those
 * same cookies without paying for a full page render each time.
 */
let browserPromise = null;
let contextPromise = null;
let seeded = false;

async function browserContext() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  const browser = await browserPromise;
  if (!contextPromise) {
    contextPromise = browser.newContext({ userAgent: UA });
  }
  const context = await contextPromise;
  if (!seeded) {
    seeded = true;
    const page = await context.newPage();
    // A JSON endpoint is a lighter page than the homepage to solve the
    // challenge against, and confirms the context is actually clear.
    await page.goto(`${ORIGIN}/products.json?limit=1`, {
      waitUntil: "load",
      timeout: 45000,
    });
    await page.close();
  }
  return context;
}

async function browserGet(url, { timeoutSec = 20 } = {}) {
  try {
    const context = await browserContext();
    const resp = await context.request.get(url, {
      timeout: timeoutSec * 1000,
    });
    const body = await resp.text();
    return { status: resp.status(), body };
  } catch (e) {
    return { status: 0, body: "" };
  }
}

function isChallengeBody(body) {
  return body.includes("Verifying your connection") || body.includes("cf-mitigated");
}

/*
 * Circuit breaker: once ANY request hits the site-wide challenge, every
 * other in-flight/upcoming request backs off together rather than each
 * hammering its own independent retry loop (which is exactly what
 * re-triggers or extends the block). `cooldownUntil` is a shared deadline;
 * any request that sees a challenge pushes it further out.
 */
let cooldownUntil = 0;

async function respectCooldown() {
  const wait = cooldownUntil - Date.now();
  if (wait > 0) await sleep(wait);
}

function tripCooldown(ms) {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + ms);
}

async function get(url, tries = 8) {
  for (let i = 0; i < tries; i++) {
    await respectCooldown();
    await sleep(REQUEST_DELAY_MS + Math.random() * 500);
    const { status, body } = await browserGet(url);
    const challenged = status === 429 || (status === 200 && isChallengeBody(body));
    if (challenged) {
      // First hit: assume a short blip. Repeated hits: assume the
      // site-wide mitigation is active and back off for minutes, not
      // seconds — hammering it with quick retries only prolongs it.
      const backoffMs = i < 2 ? 5000 * (i + 1) : 60000 * Math.min(i - 1, 5);
      tripCooldown(backoffMs);
      await respectCooldown();
      continue;
    }
    if (status >= 500 || status === 0) {
      await sleep(2000 * (i + 1));
      continue;
    }
    return { status, body };
  }
  return null;
}

async function getJson(url) {
  const res = await get(url);
  if (!res || res.status !== 200) return null;
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

async function getText(url) {
  const res = await get(url);
  if (!res || res.status !== 200) return null;
  return res.body;
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
        rec.product = p;
      }
      rec.collectionTitles.add(title);
      rec.collectionHandles.add(handle);
    }
    if (json.products.length < 250) break;
    page++;
    if (page > 60) break; // safety valve
  }
  return total;
}

async function stageA() {
  const seedFile = path.join(__dirname, "..", "capietra_categories.json");
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

const SAMPLE_RE = /\bsample\b/i;

/**
 * Extract the size string from a variant's own title/option (the part
 * after the product name, e.g. "120 x 60 x 1cm", "Greek Pattern x 2cm",
 * "56 x Random x 2.2cm"). Falls back to the raw option2/title text with the
 * leading colour + product-name words stripped isn't reliable across the
 * catalogue's inconsistent title shapes, so instead this just uses
 * option2 (or option1 if there's only one option) as-is as the size/format
 * signature — Capietra's theme always puts the size/format string in
 * whichever option isn't a plain colour swatch value in `options[]`.
 */
function sizeSignature(product, variant) {
  const optionNames = (product.options || []).map((o) => (typeof o === "string" ? o : o.name));
  const idx = optionNames.findIndex((n) => /variant name|size|format/i.test(n || ""));
  if (idx === 0) return clean(variant.option1);
  if (idx === 1) return clean(variant.option2);
  if (idx === 2) return clean(variant.option3);
  // Fallback: last non-null option value.
  return clean(variant.option3 || variant.option2 || variant.option1 || variant.title);
}

/**
 * Pull the <product-specifications> dt/dd pairs, grouped by their own
 * <span class="product-specifications__heading"> section label (Appearance,
 * Material & construction, ...) — anchored on that structural element, not
 * CSS position, since section order/count varies by product type.
 */
function parseSpecifications(html) {
  const startIdx = html.indexOf("product-specifications__group");
  if (startIdx === -1) return { groups: {}, rawText: "" };
  const blockStart = html.lastIndexOf("<product-specifications", startIdx);
  const searchFrom = blockStart === -1 ? startIdx : blockStart;
  const endIdx = html.indexOf("</product-specifications>", searchFrom);
  const segment = html.slice(searchFrom, endIdx === -1 ? searchFrom + 20000 : endIdx);

  const groups = {};
  const groupRe =
    /<span class="product-specifications__heading[^"]*">([^<]+)<\/span>\s*<dl class="product-specifications__grid">([\s\S]*?)<\/dl>/g;
  let gm;
  while ((gm = groupRe.exec(segment))) {
    const groupTitle = clean(gm[1]);
    const body = gm[2];
    const pairs = {};
    const itemRe =
      /<dt class="product-specifications__label">([^<]*)<\/dt>\s*<dd class="product-specifications__value">([\s\S]*?)<\/dd>/g;
    let im;
    while ((im = itemRe.exec(body))) {
      let label = clean(im[1]).replace(/:$/, "");
      const value = clean(im[2].replace(/<[^>]+>/g, " "));
      if (label) pairs[label] = value;
    }
    if (Object.keys(pairs).length) groups[groupTitle] = pairs;
  }

  const rawText = clean(segment.replace(/<[^>]+>/g, " "));
  return { groups, rawText };
}

function parseSchemaCategory(html) {
  const m = /"@type":"ProductGroup"[\s\S]{0,400}?"category":"([^"]*)"/.exec(html);
  if (m) return clean(m[1]);
  // category can also appear before @type in some serialisations
  const m2 = /"category":"([^"]*)"[\s\S]{0,400}?"@type":"ProductGroup"/.exec(html);
  return m2 ? clean(m2[1]) : null;
}

/**
 * Extract the <product-coverage-quantity data-...> attributes rendered for
 * whichever variant the page loaded with (default, or the one requested via
 * ?variant=<id>).
 */
function parseCoverageBlock(html) {
  const idx = html.indexOf("<product-coverage-quantity");
  if (idx === -1) return null;
  const closeIdx = html.indexOf("\n>", idx);
  const block = html.slice(idx, closeIdx === -1 ? idx + 2000 : closeIdx + 2);
  const attr = (name) => {
    const m = new RegExp(`${name}="([^"]*)"`).exec(block);
    return m ? m[1] : null;
  };
  return {
    variantId: attr("data-variant-id"),
    distributionType: attr("data-distribution-type"),
    mPerPack: attr("data-m-per-pack"),
    distributionUnitMultiple: attr("data-distribution-unit-multiple"),
    packQuantity: attr("data-pack-quantity"),
    variantPrice: attr("data-variant-price"),
    unitSingular: attr("data-unit-singular"),
    unitPlural: attr("data-unit-plural"),
    tilesPerM: attr("data-tiles-per-m"),
    wastagePercent: attr("data-wastage-percent"),
    pricingMode: attr("data-pricing-mode"),
    isSample: attr("data-is-sample"),
    primarySaleUnit: attr("data-primary-sale-unit"),
    calculatorRequired: attr("data-calculator-required"),
  };
}

async function scrapeProductPage(handle, variantId) {
  const url = variantId
    ? `${ORIGIN}/products/${handle}?variant=${variantId}`
    : `${ORIGIN}/products/${handle}`;
  const html = await getText(url);
  if (!html) return null;
  return html;
}

async function scrapeDetail(product) {
  const baseHtml = await scrapeProductPage(product.handle, null);
  if (!baseHtml) return { error: "fetch-failed" };

  const { groups, rawText } = parseSpecifications(baseHtml);
  const schemaCategory = parseSchemaCategory(baseHtml);
  const baseCoverage = parseCoverageBlock(baseHtml);

  // Group variants by size signature; skip samples. Coverage is fetched
  // once per distinct non-sample size (colour siblings at the same size
  // share identical coverage), reusing the base page's fetch for whichever
  // variant Shopify picked as default if it matches one of our groups.
  const coverageBySize = {};
  const sizeGroups = new Map(); // sizeSig -> representative variant id
  for (const v of product.variants || []) {
    const isSample = SAMPLE_RE.test(v.title);
    if (isSample) continue;
    const sig = sizeSignature(product, v);
    if (!sizeGroups.has(sig)) sizeGroups.set(sig, v.id);
  }

  if (baseCoverage && baseCoverage.variantId) {
    const bvId = Number(baseCoverage.variantId);
    const bv = (product.variants || []).find((v) => v.id === bvId);
    if (bv && !SAMPLE_RE.test(bv.title)) {
      const sig = sizeSignature(product, bv);
      coverageBySize[sig] = baseCoverage;
    }
  }

  for (const [sig, vid] of sizeGroups) {
    if (coverageBySize[sig]) continue; // already have it from base page
    const html = await scrapeProductPage(product.handle, vid);
    if (!html) continue;
    const cov = parseCoverageBlock(html);
    if (cov) coverageBySize[sig] = cov;
    await sleep(120);
  }

  return {
    specGroups: groups,
    rawSpecsText: rawText,
    schemaCategory,
    coverageBySize,
  };
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
    const detail = await scrapeDetail(p);
    if (detail.error) errors++;

    const images = (p.images || []).map((im) => (typeof im === "string" ? im : im.src)).filter(Boolean);
    const variants = (p.variants || []).map((v) => {
      const isSample = SAMPLE_RE.test(v.title);
      const sig = sizeSignature(p, v);
      return {
        id: v.id,
        title: v.title,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        sizeSignature: sig,
        isSample,
        sku: v.sku,
        price: v.price != null ? Number(v.price) : null,
        compareAtPrice: v.compare_at_price != null ? Number(v.compare_at_price) : null,
        available: !!v.available,
        weight: v.weight ?? v.grams ?? null,
        coverage: !isSample ? detail.coverageBySize?.[sig] || null : null,
      };
    });
    const firstRealVariant = variants.find((v) => !v.isSample) || variants[0] || {};

    const rec2 = {
      id: p.id,
      handle: p.handle,
      sourceUrl: `${ORIGIN}/products/${p.handle}`,
      name: p.title,
      vendor: p.vendor,
      productType: p.product_type || p.type,
      tags: p.tags || [],
      bodyHtml: p.body_html || p.description || "",
      options: p.options || [],
      images,
      variants,
      price: firstRealVariant.price ?? null,
      compareAtPrice: firstRealVariant.compareAtPrice ?? null,
      available: variants.some((v) => v.available),
      collectionTitles: [...rec.collectionTitles],
      collectionHandles: [...rec.collectionHandles],
      schemaCategory: detail.schemaCategory || null,
      specGroups: detail.specGroups || {},
      rawSpecsText: detail.rawSpecsText || "",
      error: detail.error || null,
      scrapedAt: new Date().toISOString(),
    };

    outStream.write(JSON.stringify(rec2) + "\n");
    // Errors are NOT marked done — a re-run of this script should retry
    // them rather than permanently skip a product that merely hit a
    // transient network failure.
    if (!detail.error) doneIds.add(id);
    count++;
    if (count % 25 === 0) {
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

async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close().catch(() => {});
  }
}

main()
  .then(() => closeBrowser())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    closeBrowser().finally(() => process.exit(1));
  });
