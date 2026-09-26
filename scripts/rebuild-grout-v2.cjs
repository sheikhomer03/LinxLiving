require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const mongoose = require("mongoose");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
require("dotenv").config({ path: ".env.local" });

// EXACTLY what the live site has: 6 colors, £29.99 inc VAT = £24.99 ex VAT
const GROUT_COLORS = ["Red", "Black", "Brown", "Cream", "Purple", "Pink"];
const GROUT_PRICE_EX_VAT = 24.99;
const GROUT_IMAGES = [
  "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807/g/r/grt-spkz-01_3_1.jpg",
  "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807/g/r/grt-spkz-01_4_1.jpg",
  "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807/g/r/grt-spkz-01_9_1.jpg",
];

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);

  // Delete any existing grout products
  const existing = await db.collection("products").find({
    "specs.Brand": "Tilesporcelain",
    name: /Epoxy Grout and Glitter/
  }).toArray();
  console.log(`Cleaning up ${existing.length} old products...`);
  for (const p of existing) {
    if (p.shopifyProductId) {
      try {
        await shopifyAdminRequest(`mutation { productDelete(input: { id: "${p.shopifyProductId}" }) { deletedProductId } }`);
      } catch(e) { /* ignore */ }
    }
    await db.collection("products").deleteOne({ _id: p._id });
  }

  // Build the product doc in the format syncFullProductToShopify expects
  const product = {
    _id: new mongoose.Types.ObjectId(),
    name: "Epoxy Grout and Glitter",
    description: "Add your epoxy grout and glitter to your shopping cart to get the grout and sparkle colour you desire. Available in 6 colours. Coverage approx 5m².",
    price: GROUT_PRICE_EX_VAT,
    images: GROUT_IMAGES,
    shopifyImages: [],
    department: "tiles",
    category: "glitter-grout",
    sku: "grt-spkz",
    stock: 500,
    specs: { Brand: "Tilesporcelain", Type: "Epoxy Grout", Coverage: "Approx 5m²" },
    sourceUrl: "https://tilesporcelain.co.uk/epoxy-grout-and-glitter",
    // shopifyOptions drives the color picker in the UI
    shopifyOptions: [{ name: "Colour", values: GROUT_COLORS }],
    // variants is what gets turned into Shopify variants + the color dropdown
    variants: GROUT_COLORS.map((colour, i) => ({
      _id: new mongoose.Types.ObjectId(),
      name: `Epoxy Grout and Glitter - ${colour}`,
      sku: `grt-spkz-${colour}-1`,
      price: GROUT_PRICE_EX_VAT,
      stock: 500,
      imageUrl: GROUT_IMAGES[0],
      option1: colour,
      options: { Colour: colour }
    }))
  };

  // Insert first so syncFullProductToShopify can find it
  await db.collection("products").insertOne(product);
  console.log("Inserted product:", product._id.toString());

  // Sync to Shopify - this handles multi-variant creation correctly
  await syncFullProductToShopify(product, "Tiles Porcelain");
  console.log("Shopify sync done. shopifyProductId:", product.shopifyProductId);
  console.log("shopifyImages:", product.shopifyImages?.length, "items");

  // Save back to DB
  await db.collection("products").updateOne(
    { _id: product._id },
    { $set: {
      shopifyProductId: product.shopifyProductId,
      shopifyVariantId: product.shopifyVariantId,
      shopifyHandle: product.shopifyHandle,
      shopifyProductUrl: product.shopifyProductUrl,
      shopifyImages: product.shopifyImages,
      variants: product.variants
    }}
  );

  console.log("\n✓ Done! Visit: http://localhost:3000/products/" + product._id.toString());
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
