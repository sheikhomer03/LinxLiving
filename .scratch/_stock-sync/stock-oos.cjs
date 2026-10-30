// Generic: make everything sold out on a brand's live Shopify site out of stock on ours (DB + Shopify).
//   BRAND_SLUG=bathdisc ORIGIN=https://www.bathdisc.co.uk node .scratch/_stock-sync/stock-oos.cjs          (check, read-only)
//   MODE=apply …                                                                                          (backup + write)
// Writes existing fields only. DB: variant available (+ variant stock → 0 where the field exists);
// product stock/isOutOfStock/stockStatus. Shopify: qty 0 for tracked sold-out variants. No settings changed.
// In-stock quantities are never touched. Variants back in stock on live are reported only.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));

const SLUG = process.env.BRAND_SLUG, ORIGIN = (process.env.ORIGIN || "").replace(/\/$/, "");
const MODE = process.env.MODE || "check";
if (!SLUG || !ORIGIN) { console.error("set BRAND_SLUG and ORIGIN"); process.exit(1); }
const DIR = path.join(ROOT, ".scratch", SLUG.replace(/[^a-z0-9]/g, ""));
fs.mkdirSync(DIR, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const liveIdOf = (v, p) => String(v.externalId || "").match(/^\d+$/) ? String(v.externalId) : (String(v.sourceUrl || "").match(/variant=(\d+)/) || [])[1]
  || (p && handleOf(p.sourceUrl) && v.sku ? `h:${handleOf(p.sourceUrl)}|${String(v.sku).trim()}` : null);

const handles = new Set(), dupLive = new Set();
const handleOf = (u) => (String(u || "").match(/\/products\/([^/?#]+)/) || [])[1] || null;
async function liveVariants(expect) {
  const m = new Map(); let products = 0;
  for (let page = 1; page < 200; page++) {
    let d;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${ORIGIN}/products.json?limit=250&page=${page}`, { headers: { "user-agent": UA, accept: "application/json", cookie: "localization=GB; cart_currency=GBP" } });
      const t = await res.text();
      if (res.status === 429 || res.status >= 500) { await sleep(20000 * (i + 1)); continue; }
      if (/Verifying your connection|captcha/i.test(t)) fail("live site shows a bot check — stopping");
      if (!res.ok) fail(`live HTTP ${res.status} on page ${page}`);
      d = JSON.parse(t); break;
    }
    if (!d) fail(`live page ${page} kept failing`);
    if (!d.products?.length) break;
    products += d.products.length;
    for (const p of d.products) { handles.add(p.handle); for (const v of p.variants || []) { m.set(String(v.id), v.available); if (v.sku) { const k = `h:${p.handle}|${String(v.sku).trim()}`; if (m.has(k)) dupLive.add(k); m.set(k, v.available); } } }
    await sleep(1000);
  }
  if (products < expect * 0.5) fail(`live returned only ${products} products (we hold ${expect}) — refusing to trust it`);
  return { m, products };
}

// Our products missing from the listing: check each page. 404 → gone; otherwise read its variants from <handle>.js.
async function checkMissing(ourHandles, m) {
  const todo = [...new Set(ourHandles)].filter((h) => h && !handles.has(h));
  const res = { checked: todo.length, gone404: 0, stillLive: 0, unknown: [] };
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const h = todo[i++];
      let done = false;
      for (let a = 0; a < 5 && !done; a++) {
        const r = await fetch(`${ORIGIN}/products/${h}.js`, { headers: { "user-agent": UA, accept: "application/json", cookie: "localization=GB; cart_currency=GBP" }, redirect: "follow" }).catch(() => null);
        if (!r || r.status === 429 || r.status >= 500) { await sleep(15000 * (a + 1)); continue; }
        if (r.status === 404) { res.gone404++; done = true; break; }
        const t = await r.text();
        if (/Verifying your connection|captcha/i.test(t)) fail("live site shows a bot check — stopping");
        try {
          const j = JSON.parse(t);
          handles.add(h); if (j.handle) handles.add(j.handle);
          for (const v of j.variants || []) { m.set(String(v.id), v.available); if (v.sku) m.set(`h:${h}|${String(v.sku).trim()}`, v.available); }
          res.stillLive++; done = true;
        } catch { res.unknown.push(h); done = true; }
      }
      if (!done) res.unknown.push(h);
      await sleep(350);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  // Unknown pages: treat as live-but-unreadable so those products are skipped, never marked sold out.
  for (const h of res.unknown) handles.add(h);
  return res;
}

(async () => {
  const c1 = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 20000 }).connect();
  const brand = await c1.db().collection("brands").findOne({ slug: SLUG });
  await c1.close();
  if (!brand) fail(`no brand with slug ${SLUG}`);
  const uri = brand.dataCluster === "secondary" ? env.MONGODB_URL2 : env.MONGODB_URI;
  const c = await new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 20000 }).connect();
  const col = c.db().collection("products");
  const ours = await col.find({ brand: brand._id }).project({ name: 1, slug: 1, sourceUrl: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, "variants.name": 1, "variants.sourceUrl": 1, "variants.externalId": 1, "variants.available": 1, "variants.stock": 1, "variants.shopifyVariantId": 1, "variants.sku": 1 }).toArray();
  const variantCount = ours.reduce((a, p) => a + (p.variants || []).length, 0);

  // Match key checks: complete + unique.
  const ids = ours.flatMap((p) => (p.variants || []).map((v) => liveIdOf(v, p)));
  const missingKey = ids.filter((x) => !x).length;
  const dupKey = ids.length - new Set(ids.filter(Boolean)).size - missingKey;
  if (missingKey > variantCount * 0.01) fail(`${missingKey} variants have no live id`);
  // Duplicate keys on our side: skip those products instead of guessing which row is which.
  const seenK = new Map(); for (const k of ids.filter(Boolean)) seenK.set(k, (seenK.get(k) || 0) + 1);
  const dupOurs = new Set([...seenK].filter(([, n]) => n > 1).map(([k]) => k));
  if (dupOurs.size > variantCount * 0.01) fail(`${dupOurs.size} duplicate live ids`);

  const { m: live, products: liveCount } = await liveVariants(ours.length);
  // SKIP_MISSING_CHECK=1: products missing from the listing count as gone without re-fetching each page.
  // Only use it when a full per-page check has already confirmed them (all 404) in this session.
  const missingCheck = process.env.SKIP_MISSING_CHECK === "1"
    ? { checked: 0, gone404: "trusted from earlier full check", stillLive: 0, unknown: [] }
    : await checkMissing(ours.map((p) => handleOf(p.sourceUrl)), live);
  console.log("missing-from-listing check:", JSON.stringify({ ...missingCheck, unknown: missingCheck.unknown.length }));

  // Shopify state for every linked variant.
  const sids = ours.flatMap((p) => (p.variants || []).map((v) => v.shopifyVariantId)).filter(Boolean);
  const shop = new Map();
  for (let i = 0; i < sids.length; i += 100) {
    const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked } } } }`, { ids: sids.slice(i, i + 100) });
    for (const n of d.nodes) if (n) shop.set(n.id, n);
    await sleep(150);
  }
  const location = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;

  const dbOps = [], shopQ = [], back = [], skipped = [];
  let soldLive = 0, goneLive = 0, alreadyOk = 0, productsOut = 0, sellableSoldOut = 0;
  for (const p of ours) {
    const vs = p.variants || [];
    if (vs.some((v) => !liveIdOf(v, p) || dupOurs.has(liveIdOf(v, p)))) { skipped.push(p.name); continue; }
    // Product still live but a variant can't be found there (renamed SKU etc.) → unknown, leave the product alone.
    const h = handleOf(p.sourceUrl);
    if (vs.some((v) => { const k = liveIdOf(v, p); return !live.has(k) && h && handles.has(h); }) || vs.some((v) => dupLive.has(liveIdOf(v, p)))) { skipped.push(p.name); continue; }
    const $set = {}, af = [];
    let changed = false;
    const after = vs.map((v, k) => {
      const id = liveIdOf(v, p);
      const onLive = live.has(id);
      const liveAvail = onLive ? live.get(id) : false;
      const s = v.shopifyVariantId ? shop.get(v.shopifyVariantId) : null;
      if (!liveAvail) {
        soldLive++; if (!onLive) goneLive++;
        const needDb = v.available !== false || (v.stock !== undefined && v.stock !== 0);
        if (needDb) {
          $set[`variants.$[v${k}].available`] = false;
          if (v.stock !== undefined) $set[`variants.$[v${k}].stock`] = 0;
          af.push(v.sourceUrl ? { [`v${k}.sourceUrl`]: v.sourceUrl } : { [`v${k}.sku`]: v.sku }); changed = true;
        }
        if (s && s.inventoryItem.tracked && s.inventoryQuantity !== 0) shopQ.push({ inventoryItemId: s.inventoryItem.id, locationId: location, quantity: 0, _p: p.name, _v: v.name });
        if (!needDb && !(s && s.inventoryItem.tracked && s.inventoryQuantity !== 0)) alreadyOk++;
        if (s && (s.inventoryPolicy === "CONTINUE" || !s.inventoryItem.tracked)) sellableSoldOut++;
        return { available: false, stock: v.stock === undefined ? undefined : 0 };
      }
      if (v.available === false) back.push(`${p.name} | ${v.name}`);
      return { available: v.available !== false, stock: v.stock };
    });
    const anyIn = after.some((v) => v.available);
    if (!anyIn) {
      if (p.stock !== 0 || p.isOutOfStock !== true || p.stockStatus !== "out_of_stock") { Object.assign($set, { stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" }); changed = true; }
      productsOut++;
    } else if (changed && after.every((v) => typeof v.stock === "number")) {
      $set.stock = after.filter((v) => v.available).reduce((a, v) => a + v.stock, 0);
    }
    if (changed) dbOps.push({ updateOne: { filter: { _id: p._id, brand: brand._id }, update: { $set }, ...(af.length ? { arrayFilters: af } : {}) }, _name: p.name });
  }

  const report = {
    brand: brand.name, cluster: brand.dataCluster || "primary", liveProducts: liveCount, missingFromListing: { ...missingCheck, unknown: missingCheck.unknown.length }, ourProducts: ours.length, ourVariants: variantCount,
    soldOutOnLive: soldLive, ofWhichGoneFromLive: goneLive, alreadyCorrect: alreadyOk, productsFullySoldOut: productsOut,
    dbProductsToUpdate: dbOps.length, shopifyVariantsToZero: shopQ.length, skippedProducts: skipped.length, skippedNames: skipped.slice(0, 15),
    backInStockOnLive_reportOnly: back.length, soldOutButShopifySellable: sellableSoldOut,
    examples: dbOps.slice(0, 5).map((o) => o._name), backExamples: back.slice(0, 3),
  };
  console.log(JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(DIR, `oos-check-${stamp()}.json`), JSON.stringify(report, null, 1));

  if (MODE === "apply" && (dbOps.length || shopQ.length)) {
    const bk = path.join(DIR, `oos-backup-${stamp()}.json`);
    fs.writeFileSync(bk, JSON.stringify({ ours, shopify: [...shop.values()] }));
    console.log("backup:", bk);
    for (let i = 0; i < shopQ.length; i += 250) {
      const d = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`,
        { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: shopQ.slice(i, i + 250).map(({ _p, _v, ...q }) => q) } });
      if (d.inventorySetQuantities.userErrors.length) fail("Shopify: " + JSON.stringify(d.inventorySetQuantities.userErrors).slice(0, 300));
      await sleep(300);
    }
    console.log(`Shopify set to 0: ${shopQ.length}`);
    let matched = 0, modified = 0;
    const ops = dbOps.map(({ _name, ...o }) => o);
    for (let i = 0; i < ops.length; i += 200) { const r = await col.bulkWrite(ops.slice(i, i + 200), { ordered: false }); matched += r.matchedCount; modified += r.modifiedCount; }
    console.log(`DB matched ${matched}, modified ${modified} of ${ops.length}`);
    if (matched !== ops.length) fail("not every product matched");
  }
  await c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
