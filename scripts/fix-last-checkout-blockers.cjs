/**
 * The last checkout blockers from audit-checkout-readiness.cjs, each handled
 * by an explicit rule rather than a catalogue-wide pass.
 *
 *   position+price  Shopify variants titled "Variant n" / "Default Colour":
 *                   row n ↔ MERGED-V<n+1>, and the prices must be equal.
 *   title           rows sharing a supplier SKU: row ↔ the one Shopify variant
 *                   titled exactly like its option.
 *   single          a product with one Shopify variant whose rows are the same
 *                   item at the same price under different supplier codes.
 *   create          the missing option values (Octagon colours, Farmhouse size).
 *   product-gid     pages with no option picker whose stored variant was
 *                   deleted: the live variant with the page's price, else the
 *                   closest-priced one (its price is then set to the page's).
 *
 * Only empty / dead links are changed, nothing is deleted, and a rollback file
 * is written before the first change.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-last-checkout-blockers.cjs            # dry run
 *   APPLY=1 node --require ./scripts/mongo-dns.cjs scripts/fix-last-checkout-blockers.cjs    # write
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.env.APPLY === "1";
const ROOT = path.join(__dirname, "..");
const norm = (s) => String(s ?? "").trim().toLowerCase();
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const POSITION_PRICE = ["6ab3bcf6cdb5ecac624e1a37", "6ab3bcf8cdb5ecac624e1aae", "6ab3b88553747b87fb8389f4", "6ab3b88653747b87fb838ac7", "6ab3b88653747b87fb838a3e"];
const TITLE = ["6ab795ea731d71b136a76d26"];
const SINGLE = ["6ab64883fcfdbfee1ebb4c82", "6ab6487afcfdbfee1ebb4c7e"];
const OCTAGON = "6ab2663a89e24d150e85eac7";
const FARMHOUSE = "6ab3b88553747b87fb8389e3";
const DRENCH = ["6aabd9186167968f26d1df93", "6aabd9196167968f26d1dfaf", "6aabd9196167968f26d1df9f", "6aabd9196167968f26d1dfa3", "6aabd9186167968f26d1df97", "6aabd9196167968f26d1dfa7", "6aabd9196167968f26d1dfab", "6aabd9186167968f26d1df9b"];

async function main() {
  const { register } = require("tsx/cjs/api");
  register();
  const mongoose = require("mongoose");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
  const { applyDns } = require("./mongo-connect.cjs");
  applyDns();
  // Every product here lives in the secondary cluster.
  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 }).asPromise();
  const col = conn.db.collection("products");
  const load = (id) => col.findOne({ _id: new mongoose.Types.ObjectId(id) });
  const shopProduct = async (gid) =>
    (await shopifyAdminRequest(
      `query($id:ID!){product(id:$id){id options{id name values} variants(first:250){nodes{id sku title price selectedOptions{name value}}}}}`,
      { id: gid },
    )).product;

  const rowLinks = []; // { mongoId, row, to }
  const productLinks = []; // { mongoId, from, to, price, title }
  const creates = []; // { mongoId, row, productId, optionValues, price, sku, addOption? }
  const notes = [];

  for (const id of POSITION_PRICE) {
    const p = await load(id);
    const sp = await shopProduct(p.shopifyProductId);
    p.variants.forEach((v, i) => {
      if (v.shopifyVariantId) return;
      const sv = sp.variants.nodes.find((x) => String(x.sku || "") === `MERGED-V${i + 1}`);
      if (sv && same(sv.price, v.price) && !p.variants.some((r) => r.shopifyVariantId === sv.id)) rowLinks.push({ mongoId: id, name: p.name, row: i, to: sv.id, why: `position+price "${sv.title}" £${sv.price}` });
      else notes.push(`${p.name} row ${i}: no position+price match`);
    });
  }
  for (const id of TITLE) {
    const p = await load(id);
    const sp = await shopProduct(p.shopifyProductId);
    p.variants.forEach((v, i) => {
      if (v.shopifyVariantId) return;
      const hits = sp.variants.nodes.filter((x) => norm(x.title) === norm(v.option1 || v.name));
      if (hits.length === 1) rowLinks.push({ mongoId: id, name: p.name, row: i, to: hits[0].id, why: `title "${hits[0].title}" £${hits[0].price}` });
      else notes.push(`${p.name} row ${i}: ${hits.length} title matches`);
    });
  }
  for (const id of SINGLE) {
    const p = await load(id);
    const sp = await shopProduct(p.shopifyProductId);
    const only = sp.variants.nodes.length === 1 ? sp.variants.nodes[0] : null;
    p.variants.forEach((v, i) => {
      if (v.shopifyVariantId) return;
      if (only && same(only.price, v.price)) rowLinks.push({ mongoId: id, name: p.name, row: i, to: only.id, why: `single variant "${only.title}" £${only.price}` });
      else notes.push(`${p.name} row ${i}: single variant price differs`);
    });
  }
  {
    const p = await load(OCTAGON);
    const sp = await shopProduct(p.shopifyProductId);
    const size = sp.options.find((o) => o.name === "Size");
    p.variants.forEach((v, i) => {
      if (v.shopifyVariantId) return;
      creates.push({
        mongoId: OCTAGON, name: p.name, row: i, productId: p.shopifyProductId, price: Number(v.price), sku: v.sku,
        optionValues: [{ optionName: "Size", name: size.values[0] }, { optionName: "Colour/Finish", name: v.option1 }],
      });
    });
  }
  {
    const p = await load(FARMHOUSE);
    const sp = await shopProduct(p.shopifyProductId);
    const hasSize = sp.options.some((o) => o.name === "Size");
    p.variants.forEach((v, i) => {
      if (v.shopifyVariantId) return;
      creates.push({
        mongoId: FARMHOUSE, name: p.name, row: i, productId: p.shopifyProductId, price: Number(v.price), sku: v.sku,
        // The existing variant is row 0 (300x300x7mm), which takes the first value.
        addOption: hasSize ? null : { name: "Size", values: p.variants.map((r) => r.option1) },
        optionValues: [{ optionName: "Colour/Finish", name: sp.options.find((o) => o.name === "Colour/Finish").values[0] }, { optionName: "Size", name: v.option1 }],
      });
    });
  }
  for (const id of DRENCH) {
    const p = await load(id);
    const sp = await shopProduct(p.shopifyProductId);
    const nodes = sp.variants.nodes;
    if (nodes.some((x) => x.id === p.shopifyVariantId)) continue; // already live
    const exact = nodes.find((x) => same(x.price, p.price));
    const closest = exact || [...nodes].sort((a, b) => Math.abs(a.price - p.price) - Math.abs(b.price - p.price))[0];
    productLinks.push({ mongoId: id, name: p.name, from: p.shopifyVariantId, to: closest.id, title: closest.title, shopPrice: Number(closest.price), sitePrice: p.price, exact: Boolean(exact) });
  }

  console.log(JSON.stringify({
    mode: APPLY ? "APPLY" : "DRY RUN",
    rowLinks: rowLinks.map((l) => `${l.name} | row ${l.row} → ${l.why}`),
    creates: creates.map((c) => `${c.name} | row ${c.row} → ${c.optionValues.map((o) => o.name).join(" / ")} £${c.price}${c.addOption ? " (+ Size option)" : ""}`),
    productLinks: productLinks.map((l) => `${l.name} | → "${l.title}" Shopify £${l.shopPrice} · site £${l.sitePrice}${l.exact ? " (exact)" : " (closest)"}`),
    notes,
  }, null, 2));

  if (!APPLY) return conn.close();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rollbackPath = path.join(ROOT, `rollback-last-checkout-blockers-${stamp}.json`);
  const rollback = { rowLinks: rowLinks.map((l) => ({ mongoId: l.mongoId, row: l.row, previous: "" })), productLinks: productLinks.map((l) => ({ mongoId: l.mongoId, previous: l.from })), createdVariants: [], addedOptions: [] };
  const save = () => fs.writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2));
  save();
  console.log(`rollback: ${rollbackPath}`);

  let ok = 0;
  const failed = [];
  const setRow = async (mongoId, row, to) => {
    const r = await col.updateOne(
      { _id: new mongoose.Types.ObjectId(mongoId), $or: [{ [`variants.${row}.shopifyVariantId`]: { $in: [null, ""] } }, { [`variants.${row}.shopifyVariantId`]: { $exists: false } }] },
      { $set: { [`variants.${row}.shopifyVariantId`]: to } },
    );
    return r.modifiedCount === 1;
  };
  for (const l of rowLinks) (await setRow(l.mongoId, l.row, l.to)) ? ok++ : failed.push(`link ${l.name} row ${l.row}`);

  for (const c of creates) {
    if (c.addOption) {
      const r = await shopifyAdminRequest(
        `mutation($productId:ID!,$options:[OptionCreateInput!]!){productOptionsCreate(productId:$productId,options:$options,variantStrategy:LEAVE_AS_IS){product{id options{name values}} userErrors{field message}}}`,
        { productId: c.productId, options: [{ name: c.addOption.name, values: c.addOption.values.map((name) => ({ name })) }] },
      );
      if (r.productOptionsCreate.userErrors?.length) { failed.push(`option ${c.name}: ${JSON.stringify(r.productOptionsCreate.userErrors)}`); continue; }
      rollback.addedOptions.push({ productId: c.productId, option: c.addOption.name });
      save();
    }
    const r = await shopifyAdminRequest(
      `mutation($productId:ID!,$variants:[ProductVariantsBulkInput!]!){productVariantsBulkCreate(productId:$productId,variants:$variants){productVariants{id title} userErrors{field message}}}`,
      { productId: c.productId, variants: [{ optionValues: c.optionValues, price: c.price.toFixed(2), inventoryItem: { sku: c.sku || undefined, tracked: false } }] },
    );
    const res = r.productVariantsBulkCreate;
    if (res.userErrors?.length) { failed.push(`create ${c.name} row ${c.row}: ${JSON.stringify(res.userErrors)}`); continue; }
    const vid = res.productVariants[0].id;
    rollback.createdVariants.push({ productId: c.productId, variantId: vid, mongoId: c.mongoId, row: c.row });
    save();
    (await setRow(c.mongoId, c.row, vid)) ? ok++ : failed.push(`link created ${c.name} row ${c.row}`);
  }

  for (const l of productLinks) {
    const r = await col.updateOne(
      { _id: new mongoose.Types.ObjectId(l.mongoId), shopifyVariantId: l.from },
      { $set: { shopifyVariantId: l.to } },
    );
    r.modifiedCount === 1 ? ok++ : failed.push(`product ${l.name}`);
    // Shopify charges the variant's price; make it the page's.
    if (!l.exact) {
      const sp = await shopifyAdminRequest(`query($id:ID!){productVariant(id:$id){product{id}}}`, { id: l.to });
      const u = await shopifyAdminRequest(
        `mutation($productId:ID!,$variants:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$productId,variants:$variants){userErrors{field message}}}`,
        { productId: sp.productVariant.product.id, variants: [{ id: l.to, price: Number(l.sitePrice).toFixed(2) }] },
      );
      if (u.productVariantsBulkUpdate.userErrors?.length) failed.push(`price ${l.name}`);
      else (rollback.prices = rollback.prices || []).push({ variantId: l.to, price: l.shopPrice });
      save();
    }
  }
  console.log(`applied: ${ok} changes · failed: ${failed.length}`);
  if (failed.length) console.log(failed.join("\n"));
  await conn.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
