/**
 * Turn a product's option arrays into real variants.
 *
 * `colorOptions`, `sizeOptions`, `finishes` and `flashings` are choices the PDP
 * offers and, for 109 products, charges for. None of them were variants, so
 * Shopify held one default variant at the base price: a customer picking
 * "White Polyurethane +£99" was charged as though they had not. Shopify's
 * checkout bills the variant, so a priced choice that is not a variant is a
 * choice that is given away.
 *
 * Rather than teach the sync about four parallel option systems, the axes are
 * written into `variants[]` — the one structure the product model, the cart,
 * the checkout and the Shopify sync already agree on. From there the existing
 * `syncVariantsToShopify` builds the Shopify options and one variant per
 * combination, and `attachVariantMedia` gives each its own image.
 *
 * Rules that keep this safe:
 *   - Products whose variants are already real are never touched.
 *   - A placeholder lone "Default Title" variant is replaced, not appended to.
 *   - An axis with a single value is not an axis; those products are skipped.
 *   - Optional extras (`flashings`) gain a "None" value, because Shopify
 *     requires every variant to carry a value on every axis and a customer must
 *     still be able to decline an upgrade.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/materialise-options-as-variants.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/materialise-options-as-variants.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/materialise-options-as-variants.cjs --rollback <file.json>
 *
 *   LIMIT=50   only the first N products
 */
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.env.LIMIT) || Infinity;
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

/**
 * Axis label per source array, and whether choosing one is compulsory.
 * An optional axis gets a "None" value so the customer can decline it.
 */
const AXES = [
  { field: "colorOptions", label: "Colour", optional: false },
  { field: "sizeOptions", label: "Size", optional: false },
  { field: "finishes", label: "Finish", optional: false },
  { field: "flashings", label: "Upgrade", optional: true },
];

const clean = (s) => String(s ?? "").trim();

/**
 * Is this string a real option value, or scraper debris?
 *
 * Several supplier imports captured whole `<script>` blocks into the option
 * arrays — one "finish" is sixty thousand characters of the supplier's delivery
 * date JavaScript. Shopify rejects the option outright ("Option value name is
 * too long"), so the variants never reach it, and the junk would sit in the
 * product's own variant list rendering on the PDP. A hundred characters is
 * generously above the longest genuine value in the catalogue.
 */
const MAX_OPTION_VALUE = 100;

function isUsableOptionValue(name) {
  if (!name || name.length > MAX_OPTION_VALUE) return false;
  if (name.includes("\n") || name.includes("\r") || name.includes("\t")) return false;
  // Markers of captured markup or script rather than a product choice.
  const lower = name.toLowerCase();
  const debris = ["function(", "function (", "document.", "window.", "<script", "</", "=>", '{"'];
  return !debris.some((marker) => lower.includes(marker));
}
const money = (v) => Math.round(Number(v || 0) * 100) / 100;

/** A lone "Default Title" row is Shopify's placeholder, not a real variant. */
function hasRealVariants(product) {
  const rows = product.variants || [];
  if (!rows.length) return false;
  if (rows.length === 1 && /^default title$/i.test(clean(rows[0].name))) return false;
  return true;
}

/**
 * Values for one axis, or null when the axis cannot be trusted.
 *
 * A single unusable value condemns the whole axis. Dropping just the bad one
 * would quietly sell a product missing a choice its own data offers, which is
 * worse than leaving the product as it was.
 */
function axisValues(product, axis) {
  const raw = Array.isArray(product[axis.field]) ? product[axis.field] : [];
  const values = [];
  const seen = new Set();

  for (const o of raw) {
    const name = clean(o?.name).replace(/\s+/g, " ");
    if (!isUsableOptionValue(name)) return null;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push({
      name,
      priceAdjustment: Number(o?.priceAdjustment) || 0,
      imageUrl: clean(o?.imageUrl),
      sku: clean(o?.sku),
    });
  }
  if (!values.length) return null;

  // An optional extra needs a way to say no. Only added when every value costs
  // something — a zero-priced entry already serves as the opt-out.
  if (axis.optional && values.every((v) => v.priceAdjustment > 0)) {
    values.unshift({ name: "None", priceAdjustment: 0, imageUrl: "", sku: "" });
  }
  return values;
}

function axesFor(product) {
  const out = [];
  for (const axis of AXES) {
    const values = axisValues(product, axis);
    if (!values || values.length < 2) continue;
    out.push({ label: axis.label, field: axis.field, values });
  }
  // Shopify allows three option axes; the catalogue never exceeds two, but the
  // guard keeps a future import from silently losing one.
  return out.slice(0, 3);
}

function buildVariants(product, axes) {
  const base = Number(product.price) || 0;
  const baseSku = clean(product.linxSku) || clean(product.productCode) || clean(product.specs?.sku);
  const stock = Number(product.stock) || 0;

  let combos = [[]];
  for (const axis of axes) {
    const next = [];
    for (const combo of combos) for (const value of axis.values) next.push([...combo, { axis, value }]);
    combos = next;
  }

  return combos.map((combo, index) => {
    const uplift = combo.reduce((n, c) => n + c.value.priceAdjustment, 0);
    const name = combo.map((c) => c.value.name).join(" / ");
    // The image of the most specific chosen value wins, so a colour swatch
    // beats a size icon when both carry one.
    const image = [...combo].reverse().find((c) => /^https?:\/\//i.test(c.value.imageUrl));
    const suffix = combo
      .map((c) => clean(c.value.sku) || c.value.name.replace(/[^a-zA-Z0-9]+/g, "").slice(0, 8).toUpperCase())
      .join("-");

    const variant = {
      name,
      sku: baseSku ? `${baseSku}-${suffix}` : suffix,
      price: money(base + uplift),
      stock,
      imageUrl: image ? image.value.imageUrl : "",
      available: true,
      isDefault: index === 0,
      position: index,
      shopifyVariantId: "",
      shopifyInventoryItemId: "",
      shopifyImageUrl: "",
      shopifyMediaId: "",
    };
    combo.forEach((c, i) => {
      variant[`option${i + 1}`] = c.value.name;
    });
    return variant;
  });
}

async function runRollback(db, file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let n = 0;
  for (const p of data.products || []) {
    await db.collection("products").updateOne(
      { _id: new mongoose.Types.ObjectId(p._id) },
      { $set: { variants: p.variants, shopifyOptions: p.shopifyOptions } },
    );
    n += 1;
  }
  console.log(`restored variants on ${n} product(s)`);
  console.log("Shopify still holds the generated variants — re-push those products to clear them");
}

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const col = db.collection("products");

  if (ROLLBACK) {
    await runRollback(db, ROLLBACK);
    await mongoose.disconnect();
    return;
  }

  // Projected deliberately. These documents carry the configurator image
  // arrays — tens of thousands of entries on a Pooky product — and pulling
  // them whole takes longer than the whole conversion.
  const candidates = await col
    .find({
      $or: AXES.map((a) => ({ [`${a.field}.0`]: { $exists: true } })),
    })
    .project({
      name: 1,
      price: 1,
      stock: 1,
      linxSku: 1,
      productCode: 1,
      "specs.sku": 1,
      variants: 1,
      shopifyOptions: 1,
      ...Object.fromEntries(AXES.map((a) => [a.field, 1])),
    })
    .toArray();

  const plan = [];
  let skippedReal = 0;
  let skippedSingle = 0;

  for (const p of candidates) {
    if (hasRealVariants(p)) { skippedReal += 1; continue; }
    const axes = axesFor(p);
    if (!axes.length) { skippedSingle += 1; continue; }
    const variants = buildVariants(p, axes);
    if (variants.length < 2) { skippedSingle += 1; continue; }
    plan.push({ product: p, axes, variants });
    if (plan.length >= LIMIT) break;
  }

  const totalVariants = plan.reduce((n, x) => n + x.variants.length, 0);
  const withImages = plan.reduce(
    (n, x) => n + x.variants.filter((v) => v.imageUrl).length,
    0,
  );
  const priced = plan.reduce(
    (n, x) => n + (x.variants.some((v) => v.price !== money(x.product.price)) ? 1 : 0),
    0,
  );

  console.log(`candidates with option arrays : ${candidates.length}`);
  console.log(`  already have real variants  : ${skippedReal} (untouched)`);
  console.log(`  no real choice to make      : ${skippedSingle} (untouched)`);
  console.log(`\nproducts to convert           : ${plan.length}`);
  console.log(`variants to create            : ${totalVariants}`);
  console.log(`  ...carrying their own image : ${withImages}`);
  console.log(`products whose price now varies by choice: ${priced}\n`);

  for (const { product, axes, variants } of plan.slice(0, 6)) {
    console.log(`  ${String(product.name).slice(0, 46)}  £${product.price}`);
    console.log(`     axes: ${axes.map((a) => `${a.label}(${a.values.length})`).join(" × ")} -> ${variants.length} variants`);
    for (const v of variants.slice(0, 3)) {
      console.log(`        ${String(v.name).slice(0, 34).padEnd(36)} £${v.price}${v.imageUrl ? "  [image]" : ""}`);
    }
    if (variants.length > 3) console.log(`        … ${variants.length - 3} more`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-materialise-options-${stamp}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        products: plan.map(({ product }) => ({
          _id: String(product._id),
          variants: product.variants ?? [],
          shopifyOptions: product.shopifyOptions ?? [],
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nrollback written up front: ${file}`);

  let done = 0;
  for (const { product, axes, variants } of plan) {
    await col.updateOne(
      { _id: product._id },
      {
        $set: {
          variants,
          // The axis names the sync reads when a variant carries option1..3.
          shopifyOptions: axes.map((a) => ({ name: a.label })),
        },
      },
    );
    done += 1;
    if (done % 250 === 0) console.log(`  ${done}/${plan.length}`);
  }

  console.log(
    `\nconverted ${done} product(s), ${totalVariants} variants written` +
      `\nrollback: ${file}` +
      `\n\nNow push them to Shopify:` +
      `\n  ONLY=materialised node --require ./scripts/mongo-dns.cjs scripts/sync-all-products-to-shopify.cjs\n`,
  );

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
