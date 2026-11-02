// UK Bifold Door Factory: mark the 18 products whose Smart Systems page is gone (404, not in Smart's sitemap) out of stock.
// Source: .scratch/ukbifold/pages-2026-11-02.json. MODE=check | apply. Existing fields only; Shopify qty 0 on tracked variants.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const DIR = path.join(ROOT, ".scratch/ukbifold"), MODE = process.env.MODE || "check";
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
(async () => {
  const gone = require(path.join(DIR, "pages-2026-11-02.json")).filter((r) => r.status === 404 && r.host === "smartsystems.co.uk");
  if (gone.length !== 18) fail(`expected 18, got ${gone.length}`);
  const c = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 60000 }).connect();
  const col = c.db().collection("products");
  const b = await c.db().collection("brands").findOne({ slug: "ukbifolddoorfactory" });
  const ps = await col.find({ _id: { $in: gone.map((g) => new ObjectId(g.id)) }, brand: b._id }).project({ name: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, shopifyVariantId: 1 }).toArray();
  if (ps.length !== 18) fail(`found ${ps.length}/18`);
  const set = (p) => ({ stock: 0, ...(p.stockStatus !== undefined ? { stockStatus: "out_of_stock" } : {}), ...(p.isOutOfStock !== undefined ? { isOutOfStock: true } : {}) });
  const need = ps.filter((p) => Object.entries(set(p)).some(([k, v]) => p[k] !== v));
  const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked } } } }`, { ids: ps.map((p) => p.shopifyVariantId).filter(Boolean) });
  const loc = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
  const q = d.nodes.filter((n) => n && n.inventoryItem.tracked && n.inventoryQuantity !== 0).map((n) => ({ inventoryItemId: n.inventoryItem.id, locationId: loc, quantity: 0 }));
  const sellable = d.nodes.filter((n) => n && (n.inventoryPolicy === "CONTINUE" || !n.inventoryItem.tracked || n.inventoryQuantity > 0)).length;
  console.log(JSON.stringify({ products: ps.length, dbToUpdate: need.length, shopifyToZero: q.length, stillSellableInShopify: sellable }));
  if (MODE === "apply") {
    const bk = path.join(DIR, `oos-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(bk, JSON.stringify({ products: ps, shopify: d.nodes })); console.log("backup:", bk);
    if (q.length) { const r = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ message } } }`, { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: q } }); if (r.inventorySetQuantities.userErrors.length) fail(JSON.stringify(r.inventorySetQuantities.userErrors)); }
    console.log("Shopify set to 0:", q.length);
    if (need.length) { const r = await col.bulkWrite(need.map((p) => ({ updateOne: { filter: { _id: p._id, brand: b._id }, update: { $set: set(p) } } })), { ordered: false }); console.log(`DB matched ${r.matchedCount}, modified ${r.modifiedCount} of ${need.length}`); if (r.matchedCount !== need.length) fail("not all matched"); }
  }
  await c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
