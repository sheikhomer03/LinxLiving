/**
 * Oscar pergolas — main category + the Standard Size Price List 2026.
 *
 * The price list is a 4 x 4 x 3 grid: four profile types, each in four sizes,
 * each with three roof configurations. That is 48 priced rows, but only four
 * products: a Type-150 in 3x3 and a Type-150 in 6x4 are the same pergola, so
 * size and roof are option axes and the price hangs off the variant.
 *
 * Axes use the option1/option2 columns the schema already carries, so nothing
 * was added to the schema — `shopifyOptions` declares the axes and each
 * variant names its values. option3 is left free for a future axis (height is
 * 2.7m on every row today, so it is a spec, not an axis).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-oscar-pergolas.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/import-oscar-pergolas.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/import-oscar-pergolas.cjs --rollback <file.json>
 *
 * PRICES ARE THE PDF'S FIGURES, UNCONVERTED. The price list prints "$" and
 * comes from the Foshan factory; the storefront renders GBP. Confirm the
 * currency and the retail markup before these go live.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

const BRAND_SLUG = "oscar-pergola";
const CATEGORY_SLUG = "pergola";
const CATEGORY_NAME = "Pergola";
const DEPARTMENT = "outdoor-living";
const IMG = "/oscar/pages";

/** Size axis. Motor and post counts are fixed by size on every row. */
const SIZES = [
  { label: "3×3 m", key: "3X3", motors: 1, posts: 4 },
  { label: "4×3 m", key: "4X3", motors: 1, posts: 4 },
  { label: "6×3 m", key: "6X3", motors: 2, posts: 6 },
  { label: "6×4 m", key: "6X4", motors: 2, posts: 6 },
];

/** Roof axis — the three priced columns of the price list. */
const ROOFS = [
  { label: "Manual (no LED)", key: "MAN" },
  { label: "Electric with LED", key: "ELED" },
  { label: "Electric with LED + 4-side blinds", key: "EBLIND" },
];

/**
 * Profile specs are the catalogue's, which is the higher-resolution source.
 * Where the price list disagrees it is noted — see Type-150's beam.
 */
const TYPES = [
  {
    code: "150",
    name: "Oscar Louvered Pergola — Type 150",
    maxSpan: "3.5 m",
    post: "100×100 mm / 2.0 mm",
    beam: "150×150 mm / 1.6 mm",
    blade: "150×32 mm / 1.25 mm",
    profileImage: "catalog-02.jpg",
    // price list row order: manual, electric+LED, electric+LED+blinds
    prices: {
      "3X3": [926, 1032, 2000],
      "4X3": [1228, 1334, 2456],
      "6X3": [1850, 2062, 3516],
      "6X4": [2456, 2668, 4274],
    },
  },
  {
    code: "175",
    name: "Oscar Louvered Pergola — Type 175",
    maxSpan: "4 m",
    post: "135×135 mm / 2.0 mm",
    beam: "180×150 mm / 1.7 mm",
    blade: "175×40 mm / 1.5 mm",
    profileImage: "catalog-02.jpg",
    prices: {
      "3X3": [1198, 1244, 2214],
      "4X3": [1500, 1546, 2668],
      "6X3": [2394, 2486, 3940],
      "6X4": [3000, 3092, 4698],
    },
  },
  {
    code: "200",
    name: "Oscar Louvered Pergola — Type 200 (Heavy Duty)",
    maxSpan: "4 m",
    post: "150×150 mm / 2.0 mm",
    beam: "200×150 mm / 2.4 mm",
    blade: "200×40 mm / 1.6 mm",
    profileImage: "catalog-03.jpg",
    prices: {
      "3X3": [1516, 1562, 2532],
      "4X3": [1970, 2016, 3138],
      "6X3": [3032, 3122, 4576],
      "6X4": [3940, 4032, 5638],
    },
  },
  {
    code: "220",
    name: "Oscar Louvered Pergola — Type 220 (Heavy Duty)",
    maxSpan: "5 m",
    post: "150×150 mm / 3.0 mm",
    beam: "230×150 mm / 2.5 mm",
    blade: "220×53 mm / 1.8 mm",
    profileImage: "catalog-04.jpg",
    prices: {
      "3X3": [1668, 1714, 2682],
      "4X3": [2122, 2168, 3288],
      "6X3": [3334, 3426, 4880],
      "6X4": [4244, 4334, 5940],
    },
  },
];

function buildProduct(type, brandId) {
  const variants = [];
  let position = 0;
  for (const size of SIZES) {
    for (let r = 0; r < ROOFS.length; r++) {
      const roof = ROOFS[r];
      position++;
      variants.push({
        name: `${size.label} / ${roof.label}`,
        sku: `OSC-${type.code}-${size.key}-${roof.key}`,
        option1: size.label,
        option2: roof.label,
        option3: "",
        price: type.prices[size.key][r],
        stock: 25,
        available: true,
        position,
        isDefault: position === 1,
      });
    }
  }

  const cheapest = Math.min(...variants.map((v) => v.price));

  // The supplier's sheet kept whole — one row per size, priced across the
  // three roof columns. Rendered as the spec table on the detail page.
  const pergolaSizeRows = SIZES.map((size) => ({
    size: size.label.replace(" m", ""),
    motorSet: `${size.motors} motor${size.motors === 1 ? "" : "s"}`,
    postPcs: size.posts,
    heightM: 2.7,
    manualNoLedPrice: type.prices[size.key][0],
    electricLedPrice: type.prices[size.key][1],
    electricLedBlindsPrice: type.prices[size.key][2],
  }));

  return {
    name: type.name,
    description:
      `Bioclimatic aluminium louvered pergola with a motorised roof. The blades ` +
      `rotate through 0°–90° to control sun and ventilation, and close to a ` +
      `sealed roof that channels rainwater through the beam gutter and down ` +
      `inside the posts. Built in 6063-T5 aluminium with a maximum blade span ` +
      `of ${type.maxSpan}. Post ${type.post}; beam ${type.beam}; blade ` +
      `${type.blade}. Standard height 2.7 m. Choose your size and roof ` +
      `configuration — manual, electric with LED, or electric with LED and ` +
      `windproof roller blinds to all four sides.`,
    shortDescription: `Motorised aluminium louvered pergola, ${type.maxSpan} maximum blade span.`,
    price: cheapest,
    stock: 25,
    images: [
      `${IMG}/catalog-10.jpg`,
      `${IMG}/${type.profileImage}`,
      `${IMG}/catalog-06.jpg`,
      `${IMG}/catalog-07.jpg`,
      `${IMG}/pricelist-02.jpg`,
    ],
    // Post / beam / blade profile drawing for this type, shown beside the
    // specification on the detail page.
    schematicImage: `${IMG}/${type.profileImage}`,
    brand: brandId,
    department: DEPARTMENT,
    category: CATEGORY_SLUG,
    categories: [CATEGORY_SLUG],
    subCategory: "",
    subCategories: [],
    sourceHandle: `oscar-louvered-pergola-type-${type.code}`,
    specs: {
      Type: `Type-${type.code}`,
      "Maximum blade span": type.maxSpan,
      "Post profile": type.post,
      "Beam profile": type.beam,
      "Blade profile": type.blade,
      "Standard height": "2.7 m",
      Material: "Aluminium 6063-T5",
      "Blade rotation": "0°–90°",
      "Motor (3×3, 4×3)": "1 motor · 4 posts",
      "Motor (6×3, 6×4)": "2 motors · 6 posts",
      "Finishes available":
        "RAL 9005 Jet Black · RAL 8017 Dark Brown · RAL 7016 Anthracite Grey · RAL 9016 Traffic White",
      Source: "Oscar Standard Size Price List 2026",
    },
    showSpecs: true,
    pergolaSizeRows,
    shopifyOptions: [
      { name: "Size", position: 1, values: SIZES.map((s) => s.label) },
      { name: "Roof", position: 2, values: ROOFS.map((r) => r.label) },
    ],
    variants,
  };
}

async function main() {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const products = db.collection("products");
  const menus = db.collection("menus");

  if (ROLLBACK) {
    const plan = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    for (const id of plan.insertedProductIds || []) {
      await products.deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    }
    if (plan.insertedMenuId) {
      await menus.deleteOne({ _id: new mongoose.Types.ObjectId(plan.insertedMenuId) });
    }
    console.log(
      `Rolled back ${(plan.insertedProductIds || []).length} product(s)` +
        (plan.insertedMenuId ? " and the Pergola menu" : ""),
    );
    await mongoose.disconnect();
    return;
  }

  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error(`Brand "${BRAND_SLUG}" not found — create it first`);

  const rollback = { insertedProductIds: [], insertedMenuId: null };

  // ---- main category -------------------------------------------------
  let menu = await menus.findOne({ slug: CATEGORY_SLUG, brand: brand._id });
  if (menu) {
    console.log(`menu   EXISTS  ${CATEGORY_SLUG} (${menu._id})`);
  } else if (APPLY) {
    const maxOrder = await menus
      .find({ parent: null }, { projection: { order: 1 } })
      .sort({ order: -1 })
      .limit(1)
      .toArray();
    const res = await menus.insertOne({
      name: CATEGORY_NAME,
      slug: CATEGORY_SLUG,
      parent: null,
      order: (maxOrder[0]?.order || 0) + 1,
      group: "",
      url: "",
      isActive: true,
      image: "",
      brand: brand._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    rollback.insertedMenuId = String(res.insertedId);
    console.log(`menu   CREATE  ${CATEGORY_SLUG} (${res.insertedId})`);
  } else {
    console.log(`menu   WOULD CREATE  ${CATEGORY_SLUG} "${CATEGORY_NAME}"`);
  }

  // ---- products ------------------------------------------------------
  let created = 0;
  let updated = 0;
  for (const type of TYPES) {
    const doc = buildProduct(type, brand._id);
    const existing = await products.findOne({ sourceHandle: doc.sourceHandle });

    if (existing) {
      if (APPLY) {
        await products.updateOne(
          { _id: existing._id },
          { $set: { ...doc, updatedAt: new Date() } },
        );
      }
      updated++;
      console.log(
        `${APPLY ? "UPDATE" : "WOULD UPDATE"}  ${doc.name}  ` +
          `${doc.variants.length} variants  from £${doc.price}`,
      );
    } else {
      if (APPLY) {
        const res = await products.insertOne({
          ...doc,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        rollback.insertedProductIds.push(String(res.insertedId));
      }
      created++;
      console.log(
        `${APPLY ? "CREATE" : "WOULD CREATE"}  ${doc.name}  ` +
          `${doc.variants.length} variants  from £${doc.price}`,
      );
    }
  }

  const totalVariants = TYPES.length * SIZES.length * ROOFS.length;
  console.log(
    `\n${APPLY ? "Applied" : "Dry run"}: ${created} created, ${updated} updated, ` +
      `${totalVariants} priced variants across ${TYPES.length} products.`,
  );

  if (APPLY && (rollback.insertedProductIds.length || rollback.insertedMenuId)) {
    const file = path.join(
      __dirname,
      "..",
      `rollback-oscar-pergolas-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
    console.log(`Rollback written to ${path.basename(file)}`);
  }
  if (!APPLY) console.log("Re-run with --apply to write.");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
