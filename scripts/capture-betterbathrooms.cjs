/**
 * Capture betterbathrooms.com into a JSONL store (crawl only — no Mongo writes).
 *
 * Stage A: Parses homepage to get all categories, then paginates them via ?pageNumber=N to collect all product URLs.
 * Stage B: Fetches each product URL, extracting JSON-LD (for basic specs/price) and HTML tables (for detailed specs).
 */
const path = require("path");
const fs = require("fs");

const ORIGIN = "https://www.betterbathrooms.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DATA = process.env.DATA_DIR || path.join(__dirname, "..", ".scratch", "betterbathrooms");
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

const LIMIT = Number(process.env.LIMIT) || Infinity;
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 4, 10));
const CATS_ONLY = process.env.CATS_ONLY === "1";

const URLS_FILE = path.join(DATA, "bb-urls.json");
const PDP_FILE = path.join(DATA, "bb-pdp.jsonl");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) {
      if (i === tries) throw e;
      await sleep(1000 * i);
    }
  }
  return null;
}

function extractJSONLD(html) {
  const matches = html.match(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/g);
  if (!matches) return null;
  for (const match of matches) {
    const content = match.replace(/<script type=\"application\/ld\+json\">/i, "").replace(/<\/script>/i, "").trim();
    try {
      const data = JSON.parse(content);
      // We want the Product object (could be an array or inside a graph)
      if (data["@type"] === "Product") return data;
      if (Array.isArray(data)) {
        const prod = data.find(d => d["@type"] === "Product");
        if (prod) return prod;
      }
      if (data["@graph"]) {
        const prod = data["@graph"].find(d => d["@type"] === "Product");
        if (prod) return prod;
      }
    } catch (e) {}
  }
  return null;
}

function extractTableSpecs(html) {
  const specs = {};
  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (tableMatch) {
    const rows = tableMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    if (rows) {
      rows.forEach(r => {
        const td = r.match(/<(td|th)[^>]*>([\s\S]*?)<\/(td|th)>/gi);
        if (td && td.length >= 2) {
          const key = td[0].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          const val = td[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          if (key) specs[key] = val;
        }
      });
    }
  }
  return specs;
}

async function stageA() {
  console.log("=== STAGE A: Discover URLs ===");
  if (fs.existsSync(URLS_FILE)) {
    const urls = JSON.parse(fs.readFileSync(URLS_FILE, "utf8"));
    console.log(`Loaded ${urls.length} URLs from checkpoint.`);
    return urls;
  }

  console.log("Fetching homepage for categories...");
  const home = await get(ORIGIN + "/");
  if (!home) throw new Error("Failed to fetch homepage");

  const catMatches = home.match(/href=\"([^\"]+)\"[^>]*>([^<]+)<\/a>/g) || [];
  const catUrls = new Set();
  for (const m of catMatches) {
    const parts = m.match(/href=\"([^\"]+)\"/);
    if (parts) {
      let url = parts[1];
      if (url.startsWith("/c/") || url.startsWith("/ct/")) {
        catUrls.add(url.split("?")[0]);
      }
    }
  }
  console.log(`Found ${catUrls.size} category links.`);

  const productUrls = new Set();
  const queue = [...catUrls];
  
  for (let i = 0; i < queue.length; i++) {
    const cat = queue[i];
    console.log(`Crawling category ${i + 1}/${queue.length}: ${cat}`);
    
    // Fetch page 1
    const p1 = await get(ORIGIN + cat);
    if (!p1) continue;
    
    // Find products on page 1
    const pMatches = p1.match(/href=\"(\/p\/[^\"]+)\"/g) || [];
    pMatches.forEach(m => productUrls.add(m.match(/href=\"([^\"]+)\"/)[1].split("?")[0]));
    
    // Find max pagination
    let maxPage = 1;
    const pageMatches = p1.match(/pageNumber=(\d+)/g) || [];
    pageMatches.forEach(m => {
      const page = parseInt(m.split("=")[1]);
      if (page > maxPage) maxPage = page;
    });
    
    if (maxPage > 1) {
      console.log(`  -> Found ${maxPage} pages`);
      for (let p = 2; p <= maxPage; p++) {
        const pageHtml = await get(`${ORIGIN}${cat}?pageNumber=${p}`);
        if (!pageHtml) continue;
        const pagePMatches = pageHtml.match(/href=\"(\/p\/[^\"]+)\"/g) || [];
        pagePMatches.forEach(m => productUrls.add(m.match(/href=\"([^\"]+)\"/)[1].split("?")[0]));
        await sleep(200); // Be polite
      }
    }
  }

  const urls = [...productUrls];
  console.log(`\nDiscovered ${urls.length} total unique product URLs.`);
  fs.writeFileSync(URLS_FILE, JSON.stringify(urls, null, 2));
  return urls;
}

async function stageB(urls) {
  console.log(`\n=== STAGE B: Scrape Products ===`);
  
  const doneIds = new Set();
  if (fs.existsSync(PDP_FILE)) {
    const lines = fs.readFileSync(PDP_FILE, "utf8").split("\n").filter(Boolean);
    lines.forEach(l => {
      try { doneIds.add(JSON.parse(l).url); } catch(e) {}
    });
  }
  console.log(`Found ${doneIds.size} already scraped products.`);

  const pending = urls.filter(u => !doneIds.has(u));
  console.log(`Pending: ${pending.length} products (LIMIT=${LIMIT})`);

  let count = 0;
  const workers = [];
  let index = 0;

  const worker = async (workerId) => {
    while (index < pending.length && count < LIMIT) {
      const urlPath = pending[index++];
      const fullUrl = ORIGIN + urlPath;
      
      try {
        const html = await get(fullUrl);
        if (html) {
          const jsonLd = extractJSONLD(html);
          const tableSpecs = extractTableSpecs(html);
          
          const record = {
            url: urlPath,
            sourceUrl: fullUrl,
            scrapedAt: new Date().toISOString(),
            jsonLd,
            tableSpecs,
            rawHtmlLength: html.length // useful diagnostic
          };
          
          fs.appendFileSync(PDP_FILE, JSON.stringify(record) + "\n");
        }
      } catch(e) {
        console.error(`[W${workerId}] Error on ${urlPath}: ${e.message}`);
      }
      
      count++;
      if (count % 100 === 0) console.log(`Progress: ${count}/${pending.length}`);
    }
  };

  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker(i));
  await Promise.all(workers);
  
  console.log("Scrape complete!");
}

async function main() {
  const urls = await stageA();
  if (!CATS_ONLY) {
    await stageB(urls);
  }
}
main().catch(console.error);
