/**
 * Bathdisc (bathdisc.co.uk) — full catalogue capture from the store's public
 * Shopify product feed.
 *
 * The earlier page scrape (capture-bathdisc.cjs → bathdisc-pdp.jsonl) kept one
 * image per product plus the Klarna/PayPal logos, no option names, an empty
 * colour on half the variants and no per-variant was-price. The store is
 * Shopify, so /products.json publishes all of it: options, every variant's
 * price and compare-at, each variant's image, the full gallery, type and tags.
 *
 * Read-only against bathdisc.co.uk. Writes only local files:
 *   .scratch/bathdisc/v2/products.jsonl
 *
 *   node scripts/bathdisc-api-scrape.cjs
 */
const fs = require("fs");
const path = require("path");

const SITE = "https://www.bathdisc.co.uk";
const OUT_DIR = path.join(__dirname, "../.scratch/bathdisc/v2");
const OUT = path.join(OUT_DIR, "products.jsonl");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(n) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(`${SITE}/products.json?limit=250&page=${n}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
      return (await res.json()).products || [];
    } catch (e) {
      console.log(`  page ${n}: ${e.message} (attempt ${attempt})`);
      if (/not retried/.test(e.message)) throw e;
      await delay(2000 * attempt);
    }
  }
  throw new Error(`gave up on page ${n}`);
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, "");
  const seen = new Set();
  for (let n = 1; ; n++) {
    const products = await page(n);
    if (!products.length) break;
    let added = 0;
    for (const p of products) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      fs.appendFileSync(OUT, JSON.stringify(p) + "\n");
      added++;
    }
    console.log(`page ${n}: +${added} (total ${seen.size})`);
    await delay(800);
  }
  console.log(`done: ${seen.size} products`);
}

run().catch((e) => { console.error(e); process.exit(1); });
