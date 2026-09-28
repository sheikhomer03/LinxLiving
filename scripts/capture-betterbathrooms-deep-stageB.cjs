const path = require("path");
const fs = require("fs");

const ORIGIN = "https://www.betterbathrooms.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DATA = process.env.DATA_DIR || path.join(__dirname, "..", ".scratch", "betterbathrooms");
const URLS_FILE = path.join(DATA, "bb-urls-deep.json");
const PDP_FILE = path.join(DATA, "bb-pdp-deep.jsonl");

const LIMIT = Number(process.env.LIMIT) || Infinity;
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 4, 10));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
      if (res.status === 404 || res.status === 410) return null;
      if (!res.ok && res.status >= 500) throw new Error("HTTP " + res.status);
      if (!res.ok) return null;
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

async function stageB() {
  console.log(`\n=== STAGE B: Scrape Products (Deep) ===`);
  
  const urls = JSON.parse(fs.readFileSync(URLS_FILE, "utf8"));
  
  const doneIds = new Set();
  if (fs.existsSync(PDP_FILE)) {
    const lines = fs.readFileSync(PDP_FILE, "utf8").split("\n").filter(Boolean);
    lines.forEach(l => {
      try { doneIds.add(JSON.parse(l).url); } catch(e) {}
    });
  }
  console.log(`Found ${doneIds.size} already scraped products in deep PDP.`);

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
            rawHtmlLength: html.length 
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

stageB().catch(console.error);
