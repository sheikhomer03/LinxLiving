/**
 * tp-deep-scrape-v2.cjs
 * Category-crawl → product scrape for tilesporcelain.co.uk
 * Slow concurrency + retry to avoid Cloudflare blocks.
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

async function fetchHtml(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await sleep(300 + Math.random() * 400); // 300-700ms between each request
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status === 503) {
        console.log(`  Rate limited on ${url}, waiting 5s...`);
        await sleep(5000);
        continue;
      }
      if (!res.ok) return null;
      const html = await res.text();
      // Cloudflare challenge page check
      if (html.includes('Just a moment') || html.includes('cf-browser-verification')) {
        console.log(`  Cloudflare challenge on ${url}, waiting 10s...`);
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

async function getProductLinksFromPage(url) {
  const html = await fetchHtml(url);
  if (!html) return { links: [], hasNext: false };
  const $ = cheerio.load(html);

  const links = new Set();
  $('a.product-item-link').each((_, el) => {
    let href = $(el).attr('href');
    if (href) {
      href = href.split('?')[0].trim();
      if (href.startsWith('https://tilesporcelain.co.uk/')) links.add(href);
    }
  });
  const hasNext = $('a.action.next').length > 0;
  return { links: Array.from(links), hasNext };
}

async function scrapeProduct(url) {
  const html = await fetchHtml(url);
  if (!html) return null;
  const $ = cheerio.load(html);

  let productJson = null;
  let breadcrumbJson = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '');
      if (parsed['@type'] === 'Product') productJson = parsed;
      if (parsed['@type'] === 'BreadcrumbList') breadcrumbJson = parsed;
    } catch (e) {}
  });

  if (!productJson?.name) return null;

  const specs = {};
  $('.additional-attributes tr').each((_, el) => {
    const key = $(el).find('th').text().trim();
    const val = $(el).find('td').text().trim();
    if (key && val) specs[key] = val;
  });

  const breadcrumb = [];
  if (breadcrumbJson?.itemListElement) {
    breadcrumbJson.itemListElement.forEach(item => {
      breadcrumb.push({ name: item.item.name, id: item.item['@id'] });
    });
  }

  let images = [];
  if (productJson.image) {
    images = Array.isArray(productJson.image) ? productJson.image : [productJson.image];
  }

  const priceRaw = parseFloat(productJson.offers?.price) || null;
  const boxQty = parseInt(specs['Box Quantity']) || 1;

  // sqmPerBox is stored in specs for all TP products
  const sqmPerBox = parseFloat(specs['SQM Per Box'] || specs['sqmPerBox'] || '') || null;
  // tilesPerM2 may also be available
  const tilesPerM2 = parseFloat(specs['Tiles Per M2'] || '') || null;
  
  // Compute pricePerM2: if sqmPerBox known, box price = priceRaw * boxQty → per m2
  // But priceRaw is per tile here, so pricePerBox = priceRaw * boxQty
  // then pricePerM2 = pricePerBox / sqmPerBox
  let pricePerM2 = null;
  if (priceRaw && sqmPerBox) {
    pricePerM2 = Math.round((priceRaw * boxQty / sqmPerBox) * 100) / 100;
  } else if (priceRaw && tilesPerM2) {
    pricePerM2 = Math.round(priceRaw * tilesPerM2 * 100) / 100;
  }

  return {
    url,
    crawledUrl: url,
    status: 200,
    title: productJson.name,
    sku: productJson.sku || productJson.mpn || '',
    breadcrumb,
    category: productJson.category || '',
    color: productJson.color || specs['Colour'] || '',
    weightKg: productJson.weight?.value || '',
    images,
    description: productJson.description || '',
    specs,
    priceCurrent: priceRaw,
    priceExVatPerTile: priceRaw,
    boxQty,
    sqmPerBox,
    pricePerM2,
    scrapedAt: new Date().toISOString(),
  };
}

// Sequential pool - 1 at a time to avoid rate limiting
async function runSequential(urls, batchSize = 5) {
  let done = 0, failed = 0;
  const failedUrls = [];

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    await Promise.all(batch.map(async (url) => {
      try {
        const rec = await scrapeProduct(url);
        if (rec) {
          fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
          done++;
        } else {
          failed++;
          failedUrls.push(url);
        }
      } catch (e) {
        failed++;
        failedUrls.push(url);
      }
    }));

    process.stdout.write(`\r  Scraped ${done + failed}/${urls.length} — ✓${done} ✗${failed}`);
    // Small pause between batches
    await sleep(500);
  }
  return { done, failed, failedUrls };
}

async function main() {
  const allProductUrls = new Set();

  // Phase 1: crawl category pages to get all product URLs
  console.log('\n=== Phase 1: Crawling category pages ===');
  for (const catUrl of CATEGORIES) {
    let page = 1;
    while (true) {
      const pageUrl = page === 1 ? catUrl : `${catUrl}?p=${page}`;
      process.stdout.write(`\r  ${pageUrl}...`);
      const { links, hasNext } = await getProductLinksFromPage(pageUrl);
      links.forEach(l => allProductUrls.add(l));
      if (!hasNext) break;
      page++;
    }
    process.stdout.write('\n');
  }

  const urlArray = Array.from(allProductUrls);
  console.log(`\nFound ${urlArray.length} unique products.\n`);

  // Phase 2: scrape each product
  console.log('=== Phase 2: Scraping product pages (batch=5, ~500ms delay) ===');
  fs.writeFileSync(OUT, '');
  fs.writeFileSync(FAILED_LOG, '');

  const { done, failed, failedUrls } = await runSequential(urlArray, 5);
  
  if (failedUrls.length > 0) {
    fs.writeFileSync(FAILED_LOG, failedUrls.join('\n'));
  }

  console.log(`\n\nDone! ✓${done} scraped  ✗${failed} failed`);
  console.log(`Output: ${OUT}`);
  if (failed > 0) console.log(`Failed URLs logged to: ${FAILED_LOG}`);
}

main().catch(console.error);
