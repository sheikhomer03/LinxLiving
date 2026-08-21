/**
 * Compare every stored UFHS price against the live PDP: the product price,
 * each variant, and the configurator add-ons (option choices, Do the Job Right
 * tools, coverage rows).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-ufhs-prices.cjs
 *   SAMPLE=100   — products to check (0 = all)
 *   FIX=1        — write corrected prices back
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://www.theunderfloorheatingstore.com";
const SAMPLE = Number(process.env.SAMPLE ?? 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const GAP = Number(process.env.REQUEST_GAP_MS || 250);
const FIX = process.env.FIX === "1";
const REPORT = path.join(__dirname, "_tmp-ufhs-price-report.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LinxUfhsPriceAudit/1.0";

const near = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;
const money = (n) => Math.round(Number(n) * 100) / 100;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX_RETRIES = Number(process.env.MAX_RETRIES || 6);

async function get(url, json = false) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          ...(json ? { Accept: "application/json" } : {}),
        },
      });
      // The store rate-limits hard; back off rather than dropping the product.
      if (res.status === 429 || res.status === 503) {
        await delay(1500 * attempt * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return json ? res.json() : res.text();
    } catch (e) {
      lastErr = e;
      if (/HTTP 404/.test(String(e.message))) throw e;
      if (attempt >= MAX_RETRIES) break;
      await delay(800 * attempt * attempt);
    }
  }
  throw lastErr || new Error(`failed ${url}`);
}

/** Same brace-matched extraction the scraper uses for GPOConfigs.options[]. */
function extractGpoOptionsMap(html) {
  const map = {};
  const re = /GPOConfigs\.options\[(\d+)\]\s*=\s*/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    const start = m.index + m[0].length;
    if (html[start] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = start; j < html.length; j++) {
      const ch = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            map[id] = JSON.parse(html.slice(start, j + 1));
          } catch {
            /* skip */
          }
          break;
        }
      }
    }
  }
  return map;
}

/**
 * "<elementId>::<value>" → price. Keying by element matters: the same label
 * ("Yes", "Tileable") appears in several elements at different prices.
 */
function liveAddonPrices(map, setIds) {
  const prices = new Map();
  const walk = (els) => {
    for (const el of els || []) {
      const elId = String(el.id || "");
      for (const v of el.option_values || []) {
        const label = String(v.value_en ?? v.value ?? "").trim();
        const raw = Number(v.variant_price ?? v.price ?? 0) || 0;
        if (label) prices.set(`${elId}::${label.toLowerCase()}`, money(raw));
      }
      if (el.elements) walk(el.elements);
    }
  };
  for (const id of setIds) walk(map[id]?.elements);
  return prices;
}

async function mapPool(items, n, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length || 1) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx], idx);
      }
    }),
  );
}

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db
    .collection("brands")
    .findOne({ slug: "the-under-floor-heating" });
  let products = await db
    .collection("products")
    .find({ brand: brand._id })
    .project({
      name: 1,
      price: 1,
      variants: 1,
      optionElements: 1,
      doTheJobRight: 1,
      coverage: 1,
      specs: 1,
    })
    .toArray();
  // Check the configurable products first — they carry the add-on prices.
  products.sort(
    (a, b) => (b.optionElements || []).length - (a.optionElements || []).length,
  );
  const SKIP = Number(process.env.SKIP || 0);
  if (SKIP > 0) products = products.slice(SKIP);
  if (SAMPLE > 0) products = products.slice(0, SAMPLE);
  await mongoose.disconnect();
  console.log(`Auditing prices for ${products.length} products…`);

  const productGaps = [];
  const variantGaps = [];
  const addonGaps = [];
  const fixes = [];
  let checkedVariants = 0;
  let checkedAddons = 0;
  let fail = 0;

  await mapPool(products, CONCURRENCY, async (p) => {
    const handle = String(p.specs?.ufhsHandle || "");
    if (!handle) return;
    try {
      const js = await get(`${BASE}/products/${handle}.js`, true);
      await delay(GAP);

      // Product price = first available variant, as the scraper stores it.
      const liveVariants = js.variants || [];
      const livePrice =
        money(
          (liveVariants.find((v) => v.available !== false)?.price ??
            liveVariants[0]?.price ??
            0) / 100,
        ) || 0;
      if (livePrice > 0 && !near(p.price, livePrice)) {
        productGaps.push({ handle, name: p.name, mine: p.price, live: livePrice });
        fixes.push({ handle, set: { price: livePrice } });
      }

      // Variants, matched on the supplier's own variant id.
      const liveById = new Map(liveVariants.map((v) => [String(v.id), v]));
      const nextVariants = [];
      let variantChanged = false;
      for (const v of p.variants || []) {
        const l = liveById.get(String(v.externalId || ""));
        if (!l) {
          nextVariants.push(v);
          continue;
        }
        checkedVariants++;
        const lp = money(Number(l.price) / 100);
        const lc =
          Number(l.compare_at_price) > 0 ? money(Number(l.compare_at_price) / 100) : null;
        if (!near(v.price, lp) || (lc != null && !near(v.compareAtPrice, lc))) {
          variantGaps.push({
            handle,
            variant: v.name,
            mine: v.price,
            live: lp,
          });
          variantChanged = true;
          nextVariants.push({ ...v, price: lp, compareAtPrice: lc ?? v.compareAtPrice });
        } else {
          nextVariants.push(v);
        }
      }
      if (variantChanged) {
        fixes.push({ handle, set: { variants: nextVariants } });
      }

      // Configurator add-on prices, against the live option sets.
      const setIds = (p.specs?.gpoSetIds || []).map(String);
      if (setIds.length && (p.optionElements || []).length) {
        const html = await get(`${BASE}/products/${handle}`);
        await delay(GAP);
        const live = liveAddonPrices(extractGpoOptionsMap(html), setIds);
        const nextElements = (p.optionElements || []).map((el) => ({
          ...el,
          choices: (el.choices || []).map((c) => {
            const lp = live.get(
              `${el.id}::${String(c.value || "").toLowerCase()}`,
            );
            if (lp == null) return c;
            checkedAddons++;
            if (near(c.priceAdjustment, lp)) return c;
            addonGaps.push({
              handle,
              element: el.label || el.id,
              choice: c.value,
              mine: c.priceAdjustment,
              live: lp,
            });
            return { ...c, priceAdjustment: lp };
          }),
        }));
        if (addonGaps.some((g) => g.handle === handle)) {
          fixes.push({ handle, set: { optionElements: nextElements } });
        }
      }
    } catch (e) {
      fail++;
    }
  });

  console.log(`\nPRODUCT PRICES : ${products.length} checked, ${productGaps.length} differ`);
  for (const g of productGaps.slice(0, 10)) {
    console.log(`  ${g.name.slice(0, 46).padEnd(46)} mine £${g.mine} live £${g.live}`);
  }
  console.log(`VARIANT PRICES : ${checkedVariants} checked, ${variantGaps.length} differ`);
  for (const g of variantGaps.slice(0, 10)) {
    console.log(`  ${g.handle.slice(0, 34).padEnd(34)} ${String(g.variant).slice(0, 22).padEnd(22)} mine £${g.mine} live £${g.live}`);
  }
  console.log(`ADD-ON PRICES  : ${checkedAddons} checked, ${addonGaps.length} differ`);
  for (const g of addonGaps.slice(0, 10)) {
    console.log(`  ${String(g.choice).slice(0, 40).padEnd(40)} mine £${g.mine} live £${g.live}`);
  }
  console.log(`unreachable products: ${fail}`);

  fs.writeFileSync(
    REPORT,
    JSON.stringify(
      { at: new Date().toISOString(), productGaps, variantGaps, addonGaps, fail },
      null,
      2,
    ),
  );
  console.log(`report: ${REPORT}`);

  if (FIX && fixes.length) {
    await connectMongo(process.env.MONGODB_URI);
    const P = mongoose.connection.db.collection("products");
    for (const f of fixes) {
      await P.updateOne(
        { brand: brand._id, "specs.ufhsHandle": f.handle },
        { $set: { ...f.set, updatedAt: new Date() } },
      );
    }
    console.log(`FIX applied to ${fixes.length} documents`);
    await mongoose.disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
