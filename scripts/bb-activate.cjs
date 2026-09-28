/**
 * Make the Better Bathrooms products sellable in Shopify: status ACTIVE and
 * published to the Online Store (Storefront checkout needs both).
 *
 * Only products whose Shopify id is recorded on a DB2 row tagged
 * specs.source = "bb-scrape" are touched. Every product is re-read first: a
 * product with any variant at £0 is left in DRAFT and reported.
 *
 *   node scripts/bb-activate.cjs            # report only
 *   node scripts/bb-activate.cjs --apply
 */
require("tsx/cjs");
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
require("dns").setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

const APPLY = process.argv.includes("--apply");
const CONCURRENCY = 4;
const LOG = path.join(__dirname, "../.scratch/betterbathrooms/work/activate.log");
const log = (m) => { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };

(async () => {
  const pubs = await shopifyAdminRequest(`{ publications(first: 20) { nodes { id name } } }`);
  const online = pubs.publications.nodes.find((p) => /online\s*store/i.test(p.name));
  if (!online) throw new Error("Online Store publication not found");

  const c = new MongoClient(process.env.MONGODB_URL2);
  await c.connect();
  const rows = await c.db().collection("products")
    .find({ "specs.source": "bb-scrape", shopifyProductId: { $nin: [null, ""] } }, { projection: { name: 1, shopifyProductId: 1 } })
    .toArray();

  const state = [];
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const d = await shopifyAdminRequest(
      `query($ids:[ID!]!, $pub:ID!){ nodes(ids:$ids){ ... on Product { id status vendor
        published: publishedOnPublication(publicationId:$pub)
        variants(first:100){ nodes{ price } } } } }`,
      { ids: batch.map((p) => p.shopifyProductId), pub: online.id },
    );
    const byId = new Map(d.nodes.filter(Boolean).map((n) => [n.id, n]));
    for (const p of batch) state.push({ ...p, s: byId.get(p.shopifyProductId) });
  }
  const missing = state.filter((x) => !x.s);
  const wrongVendor = state.filter((x) => x.s && x.s.vendor !== "Better Bathrooms");
  const zeroPrice = state.filter((x) => x.s && x.s.variants.nodes.some((v) => !(Number(v.price) > 0)));
  const todo = state.filter((x) => x.s && x.s.vendor === "Better Bathrooms" && !zeroPrice.includes(x) && (x.s.status !== "ACTIVE" || !x.s.published));
  log(`products ${state.length} | active ${state.filter((x) => x.s?.status === "ACTIVE").length} | published ${state.filter((x) => x.s?.published).length} | to change ${todo.length} | held back (£0 variant) ${zeroPrice.length} | missing in Shopify ${missing.length} | wrong vendor ${wrongVendor.length}`);
  for (const x of [...missing, ...wrongVendor, ...zeroPrice]) log(`  not activated: ${x.name}`);
  if (!APPLY) { await c.close(); process.exit(0); }

  let done = 0, failed = 0;
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const x = queue.shift();
      try {
        if (x.s.status !== "ACTIVE") {
          const r = await shopifyAdminRequest(`mutation($p:ProductUpdateInput!){ productUpdate(product:$p){ product{ status } userErrors{ message } } }`, { p: { id: x.shopifyProductId, status: "ACTIVE" } });
          if (r.productUpdate.userErrors.length) throw new Error(r.productUpdate.userErrors.map((e) => e.message).join("; "));
        }
        if (!x.s.published) {
          const r = await shopifyAdminRequest(`mutation($id:ID!,$in:[PublicationInput!]!){ publishablePublish(id:$id, input:$in){ userErrors{ message } } }`, { id: x.shopifyProductId, in: [{ publicationId: online.id }] });
          if (r.publishablePublish.userErrors.length) throw new Error(r.publishablePublish.userErrors.map((e) => e.message).join("; "));
        }
      } catch (e) { failed++; log(`✗ ${x.name} — ${e.message}`); }
      done++;
      if (done % 250 === 0) log(`progress ${done}/${todo.length} (failed ${failed})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`activated ${done - failed}/${todo.length}, failed ${failed}`);
  await c.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
