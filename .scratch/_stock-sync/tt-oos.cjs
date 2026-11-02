// Topps Tiles (DB1): options "unavailable online" on toppstiles.co.uk → out of stock on ours (DB + Shopify).
// Live data = the user's 4 saved API files (.scratch/toppstiles/stock/live/1-4.json, /api/n/load verbosity 3) + labels from
// init.js: stock_availability 4908 Good / 4909 Limited / 4921 Special order = in; 4910 / 4911 / 10919 "not/unavailable online" = out.
// Match: variant externalId = Topps product id. No code / missing id → unresolved (product skipped).
//   node .scratch/_stock-sync/tt-oos.cjs            (check)      MODE=apply node .scratch/_stock-sync/tt-oos.cjs   (backup + write)
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const MODE = process.env.MODE || "check";
const DIR = path.join(ROOT, ".scratch/toppstiles");
const LIVE = path.join(DIR, "stock/live");
const BRAND = new ObjectId("6ab7d7722727a5683dcbe026");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const gid = (x) => (String(x).startsWith("gid://") ? String(x) : `gid://shopify/ProductVariant/${x}`);
const IN = new Set([4908, 4909, 4921]), OUT = new Set([4910, 4911, 10919]);
const LABEL = { 4908: "Good availability", 4909: "Limited availability", 4910: "Not available online", 4911: "Unavailable online", 4921: "Special order", 10919: "Unavailable online" };

(async () => {
  const live = new Map(); let rowsRead = 0;
  for (const f of ["1.json", "2.json", "3.json", "4.json"]) {
    const d = JSON.parse(fs.readFileSync(path.join(LIVE, f), "utf8"));
    for (const o of d.result || []) {
      rowsRead++;
      const code = o.stock_availability, s = IN.has(code) ? "in" : OUT.has(code) ? "out" : null;
      if (s) live.set(String(o.id), { s, rows: [{ status: LABEL[code] || String(code), availability: "" }] });
    }
  }
  console.log(`live files: ${rowsRead} items, ${live.size} with a known stock code`);

  const c1 = new MongoClient(env.MONGODB_URI, { maxPoolSize: 3 }); await c1.connect();
  const c2 = new MongoClient(env.MONGODB_URL2, { maxPoolSize: 2 }); await c2.connect();
  try {
    const strays = await c2.db().collection("products").countDocuments({ brand: BRAND });
    const col = c1.db().collection("products");
    const ours = await col.find({ brand: BRAND }).project({ name: 1, slug: 1, sourceUrl: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, variants: 1 }).toArray();
    const skus = new Set(); let nVar = 0;
    for (const p of ours) for (const v of p.variants || []) { nVar++; if (!v.sku) fail(`variant without sku in ${p.slug}`); if (skus.has(v.sku)) fail(`duplicate sku ${v.sku}`); skus.add(v.sku); }
    const lookup = (v) => live.get(String(v.externalId)) || null;
    const counts = { soldOutOnLive: 0, alreadyRight: 0, dbVariantsToFix: 0, backInStockOnLiveButOutOnOurs: 0, unresolved: 0 };
    const skipped = [], dbOps = [], plan = [], shopVars = [], examples = { full: [], partial: [] };
    for (const p of ours) {
      const vs = (p.variants || []).map((v) => ({ v, l: lookup(v) }));
      const bad = vs.filter((x) => !x.l || x.l.s === "conflict");
      if (bad.length) { counts.unresolved += bad.length; skipped.push({ slug: p.slug, name: p.name, codes: bad.map((x) => `${x.v.sku}${x.l ? " (conflict)" : " (no stock code on Topps)"}`) }); continue; }
      const $set = {}, af = []; let allOut = vs.length > 0;
      vs.forEach(({ v, l }, i) => {
        if (l.s !== "out") { allOut = false; if (v.available === false) counts.backInStockOnLiveButOutOnOurs++; return; }
        counts.soldOutOnLive++;
        shopVars.push({ id: gid(v.shopifyVariantId), single: vs.length === 1 });
        if (v.available === false && (v.stock === undefined || v.stock === 0)) { counts.alreadyRight++; return; }
        counts.dbVariantsToFix++;
        $set[`variants.$[v${i}].available`] = false;
        if (v.stock !== undefined) $set[`variants.$[v${i}].stock`] = 0;
        af.push({ [`v${i}.externalId`]: v.externalId });
      });
      if (allOut && (p.stock !== 0 || p.isOutOfStock !== true || p.stockStatus !== "out_of_stock")) Object.assign($set, { stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" });
      const out = vs.filter((x) => x.l.s === "out");
      if (out.length) (allOut ? examples.full : examples.partial).push({ name: p.name, ours: `https://www.linxsquare.co.uk/products/${p.slug}`, live: p.sourceUrl, out: out.map((x) => `${x.v.name} [${x.v.sku}: ${x.l.rows[0].status}${x.l.rows[0].availability ? " / " + x.l.rows[0].availability : ""}]`).slice(0, 3), outOf: `${out.length}/${vs.length}` });
      if (Object.keys($set).length) { dbOps.push({ updateOne: { filter: { _id: p._id, brand: BRAND }, update: { $set }, ...(af.length ? { arrayFilters: af } : {}) } }); plan.push({ slug: p.slug, $set }); }
    }

    const location = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
    const toZero = [], notTracked = [], missing = [], notStocked = [];
    for (let i = 0; i < shopVars.length; i += 100) {
      const chunk = shopVars.slice(i, i + 100);
      const d = await gql(`query($ids:[ID!]!,$loc:ID!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked inventoryLevel(locationId:$loc){ id } } } } }`, { ids: chunk.map((x) => x.id), loc: location });
      d.nodes.forEach((n, j) => {
        if (!n) return missing.push(chunk[j].id);
        if (!n.inventoryItem.tracked) return notTracked.push({ id: n.id, policy: n.inventoryPolicy });
        if (!n.inventoryItem.inventoryLevel) return notStocked.push(n.id);
        if (n.inventoryQuantity !== 0) toZero.push({ id: n.id, inventoryItemId: n.inventoryItem.id, policy: n.inventoryPolicy, tracked: true, qty: n.inventoryQuantity, single: chunk[j].single });
      });
    }
    const report = { brand: "Topps Tiles", cluster: "primary (DB1)", strayProductsInDB2: strays, liveCodes: live.size, ourProducts: ours.length, ourVariants: nVar, ...counts,
      productsSkipped: skipped.length, dbProductsToUpdate: dbOps.length, productsFullyOut: examples.full.length, productsPartlyOut: examples.partial.length,
      shopifyVariantsToZero: toZero.length, shopifyNotTracked: notTracked.length, shopifyMissing: missing.length, shopifyNotStockedAtLocation: notStocked.length };
    const ts = stamp();
    fs.writeFileSync(path.join(DIR, `oos-check-${ts}.json`), JSON.stringify({ report, skipped, plan, toZero, notTracked, missing, notStocked, examples }, null, 1));
    console.log(JSON.stringify(report, null, 1));
    console.log("examples:", JSON.stringify({ full: examples.full.slice(0, 3), partial: examples.partial.slice(0, 3) }, null, 1));
    console.log("skipped (first 10):", JSON.stringify(skipped.slice(0, 10)));
    if (MODE !== "apply") return;

    if (counts.unresolved > nVar * 0.01 && !process.env.ALLOW_SKIP) fail(`unresolved ${counts.unresolved} > 1% of ${nVar}`);
    const backupDb = await col.find({ _id: { $in: dbOps.map((o) => o.updateOne.filter._id) } }).project({ stock: 1, isOutOfStock: 1, stockStatus: 1, "variants.sku": 1, "variants.available": 1, "variants.stock": 1 }).toArray();
    fs.writeFileSync(path.join(DIR, `oos-backup-${ts}.json`), JSON.stringify({ db: backupDb, shopify: toZero, location }, null, 1));
    console.log(`backup: .scratch/toppstiles/oos-backup-${ts}.json`);
    const ordered = [...toZero.filter((x) => !x.single), ...toZero.filter((x) => x.single)];
    let zeroed = 0; const errs = [];
    for (let i = 0; i < ordered.length; i += 250) {
      const chunk = ordered.slice(i, i + 250);
      const d = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`, { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: chunk.map((x) => ({ inventoryItemId: x.inventoryItemId, locationId: location, quantity: 0 })) } });
      const ue = d.inventorySetQuantities.userErrors; if (ue.length) { errs.push(...ue); if (ue.length >= chunk.length / 2) fail(`systematic Shopify errors ${JSON.stringify(ue.slice(0, 3))}`); }
      zeroed += chunk.length - ue.length; await sleep(500);
    }
    console.log(`shopify: set 0 on ${zeroed}/${ordered.length}`, errs.length ? JSON.stringify(errs.slice(0, 5)) : "");
    if (dbOps.length) { const r = await col.bulkWrite(dbOps, { ordered: false }); console.log(`db: matched ${r.matchedCount}, modified ${r.modifiedCount} of ${dbOps.length}`); if (r.matchedCount !== dbOps.length) fail("matched != planned"); }
    console.log("APPLIED — run the check again to verify");
  } finally { await c1.close(); await c2.close(); }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
