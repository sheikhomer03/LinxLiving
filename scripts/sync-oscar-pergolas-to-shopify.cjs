/**
 * Push the Oscar pergolas to Shopify as DRAFT products.
 *
 * Runs the same application code the admin action does — ensureShopifyProductLinked
 * then syncVariantsToShopify — so what is proven here is what production runs.
 *
 * Draft is deliberate. These carry the price list's figures unconverted, so the
 * range is built in Shopify (options, 12 variants each, images) but cannot be
 * bought until someone settles the pricing and publishes it.
 *
 *   npx tsx --require ./scripts/mongo-dns.cjs scripts/sync-oscar-pergolas-to-shopify.cjs
 *   DRY=1   list what would be sent, call nothing
 *   STATUS=ACTIVE   publish live instead of draft
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const DRY = process.env.DRY === "1";
const STATUS = process.env.STATUS === "ACTIVE" ? "ACTIVE" : "DRAFT";
const BRAND_SLUG = "oscar-pergola";

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { Product } = require("../src/models/Product.ts");
  const { Brand } = require("../src/models/Brand.ts");
  const {
    syncVariantsToShopify,
    deriveOptionAxes,
  } = require("../src/lib/shopify/sync-variants.ts");
  const {
    ensureShopifyProductLinked,
    updateShopifyProduct,
  } = require("../src/lib/shopify/sync-product.ts");

  await connectMongo(process.env.MONGODB_URI);

  const brand = await Brand.findOne({ slug: BRAND_SLUG }).lean();
  if (!brand) throw new Error(`Brand "${BRAND_SLUG}" not found`);

  const products = await Product.find({ brand: brand._id }).sort({ price: 1 });
  console.log(`${products.length} product(s) for ${brand.name} — status ${STATUS}\n`);

  for (const product of products) {
    const axisNames = (product.shopifyOptions || [])
      .map((a) => String(a?.name || "").trim())
      .filter(Boolean);

    const payload = (product.variants || []).map((row, index) => {
      const options = [];
      [row.option1, row.option2, row.option3].forEach((value, i) => {
        if (value && String(value).trim())
          options.push({
            name: axisNames[i] || `Option ${i + 1}`,
            value: String(value),
          });
      });
      return {
        key: String(row._id ?? index),
        name: String(row.name || `Variant ${index + 1}`),
        sku: row.sku || null,
        barcode: row.barcode || null,
        price: Number(row.price ?? product.price) || 0,
        compareAtPrice: row.compareAtPrice ?? null,
        stock: Number(row.stock ?? product.stock) || 0,
        options,
      };
    });

    console.log(`■ ${product.name}`);
    console.log(`   axes: ${JSON.stringify(deriveOptionAxes(payload))}`);
    console.log(`   ${payload.length} variants  £${Math.min(...payload.map((v) => v.price))}–£${Math.max(...payload.map((v) => v.price))}`);

    if (DRY) {
      console.log("   DRY=1 — nothing sent\n");
      continue;
    }

    const payloadForProduct = {
      name: product.name,
      description: product.description,
      price: product.price,
      stock: product.stock,
      category: product.category,
      subCategory: product.subCategory,
      brandName: brand.name,
      images: product.images ?? [],
      tagline: product.tagline,
      specs: product.specs ?? {},
      showSpecs: product.showSpecs,
      schematicImage: product.schematicImage,
      // Held off sale until the pricing is confirmed.
      shopifyStatus: STATUS,
      shopifyProductId: product.shopifyProductId,
      shopifyVariantId: product.shopifyVariantId,
    };

    // Links the product (creates it the first time). It deliberately returns
    // early when the link already holds, so it does not push content — the
    // update below is what carries images, copy and status across.
    const ids = await ensureShopifyProductLinked(payloadForProduct);
    console.log(`   product → ${ids.productId}`);

    await updateShopifyProduct({
      ...payloadForProduct,
      shopifyProductId: ids.productId,
      shopifyVariantId: ids.variantId,
    });
    console.log(`   content pushed (${(product.images || []).length} images)`);

    const result = await syncVariantsToShopify(ids.productId, payload);
    console.log(
      `   variants → created ${result.created}, updated ${result.updated}, orphaned ${result.orphaned.length}`,
    );
    for (const w of result.warnings) console.log("   warning:", w);

    for (const [index, row] of (product.variants || []).entries()) {
      const key = String(row._id ?? index);
      if (result.linked[key]) row.shopifyVariantId = result.linked[key];
      if (result.inventoryItems[key])
        row.shopifyInventoryItemId = result.inventoryItems[key];
    }
    product.shopifyProductId = ids.productId;
    product.shopifyVariantId = ids.variantId;
    product.shopifySyncedAt = new Date();
    product.shopifySyncError = null;
    await product.save();

    const linked = (product.variants || []).filter((v) => v.shopifyVariantId).length;
    console.log(`   linked back to Mongo: ${linked}/${product.variants.length} variants\n`);
  }

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
