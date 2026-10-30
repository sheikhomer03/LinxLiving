// Flooring Sales (DB1, WooCommerce at flooringsales.co.uk): make everything out of stock on live out of stock on ours.
//   node .scratch/_stock-sync/fs-oos.cjs              (check, read-only; saves live snapshot)
//   MODE=apply node .scratch/_stock-sync/fs-oos.cjs   (backup + write)
// Match: product specs.fslId = WooCommerce product/variation id. Live = Store API (public, read-only).
// Sold out = is_in_stock false and not on backorder, or the id 404s on live. Backorder = still buyable = left alone.
// Writes existing fields only: product stock 0, isOutOfStock true, stockStatus "out_of_stock", stockAvailabilityText
// "Out of stock", stockSyncedAt (all already present on every FS product). Shopify: qty 0 for tracked variants. No settings.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));

const MODE = process.env.MODE || "check";
const ORIGIN = "https://www.flooringsales.co.uk";
const BRAND = new ObjectId("6a7a226d4a741744c3016f51");
const DIR = path.join(ROOT, ".scratch/flooringsales"); fs.mkdirSync(DIR, { recursive: true });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };

async function get(url) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } }).catch((e) => ({ err: e.cause ? e.cause.code || e.cause.message : e.message }));
    if (r.err) { if (a === 2) fail(`live site unreachable (${r.err}) — blocked or down; not working around it`); await sleep(5000); continue; }
    if (r.status === 429 || r.status === 403) fail(`live site says ${r.status} — stopping`);
    if (r.status >= 500) { await sleep(5000 * (a + 1)); continue; }
    const t = await r.text();
    if (/captcha|are you (a )?human|verifying your connection|cf-chl/i.test(t) && !t.trim().startsWith("[") && !t.trim().startsWith("{")) fail("bot check — stopping");
    return { status: r.status, body: t };
  }
  fail(`no response from ${url}`);
}
const avail = (p) => (p.is_in_stock || p.is_on_backorder ? "in" : "out");

(async () => {
  const c1 = new MongoClient(env.MONGODB_URI, { maxPoolSize: 3 }); await c1.connect();
  const c2 = new MongoClient(env.MONGODB_URL2, { maxPoolSize: 2 }); await c2.connect();
  try {
    const strays = await c2.db().collection("products").countDocuments({ brand: BRAND });
    const col = c1.db().collection("products");
    const ours = await col.find({ brand: BRAND }).project({ name: 1, slug: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, stockAvailabilityText: 1, stockSyncedAt: 1, shopifyProductId: 1, variants: 1, "specs.fslId": 1, "specs.fslType": 1, "specs.sourceUrl": 1 }).toArray();
    // match key complete + unique
    const ids = new Map();
    for (const p of ours) {
      const id = p.specs && p.specs.fslId; if (!id) fail(`no fslId on ${p.slug}`);
      if (ids.has(String(id))) fail(`duplicate fslId ${id}: ${p.slug} / ${ids.get(String(id)).slug}`);
      ids.set(String(id), p);
      if ((p.variants || []).length) fail(`unexpected variants on ${p.slug}`);
    }

    // live: full catalogue via Store API, then each of our ids not listed (variations, hidden, removed) individually
    const live = new Map();
    for (let page = 1; page < 200; page++) {
      const r = await get(`${ORIGIN}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
      if (r.status === 400) break; // past last page
      const d = JSON.parse(r.body); if (!d.length) break;
      for (const p of d) live.set(String(p.id), { s: avail(p), text: (p.stock_availability || {}).text || "", name: p.name, type: p.type });
      process.stdout.write(`page ${page} (${live.size}) `);
      await sleep(1000);
    }
    console.log(`\nlive listing: ${live.size} products`);
    if (live.size < ours.length * 0.5) fail(`live listing only ${live.size} products (we hold ${ours.length}) — not trusting it`);
    const extra = [...ids.keys()].filter((id) => !live.has(id));
    let gone = 0;
    for (const id of extra) {
      const r = await get(`${ORIGIN}/wp-json/wc/store/v1/products/${id}`);
      if (r.status === 404) { live.set(id, { s: "out", gone: true }); gone++; }
      else if (r.status === 200) { const p = JSON.parse(r.body); live.set(id, { s: avail(p), text: (p.stock_availability || {}).text || "", name: p.name, type: p.type }); }
      await sleep(700);
    }
    fs.writeFileSync(path.join(DIR, `stock-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify([...live]));
    console.log(`checked ${extra.length} ids not in the listing individually: ${gone} gone (404)`);

    const now = new Date();
    const counts = { soldOutOnLive: 0, goneFromLive: 0, alreadyRight: 0, backInStockOnLiveButOutOnOurs: 0, unresolved: 0 };
    const dbOps = [], plan = [], toShopify = [], examples = { soldOut: [], gone: [], backInStock: [] };
    for (const p of ours) {
      const l = live.get(String(p.specs.fslId));
      if (!l) { counts.unresolved++; continue; }
      const link = { name: p.name, ours: `https://www.linxsquare.co.uk/products/${p.slug}`, live: p.specs.sourceUrl };
      if (l.s === "in") { if (p.isOutOfStock === true || p.stockStatus === "out_of_stock" || p.stock === 0) { counts.backInStockOnLiveButOutOnOurs++; examples.backInStock.push(link); } continue; }
      counts.soldOutOnLive++; if (l.gone) counts.goneFromLive++;
      toShopify.push({ productId: p.shopifyProductId, slug: p.slug });
      (l.gone ? examples.gone : examples.soldOut).push(link);
      const $set = {};
      if (p.stock !== 0) $set.stock = 0;
      if (p.isOutOfStock !== true) $set.isOutOfStock = true;
      if (p.stockStatus !== "out_of_stock") $set.stockStatus = "out_of_stock";
      if ("stockAvailabilityText" in p && p.stockAvailabilityText !== "Out of stock") $set.stockAvailabilityText = "Out of stock";
      if (!Object.keys($set).length) { counts.alreadyRight++; continue; }
      if ("stockSyncedAt" in p) $set.stockSyncedAt = now;
      dbOps.push({ updateOne: { filter: { _id: p._id, brand: BRAND }, update: { $set } } });
      plan.push({ slug: p.slug, before: { stock: p.stock, isOutOfStock: p.isOutOfStock, stockStatus: p.stockStatus, stockAvailabilityText: p.stockAvailabilityText }, $set });
    }
    if (counts.unresolved) fail(`${counts.unresolved} of our products have no live answer`);

    // Shopify: variants of the sold-out products
    const location = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
    const pids = toShopify.filter((x) => x.productId).map((x) => (String(x.productId).startsWith("gid://") ? String(x.productId) : `gid://shopify/Product/${x.productId}`));
    const toZero = [], notTracked = [], missing = [], notStocked = [];
    for (let i = 0; i < pids.length; i += 50) {
      const d = await gql(`query($ids:[ID!]!,$loc:ID!){ nodes(ids:$ids){ ... on Product { id handle variants(first:100){ nodes{ id title inventoryPolicy inventoryQuantity inventoryItem{ id tracked inventoryLevel(locationId:$loc){ id } } } } } } }`, { ids: pids.slice(i, i + 50), loc: location });
      d.nodes.forEach((n, j) => {
        if (!n) { missing.push(pids[i + j]); return; }
        for (const v of n.variants.nodes) {
          if (/free sample/i.test(v.title)) continue; // shared £0 sample variant, untracked by design
          const x = { id: v.id, product: n.handle, title: v.title, policy: v.inventoryPolicy, tracked: v.inventoryItem.tracked, qty: v.inventoryQuantity, inventoryItemId: v.inventoryItem.id, single: n.variants.nodes.length === 1 };
          if (!v.inventoryItem.tracked) notTracked.push(x);
          else if (!v.inventoryItem.inventoryLevel) notStocked.push(x);
          else if (v.inventoryQuantity !== 0) toZero.push(x);
        }
      });
    }

    const report = { brand: "Flooring sales", cluster: "primary (DB1)", strayProductsInDB2: strays, liveProducts: live.size, ourProducts: ours.length, ...counts,
      dbProductsToUpdate: dbOps.length, shopifyVariantsToZero: toZero.length, shopifyNotTracked: notTracked.length, shopifyNotTrackedPolicies: notTracked.reduce((a, x) => ((a[x.policy] = (a[x.policy] || 0) + 1), a), {}), shopifyMissing: missing.length, shopifyNotStockedAtLocation: notStocked.length };
    const ts = stamp();
    fs.writeFileSync(path.join(DIR, `oos-check-${ts}.json`), JSON.stringify({ report, plan, toZero, notTracked, missing, notStocked, examples }, null, 1));
    console.log(JSON.stringify(report, null, 1));
    console.log("examples:", JSON.stringify({ soldOut: examples.soldOut.slice(0, 3), gone: examples.gone.slice(0, 3), backInStock: examples.backInStock.slice(0, 3) }, null, 1));
    if (MODE !== "apply") return;

    // ---------- APPLY ----------
    const backupDb = await col.find({ _id: { $in: dbOps.map((o) => o.updateOne.filter._id) } }).project({ stock: 1, isOutOfStock: 1, stockStatus: 1, stockAvailabilityText: 1, stockSyncedAt: 1 }).toArray();
    fs.writeFileSync(path.join(DIR, `oos-backup-${ts}.json`), JSON.stringify({ db: backupDb, shopify: toZero.map(({ id, inventoryItemId, policy, tracked, qty }) => ({ id, inventoryItemId, policy, tracked, qty })), location }, null, 1));
    console.log(`backup: .scratch/flooringsales/oos-backup-${ts}.json`);
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
    console.log("APPLIED — run the check again to verify (expect dbProductsToUpdate 0, shopifyVariantsToZero 0)");
  } finally { await c1.close(); await c2.close(); }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
