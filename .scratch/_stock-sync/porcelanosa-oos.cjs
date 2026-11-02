// PORCELANOSA: mark the 31 products whose product-finder page was removed (.scratch/porcelanosa/gone-products.json) out of stock.
// MODE=check | apply. Existing fields only (stock, isOutOfStock, stockStatus); Shopify qty 0 on tracked variants.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const DIR = path.join(ROOT, ".scratch/porcelanosa"), MODE = process.env.MODE || "check";
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
(async () => {
  const gone = require(path.join(DIR, "gone-products.json"));
  if (gone.length !== 31) fail(`expected 31, got ${gone.length}`);
  const c = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }).connect();
  const col = c.db().collection("products");
  const b = await c.db().collection("brands").findOne({ slug: "porcelanosagrupo" });
  const ps = await col.find({ _id: { $in: gone.map((g) => new ObjectId(g.id)) }, brand: b._id }).project({ name: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, shopifyVariantId: 1 }).toArray();
  if (ps.length !== 31) fail(`found ${ps.length}/31`);
  const need = ps.filter((p) => p.stock !== 0 || p.isOutOfStock !== true || (p.stockStatus !== undefined && p.stockStatus !== "out_of_stock"));
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
    if (need.length) { const r = await col.bulkWrite(need.map((p) => ({ updateOne: { filter: { _id: p._id, brand: b._id }, update: { $set: { stock: 0, isOutOfStock: true, ...(p.stockStatus !== undefined ? { stockStatus: "out_of_stock" } : {}) } } } })), { ordered: false }); console.log(`DB matched ${r.matchedCount}, modified ${r.modifiedCount} of ${need.length}`); if (r.matchedCount !== need.length) fail("not all matched"); }
  }
  await c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
