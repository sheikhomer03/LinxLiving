// Luxury Flooring (Magento): out-of-stock sync from each product page.
//   Options: `"is_saleable":{"<childId>":true|false}` keyed by our variants[].externalId. Single products: JSON-LD availability.
//   MODE=crawl (read live, resumable → .scratch/luxuryflooring/live.jsonl) | check (plan, no writes) | apply (backup + write)
// Existing fields only. DB1: variant available + stock → 0 (where it exists); product stock/isOutOfStock/stockStatus.
// Shopify: qty 0 on tracked variants; FIX_SELLABLE=1 (only when the user asks) also sets DENY+tracked on sold-out ones.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const DIR = path.join(ROOT, ".scratch/luxuryflooring"); fs.mkdirSync(DIR, { recursive: true });
const LIVE = path.join(DIR, "live.jsonl");
const MODE = process.env.MODE || "check";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const norm = (u) => String(u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

async function readPage(url) {
  for (let a = 0; a < 5; a++) {
    let res, h;
    try { res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow" }); h = await res.text(); } catch { await sleep(10000 * (a + 1)); continue; }
    if (res.status === 404 || res.status === 410) return { status: res.status, gone: true };
    if (res.status === 429 || res.status >= 500) { await sleep(30000 * (a + 1)); continue; }
    if (/captcha|Verifying your connection|cf-chl/i.test(h.slice(0, 20000))) fail("bot check shown — stopping");
    const redirected = norm(res.url) !== norm(url);
    let ld = null;
    for (const m of h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      try { const j = JSON.parse(m[1]); const list = Array.isArray(j) ? j : j["@graph"] || [j]; const p = list.find((x) => x && x["@type"] === "Product"); if (p) { const o = Array.isArray(p.offers) ? p.offers[0] : p.offers; ld = String((o && o.availability) || ""); break; } } catch {}
    }
    if (!ld) { const m = h.match(/itemprop="availability"\s+content="([^"]+)"/); if (m) ld = m[1]; }
    const sm = h.match(/"is_saleable":(\{[^}]*\})/);
    let saleable = null; if (sm) { try { saleable = JSON.parse(sm[1]); } catch {} }
    const isProduct = !!ld || !!saleable;
    return { status: res.status, finalUrl: res.url, redirected, isProduct, ld, saleable };
  }
  return { error: "retries exhausted" };
}

(async () => {
  const c = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }).connect();
  const col = c.db().collection("products");
  const brand = await c.db().collection("brands").findOne({ slug: "luxury-flooring" });
  const ours = await col.find({ brand: brand._id }).project({ name: 1, slug: 1, sourceUrl: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, shopifyVariantId: 1, shopifyProductId: 1,
    "variants.externalId": 1, "variants.sku": 1, "variants.available": 1, "variants.stock": 1, "variants.shopifyVariantId": 1 }).toArray();

  if (MODE === "crawl") {
    const done = new Set(fs.existsSync(LIVE) ? fs.readFileSync(LIVE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).url) : []);
    const urls = [...new Set(ours.map((p) => p.sourceUrl).filter(Boolean))].filter((u) => !done.has(u));
    console.log(`${new Date().toISOString()} pages to read: ${urls.length} (already ${done.size})`);
    let i = 0, n = 0;
    const worker = async () => { while (i < urls.length) { const u = urls[i++]; const r = await readPage(u); fs.appendFileSync(LIVE, JSON.stringify({ url: u, ...r, at: new Date().toISOString() }) + "\n"); if (++n % 100 === 0) console.log(`${new Date().toISOString()} ${n}/${urls.length}`); await sleep(400); } };
    await Promise.all(Array.from({ length: 4 }, worker));
    console.log(`${new Date().toISOString()} CRAWL DONE ${n}`);
    await c.close(); return;
  }

  const live = new Map(fs.readFileSync(LIVE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.url, r]));
  const plan = [], skipped = [], back = [];
  for (const p of ours) {
    const r = live.get(p.sourceUrl);
    if (!r) { skipped.push({ name: p.name, why: "not crawled" }); continue; }
    if (r.error) { skipped.push({ name: p.name, why: r.error }); continue; }
    // Redirected to a non-product page (category/home) = discontinued; redirected to another product = unclear → skip.
    const gone = r.gone || (r.redirected && !r.isProduct);
    if (r.redirected && r.isProduct) { skipped.push({ name: p.name, why: `redirects to another product: ${r.finalUrl}` }); continue; }
    if (!gone && !r.isProduct) { skipped.push({ name: p.name, why: "no stock data on page" }); continue; }
    const vs = p.variants || [];
    const inStockLd = r.ld ? /InStock|PreOrder|BackOrder|LimitedAvailability/i.test(r.ld) && !/OutOfStock|Discontinued|SoldOut/i.test(r.ld) : null;
    let st;
    if (gone) st = vs.length ? vs.map(() => false) : [false];
    else if (vs.length && r.saleable) { st = vs.map((v) => (String(v.externalId) in r.saleable ? r.saleable[String(v.externalId)] === true : undefined)); if (st.some((x) => x === undefined)) st = null; }
    // whole product sold out on live (no option data) → every option out; otherwise a single option follows the page
    else if (vs.length && !r.saleable) st = inStockLd === false ? vs.map(() => false) : vs.length === 1 && inStockLd !== null ? [inStockLd] : null;
    else st = inStockLd === null ? null : [inStockLd];
    if (!st) { skipped.push({ name: p.name, why: "option ids not on its live page" }); continue; }
    const $set = {}, zero = [];
    vs.forEach((v, k) => {
      if (st[k]) { if (v.available === false) back.push(`${p.name} | ${v.sku}`); return; }
      if (v.available !== false || (v.stock !== undefined && v.stock !== 0)) { $set[`variants.${k}.available`] = false; if (v.stock !== undefined) $set[`variants.${k}.stock`] = 0; }
      if (v.shopifyVariantId) zero.push(v.shopifyVariantId);
    });
    const anyIn = st.some(Boolean);
    if (!anyIn && p.shopifyVariantId && !zero.includes(p.shopifyVariantId)) zero.push(p.shopifyVariantId);
    if (!anyIn && (p.stock !== 0 || p.isOutOfStock !== true || p.stockStatus !== "out_of_stock")) Object.assign($set, { stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" });
    else if (anyIn && Object.keys($set).length && vs.length && vs.every((v) => typeof v.stock === "number")) $set.stock = vs.reduce((a, v, k) => a + (st[k] ? v.stock : 0), 0);
    if (!anyIn || st.some((x) => !x)) plan.push({ p, $set, zero, full: !anyIn, gone, guard: vs.map((v, k) => [k, v.externalId]).filter(([k]) => !st[k]) });
  }

  const sids = [...new Set(plan.flatMap((x) => x.zero))];
  const shop = new Map();
  for (let i = 0; i < sids.length; i += 100) {
    const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked } } } }`, { ids: sids.slice(i, i + 100) });
    for (const n of d.nodes) if (n) shop.set(n.id, n);
    await sleep(150);
  }
  const location = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
  const shopQ = sids.map((id) => shop.get(id)).filter((n) => n && n.inventoryItem.tracked && n.inventoryQuantity !== 0).map((n) => ({ inventoryItemId: n.inventoryItem.id, locationId: location, quantity: 0 }));
  const sellable = sids.map((id) => shop.get(id)).filter((n) => n && (n.inventoryPolicy === "CONTINUE" || !n.inventoryItem.tracked));
  const dbOps = plan.filter((x) => Object.keys(x.$set).length);
  const report = {
    ourProducts: ours.length, pagesRead: live.size, gone: plan.filter((x) => x.gone).length, productsFullyOut: plan.filter((x) => x.full).length,
    productsSomeOptionsOut: plan.filter((x) => !x.full).length, variantsOut: plan.reduce((a, x) => a + x.guard.length, 0),
    dbProductsToUpdate: dbOps.length, shopifyToZero: shopQ.length, soldOutStillSellableInShopify: sellable.length,
    skipped: skipped.length, skippedReasons: skipped.reduce((a, s) => { const k = s.why.split(":")[0]; a[k] = (a[k] || 0) + 1; return a; }, {}), backInStock_reportOnly: back.length,
    examples: plan.slice(0, 8).map((x) => `${x.full ? "ALL OUT" : "SOME OUT"}${x.gone ? " (gone)" : ""} | ${x.p.name} | https://www.linxsquare.co.uk/products/${x.p.slug} | ${x.p.sourceUrl}`),
  };
  console.log(JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(DIR, `oos-check-${stamp()}.json`), JSON.stringify({ report, skipped, plan: plan.map((x) => ({ name: x.p.name, slug: x.p.slug, url: x.p.sourceUrl, full: x.full, gone: x.gone, out: x.guard.map((g) => g[1]) })) }, null, 1));

  if (MODE === "apply") {
    const bk = path.join(DIR, `oos-backup-${stamp()}.json`);
    fs.writeFileSync(bk, JSON.stringify({ products: plan.map((x) => x.p), shopify: sids.map((id) => shop.get(id)).filter(Boolean) }));
    console.log("backup:", bk);
    for (let i = 0; i < shopQ.length; i += 250) {
      const d = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`,
        { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: shopQ.slice(i, i + 250) } });
      if (d.inventorySetQuantities.userErrors.length) fail("Shopify: " + JSON.stringify(d.inventorySetQuantities.userErrors).slice(0, 300));
      await sleep(300);
    }
    console.log("Shopify set to 0:", shopQ.length);
    if (process.env.FIX_SELLABLE === "1" && sellable.length) {
      const pidOf = new Map(); plan.forEach((x) => x.zero.forEach((id) => pidOf.set(id, x.p.shopifyProductId)));
      const byP = new Map(); for (const n of sellable) { const pid = pidOf.get(n.id); if (pid) (byP.get(pid) || byP.set(pid, []).get(pid)).push(n); }
      let fixed = 0;
      for (const [pid, ns] of byP) {
        const d = await gql(`mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$pid, variants:$v){ userErrors{ message } } }`, { pid, v: ns.map((n) => ({ id: n.id, inventoryPolicy: "DENY", inventoryItem: { tracked: true } })) });
        if (d.productVariantsBulkUpdate.userErrors.length) continue;
        const q = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ message } } }`, { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: ns.map((n) => ({ inventoryItemId: n.inventoryItem.id, locationId: location, quantity: 0 })) } });
        if (!q.inventorySetQuantities.userErrors.length) fixed += ns.length;
        await sleep(200);
      }
      console.log(`Shopify sold-out variants made unsellable: ${fixed} of ${sellable.length}`);
    }
    const ops = dbOps.map((x) => ({ updateOne: { filter: { _id: x.p._id, brand: brand._id, ...Object.fromEntries(x.guard.map(([k, id]) => [`variants.${k}.externalId`, id])) }, update: { $set: x.$set } } }));
    let matched = 0;
    for (let i = 0; i < ops.length; i += 200) matched += (await col.bulkWrite(ops.slice(i, i + 200), { ordered: false })).matchedCount;
    console.log(`DB matched ${matched} of ${ops.length}`);
    if (matched !== ops.length) fail("not every product matched");
  }
  await c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
