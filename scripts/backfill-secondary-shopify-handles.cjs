/**
 * Backfill `shopifyHandle` / `shopifyProductUrl` on the secondary cluster.
 *
 * The secondary sync wrote `shopifyProductId`, `shopifySyncedAt` and the image
 * links but never the handle, so 14k products carry a Shopify id with no URL to
 * reach it. The handle is not derivable locally (Shopify de-duplicates slugs),
 * so it is read back from the store by product id and written as-is.
 *
 * Usage: node scripts/backfill-secondary-shopify-handles.cjs [--apply] [--brand=<slug>]
 * Without --apply it reports what it would write and touches nothing.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });

const dns = require("dns");
const { MongoClient, ObjectId } = require("mongodb");

const SRV = (process.env.MONGODB_DNS_SERVERS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (SRV.length) dns.setServers(SRV);

const APPLY = process.argv.includes("--apply");
const BRAND_ARG = (process.argv.find((a) => a.startsWith("--brand=")) || "").split("=")[1] || "";
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const CHUNK = 200;

async function adminToken() {
  const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID || "",
      client_secret: process.env.SHOPIFY_CLIENT_SECRET || "",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`token failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.access_token;
}

const QUERY = `query Handles($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Product { id handle status } }
}`;

async function fetchHandles(token, ids) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await fetch(`https://${DOMAIN}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: QUERY, variables: { ids } }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    const json = await res.json();
    if (json.errors) {
      // Throttled responses arrive as 200 with a THROTTLED error code.
      const throttled = json.errors.some((e) => e?.extensions?.code === "THROTTLED");
      if (throttled) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw new Error(JSON.stringify(json.errors).slice(0, 400));
    }
    return json.data.nodes || [];
  }
  throw new Error("Shopify kept throttling after 5 attempts");
}

(async () => {
  if (!DOMAIN) throw new Error("SHOPIFY_STORE_DOMAIN missing");
  const uri = process.env.MONGODB_URL2;
  if (!uri) throw new Error("MONGODB_URL2 missing");

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db("test").collection("products");

  const filter = {
    shopifyProductId: { $nin: [null, ""] },
    $or: [{ shopifyHandle: { $in: [null, ""] } }, { shopifyProductUrl: { $in: [null, ""] } }],
  };

  if (BRAND_ARG) {
    const primary = new MongoClient(process.env.MONGODB_URI);
    await primary.connect();
    const brand = await primary.db("test").collection("brands").findOne({ slug: BRAND_ARG });
    await primary.close();
    if (!brand) throw new Error(`brand slug not found: ${BRAND_ARG}`);
    filter.brand = new ObjectId(String(brand._id));
  }

  const docs = await col
    .find(filter, { projection: { shopifyProductId: 1, shopifyHandle: 1, shopifyProductUrl: 1 } })
    .toArray();

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} · candidates: ${docs.length}`);
  if (!docs.length) {
    await client.close();
    return;
  }

  const token = await adminToken();
  let resolved = 0;
  let missing = 0;
  let written = 0;
  const missingIds = [];

  for (let i = 0; i < docs.length; i += CHUNK) {
    const slice = docs.slice(i, i + CHUNK);
    const nodes = await fetchHandles(token, slice.map((d) => d.shopifyProductId));
    const byId = new Map(nodes.filter(Boolean).map((n) => [n.id, n.handle]));

    const ops = [];
    for (const d of slice) {
      const handle = byId.get(d.shopifyProductId);
      if (!handle) {
        missing += 1;
        if (missingIds.length < 10) missingIds.push(d.shopifyProductId);
        continue;
      }
      resolved += 1;
      ops.push({
        updateOne: {
          filter: { _id: d._id },
          update: { $set: { shopifyHandle: handle, shopifyProductUrl: `https://${DOMAIN}/products/${handle}` } },
        },
      });
    }

    if (APPLY && ops.length) {
      const r = await col.bulkWrite(ops, { ordered: false });
      written += r.modifiedCount;
    }
    process.stdout.write(`\r  ${Math.min(i + CHUNK, docs.length)}/${docs.length} · resolved ${resolved} · missing ${missing}`);
  }

  console.log(`\nresolved ${resolved} · missing on Shopify ${missing}${missingIds.length ? ` (e.g. ${missingIds.join(", ")})` : ""}`);
  console.log(APPLY ? `written ${written}` : "dry run — nothing written");

  if (APPLY) {
    const left = await col.countDocuments(filter);
    console.log(`remaining without handle: ${left}`);
  }

  await client.close();
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
