// Aica: stop Shopify selling at 0. MODE=check (default) | apply | verify | rollback
// - every Aica variant: inventoryPolicy DENY
// - untracked variants: tracking on, then their quantity set at once (sold out on live → 0, else our existing stock)
// Quantities of already-tracked variants are left exactly as they are.
const fs = require("fs"), path = require("path"), dns = require("dns");
const SCR = "/private/tmp/claude-501/-Users-niazig-Desktop-linxliving-LinxLiving/d2d9bf67-2e74-4a5c-a156-cc7b9dbe69c2/scratchpad";
const { gql, env, sleep, root } = require(path.join(SCR, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(root, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const DIR = path.join(root, ".scratch/aica");
const BRAND_ID = new ObjectId("6ab797f3bba7479a91b0a953");
const LOCATION = "gid://shopify/Location/120472371464";
const MODE = process.env.MODE || "check";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const fail = (m) => { console.error("ABORT:", m); process.exit(2); };

async function shopifyState(ids) {
  const s = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const d = await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id inventoryPolicy inventoryQuantity inventoryItem{ id tracked inventoryLevel(locationId:"${LOCATION}"){ id } } } } }`, { ids: ids.slice(i, i + 100) });
    for (const n of d.nodes) if (n) s.set(n.id, n);
    await sleep(200);
  }
  return s;
}

(async () => {
  const c = await new MongoClient(env.MONGODB_URL2, { maxPoolSize: 2, serverSelectionTimeoutMS: 20000 }).connect();
  const ours = await c.db().collection("products").find({ brand: BRAND_ID }).project({ name: 1, stock: 1, shopifyProductId: 1, "variants.name": 1, "variants.available": 1, "variants.shopifyVariantId": 1 }).toArray();
  await c.close();
  const all = ours.flatMap((p) => p.variants.filter((v) => v.shopifyVariantId).map((v) => ({ p, v })));
  const s = await shopifyState(all.map((x) => x.v.shopifyVariantId));
  if (s.size !== all.length) fail(`Shopify returned ${s.size}/${all.length} variants`);

  // Expected quantity for variants that will start tracking: sold out → 0; in stock → our stock for that
  // single-variant product (the untracked ones are single-variant). Anything else aborts.
  const plan = all.map(({ p, v }) => {
    const n = s.get(v.shopifyVariantId);
    const startTracking = !n.inventoryItem.tracked;
    let qty = null;
    if (startTracking) {
      if (p.variants.length !== 1 && v.available !== false) fail(`untracked in-stock variant on a multi-variant product: ${p.name} / ${v.name}`);
      qty = v.available === false ? 0 : Math.max(0, Math.floor(p.stock || 0));
      if (v.available !== false && qty <= 0) fail(`in-stock untracked variant would get 0: ${p.name}`);
    }
    return { p, v, n, setDeny: n.inventoryPolicy !== "DENY", startTracking, qty };
  });
  const sum = {
    variants: plan.length,
    toDeny: plan.filter((x) => x.setDeny).length,
    toStartTracking: plan.filter((x) => x.startTracking).length,
    startTracking_soldOut_qty0: plan.filter((x) => x.startTracking && x.qty === 0).length,
    startTracking_inStock: plan.filter((x) => x.startTracking && x.qty > 0).length,
    notStockedAtLocation: plan.filter((x) => !x.n.inventoryItem.inventoryLevel).length,
    soldOutStillSellableNow: plan.filter((x) => x.v.available === false && (x.n.inventoryPolicy === "CONTINUE" || !x.n.inventoryItem.tracked)).length,
  };

  if (MODE === "check") { console.log(JSON.stringify(sum, null, 1)); return; }

  if (MODE === "apply") {
    console.log(JSON.stringify(sum, null, 1));
    if (sum.notStockedAtLocation) fail("some inventory items are not stocked at the location — not activating anything new");
    const bk = path.join(DIR, `shopify-deny-backup-${stamp()}.json`);
    fs.writeFileSync(bk, JSON.stringify(plan.map((x) => x.n)));
    console.log("backup:", bk);
    // Multi-variant products first, single-variant last (the live admin auto-pull still reads the first variant).
    const byProduct = new Map();
    for (const x of plan) if (x.setDeny || x.startTracking) (byProduct.get(x.p.shopifyProductId) || byProduct.set(x.p.shopifyProductId, []).get(x.p.shopifyProductId)).push(x);
    const order = [...byProduct].sort((a, b) => (a[1][0].p.variants.length === 1) - (b[1][0].p.variants.length === 1));
    const errs = [];
    let done = 0;
    for (const [pid, xs] of order) {
      const d = await gql(`mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$pid, variants:$v){ userErrors{ field message } } }`,
        { pid, v: xs.map((x) => ({ id: x.v.shopifyVariantId, inventoryPolicy: "DENY", ...(x.startTracking ? { inventoryItem: { tracked: true } } : {}) })) });
      if (d.productVariantsBulkUpdate.userErrors.length) { errs.push({ product: xs[0].p.name, e: d.productVariantsBulkUpdate.userErrors }); continue; }
      const q = xs.filter((x) => x.startTracking).map((x) => ({ inventoryItemId: x.n.inventoryItem.id, locationId: LOCATION, quantity: x.qty }));
      if (q.length) {
        const r = await gql(`mutation($input:InventorySetQuantitiesInput!){ inventorySetQuantities(input:$input){ userErrors{ field message } } }`,
          { input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: q } });
        if (r.inventorySetQuantities.userErrors.length) errs.push({ product: xs[0].p.name, e: r.inventorySetQuantities.userErrors });
      }
      done++;
      if (done % 100 === 0) console.log(`${done}/${order.length} products`);
      await sleep(150);
    }
    console.log(`products updated ${done}/${order.length}, errors ${errs.length}`);
    if (errs.length) { fs.writeFileSync(path.join(DIR, `shopify-deny-errors-${stamp()}.json`), JSON.stringify(errs, null, 1)); console.log(JSON.stringify(errs.slice(0, 3))); }
    return;
  }

  if (MODE === "verify") {
    // Expected: every variant DENY + tracked. Quantity: unchanged for those tracked before (from the backup),
    // the planned qty for newly tracked ones; and every sold-out variant at 0.
    const bkFile = fs.readdirSync(DIR).filter((f) => f.startsWith("shopify-deny-backup-")).sort().pop();
    const before = new Map(JSON.parse(fs.readFileSync(path.join(DIR, bkFile), "utf8")).map((n) => [n.id, n]));
    const bad = [];
    for (const { p, v } of all) {
      const n = s.get(v.shopifyVariantId), b = before.get(v.shopifyVariantId);
      const want = b.inventoryItem.tracked ? b.inventoryQuantity : v.available === false ? 0 : Math.floor(p.stock || 0);
      if (n.inventoryPolicy !== "DENY" || !n.inventoryItem.tracked || n.inventoryQuantity !== want || (v.available === false && n.inventoryQuantity !== 0))
        bad.push({ product: p.name, variant: v.name, want, got: [n.inventoryPolicy, n.inventoryItem.tracked, n.inventoryQuantity] });
    }
    console.log(JSON.stringify({ checked: all.length, mismatches: bad.length, soldOutStillSellable: sum.soldOutStillSellableNow, examples: bad.slice(0, 10) }, null, 1));
    return;
  }

  if (MODE === "rollback") {
    const bkFile = fs.readdirSync(DIR).filter((f) => f.startsWith("shopify-deny-backup-")).sort().pop();
    const before = JSON.parse(fs.readFileSync(path.join(DIR, bkFile), "utf8"));
    const pidOf = new Map(all.map((x) => [x.v.shopifyVariantId, x.p.shopifyProductId]));
    const byP = new Map();
    for (const n of before) (byP.get(pidOf.get(n.id)) || byP.set(pidOf.get(n.id), []).get(pidOf.get(n.id))).push(n);
    for (const [pid, ns] of byP) {
      await gql(`mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$pid, variants:$v){ userErrors{ message } } }`,
        { pid, v: ns.map((n) => ({ id: n.id, inventoryPolicy: n.inventoryPolicy, inventoryItem: { tracked: n.inventoryItem.tracked } })) });
      await sleep(150);
    }
    console.log("rolled back from", bkFile);
    return;
  }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
