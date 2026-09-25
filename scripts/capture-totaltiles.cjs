/**
 * Capture totaltiles.co.uk product detail pages into a JSONL store, via a
 * real Chrome instance attached over CDP (the site sits behind Cloudflare's
 * Managed Challenge — headless/automated browsers get blocked outright, so
 * this drives the user's own already-authenticated Chrome window instead of
 * spawning a new one). Crawl-only: no Mongo writes here, see
 * import-totaltiles.cjs for that stage.
 *
 * Site shape:
 *  - Magento 2 (Smartwave Porto child theme). No rich Product JSON-LD; only
 *    a BreadcrumbList block, which IS useful (gives the real per-product
 *    category chain, more reliable than any static category file).
 *  - Price is shown in TWO units side by side: per-unit (tile/pack/each) and
 *    per-m². Both the current price and RRP have both units, cleanly
 *    labelled in dedicated blocks (.tt-our-price / .tt-msrp-price) - no
 *    "first unit on the page" guessing needed like Al Murad required.
 *  - Specs are a clean <table id="product-attribute-specs-table"> of
 *    <th>label</th><td>value</td> rows - no free-text label-matching regex
 *    needed (unlike Al Murad).
 *  - Marketing copy lives separately in
 *    .product.attribute.overview [itemprop=description].
 *  - Gallery thumbnails are `a.mt-thumb-switcher[href]` (MagicZoom plugin,
 *    not the standard Magento fotorama gallery).
 *  - A minority of products (accessory/kit lines - heating mat coverage,
 *    thermostat colour, etc.) have a `select[name^="super_attribute"]`
 *    dropdown with no static per-option price delta anywhere in the DOM;
 *    captured as informational `variantOptions`, not priced separately.
 *
 * Usage:
 *   node scripts/capture-totaltiles.cjs [--limit=N] [--retry-errors]
 *
 * Requires Chrome already running with --remote-debugging-port=9222 and
 * logged into a page that has passed the Cloudflare challenge.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DATA_DIR = path.join(__dirname, '..', '.scratch', 'totaltiles');
const CLASSIFIED_FILE = path.join(DATA_DIR, 'classified_dedup.json');
const OUT_FILE = path.join(DATA_DIR, 'tt-pdp.jsonl');
const CDP_URL = 'http://localhost:9222';

const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
const RETRY_ERRORS = process.argv.includes('--retry-errors');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadDone() {
  const done = new Map();
  if (fs.existsSync(OUT_FILE)) {
    for (const line of fs.readFileSync(OUT_FILE, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        done.set(o.url, o);
      } catch (e) {}
    }
  }
  if (RETRY_ERRORS) {
    for (const [url, o] of [...done]) {
      if (o.error) done.delete(url);
    }
  }
  return done;
}

async function scrapeOne(page, url) {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  const status = resp ? resp.status() : null;
  if (status !== 200) {
    return { url, status, error: `HTTP ${status}`, scrapedAt: new Date().toISOString() };
  }
  await page.waitForTimeout(500);

  const data = await page.evaluate(() => {
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return u; } };

    const h1 = document.querySelector('h1.page-title, h1');
    const title = txt(h1);

    // breadcrumb from JSON-LD (real per-product category chain)
    let breadcrumb = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(s.textContent);
        if (j['@type'] === 'BreadcrumbList' && Array.isArray(j.itemListElement)) {
          breadcrumb = j.itemListElement
            .sort((a, b) => a.position - b.position)
            .map(x => ({ name: x.item && x.item.name, id: x.item && x.item['@id'] }));
        }
      } catch (e) {}
    }

    const sku = txt(document.querySelector('.product-info-stock-sku [itemprop="sku"]')) ||
                txt(document.querySelector('[itemprop="sku"]'));

    // --- price: current (per-unit + per-m²) ---
    const ourBlock = document.querySelector('.tt-our-price');
    const priceAmountEl = ourBlock && ourBlock.querySelector('[data-price-amount]');
    const priceCurrent = priceAmountEl ? Number(priceAmountEl.getAttribute('data-price-amount')) : null;
    const priceCurrentUnitLabel = ourBlock && txt(ourBlock.querySelector('.tt_ppms_suffix'));
    const priceCurrentPerSqmEl = ourBlock && ourBlock.querySelector('.product-calculated-price .price');
    const priceCurrentPerSqm = priceCurrentPerSqmEl ? Number(txt(priceCurrentPerSqmEl).replace(/[^0-9.]/g, '')) || null : null;

    // fallback if no RRP block exists (no "Our Price"/"RRP" split rendered)
    const fallbackPriceEl = document.querySelector('#pricing-calculator [data-price-amount]') ||
                             document.querySelector('.product-info-price [data-price-amount]');
    const priceCurrentFinal = priceCurrent != null ? priceCurrent :
      (fallbackPriceEl ? Number(fallbackPriceEl.getAttribute('data-price-amount')) : null);

    // --- price: RRP (per-unit + per-m²), optional ---
    const rrpBlock = document.querySelector('.tt-msrp-price');
    let priceRRP = null, priceRRPPerSqm = null;
    if (rrpBlock) {
      const rrpUnitEl = rrpBlock.querySelector('.price-box:not(.price-final_price) .price, .price-box > .price');
      const rrpUnitText = txt(rrpBlock.querySelector('.tt-left').nextElementSibling);
      priceRRP = rrpUnitText ? Number(rrpUnitText.replace(/[^0-9.]/g, '')) || null : null;
      const rrpSqmEl = rrpBlock.querySelector('.product-calculated-price .price');
      priceRRPPerSqm = rrpSqmEl ? Number(txt(rrpSqmEl).replace(/[^0-9.]/g, '')) || null : null;
    }

    const savePercentText = txt(document.querySelector('.tt-save-price .red'));
    const savePercent = savePercentText ? Number(savePercentText.replace(/[^0-9.]/g, '')) || null : null;

    // --- stock ---
    const availabilityMeta = document.querySelector('meta[property="product:availability"]');
    const stockStatus = availabilityMeta ? availabilityMeta.getAttribute('content') : null;

    // --- gallery ---
    const images = [...document.querySelectorAll('a.mt-thumb-switcher[href]')]
      .map(a => abs(a.getAttribute('href')));
    const uniqueImages = [...new Set(images)];
    // fallback to the single hero image if the thumbnail strip is empty (single-image products)
    if (uniqueImages.length === 0) {
      const hero = document.querySelector('.product.media img[itemprop="image"]');
      if (hero) uniqueImages.push(abs(hero.getAttribute('src')));
    }

    // --- description (marketing overview) ---
    const overviewEl = document.querySelector('.product.attribute.overview [itemprop="description"]');
    const overviewText = overviewEl ? overviewEl.innerText.replace(/\n{2,}/g, '\n').trim() : null;

    // --- specs table (clean, structured) ---
    const specs = {};
    const specRows = [];
    document.querySelectorAll('#product-attribute-specs-table tr').forEach(tr => {
      const label = txt(tr.querySelector('th'));
      const value = txt(tr.querySelector('td'));
      if (label && value) {
        specs[label] = value;
        specRows.push(`${label}: ${value}`);
      }
    });
    const rawSpecsText = txt(document.querySelector('#product-attribute-specs-table'));

    // --- variant options (informational, no static per-option price found on this site) ---
    const variantOptions = [];
    document.querySelectorAll('.field.configurable, .swatch-attribute').forEach(field => {
      const label = txt(field.querySelector('label span, .swatch-attribute-label'));
      const select = field.querySelector('select');
      let options = [];
      if (select) {
        options = [...select.options]
          .filter(o => o.value)
          .map(o => ({ value: o.value, text: o.textContent.trim() }));
      } else {
        options = [...field.querySelectorAll('.swatch-option')]
          .map(o => ({ value: o.getAttribute('data-option-id'), text: o.getAttribute('aria-label') || o.getAttribute('option-label') }));
      }
      if (label && options.length) variantOptions.push({ label, options });
    });

    return {
      title,
      breadcrumb,
      sku,
      priceCurrent: priceCurrentFinal,
      priceCurrentPerSqm,
      priceCurrentUnitLabel,
      priceRRP,
      priceRRPPerSqm,
      savePercent,
      stockStatus,
      images: uniqueImages,
      description: overviewText,
      specs,
      rawSpecsText,
      variantOptions,
    };
  });

  return { url, status, ...data, scrapedAt: new Date().toISOString() };
}

async function main() {
  if (!fs.existsSync(CLASSIFIED_FILE)) {
    console.error('missing', CLASSIFIED_FILE, '- run the discovery crawl first');
    process.exit(1);
  }
  const classified = JSON.parse(fs.readFileSync(CLASSIFIED_FILE, 'utf8'));
  const productUrls = classified.filter(o => o.type === 'product').map(o => o.url);
  console.log('total known products:', productUrls.length);

  const done = loadDone();
  let todo = productUrls.filter(u => !done.has(u));
  if (LIMIT < todo.length) todo = todo.slice(0, LIMIT);
  console.log('already captured:', done.size, '| todo this run:', todo.length);

  if (todo.length === 0) {
    console.log('nothing to do');
    return;
  }

  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  let page = await ctx.newPage();
  const out = fs.createWriteStream(OUT_FILE, { flags: 'a' });

  let count = 0;
  for (const url of todo) {
    count++;
    await sleep(1200 + Math.random() * 1800);
    let attempt = 0;
    let rec = null;
    while (attempt < 3) {
      attempt++;
      try {
        if (page.isClosed()) page = await ctx.newPage();
        rec = await scrapeOne(page, url);
        if (rec.status !== 200 && attempt < 3) {
          console.log('non-200', rec.status, url, 'retrying after backoff');
          await sleep(9000 + Math.random() * 7000);
          continue;
        }
        break;
      } catch (e) {
        rec = { url, error: e.message, scrapedAt: new Date().toISOString() };
        if (attempt < 3) {
          try { page = await ctx.newPage(); } catch (e2) {}
          await sleep(3000);
        }
      }
    }
    out.write(JSON.stringify(rec) + '\n');
    if (count % 25 === 0 || count === todo.length) {
      console.log(count, '/', todo.length, '| last:', url, '| status:', rec.status || rec.error);
    }
  }
  out.end();
  console.log('DONE');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
