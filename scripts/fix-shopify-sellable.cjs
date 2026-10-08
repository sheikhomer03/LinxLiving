/**
 * Make Shopify accept what the storefront sells.
 *
 * Two blocks found by audit-checkout-readiness.cjs, both on Shopify's side:
 *
 *   draft        the Shopify product behind a storefront-visible product is
 *                DRAFT → set ACTIVE (the exact product Mongo points at).
 *   stock-deny   Shopify tracks stock, holds 0, and refuses to oversell, while
 *                the site shows the item in stock → inventoryPolicy CONTINUE.
 *                Only where the site's own stock is > 0; an item the site shows
 *                out of stock cannot reach the basket anyway.
 *
 * Nothing is created or deleted. A rollback file is written before any change.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-shopify-sellable.cjs AUDIT_JSON           # dry run
 *   APPLY=1 node --require ./scripts/mongo-dns.cjs scripts/fix-shopify-sellable.cjs AUDIT_JSON   # write
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.env.APPLY === "1";
const ROOT = path.join(__dirname, "..");
const AUDIT = process.argv[2];
if (!AUDIT) throw new Error("pass the audit JSON path");

async function main() {
  const { register } = require("tsx/cjs/api");
  register();
  const mongoose = require("mongoose");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
  const { connectMongo, applyDns } = require("./mongo-connect.cjs");
  const { issues } = require(path.resolve(AUDIT));

  const primary = await connectMongo(process.env.MONGODB_URI);
  applyDns();
  const secondary = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 }).asPromise();
  const conns = { primary, secondary };

  /* ---- draft ---- */
  const draftIds = [...new Set(issues.filter((i) => i.code === "SHOPIFY_PRODUCT_DRAFT").map((i) => i.detail))];
  const drafts = [];
  for (let i = 0; i < draftIds.length; i += 50) {
    const d = await shopifyAdminRequest(
      `query($ids:[ID!]!){nodes(ids:$ids){...on Product{id title status}}}`,
      { ids: draftIds.slice(i, i + 50) },
    );
    for (const n of d.nodes || []) if (n?.status === "DRAFT") drafts.push(n);
  }

  /* ---- stock-deny ---- */
  const denyProducts = new Map();
  for (const i of issues.filter((x) => x.code === "SHOPIFY_OUT_OF_STOCK_DENY")) denyProducts.set(i.productId, i.cluster);
  const policyChanges = [];
  const siteOut = [];
  for (const [id, cluster] of denyProducts) {
    const p = await conns[cluster].db.collection("products").findOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { projection: { name: 1, stock: 1, shopifyProductId: 1, shopifyVariantId: 1, variants: 1 } },
    );
    if (!p?.shopifyProductId) continue;
    // Site stock for each GID the storefront can reach.
    const siteStock = new Map();
    for (const v of p.variants || []) if (v.shopifyVariantId) siteStock.set(v.shopifyVariantId, Number(v.stock ?? p.stock) || 0);
    if (p.shopifyVariantId && !siteStock.has(p.shopifyVariantId)) siteStock.set(p.shopifyVariantId, Number(p.stock) || 0);

    const d = await shopifyAdminRequest(
      `query($id:ID!){product(id:$id){variants(first:250){nodes{id inventoryPolicy inventoryQuantity inventoryItem{tracked}}}}}`,
      { id: p.shopifyProductId },
    );
    for (const v of d.product?.variants?.nodes || []) {
      if (!siteStock.has(v.id)) continue;
      if (!(v.inventoryItem?.tracked && v.inventoryPolicy === "DENY" && Number(v.inventoryQuantity) <= 0)) continue;
      if (siteStock.get(v.id) > 0) policyChanges.push({ productId: p.shopifyProductId, variantId: v.id, mongoId: id, name: p.name, siteStock: siteStock.get(v.id) });
      else siteOut.push({ mongoId: id, name: p.name, variantId: v.id });
    }
  }

  const summary = {
    mode: APPLY ? "APPLY" : "DRY RUN",
    draftToActive: drafts.length,
    inventoryPolicyToContinue: policyChanges.length,
    inventoryPolicyProducts: new Set(policyChanges.map((c) => c.mongoId)).size,
    leftAlone_siteShowsOutOfStock: siteOut.length,
    draftSample: drafts.slice(0, 5).map((d) => d.title),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (APPLY) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rollback = path.join(ROOT, `rollback-shopify-sellable-${stamp}.json`);
    fs.writeFileSync(rollback, JSON.stringify({
      statuses: drafts.map((d) => ({ productId: d.id, status: "DRAFT" })),
      inventoryPolicies: policyChanges.map((c) => ({ productId: c.productId, variantId: c.variantId, inventoryPolicy: "DENY" })),
    }, null, 2));
    console.log(`rollback: ${rollback}`);

    const failed = [];
    let active = 0;
    for (const d of drafts) {
      const r = await shopifyAdminRequest(
        `mutation($input:ProductInput!){productUpdate(input:$input){product{id status} userErrors{field message}}}`,
        { input: { id: d.id, status: "ACTIVE" } },
      );
      if (r.productUpdate.userErrors?.length) failed.push({ id: d.id, errors: r.productUpdate.userErrors });
      else active++;
    }
    const byProduct = new Map();
    for (const c of policyChanges) {
      if (!byProduct.has(c.productId)) byProduct.set(c.productId, []);
      byProduct.get(c.productId).push(c.variantId);
    }
    let cont = 0;
    for (const [productId, ids] of byProduct) {
      const r = await shopifyAdminRequest(
        `mutation($productId:ID!,$variants:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$productId,variants:$variants){productVariants{id inventoryPolicy} userErrors{field message}}}`,
        { productId, variants: ids.map((id) => ({ id, inventoryPolicy: "CONTINUE" })) },
      );
      if (r.productVariantsBulkUpdate.userErrors?.length) failed.push({ productId, errors: r.productVariantsBulkUpdate.userErrors });
      else cont += ids.length;
    }
    console.log(`applied: ${active} products ACTIVE · ${cont} variants CONTINUE · failed: ${failed.length}`);
    if (failed.length) console.log(JSON.stringify(failed, null, 2));
  }

  await primary.close();
  await secondary.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
