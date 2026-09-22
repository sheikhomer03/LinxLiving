/**
 * Turn inventory tracking off on variants this sync created.
 *
 * `productSet` defaults a new variant to tracked, quantity 0, policy DENY, so
 * every variant created before `inventoryItem: { tracked: false }` was added
 * to the sync reads as out of stock and cannot be bought. The products that
 * had already been through the sync showed "Out of stock" on the storefront
 * for exactly this reason.
 *
 * Untracked is the convention in this store: every variant that predates the
 * sync is untracked, and `Product.stock` says why — nothing in this catalogue
 * is genuinely limited by units held.
 *
 * One `productVariantsBulkUpdate` per product, using the variant ids already
 * recorded in Mongo, so Shopify does not have to be queried first.
 *
 * Env:
 *   BRAND=slug  brand to repair (default "drench")
 *   LIMIT=n     only the first n products
 *   DRY_RUN=1   report only
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BRAND_SLUG = process.env.BRAND || "drench";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const DRY_RUN = process.env.DRY_RUN === "1";
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";

let token = null;

async function adminToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  }
  const res = await fetch("https://" + DOMAIN + "/admin/oauth/access_token", {
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
    const res = await fetch(
      "https://" + DOMAIN + "/admin/api/" + VERSION + "/graphql.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables }),
      },
    );
    const j = await res.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 240));
    return j.data;
  } catch (e) {
    if (attempt >= 5) throw e;
    await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    return admin(query, variables, attempt + 1);
  }
}

async function main() {
  token = await adminToken();
  const { db: primary } = await connectMongo();
  const brand = await primary.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("brand not found: " + BRAND_SLUG);

  let db = primary;
  let secConn = null;
  if (brand.dataCluster === "secondary") {
    secConn = await mongoose
      .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 })
      .asPromise();
    db = secConn.db;
  }
  const P = db.collection("products");

  const filter = {
    brand: brand._id,
    shopifyVariantsSyncedAt: { $exists: true },
    inventoryUntrackedAt: { $exists: false },
    // No clause on `variants.0.shopifyVariantId`: `$nin` against a positional
    // array path matches nothing here even when the value is plainly set.
    // Products without ids are skipped in the loop instead.
  };

  const total = await P.countDocuments(filter);
  console.log("brand   : " + brand.name);
  console.log("to fix  : " + total + " products" + (DRY_RUN ? "   (DRY RUN)" : ""));
  console.log("");

  let done = 0, ok = 0, failed = 0, variants = 0;
  const started = Date.now();
  const target = Math.min(total, LIMIT === Infinity ? total : LIMIT);

  for await (const doc of P.find(filter).limit(LIMIT === Infinity ? 0 : LIMIT)) {
    done += 1;
    const ids = (doc.variants || [])
      .map((v) => v.shopifyVariantId)
      .filter(Boolean);
    if (!ids.length) continue;

    if (DRY_RUN) {
      ok += 1;
      variants += ids.length;
      if (ok <= 4) {
        console.log("  [dry] " + String(doc.name).slice(0, 44).padEnd(46) + ids.length + " variants");
      }
      continue;
    }

    try {
      const d = await admin(
        "mutation Untrack($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {" +
          "  productVariantsBulkUpdate(productId: $productId, variants: $variants) {" +
          "    userErrors { field message }" +
          "  }" +
          "}",
        {
          productId: doc.shopifyProductId,
          variants: ids.map((id) => ({ id, inventoryItem: { tracked: false } })),
        },
      );
      const errs =
        (d.productVariantsBulkUpdate && d.productVariantsBulkUpdate.userErrors) || [];
      if (errs.length) {
        throw new Error(errs.map((e) => e.message).join("; ").slice(0, 200));
      }
      await P.updateOne({ _id: doc._id }, { $set: { inventoryUntrackedAt: new Date() } });
      ok += 1;
      variants += ids.length;
    } catch (e) {
      failed += 1;
      if (failed <= 8) {
        console.log("  FAIL " + String(doc.name).slice(0, 40) + " -> " + String(e.message).slice(0, 120));
      }
    }

    if (done % 50 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      const left = Math.round((target - done) / Math.max(rate, 0.001) / 60);
      console.log("  " + done + "/" + target + "  ok " + ok + "  variants " + variants +
        "  failed " + failed + "  ~" + left + "m left");
    }
  }

  console.log("");
  console.log("products fixed : " + ok);
  console.log("variants untracked: " + variants);
  console.log("failed         : " + failed);
  if (secConn) await secConn.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
