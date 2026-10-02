/**
 * Publish ACTIVE Tap Warehouse products to the same sales channels as every
 * other brand (Online Store + Google & YouTube).
 *
 * 6,698 Tap Warehouse products are ACTIVE in Shopify and visible on the site
 * but published to no channel, so the Storefront API — which the site's
 * checkout uses — cannot see them. Only publication changes: status, content,
 * variants and media are not touched. DRAFT products (hidden on the site) are
 * left exactly as they are. Each product is verified afterwards: published on
 * both channels and visible to the Storefront API.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/tapwarehouse-publish.cjs [--write] [--limit=5] [--concurrency=4]
 */
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");
for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p, quiet: true });
}
const arg = (n, d = "") => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=") || d;
const WRITE = process.argv.includes("--write");
const LIMIT = Number(arg("limit", 0)) || Infinity;
const CONCURRENCY = Number(arg("concurrency", 4));
const TW = "6aad6ac07120f8ddd7388bef";
const CHANNELS = ["Online Store", "Google & YouTube"];
const DOMAIN = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const API = `https://${DOMAIN}/admin/api/2025-07/graphql.json`;
const SF = `https://${DOMAIN}/api/2025-07/graphql.json`;
const DIR = path.join(__dirname, "..", "image-audit", "tapwarehouse-publish");
const say = (s = "") => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let token;
async function gql(query, variables) {
  for (let a = 0; a < 6; a++) {
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(60_000) });
      const b = await r.json();
      if (!b.errors) return b.data;
      if (!JSON.stringify(b.errors).includes("THROTTLED")) throw new Error(JSON.stringify(b.errors).slice(0, 300));
    } catch (e) {
      if (!String(e.message).includes("THROTTLED") && a >= 2) throw e;
    }
    await sleep(2000 * (a + 1));
  }
  throw new Error("Shopify request failed");
}
async function storefrontVisible(id) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(SF, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN }, body: JSON.stringify({ query: `query($id: ID!){ product(id: $id){ id availableForSale } }`, variables: { id } }) });
      const b = await r.json();
      if (b.data) return b.data.product;
    } catch {}
    await sleep(1500);
  }
  return null;
}

(async () => {
  token = (await (await fetch(`https://${DOMAIN}/admin/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET }) })).json()).access_token;
  fs.mkdirSync(DIR, { recursive: true });
  const pubs = (await gql(`{ publications(first: 50) { nodes { id name } } }`)).publications.nodes;
  const targets = CHANNELS.map((name) => pubs.find((p) => p.name === name));
  if (targets.some((x) => !x)) throw new Error(`channel not found: ${JSON.stringify(pubs.map((p) => p.name))}`);

  const conn = await connectMongo(process.env.MONGODB_URL2);
  const docs = await conn.db.collection("products").find({ brand: new mongoose.Types.ObjectId(TW), shopifyProductId: { $nin: [null, ""] } }).project({ name: 1, category: 1, shopifyProductId: 1 }).sort({ _id: 1 }).toArray();
  await mongoose.disconnect();

  // Current state from Shopify; only ACTIVE products not yet on both channels.
  const todo = [];
  for (let i = 0; i < docs.length; i += 50) {
    const b = docs.slice(i, i + 50);
    const d = await gql(`query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id status resourcePublications(first: 10) { nodes { publication { id } isPublished } } } } }`, { ids: b.map((x) => x.shopifyProductId) });
    d.nodes.forEach((n, k) => {
      if (!n || n.status !== "ACTIVE" || !String(b[k].category || "").trim()) return;
      const on = new Set(n.resourcePublications.nodes.filter((x) => x.isPublished).map((x) => x.publication.id));
      const missing = targets.filter((t) => !on.has(t.id));
      if (missing.length) todo.push({ doc: b[k], missing });
    });
  }
  const work = todo.slice(0, LIMIT === Infinity ? undefined : LIMIT);
  say(`${WRITE ? "WRITE" : "DRY RUN"}: ${docs.length} Tap Warehouse products; ACTIVE + on site but not on both channels: ${todo.length}; doing ${work.length}`);
  if (!WRITE) return;

  const log = path.join(DIR, `published-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  const t = { published: 0, verifiedChannels: 0, verifiedStorefront: 0, failed: 0 };
  const queue = [...work];
  let done = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const { doc, missing } = queue.shift();
        try {
          const r = await gql(
            `mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`,
            { id: doc.shopifyProductId, input: missing.map((m) => ({ publicationId: m.id })) },
          );
          if (r.publishablePublish.userErrors?.length) throw new Error(r.publishablePublish.userErrors.map((e) => e.message).join("; "));
          fs.appendFileSync(log, JSON.stringify({ id: String(doc._id), shopifyProductId: doc.shopifyProductId, published: missing.map((m) => m.name) }) + "\n");
          t.published++;
          const v = await gql(`query($id: ID!) { product(id: $id) { status resourcePublications(first: 10) { nodes { publication { id } isPublished } } } }`, { id: doc.shopifyProductId });
          const on = new Set(v.product.resourcePublications.nodes.filter((x) => x.isPublished).map((x) => x.publication.id));
          if (targets.every((x) => on.has(x.id)) && v.product.status === "ACTIVE") t.verifiedChannels++;
          if (await storefrontVisible(doc.shopifyProductId)) t.verifiedStorefront++;
        } catch (e) {
          t.failed++;
          say(`  ✗ ${doc.name.slice(0, 50)} — ${String(e.message).slice(0, 160)}`);
        }
        if (++done % 250 === 0) say(`  ${done}/${work.length} ${JSON.stringify(t)}`);
      }
    }),
  );
  say(`done ${JSON.stringify(t)}`);
  say(`log: ${log}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
