// Better Bathrooms (DB2): make everything sold out / discontinued / gone on betterbathrooms.com out of stock on ours.
// Live data comes from the snapshot .scratch/betterbathrooms/stock-<date>.jsonl (product pages: ProductGroup.hasVariant
// sku → availability, plus dataLayer stockStatus/discontinued; variant pages fetched where the group doesn't list our SKU).
//   SNAP=.scratch/betterbathrooms/stock-2026-10-30.jsonl node .scratch/_stock-sync/bb-oos.cjs              (check, read-only)
//   MODE=apply SNAP=… node .scratch/_stock-sync/bb-oos.cjs                                                     (backup + write)
// Writes existing fields only. DB: variant available + variant stock → 0 (every BB variant already has `stock`);
// product stock/isOutOfStock/stockStatus only when every variant is sold out (partly-out products keep their stock).
// Shopify: qty 0 at the active location for sold-out variants that are tracked. No settings changed. In-stock untouched.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));

const MODE = process.env.MODE || "check";
const SNAP = path.resolve(ROOT, process.env.SNAP || ".scratch/betterbathrooms/stock-2026-10-30.jsonl");
const DIR = path.join(ROOT, ".scratch/betterbathrooms");
const BRAND = new ObjectId("6ab7b2c25a35f689d8457179");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const gid = (x) => (String(x).startsWith("gid://") ? String(x) : `gid://shopify/ProductVariant/${x}`);

// availability string → "in" | "out" | "other:<x>"
const norm = (a) => {
  const t = String(a || "").replace(/^https?:\/\/schema\.org\//, "");
  if (t === "InStock") return "in";
  if (["OutOfStock", "SoldOut", "Discontinued"].includes(t)) return "out";
  return `other:${t || "none"}`;
};

function liveFor(v, p, rec) {
  // candidate pages: the variant's own page first (when we fetched it), then the product page
  for (const r of [rec.get(v.sourceUrl), rec.get(p.sourceUrl)]) {
    if (!r) continue;
    if (r.status === 404 || r.status === 410) { if (r.url === v.sourceUrl || r.url === p.sourceUrl && !rec.get(v.sourceUrl)) return { s: "out", why: "gone (404)" }; continue; }
    if (r.status !== 200) continue;
    if (r.url === v.sourceUrl && !/\/p\//.test(r.finalUrl || "")) return { s: "out", why: "gone (redirects off product pages)" };
    const sku = String(v.sku).trim(), t = (x) => String(x || "").trim();
    const vals = (r.group || []).filter((g) => t(g[0]) === sku).map((g) => norm(g[1]));
    if (t(r.pageSku) === sku) vals.push(r.discontinued === "True" ? "out" : norm(r.stockStatus));
    const u = [...new Set(vals)];
    if (u.length === 1) return { s: u[0], why: u[0] === "out" ? (r.discontinued === "True" && t(r.pageSku) === sku ? "discontinued" : "sold out/discontinued") : u[0] };
    if (u.length > 1) return { s: "unresolved", why: `conflicting ${u.join(",")}` };
  }
  return { s: "unresolved", why: "not found on live" };
}

(async () => {
  const rec = new Map();
  for (const l of fs.readFileSync(SNAP, "utf8").split("\n")) if (l) { const o = JSON.parse(l); rec.set(o.url, o); }
  const c2 = new MongoClient(env.MONGODB_URL2, { maxPoolSize: 3 }); await c2.connect();
  const c1 = new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }); await c1.connect();
  try {
    const strays = await c1.db().collection("products").countDocuments({ brand: BRAND });
    const col = c2.db().collection("products");
    const ours = await col.find({ brand: BRAND }).project({ name: 1, slug: 1, sourceUrl: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, category: 1, "specs.retired": 1, variants: 1 }).toArray();

    // match key = variant sourceUrl (+ sku); must be complete and unique within each product
    let nVar = 0;
    for (const p of ours) {
      const seen = new Set();
      for (const v of p.variants || []) {
        nVar++;
        if (!v.sourceUrl || !v.sku) fail(`variant without sourceUrl/sku in ${p.slug}`);
        const k = v.sourceUrl + "|" + v.sku; if (seen.has(k)) fail(`duplicate match key in ${p.slug}: ${k}`); seen.add(k);
      }
    }

    const counts = { soldOutOnLive: 0, alreadyRight: 0, dbVariantsToFix: 0, backInStockOnLiveButOutOnOurs: 0, otherLabels: {}, unresolved: 0 };
    const skipped = [], dbOps = [], plan = [], shopVars = [], examples = { full: [], partial: [], gone: [] };
    for (const p of ours) {
      const vs = (p.variants || []).map((v) => ({ v, l: liveFor(v, p, rec) }));
      const unres = vs.filter((x) => x.l.s === "unresolved");
      if (unres.length) { counts.unresolved += unres.length; skipped.push({ slug: p.slug, name: p.name, reasons: [...new Set(unres.map((x) => x.l.why))] }); continue; }
      const $set = {}, af = [];
      let allOut = true;
      vs.forEach(({ v, l }, i) => {
        if (l.s.startsWith("other:")) counts.otherLabels[l.s] = (counts.otherLabels[l.s] || 0) + 1;
        if (l.s !== "out") { allOut = false; if (l.s === "in" && v.available === false) counts.backInStockOnLiveButOutOnOurs++; return; }
        counts.soldOutOnLive++;
        shopVars.push({ id: gid(v.shopifyVariantId), single: vs.length === 1, slug: p.slug });
        if (v.available === false && (v.stock === undefined || v.stock === 0)) { counts.alreadyRight++; return; }
        counts.dbVariantsToFix++;
        $set[`variants.$[v${i}].available`] = false;
        if (v.stock !== undefined) $set[`variants.$[v${i}].stock`] = 0;
        af.push({ [`v${i}.sourceUrl`]: v.sourceUrl, [`v${i}.sku`]: v.sku });
      });
      if (allOut && (p.stock !== 0 || p.isOutOfStock !== true || p.stockStatus !== "out_of_stock")) Object.assign($set, { stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" });
      const outN = vs.filter((x) => x.l.s === "out").length;
      if (outN) {
        const ex = { name: p.name, ours: `https://www.linxsquare.co.uk/products/${p.slug}`, live: p.sourceUrl, retired: !!(p.specs && p.specs.retired), out: vs.filter((x) => x.l.s === "out").map((x) => `${x.v.name} (${x.l.why})`).slice(0, 3) };
        (vs.every((x) => /gone/.test(x.l.why)) ? examples.gone : allOut ? examples.full : examples.partial).push(ex);
      }
      if (Object.keys($set).length) {
        // validate targets
        for (const [k, val] of Object.entries($set)) if (/stock$/.test(k) && (!Number.isInteger(val) || val < 0)) fail(`bad target ${k}=${val} in ${p.slug}`);
        dbOps.push({ updateOne: { filter: { _id: p._id, brand: BRAND }, update: { $set }, ...(af.length ? { arrayFilters: af } : {}) } });
        plan.push({ slug: p.slug, $set });
      }
    }
    if (counts.unresolved > nVar * 0.01) console.warn(`WARNING: ${counts.unresolved} unresolved variants (> 1% of ${nVar}) — those products are skipped`);

    // Shopify state for the sold-out variants
    const location = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
    const shop = new Map();
    for (let i = 0; i < shopVars.length; i += 100) {
      const d = await gql(`query($ids:[ID!]!,$loc:ID!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked inventoryLevel(locationId:$loc){ id } } } } }`, { ids: shopVars.slice(i, i + 100).map((x) => x.id), loc: location });
      for (const n of d.nodes) if (n) shop.set(n.id, n);
    }
    const toZero = [], notTracked = [], missing = [], notStocked = [];
    for (const x of shopVars) {
      const n = shop.get(x.id);
      if (!n) { missing.push(x); continue; }
      if (!n.inventoryItem.tracked) { notTracked.push({ ...x, policy: n.inventoryPolicy }); continue; }
      if (!n.inventoryItem.inventoryLevel) { notStocked.push(x); continue; }
      if (n.inventoryQuantity !== 0) toZero.push({ ...x, inventoryItemId: n.inventoryItem.id, policy: n.inventoryPolicy, tracked: true, qty: n.inventoryQuantity });
    }

    const report = {
      brand: "Better Bathrooms", cluster: "secondary (DB2)", strayProductsInDB1: strays, snapshotPages: rec.size,
      ourProducts: ours.length, ourVariants: nVar, ...counts,
      productsSkippedUnresolved: skipped.length, dbProductsToUpdate: dbOps.length,
      productsFullyOutToFix: plan.filter((x) => x.$set.isOutOfStock === true).length,
      shopifyVariantsToZero: toZero.length, shopifyNotTracked: notTracked.length, shopifyMissing: missing.length, shopifyNotStockedAtLocation: notStocked.length,
    };
    const ts = stamp();
    fs.writeFileSync(path.join(DIR, `oos-check-${ts}.json`), JSON.stringify({ report, skipped, plan, toZero, notTracked, missing, notStocked, examples }, null, 1));
    console.log(JSON.stringify(report, null, 1));
    console.log("examples:", JSON.stringify({ full: examples.full.slice(0, 3), partial: examples.partial.slice(0, 3), gone: examples.gone.slice(0, 3) }, null, 1));
    console.log("skipped (first 5):", JSON.stringify(skipped.slice(0, 5)));
    if (MODE !== "apply") return;

    // ---------- APPLY ----------
    if (counts.unresolved > nVar * 0.01 && !process.env.ALLOW_SKIP) fail("unresolved > 1%");
    // backups
    const dbBackup = ours.filter((p) => plan.some((x) => x.slug === p.slug)).map((p) => ({ _id: p._id, stock: p.stock, isOutOfStock: p.isOutOfStock, stockStatus: p.stockStatus, variants: (p.variants || []).map((v) => ({ sourceUrl: v.sourceUrl, sku: v.sku, available: v.available, stock: v.stock })) }));
    fs.writeFileSync(path.join(DIR, `oos-backup-${ts}.json`), JSON.stringify({ db: dbBackup, shopify: toZero.map((x) => ({ id: x.id, inventoryItemId: x.inventoryItemId, policy: x.policy, tracked: x.tracked, qty: x.qty })), location }, null, 1));
    console.log(`backup: .scratch/betterbathrooms/oos-backup-${ts}.json`);

    // Shopify: multi-variant products first, single-variant last; ≤250 per call
    const ordered = [...toZero.filter((x) => !x.single), ...toZero.filter((x) => x.single)];
    let zeroed = 0, errs = [];
    for (let i = 0; i < ordered.length; i += 250) {
      const chunk = ordered.slice(i, i + 250);
      const d = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`, {
        input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: chunk.map((x) => ({ inventoryItemId: x.inventoryItemId, locationId: location, quantity: 0 })) },
      });
      const ue = d.inventorySetQuantities.userErrors;
      if (ue.length) { errs.push(...ue); if (ue.length >= chunk.length / 2) fail(`systematic Shopify errors: ${JSON.stringify(ue.slice(0, 3))}`); }
      zeroed += chunk.length - ue.length;
      await sleep(500);
    }
    console.log(`shopify: set 0 on ${zeroed}/${ordered.length}`, errs.length ? `errors: ${JSON.stringify(errs.slice(0, 5))}` : "");

    // DB: raw driver, targeted $set + arrayFilters, updatedAt untouched
    if (dbOps.length) {
      const r = await col.bulkWrite(dbOps, { ordered: false });
      console.log(`db: matched ${r.matchedCount}, modified ${r.modifiedCount} of ${dbOps.length}`);
      if (r.matchedCount !== dbOps.length) fail("matched count != products written");
    }
    console.log("APPLIED — run the check again to verify (expect dbProductsToUpdate 0, shopifyVariantsToZero 0)");
  } finally { await c1.close(); await c2.close(); }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
