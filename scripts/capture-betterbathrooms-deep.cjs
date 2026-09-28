const path = require("path");
const fs = require("fs");

const ORIGIN = "https://www.betterbathrooms.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DATA = process.env.DATA_DIR || path.join(__dirname, "..", ".scratch", "betterbathrooms");
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

const LIMIT = Number(process.env.LIMIT) || Infinity;
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 4, 10));

const URLS_FILE = path.join(DATA, "bb-urls-deep.json");
const PDP_FILE = path.join(DATA, "bb-pdp-deep.jsonl");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
      if (res.status === 404 || res.status === 410) return null;
      if (!res.ok && res.status >= 500) throw new Error("HTTP " + res.status);
      if (!res.ok) return null; // Ignore other 4xx errors
      return await res.text();
    } catch (e) {
      if (i === tries) throw e;
      await sleep(1000 * i);
    }
  }
  return null;
}

async function discoverUrls() {
  console.log("=== STAGE A: Discover URLs (DEEP CRAWL) ===");
  if (fs.existsSync(URLS_FILE)) {
    const urls = JSON.parse(fs.readFileSync(URLS_FILE, "utf8"));
    console.log(`Loaded ${urls.length} URLs from checkpoint.`);
    return urls;
  }

  const visitedCats = new Set();
  const queue = ["/"];
  const catUrls = new Set();
  const productUrls = new Set();

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (visitedCats.has(currentPath)) continue;
    visitedCats.add(currentPath);

    console.log(`Crawling: ${currentPath}`);
    const html = await get(ORIGIN + currentPath);
    if (!html) continue;

    // Find all categories
    const links = html.match(/href=\"([^\"]+)\"/g) || [];
    for (const match of links) {
      const href = match.match(/href=\"([^\"]+)\"/)[1];
      const urlPath = href.split("?")[0].replace(ORIGIN, "");
      if (urlPath.startsWith("/c/") || urlPath.startsWith("/ct/")) {
        if (!visitedCats.has(urlPath)) {
          catUrls.add(urlPath);
          queue.push(urlPath);
        }
      }
    }
  }
  
  console.log(`Found ${catUrls.size} unique category links recursively.`);
  
  const catQueue = [...catUrls];
  for (let i = 0; i < catQueue.length; i++) {
    const cat = catQueue[i];
    console.log(`Paginating category ${i + 1}/${catQueue.length}: ${cat}`);
    
    let p = 1;
    let keepPaginating = true;
    while (keepPaginating) {
      const pageUrl = p === 1 ? `${ORIGIN}${cat}` : `${ORIGIN}${cat}?pageNumber=${p}`;
      const pageHtml = await get(pageUrl);
      if (!pageHtml) break;
      
      const pMatches = pageHtml.match(/href=\"(\/p\/[^\"]+)\"/g) || [];
      let foundNewProducts = false;
      pMatches.forEach(m => {
        const prodPath = m.match(/href=\"([^\"]+)\"/)[1].split("?")[0];
        if (!productUrls.has(prodPath)) {
          productUrls.add(prodPath);
          foundNewProducts = true;
        }
      });
      
      // Look for max page in pagination links
      let maxPage = p;
      const pageNumMatches = pageHtml.match(/pageNumber=(\d+)/g) || [];
      pageNumMatches.forEach(m => {
        const page = parseInt(m.split("=")[1]);
        if (page > maxPage) maxPage = page;
      });
      
      if (p < maxPage) {
        p++;
        await sleep(200);
      } else {
        keepPaginating = false;
      }
    }
  }

  const urls = [...productUrls];
  console.log(`\nDiscovered ${urls.length} total unique product URLs.`);
  fs.writeFileSync(URLS_FILE, JSON.stringify(urls, null, 2));
  return urls;
}

discoverUrls().catch(console.error);
