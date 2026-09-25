/**
 * Flip a brand's Shopify products from DRAFT to ACTIVE and publish them to
 * the Online Store sales channel — mirrors what `syncFullProductToShopify`
 * (src/lib/shopify/sync-product.ts) already does for every other brand's
 * live products (status ACTIVE + `publishablePublish` to the Online Store
 * publication), so newly-activated products render exactly like existing
 * ones.
 *
 * Scoped strictly to `brand: brand._id` — only ever touches this brand's
 * own products, on whichever cluster the brand lives on.
 *
 * Env:
 *   BRAND="Al Murad"   which brand (required)
 *   CONCURRENCY=n      products processed at once (default 8)
 *   DRY_RUN=1          report what would change, write nothing
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BRAND_NAME = process.env.BRAND;
if (!BRAND_NAME) throw new Error('BRAND is required, e.g. BRAND="Al Murad"');
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 8, 12));
const DRY_RUN = process.env.DRY_RUN === "1";

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
let token = null;

async function adminToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("token exchange failed");
  return j.access_token;
}

async function admin(query, variables, attempt = 0) {
  try {
    const res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const j = await res.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
    return j.data;
  } catch (e) {
    if (attempt >= 5) throw e;
    await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    return admin(query, variables, attempt + 1);
  }
}

let onlineStorePublicationId;
async function getOnlineStorePublicationId() {
  if (onlineStorePublicationId !== undefined) return onlineStorePublicationId;
  const data = await admin(`query { publications(first: 20) { nodes { id name } } }`, {});
  const online = (data.publications?.nodes || []).find((p) => /online\s*store/i.test(p.name || ""));
  onlineStorePublicationId = online?.id ?? null;
  return onlineStorePublicationId;
}

async function openBrandCluster() {
  const { db: primary } = await connectMongo();
  const brand = await primary.collection("brands").findOne({ name: BRAND_NAME });
  if (!brand) throw new Error("brand not found: " + BRAND_NAME);
  if (brand.dataCluster !== "secondary") {
    return { brand, primary, db: primary, close: async () => {} };
  }
  const uri2 = process.env.MONGODB_URL2;
  if (!uri2) throw new Error(BRAND_NAME + " is on the secondary, but MONGODB_URL2 is not set");
  const conn = await mongoose.createConnection(uri2, { serverSelectionTimeoutMS: 30000 }).asPromise();
  return { brand, primary, db: conn.db, close: () => conn.close() };
}

async function activateOne(productId, publicationId) {
  const d1 = await admin(
    `mutation($input: ProductUpdateInput!) {
       productUpdate(product: $input) { product { id } userErrors { field message } }
     }`,
    { input: { id: productId, status: "ACTIVE" } },
  );
  const errs1 = d1.productUpdate.userErrors || [];
  if (errs1.length) throw new Error(errs1.map((e) => e.message).join("; ").slice(0, 200));

  if (publicationId) {
    const d2 = await admin(
      `mutation($id: ID!, $input: [PublicationInput!]!) {
         publishablePublish(id: $id, input: $input) { userErrors { message } }
       }`,
      { id: productId, input: [{ publicationId }] },
    );
    const errs2 = d2.publishablePublish.userErrors || [];
    if (errs2.length) throw new Error(errs2.map((e) => e.message).join("; ").slice(0, 200));
  }
}

async function main() {
  token = await adminToken();
  const { brand, primary, db, close } = await openBrandCluster();
  const publicationId = await getOnlineStorePublicationId();
  console.log("brand              : " + BRAND_NAME);
  console.log("online store pub id: " + (publicationId || "NOT FOUND — status will be set but not published"));

  const filter = { brand: brand._id, shopifyProductId: { $nin: [null, ""] } };
  const products = await db.collection("products").find(filter)
    .project({ shopifyProductId: 1 }).toArray();
  console.log(BRAND_NAME + ": " + products.length + " products with a Shopify id\n");
  if (!products.length) { await close(); return; }

  let done = 0, ok = 0, failed = 0;
  let cursor = 0;
  const started = Date.now();

  const worker = async () => {
    while (cursor < products.length) {
      const p = products[cursor++];
      done += 1;
      if (DRY_RUN) { ok += 1; continue; }
      try {
        await activateOne(p.shopifyProductId, publicationId);
        ok += 1;
      } catch (e) {
        failed += 1;
        if (failed <= 10) console.log("  FAIL " + p.shopifyProductId + " -> " + String(e.message || e).slice(0, 150));
      }
      if (done % 200 === 0 || done === products.length) {
        const rate = done / ((Date.now() - started) / 1000);
        const left = Math.round((products.length - done) / Math.max(rate, 0.001) / 60);
        console.log("  " + done + "/" + products.length + "  ok " + ok + "  failed " + failed + "  ~" + left + "m left");
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log("\ndone — activated " + ok + ", failed " + failed);

  if (!DRY_RUN && failed === 0) {
    await primary.collection("brands").updateOne(
      { _id: brand._id },
      { $set: { isActive: true } },
    );
    console.log("Brand.isActive set to true for " + BRAND_NAME);
  } else if (!DRY_RUN) {
    console.log("Brand.isActive left as-is — " + failed + " product(s) failed to activate, fix and re-run first.");
  }

  await close();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
