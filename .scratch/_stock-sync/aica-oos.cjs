// Aica: make sure everything sold out on the live site is out of stock on ours (DB2 + Shopify).
// MODE=check (default, read-only) | MODE=apply. Quantities of in-stock variants are never changed.
// Writes only existing fields: DB2 variants[].available, product stock/isOutOfStock/stockStatus;
// Shopify available qty = 0 for tracked variants. No settings changed.
const fs = require("fs"), path = require("path"), dns = require("dns");
const SCR = "/private/tmp/claude-501/-Users-niazig-Desktop-linxliving-LinxLiving/d2d9bf67-2e74-4a5c-a156-cc7b9dbe69c2/scratchpad";
const { gql, env, sleep, root } = require(path.join(SCR, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(root, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const DIR = path.join(root, ".scratch/aica");
const BRAND_ID = new ObjectId("6ab797f3bba7479a91b0a953");
const LOCATION = "gid://shopify/Location/120472371464";
const ORIGIN = "https://www.aicabathrooms.co.uk";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MODE = process.env.MODE || "check";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const liveIdOf = (v) => (String(v.sourceUrl || "").match(/variant=(\d+)/) || [])[1] || null;

async function liveVariants() {
  const m = new Map(); let products = 0;
  for (let page = 1; page < 50; page++) {
    const res = await fetch(`${ORIGIN}/products.json?limit=250&page=${page}`, { headers: { "user-agent": UA, accept: "application/json", cookie: "localization=GB; cart_currency=GBP" } });
    if (!res.ok) throw new Error(`live HTTP ${res.status}`);
    const d = await res.json();
    if (!d.products?.length) break;
    products += d.products.length;
    for (const p of d.products) for (const v of p.variants || []) m.set(String(v.id), v.available);
    await sleep(1200);
  }
  if (products < 500) throw new Error(`live returned only ${products} products — refusing to trust it`);
  return { m, products };
}
async function shopifyState(ids) {
  const s = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked } } } }`, { ids: ids.slice(i, i + 100) });
    for (const n of d.nodes) if (n) s.set(n.id, n);
    await sleep(200);
  }
  return s;
}

(async () => {
  const { m: live, products: liveCount } = await liveVariants();
  const c = await new MongoClient(env.MONGODB_URL2, { maxPoolSize: 2, serverSelectionTimeoutMS: 20000 }).connect();
  const col = c.db().collection("products");
  const ours = await col.find({ brand: BRAND_ID }).project({ name: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, "variants.name": 1, "variants.sourceUrl": 1, "variants.available": 1, "variants.shopifyVariantId": 1 }).toArray();
  const shop = await shopifyState(ours.flatMap((p) => p.variants.map((v) => v.shopifyVariantId)).filter(Boolean));

  // Per variant: sold out on live (or gone from live) → must be out of stock on ours.
  const fixDb = [], fixShop = [], backInStock = [], productFix = [];
  let soldLive = 0, okDb = 0, okShop = 0;
  for (const p of ours) {
    let changed = false;
    const vs = p.variants.map((v) => {
      const id = liveIdOf(v);
      const liveAvail = id && live.has(id) ? live.get(id) : false;
      const s = v.shopifyVariantId ? shop.get(v.shopifyVariantId) : null;
      if (!liveAvail) {
        soldLive++;
        if (v.available !== false) { fixDb.push({ p, v }); changed = true; } else okDb++;
        if (s && s.inventoryItem.tracked && s.inventoryQuantity !== 0) fixShop.push({ p, v, s }); else okShop++;
        return { ...v, willAvail: false, qty: 0 };
      }
      if (v.available === false) backInStock.push({ product: p.name, variant: v.name });
      return { ...v, willAvail: v.available !== false, qty: s && s.inventoryItem.tracked ? s.inventoryQuantity : null };
    });
    // Product-level: fully sold out → stock 0 / out_of_stock. Otherwise stock = sum of tracked Shopify qty (unchanged for in-stock variants).
    const anyIn = vs.some((v) => v.willAvail);
    if (!anyIn && (p.stock !== 0 || p.isOutOfStock !== true || p.stockStatus !== "out_of_stock")) productFix.push({ p, stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" });
    else if (anyIn && changed) {
      const sum = vs.filter((v) => v.willAvail).reduce((a, v) => a + (v.qty || 0), 0);
      productFix.push({ p, stock: sum || p.stock, isOutOfStock: false, stockStatus: "in_stock" });
    }
  }
  const report = { liveProducts: liveCount, liveVariants: live.size, ourProducts: ours.length, ourVariants: ours.reduce((a, p) => a + p.variants.length, 0),
    soldOutOnLive: soldLive, alreadyOutOfStockInDb: okDb, dbVariantsToFix: fixDb.length, shopifyVariantsToFix: fixShop.length, productsToFix: productFix.length,
    backInStockOnLive_reportOnly: backInStock.length,
    examples: fixDb.slice(0, 5).map((x) => `${x.p.name} | ${x.v.name}`), backInStockExamples: backInStock.slice(0, 5) };
  console.log(JSON.stringify(report, null, 1));

  if (MODE === "apply" && (fixDb.length || fixShop.length || productFix.length)) {
    fs.writeFileSync(path.join(DIR, `oos-backup-${stamp()}.json`), JSON.stringify({ ours, shopify: fixShop.map((x) => x.s) }));
    // Shopify first: qty 0 for tracked sold-out variants.
    const q = fixShop.map((x) => ({ inventoryItemId: x.s.inventoryItem.id, locationId: LOCATION, quantity: 0 }));
    for (let i = 0; i < q.length; i += 250) {
      const d = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`,
        { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: q.slice(i, i + 250) } });
      if (d.inventorySetQuantities.userErrors.length) throw new Error(JSON.stringify(d.inventorySetQuantities.userErrors).slice(0, 400));
    }
    // DB2: existing fields only.
    const byP = new Map();
    for (const x of fixDb) (byP.get(String(x.p._id)) || byP.set(String(x.p._id), { $set: {}, af: [] }).get(String(x.p._id)));
    for (const x of fixDb) { const e = byP.get(String(x.p._id)); const k = e.af.length; e.$set[`variants.$[v${k}].available`] = false; e.af.push({ [`v${k}.sourceUrl`]: x.v.sourceUrl }); }
    for (const f of productFix) { const e = byP.get(String(f.p._id)) || byP.set(String(f.p._id), { $set: {}, af: [] }).get(String(f.p._id)); Object.assign(e.$set, { stock: f.stock, isOutOfStock: f.isOutOfStock, stockStatus: f.stockStatus }); }
    const ops = [...byP].map(([id, e]) => ({ updateOne: { filter: { _id: new ObjectId(id), brand: BRAND_ID }, update: { $set: e.$set }, ...(e.af.length ? { arrayFilters: e.af } : {}) } }));
    if (ops.length) { const r = await col.bulkWrite(ops, { ordered: false }); console.log(`DB2 matched ${r.matchedCount} modified ${r.modifiedCount} of ${ops.length}`); }
    console.log(`Shopify set to 0: ${q.length}`);
  }
  await c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
