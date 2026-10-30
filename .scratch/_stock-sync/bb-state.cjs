// Read-only: dump every Better Bathrooms product/variant stock state (DB2 + Shopify) to a JSON file.
//   node .scratch/_stock-sync/bb-state.cjs <out.json>
// Diff two dumps with: node .scratch/_stock-sync/bb-state.cjs --diff <before.json> <after.json> <oos-check.json>
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const BRAND = new ObjectId("6ab7b2c25a35f689d8457179");
const gid = (x) => (String(x).startsWith("gid://") ? String(x) : `gid://shopify/ProductVariant/${x}`);

async function dump(out) {
  const c2 = new MongoClient(env.MONGODB_URL2, { maxPoolSize: 2 }); await c2.connect();
  const ps = await c2.db().collection("products").find({ brand: BRAND }).toArray(); await c2.close();
  const db = {}, ids = [];
  for (const p of ps) {
    db[String(p._id)] = { slug: p.slug, keys: Object.keys(p).sort(), updatedAt: p.updatedAt, stock: p.stock, isOutOfStock: p.isOutOfStock, stockStatus: p.stockStatus,
      variants: (p.variants || []).map((v) => ({ k: v.sourceUrl + "|" + v.sku, keys: Object.keys(v).sort(), available: v.available, stock: v.stock, sid: gid(v.shopifyVariantId) })) };
    for (const v of p.variants || []) ids.push(gid(v.shopifyVariantId));
  }
  const shop = {};
  for (let i = 0; i < ids.length; i += 100) {
    const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ tracked } } } }`, { ids: ids.slice(i, i + 100) });
    for (const n of d.nodes) if (n) shop[n.id] = { policy: n.inventoryPolicy, tracked: n.inventoryItem.tracked, qty: n.inventoryQuantity };
  }
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), db, shop }));
  console.log(`dumped ${ps.length} products, ${ids.length} variants, ${Object.keys(shop).length} Shopify variants → ${out}`);
}

function diff(bf, af, cf) {
  const B = JSON.parse(fs.readFileSync(bf)), A = JSON.parse(fs.readFileSync(af)), C = JSON.parse(fs.readFileSync(cf));
  const planned = new Map(C.plan.map((x) => [x.slug, x.$set]));
  const plannedShop = new Set(C.toZero.map((x) => x.id));
  const problems = [];
  let prodChanged = 0, varChanged = 0, shopChanged = 0;
  for (const [id, b] of Object.entries(B.db)) {
    const a = A.db[id]; if (!a) { problems.push(`product gone ${b.slug}`); continue; }
    if (b.keys.join() !== a.keys.join()) problems.push(`product fields changed ${b.slug}`);
    if (String(b.updatedAt) !== String(a.updatedAt)) problems.push(`updatedAt changed ${b.slug}`);
    const set = planned.get(b.slug) || {};
    const pc = ["stock", "isOutOfStock", "stockStatus"].filter((f) => b[f] !== a[f]);
    if (pc.length) prodChanged++;
    for (const f of pc) if (!(f in set) || set[f] !== a[f]) problems.push(`unplanned product change ${b.slug}.${f}: ${b[f]} → ${a[f]}`);
    for (const f of ["stock", "isOutOfStock", "stockStatus"]) if (f in set && a[f] !== set[f]) problems.push(`product target missed ${b.slug}.${f}`);
    if (b.variants.length !== a.variants.length) { problems.push(`variant count changed ${b.slug}`); continue; }
    b.variants.forEach((bv, i) => {
      const av = a.variants[i];
      if (bv.k !== av.k) problems.push(`variant order/key changed ${b.slug}`);
      if (bv.keys.join() !== av.keys.join()) problems.push(`variant fields changed ${b.slug} ${bv.k}`);
      const willOut = plannedShop.has(bv.sid);
      if (bv.available !== av.available || bv.stock !== av.stock) {
        varChanged++;
        if (!willOut || av.available !== false || av.stock !== 0) problems.push(`unplanned variant change ${b.slug} ${bv.k}`);
      } else if (willOut && (av.available !== false || av.stock !== 0)) problems.push(`variant target missed ${b.slug} ${bv.k}`);
      const bs = B.shop[bv.sid], as = A.shop[av.sid];
      if (!bs || !as) { problems.push(`shopify variant missing ${bv.sid}`); return; }
      if (bs.policy !== as.policy || bs.tracked !== as.tracked) problems.push(`shopify setting changed ${bv.sid}`);
      if (bs.qty !== as.qty) { shopChanged++; if (!willOut || as.qty !== 0) problems.push(`unplanned shopify qty ${bv.sid}: ${bs.qty} → ${as.qty}`); }
      else if (willOut && as.qty !== 0) problems.push(`shopify target missed ${bv.sid}`);
    });
  }
  console.log(JSON.stringify({ productsChanged: prodChanged, variantsChanged: varChanged, shopifyQtyChanged: shopChanged, problems: problems.length, firstProblems: problems.slice(0, 15) }, null, 1));
  if (problems.length) process.exit(3);
}

if (process.argv[2] === "--diff") diff(process.argv[3], process.argv[4], process.argv[5]);
else dump(process.argv[2]).catch((e) => { console.error("ERR", e.message); process.exit(1); });
