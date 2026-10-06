/**
 * Create the Shopify variants that storefront options have no counterpart for,
 * under the Shopify product the site already points at, and link them.
 *
 * Scope: picker rows that link-shopify-variants.cjs reported as
 * "no matching shopify variant". A row is created only when:
 *   - the product has option axes on the page, and Shopify's option names are
 *     exactly those axes (so values land on the right option);
 *   - the row has a value for every axis, and no Shopify variant already has
 *     that combination;
 *   - the row is still unlinked in Mongo when it is written (guarded update).
 * Price is the row's price; fix-shopify-prices-to-ui.cjs then applies any sale.
 * Inventory is untracked, as the storefront holds the stock figure.
 *
 * Nothing is deleted. Rollback lists every created variant and linked row.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/create-missing-shopify-variants.cjs PLAN_JSON           # dry run
 *   APPLY=1 node --require ./scripts/mongo-dns.cjs scripts/create-missing-shopify-variants.cjs PLAN_JSON   # write
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.env.APPLY === "1";
const ROOT = path.join(__dirname, "..");
const PLAN = process.argv[2];
if (!PLAN) throw new Error("pass the variant-link plan JSON path");
const norm = (s) => String(s ?? "").trim().toLowerCase();

async function main() {
  const { register } = require("tsx/cjs/api");
  register();
  const mongoose = require("mongoose");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
  const { connectMongo, applyDns } = require("./mongo-connect.cjs");
  const { unmatched } = require(path.resolve(PLAN));

  const primary = await connectMongo(process.env.MONGODB_URI);
  applyDns();
  const secondary = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 }).asPromise();
  const conns = { primary, secondary };

  const wanted = new Map(); // mongoId -> { cluster, rows:Set }
  for (const u of unmatched.filter((x) => /would need creating/.test(x.reason))) {
    if (!wanted.has(u.mongoId)) wanted.set(u.mongoId, { cluster: u.cluster, rows: new Set() });
    wanted.get(u.mongoId).rows.add(u.row);
  }

  const plan = [];
  const skipped = [];
  for (const [mongoId, w] of wanted) {
    const p = await conns[w.cluster].db.collection("products").findOne(
      { _id: new mongoose.Types.ObjectId(mongoId) },
      { projection: { name: 1, price: 1, shopifyProductId: 1, shopifyOptions: 1, variants: 1 } },
    );
    const axes = (p?.shopifyOptions || []).filter((a) => a?.name && !/^title$/i.test(String(a.name)) && (a.values || []).length);
    const s = await shopifyAdminRequest(
      `query($id:ID!){product(id:$id){id options{name values} variants(first:250){nodes{selectedOptions{name value}}}}}`,
      { id: p.shopifyProductId },
    );
    const shopOptions = s.product?.options || [];
    const shopOpts = shopOptions.map((o) => o.name);
    const axisNames = axes.map((a) => a.name);
    // Every page axis must be a Shopify option. A Shopify option the page does
    // not show is allowed only when it holds one fixed value, which the new
    // variant then takes too.
    const fixed = new Map();
    let mismatch = !s.product || axisNames.some((n) => !shopOpts.some((o) => norm(o) === norm(n)));
    for (const o of shopOptions) {
      if (axisNames.some((n) => norm(n) === norm(o.name))) continue;
      if ((o.values || []).length === 1) fixed.set(o.name, o.values[0]);
      else mismatch = true;
    }
    if (mismatch) {
      skipped.push({ mongoId, name: p?.name, reason: `options differ: shopify [${shopOpts}] vs page [${axisNames}]` });
      continue;
    }
    const existing = new Set(
      s.product.variants.nodes.map((v) => v.selectedOptions.map((o) => norm(o.value)).join(" / ")),
    );
    for (const idx of w.rows) {
      const row = p.variants[idx];
      if (!row || row.shopifyVariantId) continue;
      const pageValues = axes.map((a, i) => String(row[`option${Number(a.position) || i + 1}`] ?? "").trim());
      if (pageValues.some((v) => !v)) { skipped.push({ mongoId, name: p.name, row: idx, reason: "row lacks a value for an axis" }); continue; }
      // Values in Shopify's own option order.
      const values = shopOpts.map((n) => {
        const ai = axisNames.findIndex((a) => norm(a) === norm(n));
        return ai >= 0 ? pageValues[ai] : fixed.get(n);
      });
      const key = values.map(norm).join(" / ");
      if (existing.has(key)) { skipped.push({ mongoId, name: p.name, row: idx, reason: `shopify already has "${values.join(" / ")}"` }); continue; }
      existing.add(key);
      const price = Number(row.price) > 0 ? Number(row.price) : Number(p.price);
      if (!(price > 0)) { skipped.push({ mongoId, name: p.name, row: idx, reason: "no price" }); continue; }
      plan.push({
        cluster: w.cluster, mongoId, name: p.name, row: idx, sku: row.sku || "",
        productId: p.shopifyProductId,
        optionValues: shopOpts.map((n, i) => ({ optionName: n, name: values[i] })),
        price,
      });
    }
  }

  console.log(JSON.stringify({
    mode: APPLY ? "APPLY" : "DRY RUN",
    variantsToCreate: plan.length,
    products: new Set(plan.map((x) => x.mongoId)).size,
    skipped: skipped.length,
    sample: plan.slice(0, 6).map((x) => `${x.name} | ${x.optionValues.map((o) => o.name).join(" / ")} | £${x.price}`),
    skippedSample: skipped.slice(0, 6),
  }, null, 2));

  if (APPLY && plan.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rollbackPath = path.join(ROOT, `rollback-create-shopify-variants-${stamp}.json`);
    const created = [];
    const failed = [];
    const byProduct = new Map();
    for (const x of plan) {
      if (!byProduct.has(x.productId)) byProduct.set(x.productId, []);
      byProduct.get(x.productId).push(x);
    }
    for (const [productId, list] of byProduct) {
      const r = await shopifyAdminRequest(
        `mutation($productId:ID!,$variants:[ProductVariantsBulkInput!]!){
           productVariantsBulkCreate(productId:$productId, variants:$variants){
             productVariants{ id selectedOptions{name value} }
             userErrors{ field message }
           } }`,
        {
          productId,
          variants: list.map((x) => ({
            optionValues: x.optionValues,
            price: x.price.toFixed(2),
            inventoryItem: { sku: x.sku || undefined, tracked: false },
          })),
        },
      );
      const res = r.productVariantsBulkCreate;
      if (res.userErrors?.length) { failed.push({ productId, errors: res.userErrors }); continue; }
      for (const v of res.productVariants || []) {
        const key = v.selectedOptions.map((o) => norm(o.value)).join(" / ");
        const x = list.find((l) => l.optionValues.map((o) => norm(o.name)).join(" / ") === key);
        if (!x) continue;
        created.push({ ...x, variantId: v.id });
      }
      // Written as it goes, so a stop part-way still leaves a full record.
      fs.writeFileSync(rollbackPath, JSON.stringify(created.map((c) => ({ cluster: c.cluster, mongoId: c.mongoId, row: c.row, productId: c.productId, createdVariantId: c.variantId })), null, 2));
    }
    let linked = 0;
    for (const c of created) {
      const col = conns[c.cluster].db.collection("products");
      const res = await col.updateOne(
        {
          _id: new mongoose.Types.ObjectId(c.mongoId),
          $or: [{ [`variants.${c.row}.shopifyVariantId`]: { $in: [null, ""] } }, { [`variants.${c.row}.shopifyVariantId`]: { $exists: false } }],
        },
        { $set: { [`variants.${c.row}.shopifyVariantId`]: c.variantId } },
      );
      if (res.modifiedCount === 1) linked++;
    }
    console.log(`rollback: ${rollbackPath}`);
    console.log(`applied: ${created.length} variants created · ${linked} rows linked · failed products: ${failed.length}`);
    if (failed.length) console.log(JSON.stringify(failed, null, 2));
  }

  await primary.close();
  await secondary.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
