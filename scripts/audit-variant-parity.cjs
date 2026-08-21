/**
 * Does every Mongo variant exist as its own Shopify variant?
 *
 * A GID stored on a variant row is not proof of one. Two failures hide behind a
 * full-looking column:
 *
 *   shared      several Mongo variants carrying the *same* GID, which is what
 *               happens when the option sync bailed out and every row fell back
 *               to the product's default variant. Checkout then charges one
 *               price for every size.
 *   priced-opt  choices that are not variants at all — `finishes`, `flashings`,
 *               `sizeOptions` and friends carry a `priceAdjustment`, the PDP
 *               adds it to the total, and Shopify knows nothing about it, so
 *               the customer is charged the base price and gets the extra free.
 *
 * Every multi-variant product is checked, not a sample.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-variant-parity.cjs
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const OPTION_FIELDS = [
  "finishes",
  "flashings",
  "sizeOptions",
  "colorOptions",
  "typeOptions",
  "nestedOptions",
  "optionElements",
];

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const col = db.collection("products");

  // ------------------------------------------------- shared / missing GIDs
  const multi = await col
    .find({ "variants.1": { $exists: true }, shopifyProductId: { $nin: [null, ""] } })
    .project({ name: 1, shopifyProductId: 1, shopifyVariantId: 1, variants: 1 })
    .toArray();

  console.log(`multi-variant products linked to Shopify: ${multi.length}`);
  console.log("checking each against its Shopify variants…\n");

  const shared = [];
  const short = [];
  const missing = [];
  let mongoVariants = 0;
  let matchedDistinct = 0;

  for (let i = 0; i < multi.length; i += 20) {
    const chunk = multi.slice(i, i + 20);
    const d = await shopifyAdminRequest(
      `query($ids: [ID!]!) {
        nodes(ids: $ids) {
          id
          ... on Product { title variants(first: 250) { nodes { id title price } } }
        }
      }`,
      { ids: chunk.map((c) => c.shopifyProductId) },
    );
    const live = new Map((d.nodes || []).filter(Boolean).map((n) => [n.id, n]));

    for (const p of chunk) {
      const sp = live.get(p.shopifyProductId);
      if (!sp) continue;
      const rows = p.variants || [];
      mongoVariants += rows.length;

      const gids = rows.map((v) => String(v.shopifyVariantId || ""));
      const withGid = gids.filter(Boolean);
      const distinct = new Set(withGid);
      matchedDistinct += distinct.size;

      if (withGid.length < rows.length) {
        missing.push({ name: p.name, rows: rows.length, withGid: withGid.length });
      }
      if (distinct.size < withGid.length) {
        shared.push({
          name: p.name,
          rows: rows.length,
          distinct: distinct.size,
          shopifyVariants: sp.variants.nodes.length,
          _id: String(p._id),
        });
      }
      if (sp.variants.nodes.length < rows.length) {
        short.push({
          name: p.name,
          mongo: rows.length,
          shopify: sp.variants.nodes.length,
          _id: String(p._id),
        });
      }
    }
    process.stdout.write(`\r  ${Math.min(i + 20, multi.length)}/${multi.length}      `);
  }
  console.log("");

  console.log(`\nMongo variants on those products : ${mongoVariants}`);
  console.log(`distinct Shopify GIDs referenced : ${matchedDistinct}`);
  console.log(`products with a variant lacking a GID : ${missing.length}`);
  console.log(`products where GIDs are SHARED        : ${shared.length}`);
  console.log(`products with fewer variants on Shopify: ${short.length}`);

  for (const s of short.slice(0, 12)) {
    console.log(`   ${String(s.name).slice(0, 46).padEnd(48)} mongo ${s.mongo} vs shopify ${s.shopify}`);
  }

  // -------------------------------------------------- priced non-variant options
  console.log("\n=== PRICED OPTIONS THAT ARE NOT SHOPIFY VARIANTS ===");
  const priced = await col
    .aggregate(
      [
        {
          $project: {
            name: 1,
            price: 1,
            nVar: { $size: { $ifNull: ["$variants", []] } },
            opts: {
              $filter: {
                input: {
                  $concatArrays: OPTION_FIELDS.map((f) => ({ $ifNull: [`$${f}`, []] })),
                },
                cond: { $gt: [{ $ifNull: ["$$this.priceAdjustment", 0] }, 0] },
              },
            },
          },
        },
        { $match: { "opts.0": { $exists: true } } },
        { $project: { name: 1, price: 1, nVar: 1, n: { $size: "$opts" }, opts: 1 } },
        { $sort: { n: -1 } },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  const entries = priced.reduce((n, p) => n + p.n, 0);
  console.log(`products offering a paid option: ${priced.length}`);
  console.log(`paid option entries in total   : ${entries}`);
  console.log(`  ...of those products, with no Shopify variants: ${priced.filter((p) => p.nVar === 0).length}`);
  for (const p of priced.slice(0, 8)) {
    const sample = p.opts
      .slice(0, 2)
      .map((o) => `${String(o.name).slice(0, 26)} +£${o.priceAdjustment}`)
      .join(", ");
    console.log(`   ${String(p.name).slice(0, 40).padEnd(42)} £${p.price}  ${p.n} paid opts  ${sample}`);
  }

  const out = path.join(process.cwd(), "priced-options-not-in-shopify.json");
  fs.writeFileSync(
    out,
    JSON.stringify(
      priced.map((p) => ({
        _id: String(p._id),
        name: p.name,
        basePrice: p.price,
        variants: p.nVar,
        paidOptions: p.opts.map((o) => ({ name: o.name, priceAdjustment: o.priceAdjustment })),
      })),
      null,
      2,
    ),
  );
  console.log(`\nfull list -> ${out}`);

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
