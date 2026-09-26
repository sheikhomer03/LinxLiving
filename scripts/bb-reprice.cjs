/**
 * Compare every Better Bathrooms variant price in DB2 with the live
 * betterbathrooms.com price (inc VAT) and, with --apply, correct DB2 and
 * Shopify where they differ.
 *
 * Live prices come from each page's Product offer; a page's ProductGroup also
 * lists sibling SKUs with their prices, so one page often prices a whole
 * product and the remaining variant pages are only fetched when needed.
 * A variant whose live page cannot be read, or shows no price, is reported
 * and left unchanged — never zeroed.
 *
 *   node scripts/bb-reprice.cjs            # compare, write report
 *   node scripts/bb-reprice.cjs --apply    # compare, then fix DB2 + Shopify
 * Report: .scratch/betterbathrooms/work/bb-reprice.json
 */
require("tsx/cjs");
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
require("dns").setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { MongoClient } = require("mongodb");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

const APPLY = process.argv.includes("--apply") || process.argv.includes("--apply-report");
/** Apply the changes in an existing report instead of re-reading every page. */
const FROM_REPORT = process.argv.includes("--apply-report");
const CONCURRENCY = 6;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const OUT = path.join(__dirname, "../.scratch/betterbathrooms/work/bb-reprice.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseLd(raw) {
  try { return JSON.parse(raw); } catch {}
  try { return JSON.parse(raw.replace(/[\u0000-\u001f]+/g, " ")); } catch {}
  const repaired = raw
    .replace(/("(?:[^"\\\n]|\\.)*"|\d|true|false|null|[}\]])(\s*\n\s*)(?="[\w@]+"\s*:)/g, "$1,$2")
    .replace(/,(\s*[}\]])/g, "$1")
    .replace(/[\u0000-\u001f]+/g, " ");
  try { return JSON.parse(repaired); } catch {}
  return null;
}

async function livePrices(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return { status: 404, prices: {} };
      if (!res.ok) throw new Error("HTTP " + res.status);
      const $ = cheerio.load(await res.text());
      const prices = {};
      let own = null;
      $('script[type="application/ld+json"]').each((_, el) => {
        const v = parseLd($(el).html() || "");
        if (!v) return;
        for (const b of Array.isArray(v) ? v : v["@graph"] || [v]) {
          if (b["@type"] === "Product" && b.sku) {
            b.sku = String(b.sku).trim(); // their SKUs sometimes carry a trailing space
            const o = Array.isArray(b.offers) ? b.offers[0] : b.offers;
            const p = Number(o?.price);
            if (p > 0) { prices[b.sku] = p; own = b.sku; }
          }
          if (b["@type"] === "ProductGroup") for (const m of b.hasVariant || []) {
            const p = Number(m.offers?.price);
            const sku = String(m.sku || "").trim();
            if (sku && p > 0 && prices[sku] == null) prices[sku] = p;
          }
        }
      });
      return { status: 200, prices, own };
    } catch (e) {
      if (i === 3) return { status: 0, error: e.message, prices: {} };
      await sleep(1500 * i);
    }
  }
}

(async () => {
  const c = new MongoClient(process.env.MONGODB_URL2);
  await c.connect();
  const col = c.db().collection("products");
  const products = await col.find({ "specs.source": "bb-scrape" }, { projection: { name: 1, price: 1, variants: 1, shopifyProductId: 1 } }).toArray();
  if (FROM_REPORT) {
    const { changes } = JSON.parse(fs.readFileSync(OUT, "utf8"));
    console.log(`applying ${changes.length} price changes from the report`);
    return applyChanges(col, products, changes, c);
  }

  const live = new Map();       // sku -> live price
  const pageState = new Map();  // variant url -> status
  const variantRows = products.flatMap((p) => p.variants.map((v) => ({ p, v })));
  const queue = [...variantRows];
  let fetched = 0;
  async function worker() {
    while (queue.length) {
      const { v } = queue.shift();
      if (live.has(v.sku)) continue;       // priced by a sibling page
      const r = await livePrices(v.sourceUrl);
      fetched++;
      pageState.set(v.sourceUrl, r.status === 200 ? "ok" : r.status === 404 ? "404" : `error ${r.error}`);
      for (const [sku, price] of Object.entries(r.prices)) if (!live.has(sku)) live.set(sku, price);
      if (fetched % 200 === 0) console.log(`${fetched} pages read, ${live.size} SKUs priced`);
      await sleep(250);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const changes = [], unpriced = [];
  let same = 0;
  for (const { p, v } of variantRows) {
    const lp = live.get(v.sku);
    if (!(lp > 0)) { unpriced.push({ product: p.name, sku: v.sku, variant: v.name, page: pageState.get(v.sourceUrl) || "not read", url: v.sourceUrl }); continue; }
    if (Math.abs(lp - v.price) > 0.005) changes.push({ productId: String(p._id), product: p.name, sku: v.sku, variant: v.name, ours: v.price, live: lp });
    else same++;
  }
  const up = changes.filter((x) => x.live > x.ours).length;
  const summary = { variants: variantRows.length, pagesRead: fetched, matchLive: same, differ: changes.length, liveHigher: up, liveLower: changes.length - up, couldNotPrice: unpriced.length };
  fs.writeFileSync(OUT, JSON.stringify({ summary, changes, unpriced }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  for (const x of changes.slice(0, 15)) console.log(`  ${x.sku.padEnd(22)} £${x.ours} → £${x.live}  ${x.product.slice(0, 60)} (${x.variant.slice(0, 30)})`);
  if (!APPLY) { await c.close(); process.exit(0); }

  return applyChanges(col, products, changes, c);
})().catch((e) => { console.error(e); process.exit(1); });

async function applyChanges(col, products, changes, c) {
  // Shopify first, then DB2 — a product is only recorded as changed once Shopify took it
  const byProduct = new Map();
  for (const x of changes) { if (!byProduct.has(x.productId)) byProduct.set(x.productId, []); byProduct.get(x.productId).push(x); }
  let okP = 0, failP = 0;
  for (const p of products) {
    const fix = byProduct.get(String(p._id));
    if (!fix) continue;
    const newPrice = new Map(fix.map((x) => [x.sku, x.live]));
    const variants = p.variants.map((v) => (newPrice.has(v.sku) ? { ...v, price: newPrice.get(v.sku) } : v));
    const minPrice = Math.min(...variants.map((v) => v.price).filter((n) => n > 0));
    try {
      const input = variants.filter((v) => newPrice.has(v.sku) && v.shopifyVariantId).map((v) => ({ id: v.shopifyVariantId, price: v.price.toFixed(2) }));
      if (input.length !== fix.length) throw new Error("some changed variants have no Shopify id");
      const r = await shopifyAdminRequest(
        `mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$pid, variants:$v){ productVariants{ id price } userErrors{ message } } }`,
        { pid: p.shopifyProductId, v: input },
      );
      if (r.productVariantsBulkUpdate.userErrors.length) throw new Error(r.productVariantsBulkUpdate.userErrors.map((e) => e.message).join("; "));
      await col.updateOne({ _id: p._id }, { $set: { variants, price: minPrice, priceSyncedAt: new Date(), updatedAt: new Date() } });
      okP++;
    } catch (e) {
      failP++;
      console.log(`✗ ${p.name} — ${e.message}`);
    }
  }
  console.log(`applied: ${okP} products updated in DB2 + Shopify, ${failP} failed`);
  await c.close();
  process.exit(0);
}
