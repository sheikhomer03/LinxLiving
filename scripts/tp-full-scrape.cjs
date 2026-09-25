const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const sitemapUrl = "https://tilesporcelain.co.uk/tilesporcelainsitemap.xml";
const outFile = path.join(__dirname, "../.scratch/tilesporcelain/tp-pdp-all.jsonl");

async function main() {
  console.log("Fetching sitemap...");
  const sitemapRes = await fetch(sitemapUrl);
  const sitemapText = await sitemapRes.text();
  
  const urlBlocks = sitemapText.split("<url>");
  let urls = [];
  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    if (locMatch) urls.push(locMatch[1]);
  }
  
  urls = urls.filter(u => !u.endsWith("/about") && !u.endsWith("/contact") && !u.endsWith("/faqs") && !u.includes("/category/"));
  console.log(`Will scrape ${urls.length} URLs...`);
  
  fs.writeFileSync(outFile, "");

  let done = 0, skipped = 0, failed = 0;
  
  // Custom concurrency helper for CommonJS
  async function asyncPool(poolLimit, array, iteratorFn) {
    const ret = [];
    const executing = [];
    for (const item of array) {
      const p = Promise.resolve().then(() => iteratorFn(item, array));
      ret.push(p);
      if (poolLimit <= array.length) {
        const e = p.then(() => executing.splice(executing.indexOf(e), 1));
        executing.push(e);
        if (executing.length >= poolLimit) {
          await Promise.race(executing);
        }
      }
    }
    return Promise.all(ret);
  }

  await asyncPool(20, urls, async (url) => {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) { failed++; return; }
      
      const html = await res.text();
      const $ = cheerio.load(html);
      
      let productJson = null;
      let breadcrumbJson = null;
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const parsed = JSON.parse($(el).html());
          if (parsed['@type'] === 'Product') productJson = parsed;
          if (parsed['@type'] === 'BreadcrumbList') breadcrumbJson = parsed;
        } catch (e) {}
      });
      
      if (!productJson || !productJson.name) {
        skipped++;
        return;
      }
      
      const specs = {};
      $('.additional-attributes th').each((_, el) => {
        const key = $(el).text().trim();
        const val = $(el).next('td').text().trim();
        if (key && val) specs[key] = val;
      });
      
      const breadcrumb = [];
      if (breadcrumbJson && breadcrumbJson.itemListElement) {
        breadcrumbJson.itemListElement.forEach(item => {
          breadcrumb.push({
            name: item.item.name,
            id: item.item['@id']
          });
        });
      }
      
      let images = [];
      if (productJson.image) {
        images = Array.isArray(productJson.image) ? productJson.image : [productJson.image];
      }
      
      const priceRaw = parseFloat(productJson.offers?.price) || null;
      
      const rec = {
        url: url,
        crawledUrl: url,
        status: res.status,
        title: productJson.name,
        sku: productJson.sku || productJson.mpn || "",
        breadcrumb: breadcrumb,
        category: productJson.category || "",
        color: productJson.color || specs['Colour'] || "",
        weightKg: (productJson.weight && productJson.weight.value) ? productJson.weight.value : "",
        images: images,
        description: productJson.description || "",
        specs: specs,
        priceCurrent: priceRaw, 
        priceExVatPerTile: priceRaw,
        boxQty: parseInt(specs['Box Quantity']) || 1,
        scrapedAt: new Date().toISOString()
      };
      
      fs.appendFileSync(outFile, JSON.stringify(rec) + "\\n");
      done++;
      
      if (done % 50 === 0) {
        process.stdout.write(`\\rScraped ${done}/${urls.length} (Skipped ${skipped}, Failed ${failed})...`);
      }
    } catch (e) {
      failed++;
    }
  });
  
  console.log(`\\nFinished! Scraped ${done} products into ${outFile}`);
}

main().catch(console.error);
