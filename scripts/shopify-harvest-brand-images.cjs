/**
 * Fill in `shopifyImages[]` after `shopify-sync-brand.cjs`.
 *
 * That push creates each product with its gallery attached (`media` on the
 * `productCreate` mutation) but only ever records `shopifyProductId` /
 * `shopifyVariantId` — the resulting Shopify CDN URLs are never written back
 * anywhere, so a brand pushed this way ends up with images live on Shopify
 * but no record of their Shopify links in Mongo at all.
 *
 * The repo's existing `harvest-shopify-image-urls.cjs` does not cover this:
 * it only connects to the primary cluster (this script's products are on
 * whichever cluster the brand's `dataCluster` names), and it matches
 * outstanding URLs by a per-image `mediaId` that a `shopifyImages[]` entry
 * would already have to carry — which, for a product pushed by
 * `shopify-sync-brand.cjs`, was never created in the first place.
 *
 * Matches Shopify's `media` connection to our own `images[]` array by
 * POSITION (Shopify preserves the order media was attached in, which is the
 * order `images[]` was uploaded in) rather than by id, since there is no id
 * recorded yet to match against.
 *
 * Every read and write below is scoped to `brand: brand._id`, so this can
 * only ever touch the one brand's own products.
 *
 * Env:
 *   BRAND="Al Murad"   which brand (required)
 *   BATCH=40           products per Shopify query (nodes() cost-bounded)
 *   DRY_RUN=1          report what would be written, write nothing
 *   THEN_REWRITE=1     once shopifyImages[] is filled, also collapse
 *                      images[] down to the shopifyUrl list in the same run
 *                      (equivalent of REWRITE_IMAGES=1 on import-al-murad.cjs,
 *                      generalised for any brand)
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
if (!BRAND_NAME) throw new Error("BRAND is required, e.g. BRAND=\"Al Murad\"");
const BATCH = Math.max(1, Math.min(Number(process.env.BATCH) || 40, 100));
const DRY_RUN = process.env.DRY_RUN === "1";
const THEN_REWRITE = process.env.THEN_REWRITE === "1";

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

async function openBrandCluster() {
  const { db: primary } = await connectMongo();
  const brand = await primary.collection("brands").findOne({ name: BRAND_NAME });
  if (!brand) throw new Error("brand not found: " + BRAND_NAME);
  if (brand.dataCluster !== "secondary") {
    return { brand, db: primary, close: async () => {} };
  }
  const uri2 = process.env.MONGODB_URL2;
  if (!uri2) throw new Error(BRAND_NAME + " is on the secondary, but MONGODB_URL2 is not set");
  const conn = await mongoose.createConnection(uri2, { serverSelectionTimeoutMS: 30000 }).asPromise();
  return { brand, db: conn.db, close: () => conn.close() };
}

async function main() {
  token = await adminToken();
  const { brand, db, close } = await openBrandCluster();
  const col = db.collection("products");

  const filter = {
    brand: brand._id,
    shopifyProductId: { $nin: [null, ""] },
    // Raw insertMany (not the Mongoose model) leaves an unset array field
    // missing entirely rather than `[]`, so both are matched.
    $or: [{ shopifyImages: { $exists: false } }, { shopifyImages: { $size: 0 } }],
  };
  const total = await col.countDocuments(filter);
  console.log(BRAND_NAME + ": " + total + " products with a Shopify id but no shopifyImages[] yet");
  if (!total) { await close(); return; }

  let done = 0, filled = 0, stillProcessing = 0, mismatched = 0;
  let lastId = null;

  for (;;) {
    const q = Object.assign({}, filter);
    if (lastId) q._id = { $gt: lastId };
    const page = await col.find(q).project({ shopifyProductId: 1, images: 1 })
      .sort({ _id: 1 }).limit(BATCH).toArray();
    if (!page.length) break;
    lastId = page[page.length - 1]._id;

    const data = await admin(
      `query Harvest($ids: [ID!]!, $n: Int!) {
         nodes(ids: $ids) {
           id
           ... on Product { media(first: $n) { nodes { id ... on MediaImage { image { url } } } } }
         }
       }`,
      { ids: page.map((p) => p.shopifyProductId), n: 20 },
    );
    const byProductId = new Map((data.nodes || []).filter(Boolean).map((n) => [n.id, n.media?.nodes || []]));

    const ops = [];
    for (const p of page) {
      done += 1;
      const nodes = byProductId.get(p.shopifyProductId) || [];
      const MAX_IMAGES = Number(process.env.MAX_IMAGES) || 12;
      function usableImage(u) {
        const file = String(u || "").split("?")[0].split("/").pop();
        return /\.(jpe?g|png|webp|gif|avif)$/i.test(file);
      }
      const images = (p.images || []).filter(Boolean).filter(usableImage).slice(0, MAX_IMAGES);
      if (!nodes.length) { stillProcessing += 1; continue; }
      if (nodes.length !== images.length) mismatched += 1; // still recorded, positionally, best-effort

      const shopifyImages = images.map((sourceUrl, i) => {
        const node = nodes[i];
        return {
          sourceUrl,
          shopifyUrl: node?.image?.url || "",
          mediaId: node?.id || "",
          position: i,
        };
      });
      const allResolved = shopifyImages.every((si) => si.shopifyUrl);
      if (!allResolved) { stillProcessing += 1; continue; } // media still processing on Shopify's side — retry later

      filled += 1;
      const set = { shopifyImages };
      if (THEN_REWRITE) set.images = shopifyImages.map((si) => si.shopifyUrl);
      if (!DRY_RUN) {
        ops.push({ updateOne: { filter: { _id: p._id, brand: brand._id }, update: { $set: set } } });
      }
    }
    if (ops.length) await col.bulkWrite(ops, { ordered: false });
    console.log("  " + done + "/" + total + "  filled " + filled + "  still-processing " + stillProcessing + "  position-mismatch " + mismatched);
  }

  console.log("\ndone. filled " + filled + "/" + total + (stillProcessing ? " (" + stillProcessing + " still processing on Shopify's side — re-run to pick them up)" : ""));
  await close();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
