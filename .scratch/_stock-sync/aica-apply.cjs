// Aica stock sync — apply stage.
//   MODE=refresh   re-read live products.json, re-probe variants whose availability changed (live read only)
//   MODE=dry       build targets + validations + diff report (no writes)
//   MODE=shopify   backup + set DENY/tracked + set quantities in Shopify, then read back
//   MODE=db        backup + write DB2 stock fields, then read back
//   MODE=verify    full read-back of DB2 + Shopify vs targets, plus a live spot check
//   MODE=rollback-db / rollback-shopify   restore from the latest backup
// Writes touch stock fields only: DB2 variants[].available/stock + product stock/isOutOfStock/stockStatus/stockSyncedAt;
// Shopify inventoryPolicy, inventoryItem.tracked, available quantity at the one location.
const fs = require("fs"), path = require("path"), dns = require("dns");
const SCR = "/private/tmp/claude-501/-Users-niazig-Desktop-linxliving-LinxLiving/d2d9bf67-2e74-4a5c-a156-cc7b9dbe69c2/scratchpad";
const { gql, env, sleep, root } = require(path.join(SCR, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(root, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));

const DIR = path.join(root, ".scratch/aica");
const DAY = "2026-10-30";
const PROBE = path.join(DIR, `probe-${DAY}.jsonl`);
const LIVE = path.join(DIR, `stock-${DAY}.json`);
const TARGETS = path.join(DIR, `targets-${DAY}.json`);
const BRAND_ID = new ObjectId("6ab797f3bba7479a91b0a953");
const LOCATION = "gid://shopify/Location/120472371464";
const ORIGIN = "https://www.aicabathrooms.co.uk";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MODE = process.env.MODE || "dry";
// Stock given to a variant the live site lists as in stock when no quantity could be read.
const DEFAULT_IN_STOCK = Number(process.env.DEFAULT_IN_STOCK) || 0;
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (msg) => { console.error("ABORT:", msg); process.exit(2); };

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const probes = () => { const m = new Map(); for (const p of readJsonl(PROBE)) m.set(p.liveId, p); return m; }; // last write wins

async function mongo() {
  const c = await new MongoClient(env.MONGODB_URL2, { maxPoolSize: 2, serverSelectionTimeoutMS: 20000 }).connect();
  return { c, col: c.db().collection("products") };
}
async function loadOurs(col) {
  return col.find({ brand: BRAND_ID }).project({ name: 1, sourceUrl: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, stockSyncedAt: 1, shopifyProductId: 1,
    "variants.name": 1, "variants.sourceUrl": 1, "variants.available": 1, "variants.stock": 1, "variants.shopifyVariantId": 1 }).toArray();
}
const liveIdOf = (v) => (String(v.sourceUrl || "").match(/variant=(\d+)/) || [])[1] || null;

async function liveGet(url) {
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", cookie: "localization=GB; cart_currency=GBP" } });
    const t = await res.text();
    if (res.status === 429 || res.status >= 500 || /rate.?limit/i.test(t)) { await sleep(60000 * (i + 1)); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return JSON.parse(t);
  }
  throw new Error("live gave up " + url);
}
async function liveProducts() {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const d = await liveGet(`${ORIGIN}/products.json?limit=250&page=${page}`);
    if (!d.products?.length) break;
    out.push(...d.products);
    await sleep(1500);
  }
  return out;
}
async function probeOne(id) {
  // single fresh cart per call, cleared after
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${ORIGIN}/cart/add.js`, { method: "POST", headers: { "user-agent": UA, "content-type": "application/json", accept: "application/json", cookie: "localization=GB; cart_currency=GBP" },
      body: JSON.stringify({ items: [{ id: Number(id), quantity: 9999 }] }) });
    const t = await res.text();
    if (res.status === 429 || res.status >= 500 || /rate.?limit/i.test(t)) { await sleep(60000 * (i + 1)); continue; }
    const cart = ((res.headers.get("set-cookie") || "").match(/(?:^|[;,\s])cart=([^;]+)/) || [])[1];
    if (cart) await fetch(`${ORIGIN}/cart/clear.js`, { method: "POST", headers: { "user-agent": UA, cookie: `localization=GB; cart=${cart}` } }).catch(() => {});
    let b; try { b = JSON.parse(t); } catch { b = {}; }
    const msg = b.description || b.message || "";
    const m = msg.match(/Only (\d+) items? (?:were|was) added/i);
    if (res.status === 422 && m) return { qty: Number(m[1]), kind: "capped", msg };
    if (res.status === 422 && /sold out/i.test(msg)) return { qty: 0, kind: "sold_out", msg };
    const q = b.items?.[0]?.quantity;
    if (res.status === 200) return { qty: q != null && q < 9999 ? q : null, kind: q >= 9999 ? "unlimited" : "added", msg };
    return { qty: null, kind: "unknown", msg: `${res.status} ${msg}` };
  }
  return { qty: null, kind: "failed", msg: "retries exhausted" };
}

// ---------- targets ----------
function buildTargets(ours) {
  const live = new Map(JSON.parse(fs.readFileSync(LIVE, "utf8")).map((v) => [v.liveId, v]));
  const pr = probes();
  const products = [], problems = [];
  for (const p of ours) {
    const vs = (p.variants || []).map((v, i) => {
      const id = liveIdOf(v);
      const l = id ? live.get(id) : null;
      let available, stock, basis;
      if (!id) { problems.push({ product: p.name, variant: v.name, issue: "no live id" }); return null; }
      if (!l) { available = false; stock = 0; basis = "gone_from_live"; }
      else if (!l.available) { available = false; stock = 0; basis = "live_sold_out"; }
      else {
        const q = pr.get(id);
        if (!q && DEFAULT_IN_STOCK) { stock = DEFAULT_IN_STOCK; available = true; basis = "live_in_stock_default"; return { i, sourceUrl: v.sourceUrl, liveId: id, name: v.name, shopifyVariantId: v.shopifyVariantId || null, available, stock, basis, before: { available: v.available, stock: v.stock } }; }
        if (!q) { problems.push({ product: p.name, variant: v.name, liveId: id, issue: "not probed" }); return null; }
        if (q.kind === "capped" || q.kind === "sold_out" || (q.kind === "added" && q.qty != null)) { stock = q.qty; available = q.qty > 0; basis = "live_qty"; }
        else { problems.push({ product: p.name, variant: v.name, liveId: id, issue: `probe ${q.kind}: ${q.msg}` }); return null; }
      }
      return { i, sourceUrl: v.sourceUrl, liveId: id, name: v.name, shopifyVariantId: v.shopifyVariantId || null, available, stock, basis,
        before: { available: v.available, stock: v.stock } };
    });
    const ok = vs.filter(Boolean);
    const total = ok.reduce((a, v) => a + v.stock, 0);
    products.push({ _id: String(p._id), name: p.name, shopifyProductId: p.shopifyProductId, complete: ok.length === vs.length, variants: ok,
      stock: total, isOutOfStock: total <= 0, stockStatus: total > 0 ? "in_stock" : "out_of_stock",
      before: { stock: p.stock, isOutOfStock: p.isOutOfStock, stockStatus: p.stockStatus } });
  }
  return { products, problems };
}
function validate(t, oursVariantCount) {
  const vs = t.products.flatMap((p) => p.variants);
  const errs = [];
  if (t.products.length !== 620) errs.push(`expected 620 products, got ${t.products.length}`);
  if (vs.length + t.problems.length !== oursVariantCount) errs.push(`variant accounting off: ${vs.length}+${t.problems.length} != ${oursVariantCount}`);
  for (const v of vs) {
    if (!Number.isInteger(v.stock) || v.stock < 0) errs.push(`bad stock ${v.stock} on ${v.liveId}`);
    if (v.available !== v.stock > 0) errs.push(`available/stock disagree on ${v.liveId}`);
  }
  const ids = vs.map((v) => v.liveId); if (new Set(ids).size !== ids.length) errs.push("duplicate live ids");
  const urls = vs.map((v) => v.sourceUrl); if (new Set(urls).size !== urls.length) errs.push("duplicate sourceUrls");
  if (t.problems.length > oursVariantCount * 0.01) errs.push(`too many unresolved variants: ${t.problems.length}`);
  for (const p of t.products) if (p.stock !== p.variants.reduce((a, v) => a + v.stock, 0)) errs.push(`sum mismatch ${p._id}`);
  return errs;
}

(async () => {
  if (MODE === "refresh") {
    // Live availability may have moved during the long probe: re-read and re-probe what changed.
    const old = new Map(JSON.parse(fs.readFileSync(LIVE, "utf8")).map((v) => [v.liveId, v]));
    const lp = await liveProducts();
    const fresh = [];
    for (const p of lp) for (const v of p.variants || []) fresh.push({ liveId: String(v.id), liveProductId: String(p.id), handle: p.handle, product: p.title, title: v.title, sku: v.sku, available: v.available, fetchedAt: new Date().toISOString() });
    const pr = probes();
    const reprobe = fresh.filter((v) => v.available && (old.get(v.liveId)?.available !== true || !pr.has(v.liveId)) && [...old.keys()].length);
    const nowSold = fresh.filter((v) => !v.available && old.get(v.liveId)?.available === true);
    console.log(`live now: ${lp.length} products, ${fresh.length} variants; became in-stock/unprobed ${reprobe.length}, became sold out ${nowSold.length}`);
    fs.writeFileSync(LIVE, JSON.stringify(fresh));
    const ourIds = new Set(JSON.parse(fs.readFileSync(path.join(DIR, `phase12-${DAY}.json`), "utf8")).rows.map((r) => r.liveId));
    if (process.env.NOPROBE === "1") { console.log("refresh done (availability only, no cart probes)"); return; }
    for (const v of reprobe.filter((v) => ourIds.has(v.liveId))) {
      const q = await probeOne(v.liveId);
      fs.appendFileSync(PROBE, JSON.stringify({ liveId: v.liveId, handle: v.handle, variant: v.title, ...q, at: new Date().toISOString(), refresh: true }) + "\n");
      await sleep(1500);
    }
    console.log("refresh done");
    return;
  }

  const { c, col } = await mongo();
  const ours = await loadOurs(col);
  const oursVariantCount = ours.reduce((a, p) => a + (p.variants || []).length, 0);

  if (MODE === "dry") {
    const t = buildTargets(ours);
    const errs = validate(t, oursVariantCount);
    const vs = t.products.flatMap((p) => p.variants);
    const r = {
      products: t.products.length, variants: vs.length, unresolved: t.problems.length,
      basis: vs.reduce((a, v) => ((a[v.basis] = (a[v.basis] || 0) + 1), a), {}),
      variantsInStock: vs.filter((v) => v.available).length, variantsSoldOut: vs.filter((v) => !v.available).length,
      changedToSoldOut: vs.filter((v) => !v.available && v.before.available !== false).length,
      productsFullySoldOut: t.products.filter((p) => p.isOutOfStock).length,
      totalUnits: vs.reduce((a, v) => a + v.stock, 0),
      qtyBands: vs.reduce((a, v) => { const k = v.stock === 0 ? "0" : v.stock < 5 ? "1-4" : v.stock < 20 ? "5-19" : v.stock < 100 ? "20-99" : "100+"; a[k] = (a[k] || 0) + 1; return a; }, {}),
      maxQty: Math.max(...vs.map((v) => v.stock)),
      validationErrors: errs,
      examples: t.products.filter((p) => p.variants.length > 1).slice(0, 3).map((p) => ({ product: p.name, before: p.before.stock, after: p.stock,
        variants: p.variants.slice(0, 4).map((v) => `${v.name}: ${v.before.available ? "in stock" : "sold out"} → ${v.stock}`) })),
      problems: t.problems.slice(0, 20),
    };
    fs.writeFileSync(TARGETS, JSON.stringify(t));
    fs.writeFileSync(path.join(DIR, `dryrun-${DAY}.json`), JSON.stringify(r, null, 1));
    console.log(JSON.stringify(r, null, 1));
    if (errs.length) fail(errs.slice(0, 10).join("; "));
    console.log("DRY RUN OK — targets saved");
    await c.close(); return;
  }

  const t = JSON.parse(fs.readFileSync(TARGETS, "utf8"));
  if (validate(t, oursVariantCount).length) fail("targets no longer validate against DB2 — rerun MODE=dry");
  // A product with any unresolved variant is left exactly as it is (reported in the dry run).
  const skipped = t.products.filter((p) => !p.complete);
  t.products = t.products.filter((p) => p.complete);
  if (skipped.length) console.log(`skipping ${skipped.length} products with unresolved variants:`, skipped.map((p) => p.name).join(" | "));

  if (MODE === "shopify") {
    // Read current Shopify state (backup), including inventory item ids.
    const vids = t.products.flatMap((p) => p.variants).map((v) => v.shopifyVariantId).filter(Boolean);
    const cur = new Map();
    for (let i = 0; i < vids.length; i += 100) {
      const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity product{ id } inventoryItem{ id tracked } } } }`, { ids: vids.slice(i, i + 100) });
      for (const n of d.nodes) if (n) cur.set(n.id, n);
      await sleep(250);
    }
    if (cur.size !== vids.length) fail(`Shopify returned ${cur.size}/${vids.length} variants`);
    const bk = path.join(DIR, `shopify-backup-${stamp()}.json`);
    fs.writeFileSync(bk, JSON.stringify([...cur.values()]));
    console.log("backup:", bk);

    // Multi-variant products first, single-variant last (the admin auto-pull reads the most recently updated
    // products and takes product stock from the first variant — for single-variant products that is exact).
    const order = [...t.products].filter((p) => p.shopifyProductId).sort((a, b) => (a.variants.length === 1) - (b.variants.length === 1));
    // Settings untouched: no inventoryPolicy / tracking changes (user: write nothing extra).
    // Quantities, same order, batches of 250.
    const qtys = order.flatMap((p) => p.variants).filter((v) => v.shopifyVariantId && cur.get(v.shopifyVariantId).inventoryItem.tracked === true).map((v) => ({ inventoryItemId: cur.get(v.shopifyVariantId).inventoryItem.id, locationId: LOCATION, quantity: v.stock }));
    let qErr = [];
    for (let i = 0; i < qtys.length; i += 250) {
      const batch = qtys.slice(i, i + 250);
      const d = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message code } } }`,
        { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: batch } });
      const ue = d.inventorySetQuantities.userErrors;
      if (ue.length) qErr.push({ from: i, ue });
      await sleep(500);
    }
    console.log(`quantities sent: ${qtys.length}; batches with errors ${qErr.length}`);
    if (qErr.length) { fs.writeFileSync(path.join(DIR, `shopify-qty-errors-${stamp()}.json`), JSON.stringify(qErr, null, 1)); console.log(JSON.stringify(qErr).slice(0, 800)); }
    await c.close(); return;
  }

  if (MODE === "db") {
    const bk = path.join(DIR, `db-backup-${stamp()}.json`);
    fs.writeFileSync(bk, JSON.stringify(ours));
    console.log("backup:", bk);
    const now = new Date();
    const ops = t.products.map((p) => {
      // Only fields that already exist on these docs (user: add nothing new) — no stockSyncedAt, no variants[].stock.
      const $set = { stock: p.stock, isOutOfStock: p.isOutOfStock, stockStatus: p.stockStatus };
      const arrayFilters = [];
      p.variants.forEach((v, k) => {
        $set[`variants.$[v${k}].available`] = v.available;
        arrayFilters.push({ [`v${k}.sourceUrl`]: v.sourceUrl });
      });
      return { updateOne: { filter: { _id: new ObjectId(p._id), brand: BRAND_ID }, update: { $set }, arrayFilters } };
    });
    let matched = 0, modified = 0;
    for (let i = 0; i < ops.length; i += 100) {
      const r = await col.bulkWrite(ops.slice(i, i + 100), { ordered: false });
      matched += r.matchedCount; modified += r.modifiedCount;
    }
    console.log(`DB2: matched ${matched}, modified ${modified} of ${ops.length}`);
    if (matched !== ops.length) fail("not every product matched");
    await c.close(); return;
  }

  if (MODE === "verify") {
    const byId = new Map(ours.map((p) => [String(p._id), p]));
    const dbErr = [];
    for (const p of t.products) {
      const d = byId.get(p._id);
      if (d.stock !== p.stock || d.isOutOfStock !== p.isOutOfStock || d.stockStatus !== p.stockStatus) dbErr.push({ id: p._id, issue: "product", want: [p.stock, p.stockStatus], got: [d.stock, d.stockStatus] });
      const dv = new Map(d.variants.map((v) => [v.sourceUrl, v]));
      for (const v of p.variants) { const x = dv.get(v.sourceUrl); if (!x || x.available !== v.available || x.stock !== undefined) dbErr.push({ id: p._id, variant: v.name, want: [v.available, v.stock], got: x && [x.available, x.stock] }); }
    }
    const vs = t.products.flatMap((p) => p.variants).filter((v) => v.shopifyVariantId);
    const shErr = [];
    for (let i = 0; i < vs.length; i += 100) {
      const chunk = vs.slice(i, i + 100);
      const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ tracked } } } }`, { ids: chunk.map((v) => v.shopifyVariantId) });
      d.nodes.forEach((n, k) => { const v = chunk[k]; if (!n || (n.inventoryItem.tracked && n.inventoryQuantity !== v.stock)) shErr.push({ variant: v.shopifyVariantId, want: v.stock, got: n && [n.inventoryPolicy, n.inventoryItem.tracked, n.inventoryQuantity] }); });
      await sleep(250);
    }
    // What the admin auto-pull would read next: the most recently updated active products.
    const top = await gql(`{ products(first:10, query:"status:active", sortKey:UPDATED_AT, reverse:true){ nodes{ id title variantsCount{ count } variants(first:1){ nodes{ inventoryQuantity } } } } }`);
    const pullRisk = top.products.nodes.map((n) => { const p = t.products.find((x) => x.shopifyProductId === n.id); return { title: n.title, aica: !!p, variants: n.variantsCount.count, firstVariantQty: n.variants.nodes[0]?.inventoryQuantity, ourStock: p?.stock, safe: !p || p.stock === n.variants.nodes[0]?.inventoryQuantity }; });
    // Live check of EVERY variant's availability against a fresh products.json read (no cart requests).
    const lp = await liveProducts();
    const liveNow = new Map(); for (const p of lp) for (const v of p.variants || []) liveNow.set(String(v.id), v.available);
    const allV = t.products.flatMap((p) => p.variants);
    const spot = { checked: allV.length, agree: 0, disagree: [] };
    for (const v of allV) { const l = liveNow.has(v.liveId) ? liveNow.get(v.liveId) : false; if (l === v.available) spot.agree++; else spot.disagree.push({ name: v.name, liveId: v.liveId, ours: v.available, liveNow: l }); }
    spot.disagree = spot.disagree.slice(0, 20);
    const r = { dbMismatches: dbErr.length, shopifyMismatches: shErr.length, dbErr: dbErr.slice(0, 10), shErr: shErr.slice(0, 10), pullRisk, liveSpotCheck: spot };
    fs.writeFileSync(path.join(DIR, `verify-${stamp()}.json`), JSON.stringify(r, null, 1));
    console.log(JSON.stringify(r, null, 1));
    await c.close(); return;
  }

  if (MODE === "rollback-db") {
    const f = fs.readdirSync(DIR).filter((x) => x.startsWith("db-backup-")).sort().pop();
    const bk = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
    const ops = bk.map((p) => { const $set = { stock: p.stock, isOutOfStock: p.isOutOfStock, stockStatus: p.stockStatus }; const $unset = { stockSyncedAt: "" }; const af = [];
      p.variants.forEach((v, k) => { $set[`variants.$[v${k}].available`] = v.available; if (v.stock === undefined) $unset[`variants.$[v${k}].stock`] = ""; else $set[`variants.$[v${k}].stock`] = v.stock; af.push({ [`v${k}.sourceUrl`]: v.sourceUrl }); });
      if (p.stockSyncedAt) { delete $unset.stockSyncedAt; $set.stockSyncedAt = p.stockSyncedAt; }
      return { updateOne: { filter: { _id: new ObjectId(p._id) }, update: { $set, $unset }, arrayFilters: af } }; });
    const r = await col.bulkWrite(ops, { ordered: false });
    console.log("rolled back from", f, r.matchedCount);
    await c.close(); return;
  }
  fail("unknown MODE " + MODE);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
