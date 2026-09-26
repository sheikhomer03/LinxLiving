const fs = require('fs');
const path = require('path');
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
        const obj = JSON.parse(line);
        if (obj && obj.url) processed.add(obj.url);
      } catch(e) {}
    }
  }

  const remaining = productUrls.filter(u => !processed.has(u));
  console.log(`Total Product URLs: ${productUrls.length} | Processed: ${processed.size} | Remaining: ${remaining.length}`);

  if (remaining.length === 0) {
    console.log("All products scraped!");
    return;
  }

  console.log('Launching Playwright with Stealth...');
  const browser = await playwrightExtra.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  let backoffMs = 2000;
  let successCount = 0;
  
  for (let i = 0; i < remaining.length; i++) {
    const url = remaining[i];
    let success = false;
    
    while (!success) {
      try {
        console.log(`[${i+1}/${remaining.length}] Scraping ${url}...`);
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        await page.waitForFunction(() => !document.title.includes('Just a moment'), { timeout: 30000 }).catch(() => {});
        
        if (response && (response.status() === 429 || response.status() === 403)) {
           console.log(`Rate limited (${response.status()}). Backing off for ${backoffMs}ms...`);
           await delay(backoffMs);
           backoffMs = Math.min(backoffMs * 2, 60000);
           continue; 
        }

        // Wait for price/content to load (SPA behavior)
        await page.waitForSelector('.price, [data-price], h1, product-view-details', { timeout: 10000 }).catch(() => {});
        await delay(1500); // Give it a short moment for final JS rendering
        
        const data = await page.evaluate(() => {
          const title = document.querySelector('h1')?.innerText?.trim() || '';
          
          let priceStr = '';
          const priceEls = Array.from(document.querySelectorAll('.price, [data-price], .sales, .product-price, price'));
          for (const el of priceEls) {
            const t = el.innerText.trim();
            if (t.includes('£')) {
              priceStr = t.replace(/\s+/g, ' ');
              break;
            }
          }
          
          const images = [];
          document.querySelectorAll('img').forEach(img => {
            if (img.src && img.src.includes('product') && !img.src.includes('icon')) {
              images.push(img.src);
            }
          });
          
          const specs = {};
          
          // First, standard tables/rows
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

          // Second, raw text block extraction for "SKU", "Dimensions"
          const textBlocks = Array.from(document.querySelectorAll('h2, h3, .label, .value, p, div, span'))
            .map(el => el.textContent.trim());
            
          for (const text of textBlocks) {
            if (text.startsWith("SKU:")) specs["SKU"] = text.replace("SKU:", "").trim();
            if (text.startsWith("Dimensions:")) specs["Dimensions"] = text.replace("Dimensions:", "").trim();
            if (text.startsWith("Material:")) specs["Material"] = text.replace("Material:", "").trim();
            if (text.startsWith("Finish:")) specs["Finish"] = text.replace("Finish:", "").trim();
          }
          
          const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb a, .breadcrumbs a, nav a, .brd-crumbs a, product-breadcrumbs a'))
                                .map(a => a.innerText.trim())
                                .filter(Boolean);
                                
          return {
            title,
            price: priceStr,
            images: Array.from(new Set(images)), // unique
            specs,
            breadcrumbs
          };
        });

        // Append to file
        const record = { url, ...data };
        fs.appendFileSync(OUT_FILE, JSON.stringify(record) + '\n');
        
        console.log(` -> Success: ${data.title} | Images: ${data.images.length} | Price: ${data.price}`);
        successCount++;
        success = true;
        backoffMs = 2000;
        
      } catch (err) {
        console.error(`Error on ${url}: ${err.message}`);
        await delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 60000);
      }
    }
    
    // Throttle between requests
    const throttle = Math.floor(Math.random() * 1500) + 1500;
    await delay(throttle);
  }
  
  await browser.close();
  console.log(`\n=== SCRAPING COMPLETE === Successfully scraped ${successCount} products.`);
}

run().catch(console.error);
