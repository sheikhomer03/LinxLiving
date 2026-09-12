/**
 * Put the Floors4Trade prices on the same VAT footing as the rest of the shop.
 *
 * Floors4Trade quote trade buyers ex-VAT — their PDP says "ex VAT" beside every
 * figure — and the import stored those numbers as published. This storefront
 * quotes inc-VAT, so the imported prices read 20% cheaper than they should and
 * a basket built from them undercharges.
 *
 * Every field derived from the pack price moves together:
 *
 *   price              the pack price the buy box and calculator read
 *   variants[].price   per-variant pack prices, where the variant carries one
 *   specs.pricePerM2   the per-m2 rate; `verifyConfiguredUnitPrice` compares a
 *                      configured line against it, so leaving it ex-VAT while
 *                      the pack price went inc-VAT makes checkout reject the
 *                      basket as tampered
 *
 * `rrpIncVat` is deliberately left alone: it holds the supplier's own "official
 * RRP per m²", a retail figure already quoted inc-VAT, and raising it would
 * invent a 20% higher RRP the manufacturer never published.
 *
 * Re-running is safe. Each product is stamped with `specs.vatUpliftPercent`,
 * and one already stamped is skipped rather than uplifted twice — the failure
 * mode this guards against is a silent 44% price rise.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/apply-vat-to-floors4trade-prices.cjs
 *
 *   DRY_RUN=1   report the changes without writing
 *   VAT=20      percentage to add (default 20)
 *   BRAND=...   another brand with the same problem
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const VAT = Number(process.env.VAT || 20);
const BRAND = String(process.env.BRAND || "Floors4Trade").trim();

const money = (n) => Math.round(n * 100) / 100;

async function main() {
  if (!(VAT > 0)) throw new Error("VAT must be a positive percentage");
  const factor = 1 + VAT / 100;

  const { db } = await connectMongo();
  const products = db.collection("products");
  const brand = await db.collection("brands").findOne({ name: BRAND });
  if (!brand) throw new Error(`Brand "${BRAND}" not found`);
  const brandIds = [brand._id, String(brand._id)];

  const docs = await products
    .find({ $or: [{ brand: { $in: brandIds } }, { brands: { $in: brandIds } }] })
    .project({ name: 1, price: 1, variants: 1, specs: 1, packCoverageM2: 1 })
    .toArray();

  const rollback = [];
  let changed = 0, already = 0, noPrice = 0, variantsTouched = 0;

  for (const d of docs) {
    if (Number(d.specs?.vatUpliftPercent) > 0) { already += 1; continue; }

    const hasPrice = Number(d.price) > 0;
    const priced = (d.variants || []).some((v) => Number(v?.price) > 0);
    if (!hasPrice && !priced) { noPrice += 1; continue; }

    const nextPrice = hasPrice ? money(Number(d.price) * factor) : Number(d.price) || 0;
    const nextVariants = (d.variants || []).map((v) => {
      const p = Number(v?.price) || 0;
      if (!(p > 0)) return v;
      variantsTouched += 1;
      return { ...v, price: money(p * factor) };
    });

    const set = { price: nextPrice, variants: nextVariants, updatedAt: new Date() };

    // Keep the per-m2 rate in step with the pack price it is derived from.
    const cov = Number(d.packCoverageM2 || d.specs?.sqmPerBox) || 0;
    const oldRate = Number(d.specs?.pricePerM2) || 0;
    let nextRate = oldRate;
    if (cov > 0 && nextPrice > 0) nextRate = money(nextPrice / cov);
    else if (oldRate > 0) nextRate = money(oldRate * factor);
    if (nextRate !== oldRate) set["specs.pricePerM2"] = nextRate;
    set["specs.vatUpliftPercent"] = VAT;
    set["specs.vatUpliftAt"] = new Date().toISOString();

    rollback.push({
      _id: String(d._id),
      name: d.name,
      from: { price: d.price ?? null, pricePerM2: oldRate || null, variantPrices: (d.variants || []).map((v) => v?.price ?? null) },
      to: { price: nextPrice, pricePerM2: nextRate || null, variantPrices: nextVariants.map((v) => v?.price ?? null) },
    });

    if (!DRY_RUN) await products.updateOne({ _id: d._id }, { $set: set });
    changed += 1;
    if (changed <= 5) {
      console.log(
        `  ${d.name.slice(0, 46).padEnd(48)} £${d.price} -> £${nextPrice}` +
          (cov > 0 ? `   (£${oldRate}/m² -> £${nextRate}/m²)` : ""),
      );
    }
  }

  if (rollback.length && !DRY_RUN) {
    const file = path.join(
      __dirname,
      "..",
      `rollback-floors4trade-vat-${VAT}pc-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
    console.log(`\nRollback written: ${path.basename(file)}`);
  }

  console.log(
    `\n${DRY_RUN ? "[dry] " : ""}+${VAT}%  uplifted ${changed} product(s), ` +
      `${variantsTouched} priced variant(s); skipped ${noPrice} with no price, ${already} already uplifted`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
