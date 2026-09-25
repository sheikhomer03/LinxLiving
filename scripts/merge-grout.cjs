require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const mongoose = require("mongoose");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
const { deleteShopifyProduct } = require("../src/lib/shopify/sync-product.ts");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const products = await db.collection("products").find({ "specs.Brand": "Tilesporcelain", name: /Epoxy Grout and Glitter/ }).toArray();
  
  if (products.length === 0) {
    console.log("No grout found");
    process.exit(0);
  }
  
  // Pick one as the base (the first one)
  const baseProduct = products.find(p => p.name === "Epoxy Grout and Glitter-Black") || products[0];
  
  const variants = [];
  
  for (const p of products) {
    let variantName = p.name.substring("Epoxy Grout and Glitter-".length);
    if (p.name === "Epoxy Grout and Glitter") {
       variantName = "Base"; // Shouldn't exist based on list
    }
    
    // Divide prices by 1.2 to fix INC-VAT issue
    const rawPrice = p.price;
    const exVatPrice = rawPrice > 0 ? parseFloat((rawPrice / 1.2).toFixed(2)) : 0;
    
    variants.push({
      _id: new mongoose.Types.ObjectId(),
      name: p.name,
      sku: p.sku || p.sourceSku || "",
      barcode: "",
      price: exVatPrice,
      stock: 500,
      imageUrl: (p.images && p.images.length) ? p.images[0] : "",
      options: {
        Colour: variantName
      },
      option1: variantName
    });
  }
  
  const newProduct = {
    ...baseProduct,
    _id: new mongoose.Types.ObjectId(),
    name: "Epoxy Grout and Glitter",
    price: variants[0].price,
    shopifyOptions: [{ name: "Colour" }],
    variants: variants,
    images: baseProduct.images || [],
    shopifyImages: [], // will be recreated
    sourceUrl: "https://tilesporcelain.co.uk/epoxy-grout-and-glitter"
  };
  delete newProduct.shopifyProductId;
  delete newProduct.shopifyVariantId;
  delete newProduct.shopifyHandle;
  delete newProduct.shopifyProductUrl;
  
  console.log("Created merged product with variants:", variants.length);
  
  await db.collection("products").insertOne(newProduct);
  
  await syncFullProductToShopify(newProduct, "Tiles Porcelain");
  
  // Save mapping
  await db.collection("products").updateOne(
    { _id: newProduct._id },
    { $set: { 
      shopifyImages: newProduct.shopifyImages, 
      shopifyProductId: newProduct.shopifyProductId, 
      shopifyVariantId: newProduct.shopifyVariantId,
      variants: newProduct.variants,
      shopifyHandle: newProduct.shopifyHandle,
      shopifyProductUrl: newProduct.shopifyProductUrl
    }}
  );
  
  // Now delete the old individual products
  for (const p of products) {
    if (p.shopifyProductId) {
      const gid = p.shopifyProductId.startsWith("gid://") ? p.shopifyProductId : `gid://shopify/Product/${p.shopifyProductId}`;
      await deleteShopifyProduct(gid);
    }
    await db.collection("products").deleteOne({ _id: p._id });
  }
  
  console.log("Deleted old individual products");
  
  process.exit(0);
}
main().catch(console.error);
