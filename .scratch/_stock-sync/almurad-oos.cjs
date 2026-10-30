// Al Murad: apply OUT-OF-STOCK only, from the existing live snapshot (.scratch/almurad/stock-live-snapshot.jsonl).
// No requests to al-murad.co.uk. MODE=check (default) | apply | verify.
// Existing fields only — DB: product stock/isOutOfStock/stockStatus, variant available/stock; Shopify: qty 0 on tracked variants.
// In-stock items untouched. Snapshot "error" rows and ambiguous SKUs → product skipped. Back-in-stock → report only.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const DIR = path.join(ROOT, ".scratch/almurad");
const MODE = process.env.MODE || "check";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const lines = (f) => fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const snap = new Map(lines(path.join(DIR, "stock-live-snapshot.jsonl")).map((r) => [r.url, r]));
const sku2url = new Map(), ambiguous = new Set();
for (const r of lines(path.join(DIR, "am-pdp.jsonl"))) {
  const add = (s, u) => { if (!s || !u) return; s = String(s).trim(); if (sku2url.has(s) && sku2url.get(s) !== u) ambiguous.add(s); sku2url.set(s, u); };
  add(r.sku, r.sourceUrl); (r.variants || []).forEach((v) => add(v.sku, v.sourceUrl || v.url));
}
// live state for a URL: true / false / null (unknown → skip)
const liveOf = (url) => { const r = snap.get(url); if (!r || r.statusText === "error") return null; return r.statusText === "in_stock" ? true : r.statusText === "out_of_stock" || r.statusText === "gone_404" ? false : null; };

(async () => {
  const c1 = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }).connect();
  const brand = await c1.db().collection("brands").findOne({ slug: "al-murad" });
  await c1.close();
  const c = await new MongoClient(brand.dataCluster === "secondary" ? env.MONGODB_URL2 : env.MONGODB_URI, { maxPoolSize: 2 }).connect();
  const col = c.db().collection("products");
  const ours = await col.find({ brand: brand._id }).project({ name: 1, slug: 1, sourceUrl: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, shopifyVariantId: 1,
    "variants.name": 1, "variants.sku": 1, "variants.available": 1, "variants.stock": 1, "variants.shopifyVariantId": 1 }).toArray();

  const plan = [], skipped = [], back = [];
  for (const p of ours) {
    const vs = p.variants || [];
    if (!vs.length) {
      const l = liveOf(p.sourceUrl);
      if (l === null) { skipped.push({ name: p.name, why: "no usable snapshot row" }); continue; }
      if (l === true) { if (p.isOutOfStock || p.stockStatus === "out_of_stock") back.push(p.name); continue; }
      const needDb = p.stock !== 0 || p.isOutOfStock !== true || p.stockStatus !== "out_of_stock";
      plan.push({ p, $set: needDb ? { stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" } : {}, af: [], zero: p.shopifyVariantId ? [p.shopifyVariantId] : [], full: true });
      continue;
    }
    const st = vs.map((v) => { const s = String(v.sku || "").trim(); return ambiguous.has(s) ? null : liveOf(sku2url.get(s)); });
    if (st.some((x) => x === null)) { skipped.push({ name: p.name, why: "variant without a reliable live row (error or ambiguous SKU)" }); continue; }
    const $set = {}, af = [], zero = [];
    vs.forEach((v, k) => {
      if (st[k]) { if (v.available === false) back.push(`${p.name} | ${v.name}`); return; }
      if (v.available !== false || (v.stock !== undefined && v.stock !== 0)) {
        $set[`variants.${k}.available`] = false;
        if (v.stock !== undefined) $set[`variants.${k}.stock`] = 0;
        af.push(k);
      }
      if (v.shopifyVariantId) zero.push(v.shopifyVariantId);
    });
    if (!zero.length && !af.length) continue;
    const anyIn = st.some(Boolean);
    if (!anyIn) {
      if (p.stock !== 0 || p.isOutOfStock !== true || p.stockStatus !== "out_of_stock") Object.assign($set, { stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" });
    } else if (af.length && vs.every((v) => typeof v.stock === "number")) {
      $set.stock = vs.reduce((a, v, k) => a + (st[k] ? v.stock : 0), 0);
    }
    plan.push({ p, $set, af, zero, full: !anyIn, guard: af.map((k) => ({ k, sku: vs[k].sku })) });
  }

  // Shopify state for every variant we would zero.
  const sids = plan.flatMap((x) => x.zero);
  const shop = new Map();
  for (let i = 0; i < sids.length; i += 100) {
    const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked } } } }`, { ids: sids.slice(i, i + 100) });
    for (const n of d.nodes) if (n) shop.set(n.id, n);
  }
  const location = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
  const shopQ = sids.map((id) => shop.get(id)).filter((n) => n && n.inventoryItem.tracked && n.inventoryQuantity !== 0)
    .map((n) => ({ inventoryItemId: n.inventoryItem.id, locationId: location, quantity: 0 }));
  const stillSellable = sids.map((id) => shop.get(id)).filter((n) => n && (n.inventoryPolicy === "CONTINUE" || !n.inventoryItem.tracked)).length;

  const dbOps = plan.filter((x) => Object.keys(x.$set).length);
  const report = {
    snapshotRows: snap.size, snapshotOut: [...snap.values()].filter((r) => r.statusText === "out_of_stock").length, snapshotErrorsIgnored: [...snap.values()].filter((r) => r.statusText === "error").length,
    ourProducts: ours.length, productsWithSoldOut: plan.length, productsFullySoldOut: plan.filter((x) => x.full).length,
    variantsSoldOut: plan.reduce((a, x) => a + x.af.length, 0), dbProductsToUpdate: dbOps.length, shopifyToZero: shopQ.length,
    soldOutStillSellableInShopify: stillSellable, skippedProducts: skipped.length, backInStock_reportOnly: back.length,
    examples: plan.slice(0, 5).map((x) => x.p.name), skipped: skipped.slice(0, 10),
  };
  console.log(JSON.stringify(report, null, 1));

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
    // Positional writes guarded by the variant's SKU at that index, so a reordered array can't be hit.
    const ops = dbOps.map((x) => ({ updateOne: { filter: { _id: x.p._id, brand: brand._id, ...Object.fromEntries((x.guard || []).map((g) => [`variants.${g.k}.sku`, g.sku])) }, update: { $set: x.$set } } }));
    let matched = 0;
    for (let i = 0; i < ops.length; i += 200) matched += (await col.bulkWrite(ops.slice(i, i + 200), { ordered: false })).matchedCount;
    console.log(`DB matched ${matched} of ${ops.length}`);
    if (matched !== ops.length) fail("not every product matched");
  }

  if (MODE === "verify") {
    // After apply, a fresh plan must find nothing left: dbProductsToUpdate 0, shopifyToZero 0.
    console.log(report.dbProductsToUpdate === 0 && report.shopifyToZero === 0 ? "VERIFY OK — nothing left to fix" : "VERIFY FAILED");
  }
  await c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
