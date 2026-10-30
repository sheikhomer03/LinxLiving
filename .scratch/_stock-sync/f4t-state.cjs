// Read-only: dump every Floors4Trade product/variant stock state (DB1 + every Shopify variant of its products).
//   node .scratch/_stock-sync/f4t-state.cjs <out.json>
//   node .scratch/_stock-sync/f4t-state.cjs --diff <before.json> <after.json> <oos-check.json>
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const BRAND = new ObjectId("6a95c821c9d22d205a0de176");

async function dump(out) {
  const c = new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }); await c.connect();
  const ps = await c.db().collection("products").find({ brand: BRAND }).toArray(); await c.close();
  const db = {};
  for (const p of ps) db[String(p._id)] = { slug: p.slug, keys: Object.keys(p).sort(), updatedAt: p.updatedAt, stock: p.stock, isOutOfStock: p.isOutOfStock, stockStatus: p.stockStatus,
    variants: (p.variants || []).map((v) => ({ k: v.name + "|" + v.sku, keys: Object.keys(v).sort(), available: v.available, stock: v.stock })) };
  const shop = {}, pids = ps.map((p) => p.shopifyProductId).filter(Boolean);
  for (let i = 0; i < pids.length; i += 50) {
    const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id status variants(first:100){ nodes{ id inventoryPolicy inventoryQuantity inventoryItem{ tracked } } } } } }`, { ids: pids.slice(i, i + 50) });
    for (const n of d.nodes) if (n) for (const v of n.variants.nodes) shop[v.id] = { product: n.id, status: n.status, policy: v.inventoryPolicy, tracked: v.inventoryItem.tracked, qty: v.inventoryQuantity };
  }
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), db, shop }));
  console.log(`dumped ${ps.length} products, ${Object.keys(shop).length} Shopify variants → ${out}`);
}

function diff(bf, af, cf) {
  const B = JSON.parse(fs.readFileSync(bf)), A = JSON.parse(fs.readFileSync(af)), C = JSON.parse(fs.readFileSync(cf));
  const planned = new Map(C.plan.map((x) => [x.slug, x.$set])), zero = new Set(C.toZero.map((x) => x.id));
  const problems = []; let prod = 0, vars = 0, shopQ = 0;
  for (const [id, b] of Object.entries(B.db)) {
    const a = A.db[id]; if (!a) { problems.push(`product gone ${b.slug}`); continue; }
    if (b.keys.join() !== a.keys.join()) problems.push(`product fields changed ${b.slug}`);
    if (String(b.updatedAt) !== String(a.updatedAt)) problems.push(`updatedAt changed ${b.slug}`);
    const set = planned.get(b.slug) || {};
    for (const f of ["stock", "isOutOfStock", "stockStatus"]) {
      if (b[f] !== a[f]) { if (!(f in set) || set[f] !== a[f]) problems.push(`unplanned ${b.slug}.${f}: ${b[f]} → ${a[f]}`); }
      else if (f in set && a[f] !== set[f]) problems.push(`target missed ${b.slug}.${f}`);
    }
    if (["stock", "isOutOfStock", "stockStatus"].some((f) => b[f] !== a[f])) prod++;
    if (b.variants.length !== a.variants.length) { problems.push(`variant count changed ${b.slug}`); continue; }
    b.variants.forEach((bv, i) => { const av = a.variants[i];
      if (bv.k !== av.k || bv.keys.join() !== av.keys.join()) problems.push(`variant key/fields changed ${b.slug} ${bv.k}`);
      if (bv.available !== av.available || bv.stock !== av.stock) { vars++; const ks = Object.keys(set).filter((k) => k.startsWith("variants.")); if (!ks.length) problems.push(`unplanned variant change ${b.slug} ${bv.k}`); } });
  }
  for (const [vid, b] of Object.entries(B.shop)) {
    const a = A.shop[vid]; if (!a) { problems.push(`shopify variant gone ${vid}`); continue; }
    if (b.policy !== a.policy || b.tracked !== a.tracked || b.status !== a.status) problems.push(`shopify setting/status changed ${vid}`);
    if (b.qty !== a.qty) { shopQ++; if (!zero.has(vid) || a.qty !== 0) problems.push(`unplanned shopify qty ${vid}: ${b.qty} → ${a.qty}`); }
    else if (zero.has(vid) && a.qty !== 0) problems.push(`shopify target missed ${vid}`);
  }
  console.log(JSON.stringify({ productsChanged: prod, variantsChanged: vars, shopifyQtyChanged: shopQ, problems: problems.length, firstProblems: problems.slice(0, 15) }, null, 1));
  if (problems.length) process.exit(3);
}
if (process.argv[2] === "--diff") diff(process.argv[3], process.argv[4], process.argv[5]);
else dump(process.argv[2]).catch((e) => { console.error("ERR", e.message); process.exit(1); });
