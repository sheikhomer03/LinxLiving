const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const URLS_FILE = path.join(__dirname, '../.scratch/toppstiles/all_urls.txt');
const OUT_FILE = path.join(__dirname, '../.scratch/toppstiles/topps_classified.jsonl');

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function run() {
  const allUrls = fs.readFileSync(URLS_FILE, 'utf8').split('\n').filter(u => u.trim());
  let processed = new Set();
  
  if (fs.existsSync(OUT_FILE)) {
    const lines = fs.readFileSync(OUT_FILE, 'utf8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        processed.add(obj.url);
      } catch (e) {
        // ignore malformed lines
      }
    }
  }

  const remaining = allUrls.filter(u => !processed.has(u));
  console.log(`Total URLs: ${allUrls.length} | Processed: ${processed.size} | Remaining: ${remaining.length}`);

  if (remaining.length === 0) {
    console.log("All URLs processed!");
    return;
  }

  console.log('Connecting to Chrome via CDP on port 9222...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const defaultContext = browser.contexts()[0];
  const page = await defaultContext.newPage();
  
  let backoffMs = 2000;

  for (let i = 0; i < remaining.length; i++) {
    const url = remaining[i];
    let success = false;
    let type = 'other';
    
    while (!success) {
      try {
        console.log(`[${i+1}/${remaining.length}] Classifying ${url}...`);
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Handle Cloudflare wait if necessary
        await page.waitForFunction(() => !document.title.includes('Just a moment'), { timeout: 30000 }).catch(() => {});
        
        if (response && (response.status() === 429 || response.status() === 403)) {
           console.log(`Rate limited (${response.status()}). Backing off for ${backoffMs}ms...`);
           await delay(backoffMs);
           backoffMs = Math.min(backoffMs * 2, 60000);
           continue; // Retry
        }

        // Wait a bit to let JS render
        await delay(1000);
        
        type = await page.evaluate(() => {
          // Check JSON-LD
          const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
          let isProduct = false;
          let isHub = false;
          
          for (const s of scripts) {
            try {
              const data = JSON.parse(s.innerText);
              
              // Handle both direct object and array of objects
              const items = Array.isArray(data) ? data : [data];
              
              for (const item of items) {
                if (item['@type'] === 'Product' && item.sku) {
                  isProduct = true;
                }
                if (item['@type'] === 'ItemList') {
                  isHub = true;
                }
              }
            } catch (e) {
              // ignore parse error
            }
          }
          
          // Cross-check for product specific elements
          if (document.querySelector('product-view-price') || document.querySelector('product-view-details')) {
             isProduct = true;
          }
          
          if (isProduct) return 'product';
          if (isHub) return 'range-hub';
          return 'other';
        });

        // Reset backoff on success
        backoffMs = 2000;
        success = true;
        
      } catch (err) {
        console.error(`Error on ${url}: ${err.message}`);
        console.log(`Backing off for ${backoffMs}ms before retry...`);
        await delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 60000);
      }
    }
    
    const record = { url, type };
    fs.appendFileSync(OUT_FILE, JSON.stringify(record) + '\n');
    console.log(` -> Classified as: ${type}`);
    
    // Throttled pace (1-3s between requests)
    const throttle = Math.floor(Math.random() * 2000) + 1000;
    await delay(throttle);
  }
  
  await page.close();
  await browser.close();
  console.log("Classification complete!");
}

run().catch(console.error);
