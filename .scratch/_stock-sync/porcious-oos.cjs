// Porcious: user asked (2026-11-02) to mark the products NOT found on porcious.com out of stock.
// The 8 found there stay as they are. MODE=check | apply. Existing fields only; Shopify qty 0 on tracked variants.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const DIR = path.join(ROOT, ".scratch/porcious"), MODE = process.env.MODE || "check";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const clean = (s) => String(s).toLowerCase().replace(/&#[0-9]+;|&[a-z]+;/g, " ").replace(/[éè]/g, "e").replace(/\b\d+x\d+\b/g, " ").replace(/\b(matt|glossy|high gloss|gloss|anti-slip|r11|polished|carving|edl|decore|décor|decor)\b/g, " ").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
(async () => {
  const live = [];
  for (let p = 1; p <= 5; p++) { const r = await fetch(`https://www.porcious.com/wp-json/wc/store/v1/products?per_page=100&page=${p}&_fields=name`, { headers: { "user-agent": UA } }); const d = await r.json(); if (!d.length) break; live.push(...d.map((x) => clean(x.name))); await sleep(800); }
  if (live.length < 250) fail(`live returned only ${live.length}`);
  const L = new Set(live);
  const c = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }).connect();
  const col = c.db().collection("products");
  const b = await c.db().collection("brands").findOne({ slug: "porcious" });
  const ps = await col.find({ brand: b._id }).project({ name: 1, slug: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, shopifyVariantId: 1 }).toArray();
  const notOnSite = ps.filter((p) => !L.has(clean(p.name)));
  if (notOnSite.length !== 21 || ps.length !== 29) fail(`expected 21 of 29, got ${notOnSite.length} of ${ps.length}`);
  const need = notOnSite.filter((p) => p.stock !== 0 || p.isOutOfStock !== true || (p.stockStatus !== undefined && p.stockStatus !== "out_of_stock"));
  const ids = notOnSite.map((p) => p.shopifyVariantId).filter(Boolean);
  const d = ids.length ? await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked } } } }`, { ids }) : { nodes: [] };
  const loc = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
  const q = d.nodes.filter((n) => n && n.inventoryItem.tracked && n.inventoryQuantity !== 0).map((n) => ({ inventoryItemId: n.inventoryItem.id, locationId: loc, quantity: 0 }));
  const sellable = d.nodes.filter((n) => n && (n.inventoryPolicy === "CONTINUE" || !n.inventoryItem.tracked || n.inventoryQuantity > 0)).length;
  const shopState = d.nodes.reduce((a, n) => { const k = n ? `${n.inventoryPolicy}/tracked:${n.inventoryItem.tracked}` : "missing"; a[k] = (a[k] || 0) + 1; return a; }, {});
  console.log(JSON.stringify({ products: ps.length, notOnSite: notOnSite.length, dbToUpdate: need.length, shopifyLinked: ids.length, shopState, shopifyToZero: q.length, stillSellableInShopify: sellable }));
  if (MODE === "apply") {
    const bk = path.join(DIR, `oos-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(bk, JSON.stringify({ products: notOnSite, shopify: d.nodes })); console.log("backup:", bk);
    if (q.length) { const r = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ message } } }`, { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: q } }); if (r.inventorySetQuantities.userErrors.length) fail(JSON.stringify(r.inventorySetQuantities.userErrors)); }
    console.log("Shopify set to 0:", q.length);
    if (need.length) { const r = await col.bulkWrite(need.map((p) => ({ updateOne: { filter: { _id: p._id, brand: b._id }, update: { $set: { stock: 0, isOutOfStock: true, ...(p.stockStatus !== undefined ? { stockStatus: "out_of_stock" } : {}) } } } })), { ordered: false }); console.log(`DB matched ${r.matchedCount}, modified ${r.modifiedCount} of ${need.length}`); if (r.matchedCount !== need.length) fail("not all matched"); }
  }
  await c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
