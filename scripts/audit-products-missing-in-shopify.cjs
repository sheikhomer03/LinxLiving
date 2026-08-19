/**
 * Which products exist in Mongo but not on Shopify?
 *
 * Two different failures wear that description and they need different fixes:
 *
 *   unlinked   the row carries no `shopifyProductId` — it was never pushed.
 *   stale      it carries one, but the id does not resolve on the current shop.
 *              The product was deleted there, or the id belongs to a previous
 *              store. Either way the storefront link is dead and a re-push
 *              would build a second product rather than repair the first.
 *
 * Every stored id is checked, not a sample: `nodes(ids:)` resolves 250 at a
 * time, so the whole catalogue costs a few hundred requests.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-products-missing-in-shopify.cjs
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const col = db.collection("products");
  const brands = await db.collection("brands").find({}).project({ name: 1 }).toArray();
  const brandName = new Map(brands.map((b) => [String(b._id), b.name]));

  const total = await col.countDocuments({});
  const unlinked = await col
    .find({ $or: [{ shopifyProductId: null }, { shopifyProductId: "" }, { shopifyProductId: { $exists: false } }] })
    .project({ name: 1, brand: 1, price: 1, category: 1 })
    .toArray();

  console.log(`catalogue: ${total}`);
  console.log(`never linked to Shopify: ${unlinked.length}`);
  for (const p of unlinked.slice(0, 10)) {
    console.log(`   ${String(p.name).slice(0, 46).padEnd(48)} ${brandName.get(String(p.brand)) || "?"}`);
  }

  // Every distinct stored id, checked against the live shop.
  const linked = await col
    .find({ shopifyProductId: { $nin: [null, ""] } })
    .project({ name: 1, brand: 1, shopifyProductId: 1, shopifyProductUrl: 1 })
    .toArray();
  const byGid = new Map();
  for (const p of linked) {
    if (!byGid.has(p.shopifyProductId)) byGid.set(p.shopifyProductId, []);
    byGid.get(p.shopifyProductId).push(p);
  }
  const ids = [...byGid.keys()];
  console.log(`\nlinked rows: ${linked.length} · distinct Shopify ids: ${ids.length}`);
  console.log(`checking every id against the shop…`);

  const dead = [];
  const statusCount = new Map();
  for (let i = 0; i < ids.length; i += 250) {
    const chunk = ids.slice(i, i + 250);
    const d = await shopifyAdminRequest(
      `query($ids: [ID!]!) { nodes(ids: $ids) { id ... on Product { id status } } }`,
      { ids: chunk },
    );
    const alive = new Map();
    for (const n of d.nodes || []) if (n?.id) alive.set(n.id, n.status || "?");
    for (const gid of chunk) {
      if (alive.has(gid)) {
        const s = alive.get(gid);
        statusCount.set(s, (statusCount.get(s) || 0) + 1);
      } else {
        dead.push(gid);
      }
    }
    if ((i / 250) % 10 === 0) {
      process.stdout.write(`\r  ${Math.min(i + 250, ids.length)}/${ids.length} · ${dead.length} dead so far      `);
    }
  }
  console.log("");

  console.log(`\nresolve on Shopify: ${ids.length - dead.length}/${ids.length}`);
  for (const [s, n] of statusCount) console.log(`   ${s}: ${n}`);
  console.log(`STALE (id stored but not on the shop): ${dead.length}`);

  const report = [];
  for (const gid of dead) {
    for (const p of byGid.get(gid)) {
      report.push({
        _id: String(p._id),
        name: p.name,
        brand: brandName.get(String(p.brand)) || null,
        shopifyProductId: gid,
      });
      console.log(`   ${String(p.name).slice(0, 46).padEnd(48)} ${gid}`);
    }
  }

  const missing = [
    ...unlinked.map((p) => ({
      _id: String(p._id),
      name: p.name,
      brand: brandName.get(String(p.brand)) || null,
      reason: "never-linked",
    })),
    ...report.map((r) => ({ ...r, reason: "stale-id" })),
  ];

  if (missing.length) {
    const out = path.join(process.cwd(), "products-missing-in-shopify.json");
    fs.writeFileSync(out, JSON.stringify(missing, null, 2));
    console.log(`\n${missing.length} product(s) need attention -> ${out}`);
    console.log("fix with:  IDS=<comma-separated> node --require ./scripts/mongo-dns.cjs scripts/sync-all-products-to-shopify.cjs");
  } else {
    console.log("\nevery product in the database resolves on Shopify.");
  }

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => { console.error(e); process.exit(1); });
