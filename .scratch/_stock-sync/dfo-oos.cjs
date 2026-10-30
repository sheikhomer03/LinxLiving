// Direct Flooring Online: apply OUT-OF-STOCK from the verified snapshot (.scratch/directflooringonline/).
// Sources: live-soldout-*.txt (sold out on their stock API) + verdicts.json (old URLs: 410/404, replaced, renamed-sold-out).
// No requests to their site. MODE=check (default) | apply. Existing fields only:
// DB1 product stock/isOutOfStock/stockStatus; Shopify qty 0 on tracked variants. In-stock products untouched.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const DIR = path.join(ROOT, ".scratch/directflooringonline");
const MODE = process.env.MODE || "check";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const lines = (f) => fs.readFileSync(path.join(DIR, f), "utf8").split("\n").map((s) => s.trim()).filter(Boolean);

const soldLive = new Set(lines("live-soldout-2026-10-30.txt"));
const v = require(path.join(DIR, "verdicts.json"));
const outOld = new Set([...v.out_gone, ...v.out_replaced, ...v.out_renamed_soldout]);
const why = (h) => soldLive.has(h) ? "sold out on live" : v.out_gone.includes(h) ? "removed (410/404)" : v.out_replaced.includes(h) ? "discontinued (redirects to another product)" : "renamed, sold out";
const handleOf = (u) => (String(u || "").match(/\/product\/([^/?#]+)/) || [])[1] || null;

(async () => {
  const c = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }).connect();
  const col = c.db().collection("products");
  const brand = await c.db().collection("brands").findOne({ slug: "direct-flooring-online" });
  const ours = await col.find({ brand: brand._id }).project({ name: 1, slug: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, shopifyVariantId: 1, "specs.sourceUrl": 1 }).toArray();
  const targets = ours.filter((p) => { const h = handleOf(p.specs?.sourceUrl); return soldLive.has(h) || outOld.has(h); });
  if (targets.length !== 50) fail(`expected 50 targets, got ${targets.length}`);
  const needDb = targets.filter((p) => p.stock !== 0 || p.isOutOfStock !== true || p.stockStatus !== "out_of_stock");

  const sids = targets.map((p) => p.shopifyVariantId).filter(Boolean);
  const shop = new Map();
  for (let i = 0; i < sids.length; i += 100) {
    const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked } } } }`, { ids: sids.slice(i, i + 100) });
    for (const n of d.nodes) if (n) shop.set(n.id, n);
  }
  const location = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
  const shopQ = sids.map((id) => shop.get(id)).filter((n) => n && n.inventoryItem.tracked && n.inventoryQuantity !== 0).map((n) => ({ inventoryItemId: n.inventoryItem.id, locationId: location, quantity: 0 }));
  const sellable = sids.map((id) => shop.get(id)).filter((n) => n && (n.inventoryPolicy === "CONTINUE" || !n.inventoryItem.tracked)).length;

  const byWhy = {}; targets.forEach((p) => { const k = why(handleOf(p.specs.sourceUrl)); byWhy[k] = (byWhy[k] || 0) + 1; });
  console.log(JSON.stringify({ ourProducts: ours.length, toMarkOut: targets.length, byReason: byWhy, dbToUpdate: needDb.length, shopifyLinked: sids.length, shopifyToZero: shopQ.length, stillSellableInShopify: sellable }, null, 1));

  if (MODE === "apply") {
    const bk = path.join(DIR, `oos-backup-${stamp()}.json`);
    fs.writeFileSync(bk, JSON.stringify({ products: targets, shopify: sids.map((id) => shop.get(id)).filter(Boolean) }));
    console.log("backup:", bk);
    for (let i = 0; i < shopQ.length; i += 250) {
      const d = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`,
        { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: shopQ.slice(i, i + 250) } });
      if (d.inventorySetQuantities.userErrors.length) fail("Shopify: " + JSON.stringify(d.inventorySetQuantities.userErrors).slice(0, 300));
      await sleep(300);
    }
    console.log("Shopify set to 0:", shopQ.length);
    if (needDb.length) {
      const r = await col.bulkWrite(needDb.map((p) => ({ updateOne: { filter: { _id: p._id, brand: brand._id }, update: { $set: { stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" } } } })), { ordered: false });
      console.log(`DB matched ${r.matchedCount}, modified ${r.modifiedCount} of ${needDb.length}`);
      if (r.matchedCount !== needDb.length) fail("not every product matched");
    }
  }
  await c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
