// Drench: out-of-stock sync from each parent product page's `uniqueProductStockInfo` list (every option's InStock).
//   MODE=crawl  read live pages (resumable, results → .scratch/drench/live-stock.jsonl); read-only toward DB/Shopify
//   MODE=check  plan from the crawl (no writes)    MODE=apply  backup + write    (re-run check = verify)
// Out of stock = InStock false, or page 404/410. "Estimated delivery…" with InStock true stays in stock.
// Existing fields only. DB2: variant available (+ stock → 0 where it exists); product stock/isOutOfStock/stockStatus.
// Shopify: qty 0 on tracked variants. In-stock items untouched. Products with any unmatched SKU are skipped.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const DIR = path.join(ROOT, ".scratch/drench"); fs.mkdirSync(DIR, { recursive: true });
const LIVE = path.join(DIR, "live-stock.jsonl");
const MODE = process.env.MODE || "check";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };

async function loadOurs() {
  const c1 = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }).connect();
  const brand = await c1.db().collection("brands").findOne({ slug: "drench" });
  const strays = await c1.db().collection("products").countDocuments({ brand: brand._id });
  await c1.close();
  const c = await new MongoClient(env.MONGODB_URL2, { maxPoolSize: 2 }).connect();
  const col = c.db().collection("products");
  const ours = await col.find({ brand: brand._id }).project({ name: 1, slug: 1, sku: 1, sourceUrl: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, shopifyVariantId: 1, shopifyProductId: 1,
    "variants.sku": 1, "variants.available": 1, "variants.stock": 1, "variants.shopifyVariantId": 1 }).toArray();
  return { c, col, brand, ours, strays };
}

// Stream a page and stop as soon as the stock list has been read.
async function readStock(url) {
  for (let a = 0; a < 5; a++) {
    let res;
    try { res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow" }); } catch { await sleep(10000 * (a + 1)); continue; }
    if (res.status === 404 || res.status === 410) { res.body?.cancel?.(); return { status: res.status, gone: true }; }
    if (res.status === 429 || res.status >= 500) { res.body?.cancel?.(); await sleep(30000 * (a + 1)); continue; }
    if (!res.ok) { res.body?.cancel?.(); return { status: res.status, error: `HTTP ${res.status}` }; }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "", full = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      if (/Are you human|Verifying your connection|captcha/i.test(buf.slice(0, 5000))) { reader.cancel(); fail("bot check shown — stopping"); }
      const i = buf.indexOf("uniqueProductStockInfo");
      if (i >= 0) { const j = buf.indexOf("];", i); if (j > 0) { reader.cancel(); full = buf; buf = buf.slice(buf.indexOf("[", i), j + 1); break; } }
    }
    if (!full) full = buf;
    // Single products have no option list: fall back to the page's own JSON-LD Product availability.
    const ldAvail = (() => {
      for (const m of full.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
        try { const j = JSON.parse(m[1]); if (j["@type"] === "Product") return String((j.offers && j.offers.availability) || ""); } catch {}
      }
      return null;
    })();
    if (!buf.startsWith("[")) {
      if (ldAvail) return { status: res.status, finalUrl: res.url, single: true, inStock: /InStock|PreOrder|BackOrder/i.test(ldAvail) && !/OutOfStock|Discontinued|SoldOut/i.test(ldAvail), ld: ldAvail };
      return { status: res.status, finalUrl: res.url, error: "no stock list on page" };
    }
    try {
      const list = JSON.parse(buf).map((x) => ({ sku: String(x.Sku || "").trim(), inStock: x.InStock === true, avail: x.AvailableStock, text: x.Stock }));
      return { status: res.status, finalUrl: res.url, list, ld: ldAvail };
    } catch { return { status: res.status, error: "unparsable stock list" }; }
  }
  return { error: "retries exhausted" };
}

(async () => {
  const { c, col, brand, ours, strays } = await loadOurs();

  if (MODE === "crawl") {
    const done = new Set(fs.existsSync(LIVE) ? fs.readFileSync(LIVE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).url) : []);
    const urls = [...new Set(ours.map((p) => p.sourceUrl).filter(Boolean))].filter((u) => !done.has(u));
    console.log(`${new Date().toISOString()} pages to read: ${urls.length} (already ${done.size})`);
    let i = 0, n = 0;
    const worker = async () => { while (i < urls.length) { const u = urls[i++]; const r = await readStock(u); fs.appendFileSync(LIVE, JSON.stringify({ url: u, ...r, at: new Date().toISOString() }) + "\n"); n++; if (n % 250 === 0) console.log(`${new Date().toISOString()} ${n}/${urls.length}`); await sleep(Number(process.env.PACE_MS) || 400); } };
    await Promise.all(Array.from({ length: Math.min(Number(process.env.CONCURRENCY) || 3, 6) }, worker));
    console.log(`${new Date().toISOString()} CRAWL DONE ${n}`);
    await c.close(); return;
  }

  const live = new Map(fs.readFileSync(LIVE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.url, r]));
  const plan = [], skipped = [], back = [];
  let errors = 0;
  for (const p of ours) {
    const r = p.sourceUrl ? live.get(p.sourceUrl) : null;
    if (!r) { skipped.push({ name: p.name, why: p.sourceUrl ? "not crawled" : "no source url" }); continue; }
    if (r.error) { errors++; skipped.push({ name: p.name, why: r.error }); continue; }
    const m = r.gone || r.single ? null : new Map(r.list.map((x) => [x.sku, x.inStock]));
    const vs = p.variants || [];
    let st;
    if (!vs.length) {
      // single product: its own entry (sku), or the page's only entry
      const own = r.single ? r.inStock : (p.sku && m?.get(String(p.sku).trim())) ?? (r.list && r.list.length === 1 ? r.list[0].inStock : undefined);
      st = r.gone ? [false] : own === undefined ? null : [own];
    } else {
      st = vs.map((v) => (r.gone ? false : r.single ? undefined : m.get(String(v.sku || "").trim())));
      if (st.some((x) => x === undefined)) st = null;
    }
    if (!st) { skipped.push({ name: p.name, why: "SKU not on its live page" }); continue; }
    const $set = {}, zero = [];
    if (vs.length) {
      vs.forEach((v, k) => {
        if (st[k]) { if (v.available === false) back.push(`${p.name} | ${v.sku}`); return; }
        if (v.available !== false || (v.stock !== undefined && v.stock !== 0)) { $set[`variants.${k}.available`] = false; if (v.stock !== undefined) $set[`variants.${k}.stock`] = 0; }
        if (v.shopifyVariantId) zero.push(v.shopifyVariantId);
      });
    } else if (!st[0] && p.shopifyVariantId) zero.push(p.shopifyVariantId);
    const anyIn = st.some(Boolean);
    // fully sold out: the product-level Shopify variant too (some products keep their only Shopify id there)
    if (!anyIn && p.shopifyVariantId && !zero.includes(p.shopifyVariantId)) zero.push(p.shopifyVariantId);
    if (!anyIn && (p.stock !== 0 || p.isOutOfStock !== true || p.stockStatus !== "out_of_stock")) Object.assign($set, { stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" });
    else if (anyIn && Object.keys($set).length && vs.every((v) => typeof v.stock === "number")) $set.stock = vs.reduce((a, v, k) => a + (st[k] ? v.stock : 0), 0);
    if (!anyIn || st.some((x) => !x)) plan.push({ p, $set, zero, full: !anyIn, gone: !!r.gone, guard: vs.map((v, k) => [k, v.sku]).filter(([k]) => !st[k]) });
  }

  const sids = plan.flatMap((x) => x.zero);
  const shop = new Map();
  for (let i = 0; i < sids.length; i += 100) {
    const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked } } } }`, { ids: sids.slice(i, i + 100) });
    for (const n of d.nodes) if (n) shop.set(n.id, n);
    await sleep(150);
  }
  const location = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
  const shopQ = sids.map((id) => shop.get(id)).filter((n) => n && n.inventoryItem.tracked && n.inventoryQuantity !== 0).map((n) => ({ inventoryItemId: n.inventoryItem.id, locationId: location, quantity: 0 }));
  const dbOps = plan.filter((x) => Object.keys(x.$set).length);
  const report = {
    ourProducts: ours.length, straysInDB1_reportOnly: strays, pagesCrawled: live.size, pageErrors: errors,
    gone404: plan.filter((x) => x.gone).length, productsFullyOut: plan.filter((x) => x.full).length, productsSomeOptionsOut: plan.filter((x) => !x.full).length,
    variantsOut: plan.reduce((a, x) => a + x.guard.length, 0), dbProductsToUpdate: dbOps.length, shopifyToZero: shopQ.length,
    soldOutStillSellableInShopify: sids.map((id) => shop.get(id)).filter((n) => n && (n.inventoryPolicy === "CONTINUE" || !n.inventoryItem.tracked)).length,
    shopifyStateOfSoldOut: sids.map((id) => shop.get(id)).reduce((a, n) => { const k = n ? `${n.inventoryPolicy}/tracked:${n.inventoryItem.tracked}/qty:${n.inventoryQuantity <= 0 ? '<=0' : '>0'}` : 'missing'; a[k] = (a[k] || 0) + 1; return a; }, {}),
    skipped: skipped.length, skippedReasons: skipped.reduce((a, s) => ((a[s.why] = (a[s.why] || 0) + 1), a), {}), backInStock_reportOnly: back.length,
    examples: plan.slice(0, 6).map((x) => `${x.full ? "ALL OUT" : "SOME OUT"}${x.gone ? " (404)" : ""} | ${x.p.name} | https://www.linxsquare.co.uk/products/${x.p.slug} | ${x.p.sourceUrl}`),
  };
  console.log(JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(DIR, `oos-check-${stamp()}.json`), JSON.stringify({ report, skipped }, null, 1));

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
    // Sold-out variants that Shopify can still sell (untracked or CONTINUE): stop-at-0 + tracking on, then qty 0.
    // Only these sold-out variants are touched; in-stock variants keep their settings.
    if (process.env.FIX_SELLABLE === "1") {
      const pidOf = new Map(); plan.forEach((x) => x.zero.forEach((id) => pidOf.set(id, x.p.shopifyProductId)));
      const fix = sids.map((id) => shop.get(id)).filter((n) => n && (n.inventoryPolicy === "CONTINUE" || !n.inventoryItem.tracked));
      const byP = new Map(); for (const n of fix) { const pid = pidOf.get(n.id); if (!pid) continue; (byP.get(pid) || byP.set(pid, []).get(pid)).push(n); }
      let fixed = 0; const errs = [];
      for (const [pid, ns] of byP) {
        const d = await gql(`mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$pid, variants:$v){ userErrors{ field message } } }`,
          { pid, v: ns.map((n) => ({ id: n.id, inventoryPolicy: "DENY", inventoryItem: { tracked: true } })) });
        if (d.productVariantsBulkUpdate.userErrors.length) { errs.push({ pid, e: d.productVariantsBulkUpdate.userErrors }); continue; }
        const q = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`,
          { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: ns.map((n) => ({ inventoryItemId: n.inventoryItem.id, locationId: location, quantity: 0 })) } });
        if (q.inventorySetQuantities.userErrors.length) errs.push({ pid, e: q.inventorySetQuantities.userErrors }); else fixed += ns.length;
        await sleep(200);
      }
      console.log(`Shopify sold-out variants made unsellable: ${fixed} of ${fix.length}; errors ${errs.length}`);
      if (errs.length) { fs.writeFileSync(path.join(DIR, `shopify-fix-errors-${stamp()}.json`), JSON.stringify(errs, null, 1)); console.log(JSON.stringify(errs).slice(0, 400)); }
    }
    const ops = dbOps.map((x) => ({ updateOne: { filter: { _id: x.p._id, brand: brand._id, ...Object.fromEntries(x.guard.map(([k, sku]) => [`variants.${k}.sku`, sku])) }, update: { $set: x.$set } } }));
    let matched = 0;
    for (let i = 0; i < ops.length; i += 200) matched += (await col.bulkWrite(ops.slice(i, i + 200), { ordered: false })).matchedCount;
    console.log(`DB matched ${matched} of ${ops.length}`);
    if (matched !== ops.length) fail("not every product matched");
  }
  await c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
