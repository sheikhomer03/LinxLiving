/**
 * Add a "was price" discount to every product that doesn't already have one,
 * without ever changing the price the customer actually pays.
 *
 * How the storefront reads a discount (see ProductCard.tsx / ProductSection.tsx
 * / CategoryTemplate.tsx): when specs.compareAtPrice (or specs.shopifyCompareAt,
 * which wins if present) is greater than `price`, the card shows a "Was £X"
 * strike-through and a sale badge — but the price the customer is charged is
 * always the product's own `price` field, untouched. specs.salePercent only
 * drives the badge text. So the exact same mechanism already used by the 33
 * products that were manually discounted earlier (specs.salePriceMode:
 * "raise-was-keep-price") is reused here: `price` is never written to, only
 * a backward-calculated "was" price + specs.salePercent are added.
 *
 * A product counts as "already discounted" (and is left completely alone) if
 * ANY of these are true:
 *   - specs.salePercent > 0
 *   - specs.compareAtPrice > price
 *   - specs.shopifyCompareAt > price   (Shopify-synced compare-at; this field
 *     wins over compareAtPrice on the storefront). Note this only counts when
 *     it is currently GREATER than price — some products carry a stale
 *     shopifyCompareAt left over from an earlier price change that is now
 *     *below* price, which shows no discount at all today, so those are
 *     still eligible below.
 *   - specs.priceExVat > 0 AND (specs.promotionalPrice or specs.promotionPrice) > 0
 *     and less than priceExVat (the homepage "range bands" promo path)
 *
 * Only products with a positive `price` are eligible. Because
 * specs.shopifyCompareAt wins over specs.compareAtPrice on the storefront,
 * a product that already has *any* shopifyCompareAt value (even a stale,
 * dormant one) gets its new "was" price written into that same field —
 * writing compareAtPrice instead would be silently ignored. Rollback
 * restores the original shopifyCompareAt value for those rows (it existed
 * before this script touched it) rather than deleting the field.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/apply-safe-discounts.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/apply-safe-discounts.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/apply-safe-discounts.cjs --rollback <file>
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const APPLY = process.argv.includes("--apply");
const ROLLBACK_IDX = process.argv.indexOf("--rollback");
const ROLLBACK_FILE = ROLLBACK_IDX > -1 ? process.argv[ROLLBACK_IDX + 1] : null;

const BATCH_SIZE = 500;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Few at 15%, mostly split evenly between 20% and 30%. */
function pickDiscountPercent() {
  const r = Math.random();
  if (r < 0.15) return 15;
  if (r < 0.575) return 20;
  return 30;
}

const ACTIVE_COMPARE_AT = (field) => ({
  $expr: {
    $gt: [
      { $toDouble: { $ifNull: [`$${field}`, 0] } },
      { $toDouble: { $ifNull: ["$price", 0] } },
    ],
  },
});

const HAS_DISCOUNT_FILTER = {
  $or: [
    { "specs.salePercent": { $gt: 0 } },
    { $and: [{ "specs.compareAtPrice": { $gt: 0 } }, ACTIVE_COMPARE_AT("specs.compareAtPrice")] },
    { $and: [{ "specs.shopifyCompareAt": { $gt: 0 } }, ACTIVE_COMPARE_AT("specs.shopifyCompareAt")] },
    {
      $and: [
        { "specs.priceExVat": { $gt: 0 } },
        {
          $or: [
            { "specs.promotionalPrice": { $gt: 0 } },
            { "specs.promotionPrice": { $gt: 0 } },
          ],
        },
      ],
    },
  ],
};

const ADDED_ONLY_SPEC_KEYS = [
  "salePercent",
  "salePriceMode",
  "saleOriginalPrice",
  "saleAppliedAt",
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Products = mongoose.connection.collection("products");

  if (ROLLBACK_FILE) {
    const rows = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
    let n = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const ops = chunk.map((r) => {
        const unset = {};
        for (const key of ADDED_ONLY_SPEC_KEYS) unset[`specs.${key}`] = "";
        if (r.field === "shopifyCompareAt") {
          // Pre-existing field we overwrote — restore its prior value
          // instead of deleting it.
          if (r.previousValue == null) {
            unset["specs.shopifyCompareAt"] = "";
            return {
              updateOne: {
                filter: { _id: new mongoose.Types.ObjectId(r._id) },
                update: { $unset: unset },
              },
            };
          }
          return {
            updateOne: {
              filter: { _id: new mongoose.Types.ObjectId(r._id) },
              update: {
                $set: { "specs.shopifyCompareAt": r.previousValue },
                $unset: unset,
              },
            },
          };
        }
        // Brand new compareAtPrice field — never existed before.
        unset["specs.compareAtPrice"] = "";
        return {
          updateOne: {
            filter: { _id: new mongoose.Types.ObjectId(r._id) },
            update: { $unset: unset },
          },
        };
      });
      await Products.bulkWrite(ops);
      n += chunk.length;
    }
    console.log(`Rolled back discount fields on ${n} products.`);
    await mongoose.disconnect();
    return;
  }

  const filter = {
    $and: [{ $nor: [HAS_DISCOUNT_FILTER] }, { price: { $gt: 0 } }],
  };

  const targets = await Products.find(filter)
    .project({ _id: 1, price: 1, "specs.shopifyCompareAt": 1 })
    .toArray();

  const alreadyDiscounted = await Products.countDocuments(HAS_DISCOUNT_FILTER);

  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");
  console.log(`already discounted (left untouched): ${alreadyDiscounted}`);
  console.log(`eligible for a new discount (priced, no active discount): ${targets.length}`);

  const skipped = [];
  const plan = [];
  for (const p of targets) {
    const price = round2(p.price);
    const discountPercent = pickDiscountPercent();
    const originalPrice = round2(price / (1 - discountPercent / 100));

    // Guard: rounding must never make the "was" price collide with or drop
    // below the real price — if it does, this product is skipped rather than
    // writing a broken compare-at (the actual charged price is unaffected
    // either way since we never touch `price`).
    if (!(originalPrice > price)) {
      skipped.push({ id: String(p._id), price });
      continue;
    }

    const hasDormantShopifyCompareAt = p.specs?.shopifyCompareAt != null;
    plan.push({
      id: String(p._id),
      price,
      discountPercent,
      originalPrice,
      field: hasDormantShopifyCompareAt ? "shopifyCompareAt" : "compareAtPrice",
      previousValue: hasDormantShopifyCompareAt ? p.specs.shopifyCompareAt : null,
    });
  }

  const byField = {
    compareAtPrice: plan.filter((r) => r.field === "compareAtPrice").length,
    shopifyCompareAt: plan.filter((r) => r.field === "shopifyCompareAt").length,
  };
  console.log(
    `  planned: ${plan.length} (new compareAtPrice: ${byField.compareAtPrice}, ` +
      `overwriting dormant shopifyCompareAt: ${byField.shopifyCompareAt}), ` +
      `skipped (rounding guard): ${skipped.length}`,
  );
  console.log("Sample:", plan.slice(0, 5));

  if (!APPLY) {
    console.log("\nRe-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  if (plan.length === 0) {
    console.log("Nothing to update.");
    await mongoose.disconnect();
    return;
  }

  const backup = plan.map((row) => ({
    _id: row.id,
    field: row.field,
    previousValue: row.previousValue,
  }));
  const file = path.join(
    process.cwd(),
    `rollback-safe-discounts-${backup.length}-${Date.now()}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nRollback file: ${path.basename(file)}`);

  const appliedAt = new Date().toISOString();
  let updated = 0;
  for (let i = 0; i < plan.length; i += BATCH_SIZE) {
    const chunk = plan.slice(i, i + BATCH_SIZE);
    const ops = chunk.map((row) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(row.id) },
        update: {
          $set: {
            "specs.salePercent": row.discountPercent,
            [`specs.${row.field}`]: row.originalPrice,
            "specs.salePriceMode": "raise-was-keep-price",
            "specs.saleOriginalPrice": row.price,
            "specs.saleAppliedAt": appliedAt,
            updatedAt: new Date(),
          },
        },
      },
    }));
    const res = await Products.bulkWrite(ops);
    updated += res.modifiedCount;
    console.log(`  ${Math.min(i + BATCH_SIZE, plan.length)}/${plan.length}`);
  }

  console.log(`\nProducts updated: ${updated}`);
  console.log(
    `To undo: node --require ./scripts/mongo-dns.cjs scripts/apply-safe-discounts.cjs --rollback ${path.basename(file)}`,
  );

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
