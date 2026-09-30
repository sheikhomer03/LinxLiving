/**
 * Frontline Bathrooms — verify v3/fl-final.json. No DB writes, no Shopify.
 * Reads local files + the category slugs already in use (from the Better
 * Bathrooms taxonomy dump), GETs/POSTs frontlinebathrooms.co.uk only.
 *
 *  1. structure: price > £0 on every variant, images, existing category,
 *     ≤ 3 options, unique complete combinations, unique SKU catalogue-wide
 *  2. images: every photo URL answers 200 with an image type
 *  3. live re-check: a sample of variants re-read from the site — the page
 *     (or its dropdown option) must still show the same F code and price
 * Writes v3/fl-verify.json.
 *   node .scratch/frontlinebathrooms/v3/fl-verify.cjs [--sample=250]
 */
const fs = require("fs");
const path = require("path");
const V3 = __dirname;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const SAMPLE = Number((process.argv.find((a) => a.startsWith("--sample=")) || "").slice(9)) || 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOG = path.join(V3, "progress.log");
const log = (m) => { const l = `[${new Date().toISOString().slice(11, 19)}] verify: ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

(async () => {
  const products = JSON.parse(fs.readFileSync(path.join(V3, "fl-final.json"), "utf8"));
  const tax = JSON.parse(fs.readFileSync(path.join(V3, "taxonomy.json"), "utf8"));
  const existing = new Set([...tax.usedDB1, ...tax.usedDB2].map((r) => [r._id.d, r._id.c, r._id.s || ""].join(" > ")));
  const problems = [];
  const bad = (p, m) => problems.push({ name: p.name, problem: m });
  const skus = new Map();

  for (const p of products) {
    if (!p.name || /[<>]|&#?\w+;/.test(p.name)) bad(p, "bad name");
    if (!(p.price > 0)) bad(p, "price not > 0");
    if (!p.images.length) bad(p, "no images");
    if (!p.description || p.description.length < 20) bad(p, "no description");
    const cat = [p.department, p.category, p.subCategory || ""].join(" > ");
    if (!p.category) bad(p, "no category"); else if (!existing.has(cat)) bad(p, `category not in use anywhere: ${cat}`);
    if (p.shopifyOptions.length > 3) bad(p, "more than 3 options");
    if (p.variants.length > 250) bad(p, "more than 250 variants");
    if (Math.abs(Math.min(...p.variants.map((v) => v.price)) - p.price) > 0.001) bad(p, "product price is not the cheapest variant");
    const combos = new Set();
    for (const v of p.variants) {
      if (!(v.price > 0)) bad(p, `variant ${v.sku} price not > 0`);
      if (!v.imageUrl) bad(p, `variant ${v.sku} no image`);
      if (!/^F\d{4,}/i.test(v.sku)) bad(p, `variant SKU "${v.sku}" is not an F code`);
      const k = String(v.sku).toUpperCase();
      if (skus.has(k)) bad(p, `SKU ${v.sku} also on ${skus.get(k)}`); else skus.set(k, p.name);
      if (p.shopifyOptions.length) {
        const vals = p.shopifyOptions.map((o) => v.options?.[o.name]);
        if (vals.some((x) => !x)) bad(p, `variant ${v.sku} missing an option value`);
        const c = vals.join("|").toLowerCase();
        if (combos.has(c)) bad(p, `duplicate option combination ${vals.join(" / ")}`);
        combos.add(c);
        if (/ \/ /.test(p.shopifyOptions.map((o) => o.name).join(""))) bad(p, "option name contains ' / ' (Shopify rejects it)");
      }
    }
    if (p.variants.length > 1 && !p.shopifyOptions.length) bad(p, "several variants but no options");
  }
  log(`structure: ${products.length} products / ${products.reduce((a, p) => a + p.variants.length, 0)} variants, ${problems.length} problems`);

  // images
  const urls = [...new Set(products.flatMap((p) => [...p.images, ...p.variants.flatMap((v) => [v.imageUrl, ...(v.images || [])])]).filter(Boolean))];
  const dead = [];
  let n = 0;
  await pool(urls, 12, async (u) => {
    let ok = false, info = "";
    for (let t = 0; t < 3 && !ok; t++) {
      try {
        const r = await fetch(u, { method: "HEAD", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
        ok = r.ok && /^image\//.test(r.headers.get("content-type") || "");
        info = `${r.status} ${r.headers.get("content-type") || ""}`;
        if (r.status === 404) break;
      } catch (e) { info = e.message; await sleep(800); }
    }
    if (!ok) dead.push({ url: u, info });
    if (++n % 1000 === 0) log(`images: ${n}/${urls.length}, ${dead.length} dead`);
  });
  log(`images: ${urls.length} checked, ${dead.length} dead`);

  // live re-check of a sample of variants
  const all = products.flatMap((p) => p.variants.map((v) => ({ p, v })));
  const sample = all.sort(() => Math.random() - 0.5).slice(0, SAMPLE);
  const mismatch = [];
  let m = 0;
  await pool(sample, 5, async ({ p, v }) => {
    const ref = String(v.sku).replace(/-\d+$/, "");
    try {
      const r1 = await fetch(v.sourceUrl, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
      let h = await r1.text();
      const has = (html) => { const t = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); const rm = t.match(/Ref:\s*(F[\w-]+)/); const pm = t.match(/Price:\s*£\s?([\d,]+(?:\.\d+)?)/); return { ref: rm?.[1], price: pm ? Number(pm[1].replace(/,/g, "")) : 0 }; };
      let got = has(h);
      if (got.ref !== ref && v.sourcePageId) {
        const r2 = await fetch(v.sourceUrl, { method: "POST", headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" }, body: `product-select=${v.sourcePageId}`, signal: AbortSignal.timeout(30000) });
        got = has(await r2.text());
      }
      if (got.ref !== ref || Math.abs(got.price - v.price) > 0.005) mismatch.push({ name: p.name, variant: v.name, sku: v.sku, ours: v.price, live: got });
    } catch (e) { mismatch.push({ name: p.name, sku: v.sku, error: e.message }); }
    if (++m % 50 === 0) log(`live re-check: ${m}/${sample.length}, ${mismatch.length} mismatches`);
    await sleep(150);
  });
  log(`live re-check: ${sample.length} variants, ${mismatch.length} mismatches`);

  const result = { products: products.length, variants: all.length, structureProblems: problems.length, imagesChecked: urls.length, deadImages: dead.length, liveChecked: sample.length, liveMismatches: mismatch.length };
  fs.writeFileSync(path.join(V3, "fl-verify.json"), JSON.stringify({ result, problems, dead, mismatch }, null, 1));
  console.log(JSON.stringify(result, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
