/**
 * capture-bathdisc.cjs
 * Scrapes ALL products from bathdisc.co.uk into a JSONL file.
 *
 * NO database writes. NO Shopify writes. SCRAPE ONLY.
 * Output: .scratch/bathdisc/bathdisc-pdp.jsonl
 *
 * Strategy:
 *   1. Pull all product URLs from the 10 sitemap_products_N.xml files.
 *   2. Scrape each product page, extracting:
 *      - JSON-LD Product schema (name, description, brand, images)
 *      - All offers/variants (colour, finish, SKU, price, compareAtPrice, URL)
 *      - Full spec table from HTML
 *      - All gallery images
 *      - Calculator / dimensions
 *      - Collections/breadcrumbs
 *   3. Checkpoint progress to disk — resumable if interrupted.
 *
 * ~9,228 products. Runs with 5-concurrent batches + 300ms delay per batch.
 */

'use strict';
const fs   = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const SCRATCH    = path.join(__dirname, '../.scratch/bathdisc');
const OUT_JSONL  = path.join(SCRATCH, 'bathdisc-pdp.jsonl');
const DONE_FILE  = path.join(SCRATCH, 'bathdisc-done-urls.txt');   // checkpoint
const FAILED_LOG = path.join(SCRATCH, 'bathdisc-failed.txt');

const SITEMAP_INDEX = 'https://www.bathdisc.co.uk/sitemap.xml';
const BATCH_SIZE    = 5;
const BATCH_DELAY   = 350; // ms between batches

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── fetch helpers ────────────────────────────────────────────────────────────

async function fetchText(url, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      await sleep(100 + Math.random() * 200);
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status === 503) {
        console.log(`\n  [rate-limit] ${url} — waiting 8s`);
        await sleep(8000);
        continue;
      }
      if (!res.ok) return null;
      const text = await res.text();
      if (text.includes('Just a moment') || text.includes('cf-browser-verification')) {
        console.log(`\n  [cf-challenge] ${url} — waiting 12s`);
        await sleep(12000);
        continue;
      }
      return text;
    } catch (e) {
      if (i < retries - 1) await sleep(2000);
    }
  }
  return null;
}

// ─── Step 1: collect all product URLs from sitemaps ──────────────────────────

async function collectUrls() {
  console.log('=== Phase 1: Collecting product URLs from sitemaps ===');
  const indexXml = await fetchText(SITEMAP_INDEX);
  if (!indexXml) throw new Error('Could not fetch sitemap index');

  // Extract all sitemap_products_N.xml URLs
  const sitemapUrls = [];
  for (const m of indexXml.matchAll(/<loc>(https:\/\/www\.bathdisc\.co\.uk\/sitemap_products_[^<]+)<\/loc>/g)) {
    sitemapUrls.push(m[1].replace(/&amp;/g, '&'));
  }

  console.log(`  Found ${sitemapUrls.length} product sitemaps`);

  const allUrls = new Set();
  for (const smUrl of sitemapUrls) {
    const xml = await fetchText(smUrl);
    if (!xml) { console.log(`  WARN: could not fetch ${smUrl}`); continue; }
    for (const m of xml.matchAll(/<loc>(https:\/\/www\.bathdisc\.co\.uk\/products\/[^<]+)<\/loc>/g)) {
      allUrls.add(m[1].replace(/&amp;/g, '&'));
    }
    process.stdout.write(`\r  Collected ${allUrls.size} product URLs...`);
    await sleep(200);
  }

  console.log(`\n  Total unique product URLs: ${allUrls.size}`);
  return Array.from(allUrls);
}

// ─── Step 2: parse a single product page ─────────────────────────────────────

function parseProduct(html, url) {
  const $ = cheerio.load(html);

  // ── JSON-LD ──────────────────────────────────────────────────────────────
  let productLd  = null;
  let breadcrumbLd = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '');
      if (parsed['@type'] === 'Product')       productLd = parsed;
      if (parsed['@type'] === 'BreadcrumbList') breadcrumbLd = parsed;
    } catch {}
  });

  if (!productLd?.name) return null;

  // ── Variants from JS (`variants: [{ "ColourName": variantId }]`) ─────────
  let variantMap = {}; // { variantId: colourName }
  const variantMatch = html.match(/variants\s*:\s*(\[.*?\])/s);
  if (variantMatch) {
    try {
      const arr = JSON.parse(variantMatch[1]);
      for (const item of arr) {
        for (const [name, id] of Object.entries(item)) {
          variantMap[String(id)] = name;
        }
      }
    } catch {}
  }

  // ── Offers (price per variant) ────────────────────────────────────────────
  const rawOffers = Array.isArray(productLd.offers)
    ? productLd.offers
    : productLd.offers ? [productLd.offers] : [];

  const variants = rawOffers.map(offer => {
    const variantIdMatch = String(offer.url || '').match(/variant=(\d+)/);
    const variantId = variantIdMatch ? variantIdMatch[1] : null;
    const colour = variantId ? (variantMap[variantId] || null) : null;
    return {
      sku:            offer.sku || null,
      variantId:      variantId,
      colour:         colour,
      price:          typeof offer.price === 'number' ? offer.price : parseFloat(offer.price) || null,
      compareAtPrice: typeof offer.priceValidUntil === 'string' ? null : null, // not in LD+JSON for bathdisc
      availability:   (offer.availability || '').includes('InStock') ? 'InStock' : 'OutOfStock',
      url:            offer.url || url,
    };
  });

  // ── Compare-at price from HTML (was-price) ────────────────────────────────
  // Bathdisc shows "£1,685.84" in productImageAndPrice JS object
  const compareAtMatch = html.match(/CompareAtPrice\s*:\s*"£([\d,]+\.?\d*)"/);
  const compareAtPrice = compareAtMatch
    ? parseFloat(compareAtMatch[1].replace(/,/g, ''))
    : null;

  // Main price (lowest variant price)
  const prices = variants.map(v => v.price).filter(Boolean);
  const price = prices.length ? Math.min(...prices) : null;

  // ── Images ────────────────────────────────────────────────────────────────
  // JSON-LD image array
  let images = [];
  if (productLd.image) {
    const raw = Array.isArray(productLd.image) ? productLd.image : [productLd.image];
    images = raw.map(img => typeof img === 'string' ? img : (img.url || '')).filter(Boolean);
  }
  // Also pick up any additional gallery images from HTML (Shopify CDN)
  $('img[src*="cdn.shopify.com"], img[src*="bathdisc.co.uk/cdn"]').each((_, el) => {
    let src = $(el).attr('src') || $(el).attr('data-src') || '';
    // Clean Shopify image URL (remove size suffix for full-res)
    src = src.replace(/\?.*$/, '').replace(/_\d+x\d*(\.\w+)$/, '$1');
    if (src && !images.includes(src)) images.push(src);
  });
  // Deduplicate
  images = [...new Set(images)].filter(u => u.startsWith('http'));

  // ── Spec table ────────────────────────────────────────────────────────────
  const specs = {};
  // Common Shopify spec tables
  $('.product__description table tr, .product-description table tr, .description table tr').each((_, el) => {
    const cells = $(el).find('td, th');
    if (cells.length >= 2) {
      const key = $(cells[0]).text().trim();
      const val = $(cells[1]).text().trim();
      if (key && val) specs[key] = val;
    }
  });
  // Also try definition-list style specs
  $('.product__description dt, .product-specs dt').each((_, el) => {
    const key = $(el).text().trim();
    const val = $(el).next('dd').text().trim();
    if (key && val) specs[key] = val;
  });
  // Try metafield-style spec rows
  $('.product__metafields li, .product-features li').each((_, el) => {
    const text = $(el).text().trim();
    const colonIdx = text.indexOf(':');
    if (colonIdx > 0) {
      specs[text.slice(0, colonIdx).trim()] = text.slice(colonIdx + 1).trim();
    }
  });

  // ── Description ──────────────────────────────────────────────────────────
  const description = (productLd.description || '')
    .replace(/\s{2,}/g, '\n')
    .trim();

  // ── Brand ─────────────────────────────────────────────────────────────────
  const brand = typeof productLd.brand === 'string'
    ? productLd.brand
    : (productLd.brand?.name || '');

  // ── Collections / breadcrumbs ─────────────────────────────────────────────
  const breadcrumb = [];
  if (breadcrumbLd?.itemListElement) {
    for (const item of breadcrumbLd.itemListElement) {
      breadcrumb.push({ name: item.item?.name || item.name, url: item.item?.['@id'] || '' });
    }
  }

  // ── Collections from HTML ─────────────────────────────────────────────────
  const collections = [];
  $('a[href*="/collections/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const name = $(el).text().trim();
    if (name && href && !collections.some(c => c.href === href)) {
      collections.push({ name, href: href.startsWith('http') ? href : `https://www.bathdisc.co.uk${href}` });
    }
  });

  return {
    url,
    title:          productLd.name,
    brand,
    description,
    images,
    breadcrumb,
    collections,
    specs,
    variants,
    price,
    compareAtPrice,
    currency:       'GBP',
    sku:            productLd.sku || (variants[0]?.sku) || '',
    rawLd:          productLd,   // keep raw for re-parsing without re-scraping
    scrapedAt:      new Date().toISOString(),
  };
}

// ─── Step 3: scrape all products ─────────────────────────────────────────────

async function scrapeAll(urls) {
  console.log('\n=== Phase 2: Scraping product pages ===');

  // Load checkpoint
  const done = new Set(
    fs.existsSync(DONE_FILE)
      ? fs.readFileSync(DONE_FILE, 'utf8').trim().split('\n').filter(Boolean)
      : []
  );

  if (done.size > 0) {
    console.log(`  Resuming — ${done.size} already done, ${urls.length - done.size} remaining`);
  }

  const todo = urls.filter(u => !done.has(u));
  const failed = [];
  let scraped = done.size;

  // Ensure output file exists
  if (!fs.existsSync(OUT_JSONL)) fs.writeFileSync(OUT_JSONL, '');

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async url => {
      try {
        const html = await fetchText(url);
        if (!html) { failed.push(url); return; }
        const rec = parseProduct(html, url);
        if (rec) {
          fs.appendFileSync(OUT_JSONL, JSON.stringify(rec) + '\n');
          fs.appendFileSync(DONE_FILE, url + '\n');
          scraped++;
        } else {
          failed.push(url);
        }
      } catch (e) {
        failed.push(url);
      }
    }));

    process.stdout.write(
      `\r  Progress: ${Math.min(i + BATCH_SIZE, todo.length + done.size)}/${urls.length} — ✓${scraped} scraped ✗${failed.length} failed`
    );
    await sleep(BATCH_DELAY);
  }

  return { scraped, failed };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🛁  bathdisc.co.uk scraper');
  console.log(`   Output: ${OUT_JSONL}\n`);

  fs.mkdirSync(SCRATCH, { recursive: true });

  // Step 1: URL discovery
  const urls = await collectUrls();

  // Step 2: scrape
  const { scraped, failed } = await scrapeAll(urls);

  // Step 3: save failed list
  fs.writeFileSync(FAILED_LOG, failed.join('\n'));

  console.log('\n\n╔═══════════════════════════════════╗');
  console.log('║         SCRAPE COMPLETE           ║');
  console.log('╠═══════════════════════════════════╣');
  console.log(`║  Total URLs:   ${String(urls.length).padEnd(19)}║`);
  console.log(`║  Scraped ✓:    ${String(scraped).padEnd(19)}║`);
  console.log(`║  Failed  ✗:    ${String(failed.length).padEnd(19)}║`);
  console.log('╚═══════════════════════════════════╝');
  console.log(`\nOutput: ${OUT_JSONL}`);
  if (failed.length > 0) {
    console.log(`Failed: ${FAILED_LOG}`);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
