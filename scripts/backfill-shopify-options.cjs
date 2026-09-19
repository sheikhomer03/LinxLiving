/**
 * Fill `Product.shopifyOptions` from the options Shopify actually holds.
 *
 * `ProductSection` builds its variant picker from `shopifyOptions`, not from
 * `variantGroups` or the `option1..3` fields on the rows. A brand imported and
 * pushed without that field therefore shows no picker at all, however complete
 * its variants are — Toasty had 433 multi-variant products and rendered a
 * chooser on none of them.
 *
 * `shopify-sync-variants.cjs` writes this field as part of installing a variant
 * set. Where the variants already exist on the store with their own ids, as a
 * full push leaves them, there is nothing to install and only the read-back is
 * missing. This is that read-back on its own.
 *
 * Read from Shopify rather than derived locally on purpose: the axes the picker
 * offers must be the axes checkout resolves against, and Shopify normalises
 * what it is given (it trimmed a supplier's "Watt " to "Watt").
 *
 *   BRAND=toasty [APPLY=1] node --require ./scripts/mongo-dns.cjs scripts/backfill-shopify-options.cjs
 *
 *   BRAND=slug   brand to fill (required)
 *   APPLY=1      write (default: report only)
 *   BATCH=50     products per Shopify query
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const dns = require("dns");
const { MongoClient } = require("mongodb");

const SRV = (process.env.MONGODB_DNS_SERVERS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (SRV.length) dns.setServers(SRV);

const APPLY = process.env.APPLY === "1";
const SLUG = process.env.BRAND || "";
const BATCH = Math.max(1, Math.min(Number(process.env.BATCH) || 50, 100));
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || "").trim();
if (!SLUG) throw new Error("set BRAND=<slug>");

async function token() {
  const r = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID || "",
      client_secret: process.env.SHOPIFY_CLIENT_SECRET || "",
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("token failed");
  return j.access_token;
}

const Q = `query O($ids:[ID!]!){nodes(ids:$ids){... on Product{id options{name position values}}}}`;

async function gql(tok, ids, attempt = 1) {
  const r = await fetch(`https://${DOMAIN}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": tok },
    body: JSON.stringify({ query: Q, variables: { ids } }),
  });
  if ((r.status === 429 || r.status >= 500) && attempt <= 5) {
    await new Promise((s) => setTimeout(s, 1000 * attempt));
    return gql(tok, ids, attempt + 1);
  }
  const j = await r.json();
  if (j.errors?.some((e) => e?.extensions?.code === "THROTTLED") && attempt <= 5) {
    await new Promise((s) => setTimeout(s, 2000 * attempt));
    return gql(tok, ids, attempt + 1);
  }
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data.nodes || [];
}

/** Shopify's placeholder axis describes nothing and must not reach the PDP. */
const isPlaceholder = (o) =>
  /^title$/i.test(String(o?.name || "")) &&
  (o?.values || []).length === 1 &&
  /^default title$/i.test(String(o.values[0] || ""));

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await c.connect();
  const db = c.db("test");
  const brand = await db.collection("brands").findOne({ slug: SLUG });
  if (!brand) throw new Error("brand not found: " + SLUG);
  const col = db.collection("products");

  const docs = await col
    .find({ brand: brand._id, shopifyProductId: { $nin: [null, ""] } })
    .project({ _id: 1, shopifyProductId: 1 })
    .toArray();
  if (!docs.length) throw new Error("no synced products for " + SLUG + " — aborting");

  console.log(`${APPLY ? "APPLY" : "DRY"} · ${SLUG} · ${docs.length} synced products`);
  const tok = await token();
  const byGid = new Map(docs.map((d) => [d.shopifyProductId, d._id]));
  let filled = 0, placeholder = 0, missing = 0, written = 0;
  let ops = [];

  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH);
    const nodes = await gql(tok, slice.map((d) => d.shopifyProductId));
    for (const n of nodes) {
      if (!n) { missing += 1; continue; }
      const opts = (n.options || []).filter((o) => !isPlaceholder(o));
      if (!opts.length) { placeholder += 1; continue; }
      filled += 1;
      ops.push({
        updateOne: {
          filter: { _id: byGid.get(n.id) },
          update: { $set: { shopifyOptions: opts.map((o) => ({ name: o.name, values: o.values, position: o.position })) } },
        },
      });
    }
    if (APPLY && ops.length >= 200) {
      written += (await col.bulkWrite(ops, { ordered: false })).modifiedCount;
      ops = [];
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH, docs.length)}/${docs.length} · with options ${filled} · title-only ${placeholder}`);
  }
  if (APPLY && ops.length) written += (await col.bulkWrite(ops, { ordered: false })).modifiedCount;

  console.log(`\nproducts with real options: ${filled} · only Shopify's placeholder: ${placeholder} · not found: ${missing}`);
  console.log(APPLY ? `written: ${written}` : "dry run — nothing written");
  await c.close();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
