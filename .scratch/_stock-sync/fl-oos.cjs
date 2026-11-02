// Frontline Bathrooms (DB1): F-codes "Out of Stock" on Frontline's public Stock Checker → out of stock on ours (DB + Shopify).
//   SNAP=.scratch/frontlinebathrooms/stock-2026-11-02.jsonl node .scratch/_stock-sync/fl-oos.cjs             (check, read-only)
//   MODE=apply SNAP=… node .scratch/_stock-sync/fl-oos.cjs                                                     (backup + write)
// Match: variant sku = F-code (our "-n" duplicate suffix maps to the base code). Codes missing from the checker are
// unresolved → that product is skipped (never guessed). Existing fields only: variant available false + stock 0;
// product stock 0 / isOutOfStock true / stockStatus out_of_stock only when every variant is out (partly-out products keep
// their stock). Shopify: qty 0 for tracked sold-out variants. No settings changed. In-stock untouched.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const MODE = process.env.MODE || "check";
const SNAP = path.resolve(ROOT, process.env.SNAP || `.scratch/frontlinebathrooms/stock-${new Date().toISOString().slice(0, 10)}.jsonl`);
const DIR = path.join(ROOT, ".scratch/frontlinebathrooms");
const BRAND = new ObjectId("6abcf8a8cd37dbea4893b95a");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const gid = (x) => (String(x).startsWith("gid://") ? String(x) : `gid://shopify/ProductVariant/${x}`);

(async () => {
  // live: code → "in" | "out" (conflicting rows → "conflict")
  const pages = fs.readFileSync(SNAP, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const total = pages[0] && pages.find((p) => p.total) ? pages.find((p) => p.total).total : 0;
  const live = new Map(), statusSeen = {};
  for (const pg of pages) for (const r of pg.rows) {
    const code = r.code.toUpperCase(); if (!code) continue;
    statusSeen[r.statusClass || "none"] = (statusSeen[r.statusClass || "none"] || 0) + 1;
    const s = r.statusClass === "stocked" || r.statusClass === "special-order" ? "in" : r.statusClass === "not-stocked" ? "out" : null; // special order = orderable (5 days)
    if (!s) continue;
    const prev = live.get(code);
    live.set(code, prev && prev.s !== s ? { s: "conflict", rows: [...prev.rows, r] } : { s, rows: [...(prev ? prev.rows : []), r] });
  }
  const rowsRead = pages.reduce((a, p) => a + p.rows.length, 0);
  console.log(`snapshot: ${pages.length} pages, ${rowsRead} rows (site says ${total}), ${live.size} codes, statuses ${JSON.stringify(statusSeen)}`);
  if (rowsRead < total * 0.98) fail(`snapshot incomplete: ${rowsRead} of ${total} rows`);

  const c1 = new MongoClient(env.MONGODB_URI, { maxPoolSize: 3 }); await c1.connect();
  const c2 = new MongoClient(env.MONGODB_URL2, { maxPoolSize: 2 }); await c2.connect();
  try {
    const strays = await c2.db().collection("products").countDocuments({ brand: BRAND });
    const col = c1.db().collection("products");
    const ours = await col.find({ brand: BRAND }).project({ name: 1, slug: 1, sourceUrl: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, variants: 1 }).toArray();
    const skus = new Set(); let nVar = 0;
    for (const p of ours) for (const v of p.variants || []) { nVar++; if (!v.sku) fail(`variant without sku in ${p.slug}`); if (skus.has(v.sku)) fail(`duplicate sku ${v.sku}`); skus.add(v.sku); }
    // "-n" SKUs are our suffix for a second item sharing one Frontline code: use the base code only when the checker's
    // description shares a real word with our option name (e.g. colour/size), otherwise unresolved.
    const STOP = new Set(["matt", "the", "and", "with", "for", "unit", "only"]);
    const toks = (t) => new Set(String(t).toLowerCase().replace(/&#0?38;|&amp;/g, " ").replace(/(\d+)\s*mm\b/g, "$1").split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));
    const lookup = (sku, vname) => {
      const s = String(sku).trim().toUpperCase();
      if (live.has(s)) return live.get(s);
      if (!/^F\d{5}-\d+$/.test(s)) return null;
      const base = live.get(s.replace(/-\d+$/, "")); if (!base) return null;
      const vt = toks(vname), ok = base.rows.every((r) => [...toks(r.desc)].some((w) => vt.has(w)));
      return ok ? base : null;
    };

    const counts = { soldOutOnLive: 0, alreadyRight: 0, dbVariantsToFix: 0, backInStockOnLiveButOutOnOurs: 0, unresolved: 0 };
    const skipped = [], dbOps = [], plan = [], shopVars = [], examples = { full: [], partial: [] };
    for (const p of ours) {
      const vs = (p.variants || []).map((v) => ({ v, l: lookup(v.sku, v.name) }));
      const bad = vs.filter((x) => !x.l || x.l.s === "conflict");
      if (bad.length) { counts.unresolved += bad.length; skipped.push({ slug: p.slug, name: p.name, codes: bad.map((x) => `${x.v.sku}${x.l ? " (conflicting rows)" : " (not in stock checker)"}`) }); continue; }
      const $set = {}, af = []; let allOut = vs.length > 0;
      vs.forEach(({ v, l }, i) => {
        if (l.s !== "out") { allOut = false; if (v.available === false) counts.backInStockOnLiveButOutOnOurs++; return; }
        counts.soldOutOnLive++;
        shopVars.push({ id: gid(v.shopifyVariantId), single: vs.length === 1 });
        if (v.available === false && (v.stock === undefined || v.stock === 0)) { counts.alreadyRight++; return; }
        counts.dbVariantsToFix++;
        $set[`variants.$[v${i}].available`] = false;
        if (v.stock !== undefined) $set[`variants.$[v${i}].stock`] = 0;
        af.push({ [`v${i}.sku`]: v.sku });
      });
      if (allOut && (p.stock !== 0 || p.isOutOfStock !== true || p.stockStatus !== "out_of_stock")) Object.assign($set, { stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" });
      const out = vs.filter((x) => x.l.s === "out");
      if (out.length) (allOut ? examples.full : examples.partial).push({ name: p.name, ours: `https://www.linxsquare.co.uk/products/${p.slug}`, live: p.sourceUrl, out: out.map((x) => `${x.v.name} [${x.v.sku}: ${x.l.rows[0].status}${x.l.rows[0].availability ? " / " + x.l.rows[0].availability : ""}]`).slice(0, 3), outOf: `${out.length}/${vs.length}` });
      if (Object.keys($set).length) { dbOps.push({ updateOne: { filter: { _id: p._id, brand: BRAND }, update: { $set }, ...(af.length ? { arrayFilters: af } : {}) } }); plan.push({ slug: p.slug, $set }); }
    }

    const location = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
    const toZero = [], notTracked = [], missing = [], notStocked = [];
    for (let i = 0; i < shopVars.length; i += 100) {
      const chunk = shopVars.slice(i, i + 100);
      const d = await gql(`query($ids:[ID!]!,$loc:ID!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked inventoryLevel(locationId:$loc){ id } } } } }`, { ids: chunk.map((x) => x.id), loc: location });
      d.nodes.forEach((n, j) => {
        if (!n) return missing.push(chunk[j].id);
        if (!n.inventoryItem.tracked) return notTracked.push({ id: n.id, policy: n.inventoryPolicy });
        if (!n.inventoryItem.inventoryLevel) return notStocked.push(n.id);
        if (n.inventoryQuantity !== 0) toZero.push({ id: n.id, inventoryItemId: n.inventoryItem.id, policy: n.inventoryPolicy, tracked: true, qty: n.inventoryQuantity, single: chunk[j].single });
      });
    }
    const report = { brand: "Frontline Bathrooms", cluster: "primary (DB1)", strayProductsInDB2: strays, liveCodes: live.size, ourProducts: ours.length, ourVariants: nVar, ...counts,
      productsSkipped: skipped.length, dbProductsToUpdate: dbOps.length, productsFullyOut: examples.full.length, productsPartlyOut: examples.partial.length,
      shopifyVariantsToZero: toZero.length, shopifyNotTracked: notTracked.length, shopifyMissing: missing.length, shopifyNotStockedAtLocation: notStocked.length };
    const ts = stamp();
    fs.writeFileSync(path.join(DIR, `oos-check-${ts}.json`), JSON.stringify({ report, skipped, plan, toZero, notTracked, missing, notStocked, examples }, null, 1));
    console.log(JSON.stringify(report, null, 1));
    console.log("examples:", JSON.stringify({ full: examples.full.slice(0, 3), partial: examples.partial.slice(0, 3) }, null, 1));
    console.log("skipped (first 10):", JSON.stringify(skipped.slice(0, 10)));
    if (MODE !== "apply") return;

    if (counts.unresolved > nVar * 0.01 && !process.env.ALLOW_SKIP) fail(`unresolved ${counts.unresolved} > 1% of ${nVar}`);
    const backupDb = await col.find({ _id: { $in: dbOps.map((o) => o.updateOne.filter._id) } }).project({ stock: 1, isOutOfStock: 1, stockStatus: 1, "variants.sku": 1, "variants.available": 1, "variants.stock": 1 }).toArray();
    fs.writeFileSync(path.join(DIR, `oos-backup-${ts}.json`), JSON.stringify({ db: backupDb, shopify: toZero, location }, null, 1));
    console.log(`backup: .scratch/frontlinebathrooms/oos-backup-${ts}.json`);
    const ordered = [...toZero.filter((x) => !x.single), ...toZero.filter((x) => x.single)];
    let zeroed = 0; const errs = [];
    for (let i = 0; i < ordered.length; i += 250) {
      const chunk = ordered.slice(i, i + 250);
      const d = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`, { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: chunk.map((x) => ({ inventoryItemId: x.inventoryItemId, locationId: location, quantity: 0 })) } });
      const ue = d.inventorySetQuantities.userErrors; if (ue.length) { errs.push(...ue); if (ue.length >= chunk.length / 2) fail(`systematic Shopify errors ${JSON.stringify(ue.slice(0, 3))}`); }
      zeroed += chunk.length - ue.length; await sleep(500);
    }
    console.log(`shopify: set 0 on ${zeroed}/${ordered.length}`, errs.length ? JSON.stringify(errs.slice(0, 5)) : "");
    if (dbOps.length) { const r = await col.bulkWrite(dbOps, { ordered: false }); console.log(`db: matched ${r.matchedCount}, modified ${r.modifiedCount} of ${dbOps.length}`); if (r.matchedCount !== dbOps.length) fail("matched != planned"); }
    console.log("APPLIED — run the check again to verify");
  } finally { await c1.close(); await c2.close(); }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
