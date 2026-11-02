// Noken (DB1): mark products removed from noken.com (404) out of stock — DATABASE ONLY (all Noken Shopify products are
// DRAFT; user said do not touch them). Input: .scratch/noken/removed-from-noken-2026-11-02.json (from nk-snapshot.cjs).
//   node .scratch/_stock-sync/nk-oos.cjs              (check: re-confirms each page is still 404, shows plan)
//   MODE=apply node .scratch/_stock-sync/nk-oos.cjs   (backup + write + full before/after diff of every Noken product)
// Existing fields only: product stock 0 / isOutOfStock true / stockStatus out_of_stock; every variant available false
// (+ variant stock 0 where present). updatedAt untouched (raw driver).
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const MODE = process.env.MODE || "check";
const BRAND = new ObjectId("6a6b9d78a00dad2200fa2fd0");
const DIR = path.join(ROOT, ".scratch/noken");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const snap = (p) => ({ keys: Object.keys(p).sort().join(), updatedAt: String(p.updatedAt), stock: p.stock, isOutOfStock: p.isOutOfStock, stockStatus: p.stockStatus,
  v: (p.variants || []).map((v) => [Object.keys(v).sort().join(), v.available, v.stock]) });

(async () => {
  const removed = JSON.parse(fs.readFileSync(path.join(DIR, "removed-from-noken-2026-11-02.json"), "utf8"));
  const slugs = removed.map((r) => r.ours.split("/products/")[1]);
  const c = new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }); await c.connect();
  try {
    const col = c.db().collection("products");
    const all = await col.find({ brand: BRAND }).toArray();
    const targets = all.filter((p) => slugs.includes(p.slug));
    if (targets.length !== removed.length) fail(`expected ${removed.length} products, found ${targets.length}`);

    // re-confirm each page is still gone right now
    let still404 = 0; const back = [];
    for (const p of targets) {
      let r = null;
      for (let a = 0; a < 5 && !r; a++) { r = await fetch(p.specs.sourceUrl, { headers: { "user-agent": UA } }).catch(() => null); if (!r) await sleep(5000 * (a + 1)); }
      if (!r) fail(`no response for ${p.specs.sourceUrl}`);
      if (r.status === 404) still404++; else back.push(`${p.slug} → ${r.status}`);
      await sleep(600);
    }
    if (back.length) fail(`pages no longer 404: ${back.join(", ")}`);

    const ops = [], plan = [];
    for (const p of targets) {
      const $set = {};
      if ("stock" in p && p.stock !== 0) $set.stock = 0;
      if ("isOutOfStock" in p && p.isOutOfStock !== true) $set.isOutOfStock = true;
      if ("stockStatus" in p && p.stockStatus !== "out_of_stock") $set.stockStatus = "out_of_stock";
      (p.variants || []).forEach((v, i) => {
        if ("available" in v && v.available !== false) $set[`variants.${i}.available`] = false;
        if ("stock" in v && v.stock !== 0) $set[`variants.${i}.stock`] = 0;
      });
      if (Object.keys($set).length) { ops.push({ updateOne: { filter: { _id: p._id, brand: BRAND, "variants.0.sku": p.variants && p.variants[0] ? p.variants[0].sku : { $exists: false } }, update: { $set } } }); plan.push({ slug: p.slug, fields: Object.keys($set).length }); }
    }
    console.log(JSON.stringify({ nokenProducts: all.length, removedFromNoken: targets.length, still404, productsToWrite: ops.length, optionsAffected: targets.reduce((a, p) => a + (p.variants || []).length, 0), shopifyWrites: 0 }, null, 1));
    if (MODE !== "apply") return;

    const ts = stamp();
    const backup = targets.map((p) => ({ _id: p._id, slug: p.slug, stock: p.stock, isOutOfStock: p.isOutOfStock, stockStatus: p.stockStatus, variants: (p.variants || []).map((v) => ({ sku: v.sku, available: v.available, stock: v.stock })) }));
    fs.writeFileSync(path.join(DIR, `oos-backup-${ts}.json`), JSON.stringify(backup, null, 1));
    console.log(`backup: .scratch/noken/oos-backup-${ts}.json`);
    const before = new Map(all.map((p) => [String(p._id), snap(p)]));
    const r = await col.bulkWrite(ops, { ordered: false });
    console.log(`db: matched ${r.matchedCount}, modified ${r.modifiedCount} of ${ops.length}`);
    if (r.matchedCount !== ops.length) fail("matched != planned");

    // verify: every Noken product re-read; only the targets changed, and only their stock fields
    const after = await col.find({ brand: BRAND }).toArray();
    const targetIds = new Set(targets.map((p) => String(p._id)));
    const problems = []; let changed = 0;
    for (const p of after) {
      const b = before.get(String(p._id)), a = snap(p);
      if (!b) { problems.push(`new product ${p.slug}`); continue; }
      if (b.keys !== a.keys || b.updatedAt !== a.updatedAt) problems.push(`fields/updatedAt changed ${p.slug}`);
      if (b.v.length !== a.v.length || b.v.some((x, i) => x[0] !== a.v[i][0])) problems.push(`variant fields changed ${p.slug}`);
      const diff = JSON.stringify(b) !== JSON.stringify(a);
      if (diff) changed++;
      if (targetIds.has(String(p._id))) {
        if (("stock" in p && p.stock !== 0) || ("isOutOfStock" in p && p.isOutOfStock !== true) || ("stockStatus" in p && p.stockStatus !== "out_of_stock") || (p.variants || []).some((v) => v.available !== false || ("stock" in v && v.stock !== 0))) problems.push(`target not out of stock ${p.slug}`);
      } else if (diff) problems.push(`non-target changed ${p.slug}`);
    }
    if (after.length !== all.length) problems.push(`product count ${all.length} → ${after.length}`);
    console.log(JSON.stringify({ productsChanged: changed, problems: problems.length, firstProblems: problems.slice(0, 10) }, null, 1));
    if (problems.length) process.exit(3);
  } finally { await c.close(); }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
