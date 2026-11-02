// Tiles Porcelain (Magento): out-of-stock sync from the store's GraphQL (stock_status per product and per configurable option).
//   MODE=check (default, read-only) | apply (backup + write; re-run check = verify)
// Products missing from GraphQL: page checked one by one (404 → gone; otherwise JSON-LD availability).
// Existing fields only. DB2: variant available (+ stock → 0 where it exists); product stock/isOutOfStock/stockStatus.
// Shopify: qty 0 on tracked variants; FIX_SELLABLE=1 (only when the user asks) also DENY+tracked on sold-out ones.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const ORIGIN = "https://tilesporcelain.co.uk";
const DIR = path.join(ROOT, ".scratch/tilesporcelain"); fs.mkdirSync(DIR, { recursive: true });
const MODE = process.env.MODE || "check";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const keyOf = (u) => String(u || "").replace(/^https?:\/\/[^/]+\//, "").replace(/[?#].*$/, "").replace(/\.html$/, "").replace(/\/+$/, "").toLowerCase();

async function mgq(q) {
  for (let a = 0; a < 5; a++) {
    const r = await fetch(`${ORIGIN}/graphql?query=${encodeURIComponent(q)}`, { headers: { "user-agent": UA, accept: "application/json" } });
    if (r.status === 429 || r.status >= 500) { await sleep(15000 * (a + 1)); continue; }
    const j = await r.json(); if (j.errors) fail("GraphQL: " + JSON.stringify(j.errors).slice(0, 200)); return j.data;
  }
  fail("GraphQL kept failing");
}

(async () => {
  // 1) live catalogue
  const live = new Map(); let total = 0;
  for (let page = 1; page < 50; page++) {
    const d = await mgq(`{ products(search:"", pageSize:100, currentPage:${page}){ total_count items{ sku url_key stock_status __typename } } }`);
    total = d.products.total_count; const items = d.products.items;
    for (const it of items) live.set(String(it.url_key).toLowerCase(), { inStock: it.stock_status === "IN_STOCK", bySku: {}, sku: it.sku, type: it.__typename });
    if (items.length < 100) break;
    await sleep(900);
  }
  if (live.size < total * 0.95) fail(`read ${live.size} of ${total}`);

  // 2) ours
  const c1 = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 60000 }).connect();
  const brand = await c1.db().collection("brands").findOne({ slug: "tiles-porcelain" });
  await c1.close();
  const c = await new MongoClient(env.MONGODB_URL2, { maxPoolSize: 2, serverSelectionTimeoutMS: 60000 }).connect();
  const col = c.db().collection("products");
  const ours = await col.find({ brand: brand._id }).project({ name: 1, slug: 1, sourceUrl: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, shopifyVariantId: 1, shopifyProductId: 1,
    "variants.sku": 1, "variants.available": 1, "variants.stock": 1, "variants.shopifyVariantId": 1 }).toArray();

  // 2b) options: look up every one of our option SKUs directly (their child products are queryable by SKU)
  let optErr = 0; const skuState = new Map();
  const allSkus = [...new Set(ours.flatMap((p) => (p.variants || []).map((v) => String(v.sku || "").trim())).filter(Boolean))];
  for (let i = 0; i < allSkus.length; i += 40) {
    const batch = allSkus.slice(i, i + 40);
    try {
      const r = await fetch(`${ORIGIN}/graphql?query=${encodeURIComponent(`{ products(filter:{sku:{in:${JSON.stringify(batch)}}}, pageSize:100){ items{ sku stock_status } } }`)}`, { headers: { "user-agent": UA, accept: "application/json" } });
      const j = await r.json(); for (const it of j.data?.products?.items || []) skuState.set(String(it.sku).trim(), it.stock_status === "IN_STOCK");
      if (!j.data) optErr++;
    } catch { optErr++; }
    await sleep(700);
  }

  // 3) products missing from GraphQL: check their page
  const missing = [...new Set(ours.map((p) => keyOf(p.sourceUrl)).filter((k) => k && !live.has(k)))];
  const pageState = new Map();
  for (const k of missing) {
    const r = await fetch(`${ORIGIN}/${k}`, { headers: { "user-agent": UA }, redirect: "follow" });
    const h = await r.text();
    if (r.status === 404 || r.status === 410) pageState.set(k, { gone: true });
    else { const ld = (h.match(/"availability"\s*:\s*"([^"]+)"/) || [])[1] || ""; pageState.set(k, ld ? { inStock: /InStock/i.test(ld) && !/OutOfStock/i.test(ld) } : { unknown: true }); }
    await sleep(800);
  }

  // 4) plan
  const plan = [], skipped = [], back = [];
  for (const p of ours) {
    const k = keyOf(p.sourceUrl), l = live.get(k), ps = pageState.get(k);
    const vs = p.variants || [];
    let st;
    if (!k || ps?.unknown) { skipped.push({ name: p.name, why: "no reliable live state" }); continue; }
    if (ps?.gone) st = vs.length ? vs.map(() => false) : [false];
    else if (ps) st = vs.length ? (ps.inStock ? null : vs.map(() => false)) : [ps.inStock];
    else if (!vs.length) st = [l.inStock];
    else { st = vs.map((v) => { const sk = String(v.sku || "").trim(); return skuState.has(sk) ? skuState.get(sk) : sk === l.sku ? l.inStock : undefined; }); if (st.some((x) => x === undefined)) st = l.inStock ? null : vs.map(() => false); }
    if (!st) { skipped.push({ name: p.name, why: "option SKUs not on the live product", url: p.sourceUrl, skus: vs.map((v) => v.sku), missing: vs.map((v) => String(v.sku || "").trim()).filter((sk) => !skuState.has(sk)) }); continue; }
    const $set = {}, zero = [];
    vs.forEach((v, kk) => {
      if (st[kk]) { if (v.available === false) back.push(p.name); return; }
      if (v.available !== false || (v.stock !== undefined && v.stock !== 0)) { $set[`variants.${kk}.available`] = false; if (v.stock !== undefined) $set[`variants.${kk}.stock`] = 0; }
      if (v.shopifyVariantId) zero.push(v.shopifyVariantId);
    });
    const anyIn = st.some(Boolean);
    if (!anyIn && p.shopifyVariantId && !zero.includes(p.shopifyVariantId)) zero.push(p.shopifyVariantId);
    if (!anyIn && (p.stock !== 0 || p.isOutOfStock !== true || p.stockStatus !== "out_of_stock")) Object.assign($set, { stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" });
    else if (anyIn && Object.keys($set).length && vs.length && vs.every((v) => typeof v.stock === "number")) $set.stock = vs.reduce((a, v, kk) => a + (st[kk] ? v.stock : 0), 0);
    if (!anyIn || st.some((x) => !x)) plan.push({ p, $set, zero, full: !anyIn, gone: !!ps?.gone, guard: vs.map((v, kk) => [kk, v.sku]).filter(([kk]) => !st[kk]) });
  }

  // 5) Shopify state
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
    liveProducts: live.size, liveTotal: total, optionReadErrors: optErr, optionSkusFound: skuState.size, optionSkusAsked: allSkus.length, ourProducts: ours.length, missingFromGraphql: missing.length,
    missingPages: [...pageState.values()].reduce((a, s) => { const kk = s.gone ? "gone" : s.unknown ? "unknown" : s.inStock ? "in" : "out"; a[kk] = (a[kk] || 0) + 1; return a; }, {}),
    productsFullyOut: plan.filter((x) => x.full).length, productsSomeOptionsOut: plan.filter((x) => !x.full).length,
    dbProductsToUpdate: dbOps.length, shopifyToZero: shopQ.length, soldOutStillSellableInShopify: sellable.length,
    shopifyState: sids.map((id) => shop.get(id)).reduce((a, n) => { const kk = n ? `${n.inventoryPolicy}/tracked:${n.inventoryItem.tracked}` : "missing"; a[kk] = (a[kk] || 0) + 1; return a; }, {}),
    skipped: skipped.length, skippedWhy: skipped.reduce((a, s) => ((a[s.why] = (a[s.why] || 0) + 1), a), {}), backInStock_reportOnly: back.length,
    examples: plan.slice(0, 6).map((x) => `${x.full ? "ALL OUT" : "SOME OUT"}${x.gone ? " (gone)" : ""} | ${x.p.name} | https://www.linxsquare.co.uk/products/${x.p.slug} | ${x.p.sourceUrl}`),
  };
  console.log(JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(DIR, "skipped.json"), JSON.stringify(skipped, null, 1));

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
    const ops = dbOps.map((x) => ({ updateOne: { filter: { _id: x.p._id, brand: brand._id, ...Object.fromEntries(x.guard.map(([kk, sku]) => [`variants.${kk}.sku`, sku])) }, update: { $set: x.$set } } }));
    let matched = 0;
    for (let i = 0; i < ops.length; i += 200) matched += (await col.bulkWrite(ops.slice(i, i + 200), { ordered: false })).matchedCount;
    console.log(`DB matched ${matched} of ${ops.length}`);
    if (matched !== ops.length) fail("not every product matched");
  }
  await c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
