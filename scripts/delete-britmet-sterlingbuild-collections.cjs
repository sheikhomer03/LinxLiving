/**
 * Delete the Shopify collections that belonged only to Britmet / Sterlingbuild.
 *
 * The id list is derived from the removal backup, minus every collection a
 * surviving brand still points at — "Accessories" alone is shared by nine
 * brands, and "Pitched Roof Windows" is FAKRO's. Each id is checked against
 * Shopify for a zero product count immediately before deletion, so a
 * collection that turns out to hold another brand's products is skipped
 * rather than removed.
 *
 * Usage: node scripts/delete-britmet-sterlingbuild-collections.cjs [--apply]
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });

const dns = require("dns");
const path = require("path");
const { MongoClient } = require("mongodb");

const SRV = (process.env.MONGODB_DNS_SERVERS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (SRV.length) dns.setServers(SRV);

const APPLY = process.argv.includes("--apply");
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const SAFE = require(path.join(__dirname, "..", "backups", "_collections-safe.json"));

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
  if (!res.ok || !json.access_token) throw new Error(`token failed (${res.status})`);
  return json.access_token;
}

async function gql(token, query, variables) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await fetch(`https://${DOMAIN}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    const json = await res.json();
    if (json.errors?.some((e) => e?.extensions?.code === "THROTTLED")) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 300));
    return json.data;
  }
  throw new Error("throttled after 5 attempts");
}

const LOOKUP = `query C($id: ID!) {
  collection(id: $id) { id title productsCount { count } }
}`;
const DELETE = `mutation D($input: CollectionDeleteInput!) {
  collectionDelete(input: $input) { deletedCollectionId userErrors { message } }
}`;

(async () => {
  if (!DOMAIN) throw new Error("SHOPIFY_STORE_DOMAIN missing");
  if (!SAFE.length) throw new Error("empty safe list — aborting");

  // Re-derive the guard from the live database rather than trusting the file:
  // if anything was re-pointed at one of these collections since the list was
  // written, it must drop out now.
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("test");
  const referenced = new Set();
  for (const name of ["menus", "brands", "collections", "departments", "configuratorcategories"]) {
    try {
      const hits = await db.collection(name).find({ shopifyCollectionId: { $in: SAFE } }).project({ shopifyCollectionId: 1 }).toArray();
      hits.forEach((h) => referenced.add(h.shopifyCollectionId));
    } catch (e) { /* collection absent */ }
  }
  await client.close();

  const ids = SAFE.filter((i) => !referenced.has(i));
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} · candidates ${ids.length}/${SAFE.length}${referenced.size ? ` (${referenced.size} newly referenced, skipped)` : ""}`);

  const token = await adminToken();
  let deleted = 0;
  const skipped = [];
  const missing = [];

  for (const id of ids) {
    const data = await gql(token, LOOKUP, { id });
    const col = data.collection;
    if (!col) { missing.push(id); continue; }
    const count = col.productsCount?.count ?? 0;
    if (count > 0) {
      skipped.push(`${col.title} (${count} products)`);
      continue;
    }
    if (APPLY) {
      const res = await gql(token, DELETE, { input: { id } });
      const ue = res.collectionDelete?.userErrors || [];
      if (ue.length) { skipped.push(`${col.title} (${ue.map((e) => e.message).join("; ")})`); continue; }
      deleted += 1;
    } else {
      deleted += 1;
    }
    process.stdout.write(`\r  ${APPLY ? "deleted" : "would delete"} ${deleted} · skipped ${skipped.length}`);
  }

  console.log(`\n${APPLY ? "deleted" : "would delete"}: ${deleted}`);
  if (skipped.length) console.log(`skipped (not empty / error): ${skipped.join(" | ")}`);
  if (missing.length) console.log(`already gone from Shopify: ${missing.length}`);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
