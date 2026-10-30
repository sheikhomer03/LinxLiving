// Floors4Trade (DB1, Shopify supplier floors4trade.co.uk): sold out on live → out of stock on ours (DB + Shopify).
//   node .scratch/_stock-sync/f4t-oos.cjs              (check, read-only)
//   MODE=apply node .scratch/_stock-sync/f4t-oos.cjs   (backup + write)
// Match: variant externalId = live variant id; otherwise live product (sourceProductId) + option title == variant name.
// Products missing from /products.json are checked individually (<handle>.js): 404 → gone → sold out.
// Existing fields only. Variant: available false (+ stock 0 where the field exists). Product (only fields it already has):
// fully sold out → stock 0 / isOutOfStock true / stockStatus out_of_stock. Shopify: qty 0 on tracked variants. No settings.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { gql, env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const MODE = process.env.MODE || "check";
const ORIGIN = "https://floors4trade.co.uk";
const BRAND = new ObjectId("6a95c821c9d22d205a0de176");
const DIR = path.join(ROOT, ".scratch/floors4trade"); fs.mkdirSync(DIR, { recursive: true });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HDR = { "user-agent": UA, accept: "application/json", cookie: "localization=GB; cart_currency=GBP" };
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const handleOf = (u) => { const m = String(u || "").match(/\/products\/([^/?#]+)/); return m ? m[1] : null; };

async function get(url) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch(url, { headers: HDR }).catch(() => null);
    if (!r) { await sleep(5000); continue; }
    if (r.status === 429) fail(`rate limited (429) on ${url} — stopping, not pushing`);
    if (r.status >= 500) { await sleep(5000 * (a + 1)); continue; }
    const t = await r.text();
    if (/Verifying your connection|captcha/i.test(t)) fail("bot check — stopping");
    return { status: r.status, body: t };
  }
  fail(`no response from ${url}`);
}

(async () => {
  const c1 = new MongoClient(env.MONGODB_URI, { maxPoolSize: 3 }); await c1.connect();
  const c2 = new MongoClient(env.MONGODB_URL2, { maxPoolSize: 2 }); await c2.connect();
  try {
    const strays = await c2.db().collection("products").countDocuments({ brand: BRAND });
    const col = c1.db().collection("products");
    const ours = await col.find({ brand: BRAND }).project({ name: 1, slug: 1, sourceUrl: 1, sourceProductId: 1, stock: 1, isOutOfStock: 1, stockStatus: 1, shopifyProductId: 1, variants: 1 }).toArray();

    // live catalogue
    const byPid = new Map(), byVid = new Map();
    const add = (p) => { byPid.set(String(p.id), p); for (const v of p.variants) byVid.set(String(v.id), v); };
    for (let page = 1; page < 30; page++) {
      const r = await get(`${ORIGIN}/products.json?limit=250&page=${page}`);
      const d = JSON.parse(r.body).products; if (!d.length) break;
      d.forEach(add); process.stdout.write(`page ${page} (${byPid.size}) `); await sleep(1200);
    }
    console.log(`\nlive listing: ${byPid.size} products, ${byVid.size} variants`);
    if (byPid.size < ours.length * 0.5) fail(`live listing only ${byPid.size} products (we hold ${ours.length})`);
    const gone = new Set(); let checked = 0;
    for (const p of ours) {
      if (byPid.has(String(p.sourceProductId))) continue;
      const h = handleOf(p.sourceUrl); if (!h) continue;
      const r = await get(`${ORIGIN}/products/${h}.js`); checked++;
      if (r.status === 404) gone.add(String(p.sourceProductId));
      else if (r.status === 200) { const j = JSON.parse(r.body); add({ id: j.id, variants: j.variants.map((v) => ({ id: v.id, title: v.title, available: v.available, sku: v.sku })) }); byPid.set(String(p.sourceProductId), byPid.get(String(j.id))); }
      await sleep(1200);
    }
    fs.writeFileSync(path.join(DIR, `stock-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({ products: [...byPid.values()].filter(Boolean).map((p) => ({ id: p.id, variants: p.variants.map((v) => [v.id, v.title, v.available]) })), gone: [...gone] }));
    console.log(`checked ${checked} products missing from the listing: ${gone.size} gone (404)`);

    const counts = { soldOutOnLive: 0, goneFromLive: 0, alreadyRight: 0, dbVariantsToFix: 0, backInStockOnLiveButOutOnOurs: 0, unresolvedVariants: 0 };
    const skipped = [], dbOps = [], plan = [], shopIds = [], examples = { full: [], partial: [], gone: [] };
    let nVar = 0;
    for (const p of ours) {
      const pid = String(p.sourceProductId), isGone = gone.has(pid), lp = byPid.get(pid);
      const titles = new Map(); if (lp) for (const v of lp.variants) { const k = norm(v.title); titles.set(k, titles.has(k) ? null : v); }
      const res = (p.variants || []).map((v) => {
        nVar++;
        if (isGone) return { s: "out", why: "gone (404)" };
        const lv = (v.externalId && byVid.get(String(v.externalId))) || (lp && titles.get(norm(v.name)));
        if (!lv) return { s: "unresolved" };
        return { s: lv.available ? "in" : "out", why: "sold out" };
      });
      const unres = res.filter((x) => x.s === "unresolved").length;
      if (unres) { counts.unresolvedVariants += unres; skipped.push({ slug: p.slug, unresolved: unres, of: res.length, liveFound: !!lp }); continue; }
      const $set = {}, af = []; let allOut = res.length > 0;
      res.forEach((x, i) => {
        const v = p.variants[i];
        if (x.s !== "out") { allOut = false; if (v.available === false) counts.backInStockOnLiveButOutOnOurs++; return; }
        counts.soldOutOnLive++; if (isGone) counts.goneFromLive++;
        if (v.shopifyVariantId) shopIds.push({ id: String(v.shopifyVariantId).startsWith("gid://") ? String(v.shopifyVariantId) : `gid://shopify/ProductVariant/${v.shopifyVariantId}`, single: p.variants.length === 1 });
        if (v.available === false && (v.stock === undefined || v.stock === 0)) { counts.alreadyRight++; return; }
        counts.dbVariantsToFix++;
        $set[`variants.$[v${i}].available`] = false;
        if (v.stock !== undefined) $set[`variants.$[v${i}].stock`] = 0;
        af.push({ [`v${i}.name`]: v.name, [`v${i}.sku`]: v.sku });
      });
      if (allOut) {
        if ("stock" in p && p.stock !== 0) $set.stock = 0;
        if ("isOutOfStock" in p && p.isOutOfStock !== true) $set.isOutOfStock = true;
        if ("stockStatus" in p && p.stockStatus !== "out_of_stock") $set.stockStatus = "out_of_stock";
      }
      const outN = res.filter((x) => x.s === "out").length;
      if (outN) (isGone ? examples.gone : allOut ? examples.full : examples.partial).push({ name: p.name, ours: `https://www.linxsquare.co.uk/products/${p.slug}`, live: p.sourceUrl, out: p.variants.filter((_, i) => res[i].s === "out").map((v) => v.name).slice(0, 4), outOf: `${outN}/${res.length}`, productFieldsPresent: ["stock", "isOutOfStock", "stockStatus"].filter((f) => f in p) });
      if (Object.keys($set).length) { dbOps.push({ updateOne: { filter: { _id: p._id, brand: BRAND }, update: { $set }, ...(af.length ? { arrayFilters: af } : {}) } }); plan.push({ slug: p.slug, $set }); }
    }

    const location = (await gql(`{ locations(first:10, includeInactive:false){ nodes{ id isActive } } }`)).locations.nodes.find((l) => l.isActive).id;
    const toZero = [], notTracked = [], missing = [], notStocked = [];
    for (let i = 0; i < shopIds.length; i += 100) {
      const chunk = shopIds.slice(i, i + 100);
      const d = await gql(`query($ids:[ID!]!,$loc:ID!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked inventoryLevel(locationId:$loc){ id } } } } }`, { ids: chunk.map((x) => x.id), loc: location });
      d.nodes.forEach((n, j) => {
        const x = chunk[j];
        if (!n) return missing.push(x.id);
        if (!n.inventoryItem.tracked) return notTracked.push({ id: n.id, policy: n.inventoryPolicy });
        if (!n.inventoryItem.inventoryLevel) return notStocked.push(n.id);
        if (n.inventoryQuantity !== 0) toZero.push({ id: n.id, inventoryItemId: n.inventoryItem.id, policy: n.inventoryPolicy, tracked: true, qty: n.inventoryQuantity, single: x.single });
      });
    }
    // fully sold-out products: every Shopify variant of the product → 0 (covers unlinked "Default Title" variants)
    const fullIds = [...new Set(ours.filter((p) => plan.some((x) => x.slug === p.slug && x.$set.stockStatus === "out_of_stock") || examples.full.concat(examples.gone).some((e) => e.ours.endsWith("/" + p.slug))).map((p) => p.shopifyProductId).filter(Boolean))];
    const have = new Set(toZero.map((x) => x.id));
    for (let i = 0; i < fullIds.length; i += 50) {
      const d = await gql(`query($ids:[ID!]!,$loc:ID!){ nodes(ids:$ids){ ... on Product { id variants(first:100){ nodes{ id inventoryPolicy inventoryQuantity inventoryItem{ id tracked inventoryLevel(locationId:$loc){ id } } } } } } }`, { ids: fullIds.slice(i, i + 50), loc: location });
      for (const n of d.nodes) if (n) for (const v of n.variants.nodes) {
        if (have.has(v.id)) continue;
        if (!v.inventoryItem.tracked) { notTracked.push({ id: v.id, policy: v.inventoryPolicy }); continue; }
        if (!v.inventoryItem.inventoryLevel) { notStocked.push(v.id); continue; }
        if (v.inventoryQuantity !== 0) { toZero.push({ id: v.id, inventoryItemId: v.inventoryItem.id, policy: v.inventoryPolicy, tracked: true, qty: v.inventoryQuantity, single: n.variants.nodes.length === 1, unlinked: true }); have.add(v.id); }
      }
    }
    const report = { brand: "Floors4Trade", cluster: "primary (DB1)", strayProductsInDB2: strays, liveProducts: byPid.size, ourProducts: ours.length, ourVariants: nVar, ...counts,
      productsSkipped: skipped.length, dbProductsToUpdate: dbOps.length, productsFullyOut: examples.full.length + examples.gone.length, productsPartlyOut: examples.partial.length,
      shopifyVariantsToZero: toZero.length, shopifyUnlinkedOfFullyOut: toZero.filter((x) => x.unlinked).length, shopifyNotTracked: notTracked.length, shopifyMissing: missing.length, shopifyNotStockedAtLocation: notStocked.length };
    const ts = stamp();
    fs.writeFileSync(path.join(DIR, `oos-check-${ts}.json`), JSON.stringify({ report, skipped, plan, toZero, notTracked, missing, notStocked, examples }, null, 1));
    console.log(JSON.stringify(report, null, 1));
    console.log("examples:", JSON.stringify({ full: examples.full.slice(0, 3), partial: examples.partial.slice(0, 3), gone: examples.gone.slice(0, 2) }, null, 1));
    console.log("skipped (first 8):", JSON.stringify(skipped.slice(0, 8)));
    if (MODE !== "apply") return;

    if (counts.unresolvedVariants > nVar * 0.01 && !process.env.ALLOW_SKIP) fail(`unresolved ${counts.unresolvedVariants} > 1% of ${nVar}`);
    const backupDb = await col.find({ _id: { $in: dbOps.map((o) => o.updateOne.filter._id) } }).project({ stock: 1, isOutOfStock: 1, stockStatus: 1, "variants.name": 1, "variants.sku": 1, "variants.available": 1, "variants.stock": 1 }).toArray();
    fs.writeFileSync(path.join(DIR, `oos-backup-${ts}.json`), JSON.stringify({ db: backupDb, shopify: toZero, location }, null, 1));
    console.log(`backup: .scratch/floors4trade/oos-backup-${ts}.json`);
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
