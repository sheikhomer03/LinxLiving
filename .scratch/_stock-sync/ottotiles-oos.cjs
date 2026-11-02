// Otto Tiles: mark products gone from ottotiles.co.uk (404, from .scratch/ottotiles/check-2026-11-02.json) out of stock.
// MODE=check (default) | apply. Existing fields only: DB1 stock → 0, isOutOfStock → true (stockStatus only where it exists);
// Shopify qty 0 on tracked variants. Nothing else touched.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const DIR = path.join(ROOT, ".scratch/ottotiles");
const MODE = process.env.MODE || "check";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };

(async () => {
  const gone = require(path.join(DIR, "check-2026-11-02.json")).filter((r) => r.live === "GONE" && /^page 404$/.test(r.how));
  if (gone.length !== 25) fail(`expected 25 gone, got ${gone.length}`);
  const c = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }).connect();
  const col = c.db().collection("products");
  const brand = await c.db().collection("brands").findOne({ slug: "otto-tiles" });
  const ps = await col.find({ _id: { $in: gone.map((g) => new ObjectId(g.id)) }, brand: brand._id }).project({ name: 1, slug: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, shopifyVariantId: 1 }).toArray();
  if (ps.length !== 25) fail(`found ${ps.length}/25 in DB`);
  const need = ps.filter((p) => p.stock !== 0 || p.isOutOfStock !== true || (p.stockStatus !== undefined && p.stockStatus !== "out_of_stock"));
  const ids = ps.map((p) => p.shopifyVariantId).filter(Boolean);
  const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked } } } }`, { ids });
  const loc = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
  const shopQ = d.nodes.filter((n) => n && n.inventoryItem.tracked && n.inventoryQuantity !== 0).map((n) => ({ inventoryItemId: n.inventoryItem.id, locationId: loc, quantity: 0 }));
  const sellable = d.nodes.filter((n) => n && (n.inventoryPolicy === "CONTINUE" || !n.inventoryItem.tracked || n.inventoryQuantity > 0)).length;
  console.log(JSON.stringify({ gone: ps.length, dbToUpdate: need.length, shopifyToZero: shopQ.length, stillSellableInShopify: sellable }));
  if (MODE === "apply") {
    const bk = path.join(DIR, `oos-backup-${stamp()}.json`);
    fs.writeFileSync(bk, JSON.stringify({ products: ps, shopify: d.nodes }));
    console.log("backup:", bk);
    if (shopQ.length) {
      const r = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`, { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: shopQ } });
      if (r.inventorySetQuantities.userErrors.length) fail("Shopify: " + JSON.stringify(r.inventorySetQuantities.userErrors));
    }
    console.log("Shopify set to 0:", shopQ.length);
    if (need.length) {
      const r = await col.bulkWrite(need.map((p) => ({ updateOne: { filter: { _id: p._id, brand: brand._id }, update: { $set: { stock: 0, isOutOfStock: true, ...(p.stockStatus !== undefined ? { stockStatus: "out_of_stock" } : {}) } } } })), { ordered: false });
      console.log(`DB matched ${r.matchedCount}, modified ${r.modifiedCount} of ${need.length}`);
      if (r.matchedCount !== need.length) fail("not every product matched");
    }
  }
  await c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
