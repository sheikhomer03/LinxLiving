require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);

  // Fix grout: price should be 29.99 (inc VAT) and fetch real image URLs
  const grout = await db.collection("products").findOne({ name: "Epoxy Grout and Glitter", "specs.Brand": "Tilesporcelain" });
  if (!grout) { console.log("Grout not found!"); process.exit(1); }

  console.log("Grout ID:", grout._id, "current price:", grout.price);

  // Fetch real Shopify image URLs
  const mediaData = await shopifyAdminRequest(`
    query { product(id: "${grout.shopifyProductId}") { media(first: 10) { nodes { id status ... on MediaImage { image { url } } } } } }
  `);
  const mediaNodes = mediaData?.product?.media?.nodes || [];
  const urlMap = {};
  for (const n of mediaNodes) {
    if (n.status === "READY" && n.image?.url) urlMap[n.id] = n.image.url;
  }
  console.log("Ready media URLs:", Object.keys(urlMap).length);

  // Update shopifyImages with real URLs
  const newShopifyImages = (grout.shopifyImages || []).map(img => ({
    ...img,
    shopifyUrl: urlMap[img.mediaId] || img.shopifyUrl || ""
  }));

  // Update variants — price 29.99, and use real image URL
  const firstImageUrl = Object.values(urlMap)[0] || "";
  const newVariants = (grout.variants || []).map(v => ({
    ...v,
    price: 29.99,
    shopifyImageUrl: firstImageUrl
  }));

  await db.collection("products").updateOne(
    { _id: grout._id },
    { $set: {
      price: 29.99,             // inc VAT — matches live site display
      shopifyImages: newShopifyImages,
      variants: newVariants
    }}
  );

  console.log(`✓ Grout fixed: price=29.99, shopifyImages updated (${newShopifyImages.filter(i=>i.shopifyUrl).length}/3 have URLs)`);

  // Also fix the Glitter 150g separate products if they exist — also inc-VAT pricing
  const glitters = await db.collection("products").find({
    "specs.Brand": "Tilesporcelain",
    name: /Glitter.*150g/
  }).toArray();
  console.log(`Found ${glitters.length} Glitter 150g products`);
  for (const g of glitters) {
    // Live site: £8.99 inc VAT → store 8.99
    if (g.price !== 8.99) {
      await db.collection("products").updateOne({ _id: g._id }, { $set: { price: 8.99 } });
      console.log(`  Fixed ${g.name}: price → 8.99`);
    }
  }

  // Fix the merged tile products (Alaska White, Bali Gold, Diamond White) — check their prices are inc-VAT
  // These were kept at original prices which should be correct already
  console.log("\nDone!");
  process.exit(0);
}
main().catch(console.error);
