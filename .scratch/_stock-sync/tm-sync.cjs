// Tile Mountain (DB2): make our stock match tilemountain.co.uk, as the user asked (2026-11-02):
//   out of stock on live (JSON-LD OutOfStock, or page gone) → DB stock 0 / isOutOfStock true / stockStatus out_of_stock, Shopify qty 0
//   in stock on live                                         → DB stock 500 / isOutOfStock false / stockStatus in_stock, Shopify qty 500
// Shopify (user asked for all products to match live): every main variant → inventoryPolicy DENY + tracked, then qty set.
// Products whose page SKU doesn't match ours, or with an unknown availability, are skipped (never guessed).
//   node .scratch/_stock-sync/tm-sync.cjs                 (check, read-only)
//   MODE=apply node .scratch/_stock-sync/tm-sync.cjs      (backup + write + full verify)
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const MODE = process.env.MODE || "check";
const BRAND = new ObjectId("6aabed1fef4d49fd99f1daf3");
const DIR = path.join(ROOT, ".scratch/tilemountain");
const SNAP = path.join(DIR, process.env.SNAP || "pages-2026-11-02.jsonl");
const IN_QTY = 500;
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const av = (a) => { const t = String(a || "").replace(/^https?:\/\/schema\.org\//, ""); return ["InStock", "BackOrder", "PreOrder", "LimitedAvailability", "OnlineOnly", "InStoreOnly"].includes(t) ? "in" : ["OutOfStock", "SoldOut", "Discontinued"].includes(t) ? "out" : null; };

async function shopifyState(ps, location) {
  const st = new Map();
  for (let i = 0; i < ps.length; i += 40) {
    const ch = ps.slice(i, i + 40);
    const d = await gql(`query($ids:[ID!]!,$loc:ID!){ nodes(ids:$ids){ ... on Product { id status variants(first:20){ nodes{ id title inventoryPolicy inventoryQuantity inventoryItem{ id tracked inventoryLevel(locationId:$loc){ id } } } } } } }`, { ids: ch.map((p) => p.shopifyProductId), loc: location });
    d.nodes.forEach((n, j) => st.set(String(ch[j]._id), n));
  }
  return st;
}

(async () => {
  const pages = new Map(fs.readFileSync(SNAP, "utf8").split("\n").filter(Boolean).map((l) => { const o = JSON.parse(l); return [o.url, o]; }));
  const c1 = new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }); await c1.connect();
  const c2 = new MongoClient(env.MONGODB_URL2, { maxPoolSize: 3 }); await c2.connect();
  try {
    const strays = await c1.db().collection("products").find({ brand: BRAND }).project({ slug: 1 }).toArray();
    const col = c2.db().collection("products");
    const ours = await col.find({ brand: BRAND }).project({ name: 1, slug: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, shopifyProductId: 1, "specs.sourceUrl": 1, "specs.sku": 1, variants: 1 }).toArray();
    if ((ours.filter((p) => (p.variants || []).length)).length) fail("unexpected variants on Tile Mountain products");

    const counts = { outOnLive: 0, goneFromLive: 0, inOnLive: 0, unresolved: 0 }, skipped = [], targets = new Map(), examples = { out: [], in: [] };
    for (const p of ours) {
      const r = pages.get(p.specs.sourceUrl);
      let s = null, why = "";
      if (!r) why = "page not read";
      else if (r.status === 404 || r.status === 410) { s = "out"; why = "gone (404)"; counts.goneFromLive++; }
      else if (r.status !== 200) why = `HTTP ${r.status}`;
      else if (!r.sku && r.finalUrl && r.finalUrl.replace(/\/$/, "") !== r.url.replace(/\/$/, "")) { s = "out"; why = "removed (redirects to a category page)"; counts.goneFromLive++; }
      else if (String(r.sku || "").trim() !== String(p.specs.sku || "").trim()) why = `page SKU ${r.sku} ≠ ours ${p.specs.sku}${r.finalUrl !== r.url ? " (redirected)" : ""}`;
      else { s = av(r.availability); if (!s) why = `unknown availability ${r.availability}`; }
      if (!s) { counts.unresolved++; skipped.push({ slug: p.slug, why }); continue; }
      s === "out" ? counts.outOnLive++ : counts.inOnLive++;
      targets.set(String(p._id), s);
      if (examples[s].length < 4) examples[s].push({ name: p.name, ours: `https://www.linxsquare.co.uk/products/${p.slug}`, live: p.specs.sourceUrl, live_says: r.stockText || r.availability || why });
    }
    if (pages.size < ours.length * 0.98) fail(`snapshot has ${pages.size} pages for ${ours.length} products — incomplete`);

    // DB plan (existing fields only)
    const dbOps = [], dbPlan = [];
    for (const p of ours) {
      const s = targets.get(String(p._id)); if (!s) continue;
      const want = s === "out" ? { stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" } : { stock: IN_QTY, isOutOfStock: false, stockStatus: "in_stock" };
      const $set = {};
      for (const [k, v] of Object.entries(want)) if (k in p && p[k] !== v) $set[k] = v;
      for (const v of Object.values($set)) if (typeof v === "number" && (!Number.isInteger(v) || v < 0)) fail("bad target");
      if (Object.keys($set).length) { dbOps.push({ updateOne: { filter: { _id: p._id, brand: BRAND }, update: { $set } } }); dbPlan.push({ slug: p.slug, $set }); }
    }

    // Shopify plan
    const location = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
    const shop = await shopifyState(ours.filter((p) => targets.has(String(p._id))), location);
    const settings = [], qtys = [], notStocked = [], missing = [];
    for (const p of ours) {
      const s = targets.get(String(p._id)); if (!s) continue;
      const n = shop.get(String(p._id)); if (!n) { missing.push(p.slug); continue; }
      const want = s === "out" ? 0 : IN_QTY;
      for (const v of n.variants.nodes) {
        if (/free sample/i.test(v.title)) continue;
        if (v.inventoryPolicy !== "DENY" || !v.inventoryItem.tracked) settings.push({ productId: n.id, id: v.id, inventoryItemId: v.inventoryItem.id, policy: v.inventoryPolicy, tracked: v.inventoryItem.tracked, slug: p.slug });
        if (!v.inventoryItem.inventoryLevel) { notStocked.push(p.slug); continue; }
        if (!v.inventoryItem.tracked || v.inventoryQuantity !== want) qtys.push({ id: v.id, inventoryItemId: v.inventoryItem.id, qty: v.inventoryQuantity, want, single: n.variants.nodes.length === 1 });
      }
    }
    if (qtys.some((x) => targets && x.want === 0 && false)) fail("unreachable");
    const report = { brand: "Tile Mountain", cluster: "secondary (DB2)", strayProductsInDB1: strays.length, pagesRead: pages.size, ourProducts: ours.length, ...counts,
      productsSkipped: skipped.length, dbProductsToUpdate: dbPlan.length, dbToOut: dbPlan.filter((x) => x.$set.stockStatus === "out_of_stock" || x.$set.stock === 0).length, dbTo500: dbPlan.filter((x) => x.$set.stock === IN_QTY).length,
      shopifySettingsToChange: settings.length, shopifyQtyToSet: qtys.length, shopifyQtyTo0: qtys.filter((x) => x.want === 0).length, shopifyQtyTo500: qtys.filter((x) => x.want === IN_QTY).length, shopifyNotStockedAtLocation: notStocked.length, shopifyMissing: missing.length };
    const ts = stamp();
    fs.writeFileSync(path.join(DIR, `sync-check-${ts}.json`), JSON.stringify({ report, skipped, dbPlan, settings, qtys, notStocked, missing, examples }, null, 1));
    console.log(JSON.stringify(report, null, 1));
    console.log("examples:", JSON.stringify(examples, null, 1));
    console.log("skipped:", JSON.stringify(skipped.slice(0, 10)));
    if (MODE !== "apply") return;

    if (counts.unresolved > ours.length * 0.01 && !process.env.ALLOW_SKIP) fail(`unresolved ${counts.unresolved} > 1%`);
    if (notStocked.length) fail(`${notStocked.length} variants not stocked at the location — not activating locations; stopping`);
    // backup
    const backupDb = ours.map((p) => ({ _id: p._id, slug: p.slug, stock: p.stock, isOutOfStock: p.isOutOfStock, stockStatus: p.stockStatus }));
    const backupShop = []; for (const n of shop.values()) if (n) for (const v of n.variants.nodes) backupShop.push({ productId: n.id, id: v.id, inventoryItemId: v.inventoryItem.id, policy: v.inventoryPolicy, tracked: v.inventoryItem.tracked, qty: v.inventoryQuantity });
    fs.writeFileSync(path.join(DIR, `sync-backup-${ts}.json`), JSON.stringify({ db: backupDb, shopify: backupShop, location }, null, 1));
    console.log(`backup: .scratch/tilemountain/sync-backup-${ts}.json`);

    // Shopify, per product: settings (DENY + tracked) then its quantities straight away (a newly tracked item has none).
    // Multi-variant products first, single-variant last.
    const prodIds = [...new Set([...settings.map((x) => x.productId), ...qtys.map((x) => null)].filter(Boolean))];
    const qByProduct = new Map(); for (const [k, n] of shop) if (n) for (const v of n.variants.nodes) { const q = qtys.find((x) => x.id === v.id); if (q) { if (!qByProduct.has(n.id)) qByProduct.set(n.id, []); qByProduct.get(n.id).push(q); } }
    const sByProduct = new Map(); for (const x of settings) { if (!sByProduct.has(x.productId)) sByProduct.set(x.productId, []); sByProduct.get(x.productId).push(x); }
    const all = [...new Set([...sByProduct.keys(), ...qByProduct.keys()])];
    const isSingle = (pid) => (qByProduct.get(pid) || []).every((x) => x.single);
    all.sort((a, b) => isSingle(a) - isSingle(b));
    let setOk = 0, qOk = 0; const errs = [];
    for (const pid of all) {
      const vs = sByProduct.get(pid) || [], qs = qByProduct.get(pid) || [];
      if (qs.some((x) => x.want === IN_QTY) && qs.some((x) => x.want !== 0 && x.want !== IN_QTY)) fail("bad qty target");
      if (vs.length) {
        const d = await gql(`mutation($p:ID!,$v:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$p, variants:$v){ userErrors{ field message } } }`, { p: pid, v: vs.map((x) => ({ id: x.id, inventoryPolicy: "DENY", inventoryItem: { tracked: true } })) });
        const ue = d.productVariantsBulkUpdate.userErrors; if (ue.length) { errs.push({ pid, ue }); if (errs.length > 20) fail(`systematic Shopify errors ${JSON.stringify(errs.slice(0, 3))}`); continue; }
        setOk += vs.length;
      }
      if (qs.length) {
        const d = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`, { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: qs.map((x) => ({ inventoryItemId: x.inventoryItemId, locationId: location, quantity: x.want })) } });
        const ue = d.inventorySetQuantities.userErrors; if (ue.length) { errs.push({ pid, ue }); if (errs.length > 20) fail(`systematic Shopify errors ${JSON.stringify(errs.slice(0, 3))}`); } else qOk += qs.length;
      }
      await sleep(200);
    }
    console.log(`shopify: settings ${setOk}/${settings.length}, qty ${qOk}/${qtys.length}`, errs.length ? JSON.stringify(errs.slice(0, 5)) : "");
    if (dbOps.length) { const r = await col.bulkWrite(dbOps, { ordered: false }); console.log(`db: matched ${r.matchedCount}, modified ${r.modifiedCount} of ${dbOps.length}`); if (r.matchedCount !== dbOps.length) fail("matched != planned"); }

    // verify everything
    const afterDb = await col.find({ brand: BRAND }).toArray();
    const before = new Map(ours.map((p) => [String(p._id), p]));
    const afterShop = await shopifyState(afterDb.filter((p) => targets.has(String(p._id))), location);
    const problems = [];
    for (const p of afterDb) {
      const s = targets.get(String(p._id)), b = before.get(String(p._id));
      if (!s) { if (b && (b.stock !== p.stock || b.isOutOfStock !== p.isOutOfStock || b.stockStatus !== p.stockStatus)) problems.push(`skipped product changed ${p.slug}`); continue; }
      const want = s === "out" ? { stock: 0, isOutOfStock: true, stockStatus: "out_of_stock" } : { stock: IN_QTY, isOutOfStock: false, stockStatus: "in_stock" };
      for (const [k, v] of Object.entries(want)) if (k in p && p[k] !== v) problems.push(`db ${p.slug}.${k}=${p[k]}`);
      const n = afterShop.get(String(p._id)); if (!n) { problems.push(`shopify missing ${p.slug}`); continue; }
      for (const v of n.variants.nodes) { if (/free sample/i.test(v.title)) continue;
        if (v.inventoryPolicy !== "DENY" || !v.inventoryItem.tracked) problems.push(`shopify setting ${p.slug}`);
        if (v.inventoryQuantity !== (s === "out" ? 0 : IN_QTY)) problems.push(`shopify qty ${p.slug}=${v.inventoryQuantity}`); }
    }
    console.log(JSON.stringify({ verifiedProducts: afterDb.length, problems: problems.length, firstProblems: problems.slice(0, 10) }, null, 1));
    if (problems.length) process.exit(3);
  } finally { await c1.close(); await c2.close(); }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
