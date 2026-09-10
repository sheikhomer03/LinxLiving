/**
 * Push a brand's cleaned product names to Shopify as product titles.
 *
 * Deliberately narrow: the mutation carries only `id` and `title`, so nothing
 * else on the Shopify product (price, images, status, metafields, tags) can be
 * disturbed by this run. Products are picked up via shopifySyncedAt: null,
 * which strip-brand-name-prefix.cjs sets on every name it changed.
 *
 * Before writing, the current Shopify titles are read back and journalled to
 * rollback-<brand>-shopify-titles-<stamp>.json so the store side is reversible.
 *
 * Dry run by default.
 *   node --require ./scripts/mongo-dns.cjs scripts/push-brand-titles-to-shopify.cjs --brand=<slug>
 *   ... --apply            commit
 *   ... --apply --limit 5  commit a small test batch first
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const BRAND = (process.argv.find((a) => a.startsWith("--brand=")) || "").slice(8);
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
const STORE = String(process.env.SHOPIFY_STORE_DOMAIN || "")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const GRAPHQL_URL = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;
const SHOPIFY_TITLE_MAX = 255;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toShopifyTitle(name) {
  const title = String(name ?? "").trim();
  if (title.length <= SHOPIFY_TITLE_MAX) return title;
  const clipped = title.slice(0, SHOPIFY_TITLE_MAX - 1);
  const cut = clipped.lastIndexOf(" ");
  return (cut > SHOPIFY_TITLE_MAX - 40 ? clipped.slice(0, cut) : clipped).trim();
}

let cachedToken = null;
async function getToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`token request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("token response missing access_token");
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 86399) * 1000,
  };
  return cachedToken.accessToken;
}

/** Cost-aware request: waits when the leaky bucket runs low, retries throttles. */
async function gql(query, variables, attempt = 0) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": await getToken(),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`HTTP ${res.status} after retries`);
    await sleep(2000 * 2 ** attempt);
    return gql(query, variables, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const body = await res.json();
  const throttled = body.errors?.some((e) => e.extensions?.code === "THROTTLED");
  if (throttled) {
    if (attempt >= 5) throw new Error("throttled after retries");
    await sleep(2000 * 2 ** attempt);
    return gql(query, variables, attempt + 1);
  }
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));

  const bucket = body.extensions?.cost?.throttleStatus;
  if (bucket && bucket.currentlyAvailable < 100) {
    await sleep(Math.ceil((100 - bucket.currentlyAvailable) / bucket.restoreRate) * 1000);
  }
  return body.data;
}

const READ_TITLES = `
  query ReadTitles($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { id title } }
  }
`;

const UPDATE_TITLE = `
  mutation UpdateTitle($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id title }
      userErrors { field message }
    }
  }
`;

(async () => {
  if (!BRAND) {
    console.error("Usage: --brand=<slug> [--limit=N] [--apply]");
    process.exit(1);
  }
  if (!STORE || !process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET) {
    console.error("Missing SHOPIFY_STORE_DOMAIN / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET");
    process.exit(1);
  }
  await connectMongo();
  const db = require("mongoose").connection.db;

  const brand = await db.collection("brands").findOne({ slug: BRAND });
  if (!brand) {
    console.error(`Brand ${BRAND} not found`);
    process.exit(1);
  }

  let products = await db
    .collection("products")
    .find({
      brand: brand._id,
      shopifySyncedAt: null,
      shopifyProductId: { $nin: [null, ""] },
    })
    .project({ name: 1, shopifyProductId: 1 })
    .toArray();

  const missingGid = await db.collection("products").countDocuments({
    brand: brand._id,
    shopifySyncedAt: null,
    $or: [{ shopifyProductId: null }, { shopifyProductId: "" }],
  });

  if (products.length > LIMIT) products = products.slice(0, LIMIT);

  console.log(`store            : ${STORE} (${API_VERSION})`);
  console.log(`pending push     : ${products.length}`);
  console.log(`no shopify gid   : ${missingGid} (skipped)`);
  console.log("\n-- first 10 titles to send --");
  products.slice(0, 10).forEach((p) => console.log(`   "${toShopifyTitle(p.name)}"`));

  if (!APPLY) {
    console.log("\nDRY RUN — nothing sent to Shopify. Re-run with --apply.");
    process.exit(0);
  }

  // Read current Shopify titles first so the store side is reversible.
  console.log("\nreading current Shopify titles…");
  const before = [];
  for (let i = 0; i < products.length; i += 100) {
    const chunk = products.slice(i, i + 100);
    const data = await gql(READ_TITLES, { ids: chunk.map((p) => p.shopifyProductId) });
    for (const node of data.nodes) {
      if (node?.id) before.push({ id: node.id, title: node.title });
    }
    process.stdout.write(`\r  read ${Math.min(i + 100, products.length)}/${products.length}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rollbackPath = path.join(__dirname, "..", `rollback-${BRAND}-shopify-titles-${stamp}.json`);
  fs.writeFileSync(rollbackPath, JSON.stringify(before, null, 2));
  console.log(`\nrollback written: ${rollbackPath}`);

  let ok = 0;
  const failures = [];
  for (const [i, p] of products.entries()) {
    const title = toShopifyTitle(p.name);
    try {
      const data = await gql(UPDATE_TITLE, {
        product: { id: p.shopifyProductId, title },
      });
      const errs = data.productUpdate.userErrors;
      if (errs.length) {
        failures.push({ _id: String(p._id), title, error: errs.map((e) => e.message).join("; ") });
      } else {
        ok++;
        await db
          .collection("products")
          .updateOne(
            { _id: p._id },
            { $set: { shopifySyncedAt: new Date(), shopifySyncError: null } },
          );
      }
    } catch (e) {
      failures.push({ _id: String(p._id), title, error: e.message });
    }
    if ((i + 1) % 25 === 0 || i === products.length - 1) {
      process.stdout.write(`\r  pushed ${i + 1}/${products.length}  ok=${ok} failed=${failures.length}`);
    }
  }

  console.log(`\n\nupdated on Shopify : ${ok}`);
  console.log(`failed             : ${failures.length}`);
  failures.slice(0, 15).forEach((f) => console.log(`   ${f._id}: ${f.error}`));
  if (failures.length) {
    const failPath = path.join(__dirname, "..", `${BRAND}-shopify-title-failures-${stamp}.json`);
    fs.writeFileSync(failPath, JSON.stringify(failures, null, 2));
    console.log(`failures written: ${failPath}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
