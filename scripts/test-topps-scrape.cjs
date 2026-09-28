const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { chromium: playwrightExtra } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
playwrightExtra.use(stealth);

const CLASSIFIED_FILE = path.join(__dirname, '../.scratch/toppstiles/topps_classified.jsonl');
const OUT_FILE = path.join(__dirname, '../.scratch/toppstiles/topps_products.jsonl');

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function run() {
  const classifiedLines = fs.readFileSync(CLASSIFIED_FILE, 'utf8').split('\n').filter(Boolean);
  const productUrls = [];
  for (const line of classifiedLines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'product') productUrls.push(obj.url);
    } catch(e) {}
  }

  let processed = new Set();
  if (fs.existsSync(OUT_FILE)) {
    const outLines = fs.readFileSync(OUT_FILE, 'utf8').split('\n').filter(Boolean);
    for (const line of outLines) {
      try {
        processed.add(JSON.parse(line).url);
      } catch(e) {}
    }
  }

  const remaining = productUrls.filter(u => !processed.has(u));
  console.log(`Total Product URLs: ${productUrls.length} | Processed: ${processed.size} | Remaining: ${remaining.length}`);

  if (remaining.length === 0) return;

  console.log('Launching Playwright Extra with Stealth...');
  const browser = await playwrightExtra.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Just testing the first URL to make sure extraction is PERFECT
  const testUrls = remaining.slice(0, 1);
  
  for (let i = 0; i < testUrls.length; i++) {
    const url = testUrls[i];
    let success = false;
    let backoffMs = 2000;
    
    while (!success) {
      try {
        console.log(`[TEST] Scraping ${url}...`);
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        await page.waitForFunction(() => !document.title.includes('Just a moment'), { timeout: 30000 }).catch(() => {});
        
        if (response && (response.status() === 429 || response.status() === 403)) {
           console.log(`Rate limited (${response.status()}). Backing off for ${backoffMs}ms...`);
           await delay(backoffMs);
           backoffMs = Math.min(backoffMs * 2, 60000);
           continue; 
        }

        // Wait for price to load (SPA behavior)
        await page.waitForSelector('.price, [data-price], h1', { timeout: 10000 }).catch(() => {});
        await delay(2000);
        
        const data = await page.evaluate(() => {
          const title = document.querySelector('h1')?.innerText?.trim() || '';
          
          // Price can be in various elements
          let priceStr = '';
          const priceEls = Array.from(document.querySelectorAll('.price, [data-price], .sales, .product-price'));
          for (const el of priceEls) {
            const t = el.innerText.trim();
            if (t.includes('£')) {
              priceStr = t;
              break;
            }
          }
          
          // Images
          const images = [];
          document.querySelectorAll('img').forEach(img => {
            if (img.src && img.src.includes('product') && !img.src.includes('icon')) {
              images.push(img.src);
            }
          });
          
          // Specifications
          const specs = {};
          const rows = document.querySelectorAll('tr, .spec-row, .attribute-row, li');
          rows.forEach(row => {
            const th = row.querySelector('th, .label, strong');
            const td = row.querySelector('td, .value, span:not(.label)');
            if (th && td) {
              const k = th.innerText.trim();
              const v = td.innerText.trim();
              if (k && v && k.length < 50) specs[k] = v;
            } else if (row.innerText.includes(':')) {
               const parts = row.innerText.split(':');
               const k = parts[0].trim();
               const v = parts.slice(1).join(':').trim();
               if (k && v && k.length < 50) specs[k] = v;
            }
          });
          
          // Breadcrumbs
          const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb a, .breadcrumbs a, nav a'))
                                .map(a => a.innerText.trim())
                                .filter(Boolean);
                                
          return {
            title,
            price: priceStr,
            images: Array.from(new Set(images)), // unique
            specs,
            breadcrumbs,
            rawHtmlLength: document.body.innerHTML.length
          };
        });

        console.log("=== SCRAPED DATA ===");
        console.log(JSON.stringify(data, null, 2));
        success = true;
        
      } catch (err) {
        console.error(`Error on ${url}: ${err.message}`);
        await delay(backoffMs);
      }
    }
  }
  
  await browser.close();
}

run().catch(console.error);
