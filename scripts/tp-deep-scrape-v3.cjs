/**
 * tp-deep-scrape-v3.cjs
 * Scrapes ALL products from tilesporcelain.co.uk into a JSONL file.
 * NO database writes. Just scraping to file.
 *
 * Strategy: brute-force paginate each category (?p=1, ?p=2, ...) until
 * a page returns 0 products. Deduplicate by URL, then scrape each product.
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const OUT = path.join(__dirname, '../.scratch/tilesporcelain/tp-pdp-all.jsonl');
const FAILED_LOG = path.join(__dirname, '../.scratch/tilesporcelain/tp-failed.txt');

const CATEGORIES = [
  "https://tilesporcelain.co.uk/bathroom-tiles",
  "https://tilesporcelain.co.uk/kitchen-tiles",
  "https://tilesporcelain.co.uk/outdoor-tiles",
  "https://tilesporcelain.co.uk/living-room-tiles",
  "https://tilesporcelain.co.uk/hallway-tiles",
  "https://tilesporcelain.co.uk/mosaic-tiles",
  "https://tilesporcelain.co.uk/wood-effect-tiles",
  "https://tilesporcelain.co.uk/marble-effect-tiles",
  "https://tilesporcelain.co.uk/quartz-tiles",
  "https://tilesporcelain.co.uk/clearance",
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.5',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchHtml(url, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      await sleep(200 + Math.random() * 300);
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status === 503) {
        await sleep(8000);
        continue;
      }
      if (!res.ok) return null;
      const html = await res.text();
      if (html.includes('Just a moment') || html.includes('cf-browser-verification')) {
        await sleep(10000);
        continue;
      }
      return html;
    } catch (e) {
      if (i < retries - 1) await sleep(2000);
    }
  }
  return null;
}

function extractProductLinks(html) {
  const $ = cheerio.load(html);
  const links = new Set();
  // Try multiple selectors Magento uses
  $('a.product-item-link, .product-item-info a, .product-name a').each((_, el) => {
    let href = $(el).attr('href');
    if (href && href.startsWith('https://tilesporcelain.co.uk/') && !href.includes('?')) {
      links.add(href.trim());
    }
  });
  return Array.from(links);
}

async function crawlCategory(baseUrl) {
  const allLinks = new Set();
  let page = 1;
  let consecutiveEmpty = 0;

  while (true) {
    const url = page === 1 ? baseUrl : `${baseUrl}?p=${page}`;
    const html = await fetchHtml(url);

    if (!html) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) break;
      page++;
      continue;
    }

    const links = extractProductLinks(html);

    if (links.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) break;
    } else {
      consecutiveEmpty = 0;
      links.forEach(l => allLinks.add(l));
    }

    process.stdout.write(`\r  ${baseUrl} — page ${page} — found ${links.length} products (total: ${allLinks.size})`);
    page++;

    // Max guard: tilesporcelain has ~36 pages for bathroom
    if (page > 50) break;
  }

  return Array.from(allLinks);
}

async function scrapeProduct(url) {
  const html = await fetchHtml(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  let productJson = null;
  let breadcrumbJson = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const txt = $(el).html() || '';
      const parsed = JSON.parse(txt);
      if (parsed['@type'] === 'Product') productJson = parsed;
      if (parsed['@type'] === 'BreadcrumbList') breadcrumbJson = parsed;
    } catch (e) {}
  });

  if (!productJson?.name) return null;

  // Extract specs table
  const specs = {};
  $('.additional-attributes tr').each((_, el) => {
    const key = $(el).find('th').text().trim();
    const val = $(el).find('td').text().trim();
    if (key && val) specs[key] = val;
  });

  // Breadcrumbs
  const breadcrumb = [];
  if (breadcrumbJson?.itemListElement) {
    breadcrumbJson.itemListElement.forEach(item => {
      breadcrumb.push({ name: item.item.name, id: item.item['@id'] });
    });
  }

  // Images
  let images = [];
  if (productJson.image) {
    images = Array.isArray(productJson.image) ? productJson.image : [productJson.image];
  }

  const pricePerTile = parseFloat(productJson.offers?.price) || null;
  const boxQty = parseInt(specs['Box Quantity']) || 1;
  const sqmPerBox = parseFloat(specs['SQM Per Box'] || specs['sqmPerBox'] || '') || null;
  const tilesPerM2 = parseFloat(specs['Tiles Per M2'] || '') || null;

  // Derive pricePerM2
  let pricePerM2 = null;
  if (pricePerTile && sqmPerBox && boxQty > 0) {
    const boxPrice = pricePerTile * boxQty;
    pricePerM2 = Math.round((boxPrice / sqmPerBox) * 100) / 100;
  } else if (pricePerTile && tilesPerM2) {
    pricePerM2 = Math.round(pricePerTile * tilesPerM2 * 100) / 100;
  }

  return {
    url,
    title: productJson.name,
    sku: productJson.sku || productJson.mpn || '',
    breadcrumb,
    category: productJson.category || '',
    color: productJson.color || specs['Colour'] || '',
    weightKg: productJson.weight?.value || '',
    images,
    description: productJson.description || '',
    specs,
    pricePerTile,
    boxQty,
    sqmPerBox,
    pricePerM2,
    scrapedAt: new Date().toISOString(),
  };
}

async function main() {
  console.log('\n=== Phase 1: Discovering product URLs ===');
  const allProductUrls = new Set();

  for (const cat of CATEGORIES) {
    const links = await crawlCategory(cat);
    links.forEach(l => allProductUrls.add(l));
    process.stdout.write('\n');
  }

  const urls = Array.from(allProductUrls);
  console.log(`\nTotal unique products found: ${urls.length}`);

  console.log('\n=== Phase 2: Scraping each product ===');
  fs.writeFileSync(OUT, '');
  const failed = [];
  let done = 0;

  // Batch of 3 at a time
  for (let i = 0; i < urls.length; i += 3) {
    const batch = urls.slice(i, i + 3);
    await Promise.all(batch.map(async (url) => {
      try {
        const rec = await scrapeProduct(url);
        if (rec) {
          fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
          done++;
        } else {
          failed.push(url);
        }
      } catch (e) {
        failed.push(url);
      }
    }));
    process.stdout.write(`\r  Progress: ${i + batch.length}/${urls.length} — ✓${done} scraped ✗${failed.length} failed`);
    await sleep(400);
  }

  fs.writeFileSync(FAILED_LOG, failed.join('\n'));

  console.log(`\n\n=== DONE ===`);
  console.log(`Scraped: ${done}/${urls.length}`);
  console.log(`Failed:  ${failed.length}`);
  console.log(`Output:  ${OUT}`);
}

main().catch(console.error);
