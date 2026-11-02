// Walls and Floors (Magento, GraphQL off): out-of-stock sync from product pages.
// Every option is its own page; a page carries JSON-LD availability for its own SKU and a sibling list (sku → url_key).
//   MODE=crawl (read live, resumable → .scratch/wallsandfloors/pages.jsonl) | check (plan, no writes) | apply (backup + write)
// Existing fields only. DB2: variant available (+ stock → 0 where it exists); product stock/isOutOfStock/stockStatus.
// Shopify: qty 0 on tracked variants; FIX_SELLABLE=1 (only when the user asks) also DENY+tracked on sold-out ones.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const ORIGIN = "https://www.wallsandfloors.co.uk";
const DIR = path.join(ROOT, ".scratch/wallsandfloors"); fs.mkdirSync(DIR, { recursive: true });
const PAGES = path.join(DIR, "pages.jsonl");
const MODE = process.env.MODE || "check";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const norm = (u) => String(u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

async function readPage(url) {
  for (let a = 0; a < 5; a++) {
    let r, h;
    try { r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow" }); h = await r.text(); } catch { await sleep(10000 * (a + 1)); continue; }
    if (r.status === 404 || r.status === 410) return { status: r.status, gone: true };
    if (r.status === 429 || r.status >= 500) { await sleep(30000 * (a + 1)); continue; }
    if (/Just a moment|cf-chl|Verifying you are human/i.test(h.slice(0, 20000))) fail("bot check shown — stopping");
    let ldSku = null, ldAvail = null;
    for (const m of h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      try { const j = JSON.parse(m[1]); const list = Array.isArray(j) ? j : j["@graph"] || [j]; const p = list.find((x) => x && x["@type"] === "Product"); if (p) { ldSku = p.sku ? String(p.sku).trim() : null; const o = Array.isArray(p.offers) ? p.offers[0] : p.offers; ldAvail = o && o.availability ? String(o.availability) : null; break; } } catch {}
    }
    if (!ldAvail) { const m = h.match(/"availability"\s*:\s*"([^"]+)"/); if (m) ldAvail = m[1]; }
    // JSON-LD here is not always valid JSON: fall back to the Offer microdata / the LD text for this page's own SKU
    if (!ldSku) { const m = h.match(/itemprop="offers"[^>]*content="([^"]+)"/) || h.match(/<script type="application\/ld\+json"[^>]*>[\s\S]*?"sku"\s*:\s*"([^"]+)"/); if (m) ldSku = m[1].trim(); }
    const siblings = {};
    for (const m of h.matchAll(/\{\\"sku\\":\\"([^\\"]+)\\"[^{}]*?\\"url_key\\":\\"([^\\"]+)\\"/g)) siblings[m[1].trim()] = m[2];
    const inStock = ldAvail ? /InStock|PreOrder|BackOrder|LimitedAvailability/i.test(ldAvail) && !/OutOfStock|Discontinued|SoldOut/i.test(ldAvail) : null;
    return { status: r.status, finalUrl: r.url, redirected: norm(r.url) !== norm(url), ldSku, ldAvail, inStock, siblings };
  }
  return { error: "retries exhausted" };
}

async function crawl(urls, done) {
  const todo = [...new Set(urls)].filter((u) => !done.has(u));
  console.log(`${new Date().toISOString()} pages to read: ${todo.length}`);
  let i = 0, n = 0;
  const worker = async () => { while (i < todo.length) { const u = todo[i++]; const r = await readPage(u); fs.appendFileSync(PAGES, JSON.stringify({ url: u, ...r, at: new Date().toISOString() }) + "\n"); done.add(u); if (++n % 200 === 0) console.log(`${new Date().toISOString()} ${n}/${todo.length}`); await sleep(350); } };
  await Promise.all(Array.from({ length: 4 }, worker));
}
const loadPages = () => new Map((fs.existsSync(PAGES) ? fs.readFileSync(PAGES, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).map((r) => [r.url, r]));

(async () => {
  const c1 = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 60000 }).connect();
  const brand = await c1.db().collection("brands").findOne({ slug: "walls-and-floors" });
  await c1.close();
  const c = await new MongoClient(env.MONGODB_URL2, { maxPoolSize: 2, serverSelectionTimeoutMS: 60000 }).connect();
  const col = c.db().collection("products");
  const ours = await col.find({ brand: brand._id }).project({ name: 1, slug: 1, sourceUrl: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, shopifyVariantId: 1, shopifyProductId: 1,
    "variants.sku": 1, "variants.available": 1, "variants.stock": 1, "variants.shopifyVariantId": 1 }).toArray();

  if (MODE === "crawl") {
    const done = new Set(loadPages().keys());
    await crawl(ours.map((p) => p.sourceUrl).filter(Boolean), done);
    // second pass: each option's own page, via the sibling list
    const pages = loadPages(); const extra = [];
    for (const p of ours) {
      const pg = pages.get(p.sourceUrl); if (!pg || pg.gone || pg.error) continue;
      for (const v of p.variants || []) { const sk = String(v.sku || "").trim(); if (!sk || sk === pg.ldSku) continue; const uk = pg.siblings?.[sk]; if (uk) extra.push(`${ORIGIN}/${uk}`); }
    }
    await crawl(extra, done);
    console.log(`${new Date().toISOString()} CRAWL DONE`);
    await c.close(); return;
  }

  // sku → in stock, from every page read
  const pages = loadPages(); const skuState = new Map();
  for (const r of pages.values()) if (r.ldSku && r.inStock !== null && !r.gone) skuState.set(r.ldSku, r.inStock);
  const plan = [], skipped = [], back = [];
  for (const p of ours) {
    const pg = pages.get(p.sourceUrl);
    if (!pg || pg.error) { skipped.push({ name: p.name, why: pg ? pg.error : "not crawled" }); continue; }
    const vs = p.variants || [];
    let st;
    if (pg.gone) st = vs.length ? vs.map(() => false) : [false];
    else if (!vs.length) st = pg.inStock === null ? null : [pg.inStock];
    else { st = vs.map((v) => { const sk = String(v.sku || "").trim(); return skuState.has(sk) ? skuState.get(sk) : undefined; }); if (st.some((x) => x === undefined)) st = null; }
    if (!st) { skipped.push({ name: p.name, why: vs.length ? "an option's own page could not be read" : "no availability on page", url: p.sourceUrl }); continue; }
    const $set = {}, zero = [];
    vs.forEach((v, k) => {
      if (st[k]) { if (v.available === false) back.push(p.name); return; }
      if (v.available !== false || (v.stock !== undefined && v.stock !== 0)) { $set[`variants.${k}.available`] = false; if (v.stock !== undefined) $set[`variants.${k}.stock`] = 0; }
      if (v.shopifyVariantId) zero.push(v.shopifyVariantId);
    });
    const anyIn = st.some(Boolean);
    if (!anyIn && p.shopifyVariantId && !zero.includes(p.shopifyVariantId)) zero.push(p.shopifyVariantId);
    if (!anyIn && (p.stock !== 0 || p.isOutOfStock !== true || p.stockStatus !== "out_of_stock")) Object.assign($set, { stock: 0, isOutOfStock: true, ...(p.stockStatus !== undefined ? { stockStatus: "out_of_stock" } : {}) });
    else if (anyIn && Object.keys($set).length && vs.length && vs.every((v) => typeof v.stock === "number")) $set.stock = vs.reduce((a, v, k) => a + (st[k] ? v.stock : 0), 0);
    if (!anyIn || st.some((x) => !x)) plan.push({ p, $set, zero, full: !anyIn, gone: !!pg.gone, guard: vs.map((v, k) => [k, v.sku]).filter(([k]) => !st[k]) });
  }

  const sids = [...new Set(plan.flatMap((x) => x.zero))];
  const shop = new Map();
  for (let i = 0; i < sids.length; i += 100) {
    const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked } } } }`, { ids: sids.slice(i, i + 100) });
    for (const n of d.nodes) if (n) shop.set(n.id, n);
  }
  const location = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
  const shopQ = sids.map((id) => shop.get(id)).filter((n) => n && n.inventoryItem.tracked && n.inventoryQuantity !== 0).map((n) => ({ inventoryItemId: n.inventoryItem.id, locationId: location, quantity: 0 }));
  const sellable = sids.map((id) => shop.get(id)).filter((n) => n && (n.inventoryPolicy === "CONTINUE" || !n.inventoryItem.tracked));
  const dbOps = plan.filter((x) => Object.keys(x.$set).length);
  const report = {
    ourProducts: ours.length, pagesRead: pages.size, pageErrors: [...pages.values()].filter((r) => r.error).length,
    gone: plan.filter((x) => x.gone).length, productsFullyOut: plan.filter((x) => x.full).length, productsSomeOptionsOut: plan.filter((x) => !x.full).length,
    variantsOut: plan.reduce((a, x) => a + x.guard.length, 0), dbProductsToUpdate: dbOps.length, shopifyToZero: shopQ.length, soldOutStillSellableInShopify: sellable.length,
    shopifyState: sids.map((id) => shop.get(id)).reduce((a, n) => { const k = n ? `${n.inventoryPolicy}/tracked:${n.inventoryItem.tracked}` : "missing"; a[k] = (a[k] || 0) + 1; return a; }, {}),
    skipped: skipped.length, skippedWhy: skipped.reduce((a, s) => ((a[s.why] = (a[s.why] || 0) + 1), a), {}), backInStock_reportOnly: back.length,
    examples: plan.slice(0, 8).map((x) => `${x.full ? "ALL OUT" : "SOME OUT"}${x.gone ? " (404)" : ""} | ${x.p.name} | https://www.linxsquare.co.uk/products/${x.p.slug} | ${x.p.sourceUrl}`),
  };
  console.log(JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(DIR, "plan.json"), JSON.stringify({ report, skipped, plan: plan.map((x) => ({ name: x.p.name, slug: x.p.slug, url: x.p.sourceUrl, full: x.full, gone: x.gone, out: x.guard.map((g) => g[1]) })) }, null, 1));

  if (MODE === "apply") {
    const bk = path.join(DIR, `oos-backup-${stamp()}.json`);
    fs.writeFileSync(bk, JSON.stringify({ products: plan.map((x) => x.p), shopify: sids.map((id) => shop.get(id)).filter(Boolean) }));
    console.log("backup:", bk);
    for (let i = 0; i < shopQ.length; i += 250) {
      const d = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ message } } }`, { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: shopQ.slice(i, i + 250) } });
      if (d.inventorySetQuantities.userErrors.length) fail("Shopify: " + JSON.stringify(d.inventorySetQuantities.userErrors).slice(0, 300));
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
    const ops = dbOps.map((x) => ({ updateOne: { filter: { _id: x.p._id, brand: brand._id, ...Object.fromEntries(x.guard.map(([k, sku]) => [`variants.${k}.sku`, sku])) }, update: { $set: x.$set } } }));
    let matched = 0;
    for (let i = 0; i < ops.length; i += 200) matched += (await col.bulkWrite(ops.slice(i, i + 200), { ordered: false })).matchedCount;
    console.log(`DB matched ${matched} of ${ops.length}`);
    if (matched !== ops.length) fail("not every product matched");
  }
  await c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
