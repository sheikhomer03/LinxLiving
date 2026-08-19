/**
 * Push the Awning reorganisation to Shopify.
 *
 * Two things changed in Mongo that Shopify mirrors, and neither updates itself:
 *
 *   collections  each menu is a `menu-<slug>` collection carrying its parent
 *                slug as a metafield, so the four demoted ranges now describe
 *                the wrong parent, and the new main has no collection at all.
 *   products     a product's category becomes its Shopify product type and one
 *                of its tags, so all eight still read as the old categories.
 *
 * Runs the same application code the admin uses, so the result matches what a
 * push from the UI would produce.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-awning-to-shopify.cjs
 *   DRY=1  report what would be sent, call nothing
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const DRY = process.env.DRY === "1";
const BRAND = "AlunoTec";
const MAIN_SLUG = "awning";

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();

  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { pushMenuAsCollection } = require("../src/lib/shopify/sync-collection.ts");
  const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
  const { shopifyAdminHealthcheck } = require("../src/lib/shopify/admin.ts");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const health = await shopifyAdminHealthcheck();
  if (!health.ok) throw new Error(`Shopify unreachable: ${health.error}`);
  console.log(`shop: ${health.shop}\n`);

  const brand = await db
    .collection("brands")
    .findOne({ name: new RegExp(`^${BRAND}$`, "i") });
  if (!brand) throw new Error(`Brand "${BRAND}" not found`);

  const mainMenu = await db.collection("menus").findOne({ slug: MAIN_SLUG });
  if (!mainMenu) throw new Error(`Menu "${MAIN_SLUG}" not found — run create-awning-category.cjs first`);

  const children = await db
    .collection("menus")
    .find({ parent: mainMenu._id })
    .sort({ order: 1 })
    .toArray();

  const products = await db
    .collection("products")
    .find({ $or: [{ brand: brand._id }, { brands: brand._id }] })
    .toArray();

  // A menu collection lists the products that sit in it, so the main gets all
  // eight and each subcategory gets the ones naming it.
  //
  // These are Mongo ids: `pushMenuAsCollection` resolves them to Shopify GIDs
  // itself, and handing it GIDs makes it try to look them up as `_id`.
  const memberIdsFor = (slug) =>
    products
      .filter(
        (p) =>
          p.subCategory === slug ||
          (Array.isArray(p.subCategories) && p.subCategories.includes(slug)),
      )
      .map((p) => String(p._id));

  const allIds = products.map((p) => String(p._id));

  console.log(`collections to push: ${children.length + 1}`);
  console.log(`   ${MAIN_SLUG.padEnd(22)} (main)        ${allIds.length} products`);
  for (const c of children) {
    console.log(`   ${c.slug.padEnd(22)} parent ${MAIN_SLUG}  ${memberIdsFor(c.slug).length} products`);
  }
  console.log(`\nproducts to re-push: ${products.length}`);

  if (DRY) {
    console.log("\nDRY=1 — nothing sent");
    await mongoose.disconnect();
    unregister();
    return;
  }

  const stamp = (id) =>
    db.collection("menus").updateOne(
      { _id: id },
      { $set: { shopifySyncedAt: new Date() } },
    );

  // Main first: a child's `parent_slug` metafield is only meaningful once the
  // collection it names exists.
  const mainResult = await pushMenuAsCollection({
    name: mainMenu.name,
    slug: mainMenu.slug,
    image: mainMenu.image || undefined,
    brandSlug: brand.slug || null,
    parentSlug: null,
    order: mainMenu.order ?? 0,
    shopifyCollectionId: mainMenu.shopifyCollectionId,
    productIds: allIds,
  });
  if (mainResult) {
    await db
      .collection("menus")
      .updateOne(
        { _id: mainMenu._id },
        { $set: { shopifyCollectionId: mainResult, shopifySyncedAt: new Date() } },
      );
  }
  console.log(`\nmain collection  -> ${mainResult || "(no id returned)"}`);

  for (const c of children) {
    const res = await pushMenuAsCollection({
      name: c.name,
      slug: c.slug,
      image: c.image || undefined,
      brandSlug: brand.slug || null,
      parentSlug: mainMenu.slug,
      order: c.order ?? 0,
      shopifyCollectionId: c.shopifyCollectionId,
      productIds: memberIdsFor(c.slug),
    });
    if (res) {
      await db
        .collection("menus")
        .updateOne(
          { _id: c._id },
          { $set: { shopifyCollectionId: res, shopifySyncedAt: new Date() } },
        );
    } else {
      await stamp(c._id);
    }
    console.log(`  ${c.slug.padEnd(22)} -> ${res || "(unchanged)"}`);
  }

  console.log("\nre-pushing products (category drives Shopify product type + tags)");
  let ok = 0;
  for (const p of products) {
    try {
      await syncFullProductToShopify(p, brand.name);
      await db.collection("products").updateOne(
        { _id: p._id },
        {
          $set: {
            shopifyProductId: p.shopifyProductId,
            shopifyVariantId: p.shopifyVariantId,
            shopifyImages: p.shopifyImages || [],
            shopifyHandle: p.shopifyHandle || "",
            shopifyProductUrl: p.shopifyProductUrl || "",
            shopifySyncError: null,
            shopifySyncedAt: new Date(),
          },
        },
        { timestamps: false },
      );
      ok += 1;
      console.log(`  ok  ${String(p.name).slice(0, 50)}`);
    } catch (error) {
      console.error(`  ✗  ${String(p.name).slice(0, 50)} — ${error.message.slice(0, 100)}`);
    }
  }
  console.log(`\n${ok}/${products.length} products re-pushed`);

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
