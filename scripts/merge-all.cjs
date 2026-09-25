require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const mongoose = require("mongoose");
const { syncFullProductToShopify } = require("../src/lib/shopify/sync-product-full.ts");
const { deleteShopifyProduct } = require("../src/lib/shopify/sync-product.ts");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const products = await db.collection("products").find({ "specs.Brand": "Tilesporcelain", name: /-/ }).toArray();
  
  const groups = {};
  
  for (const p of products) {
    if (p.name.includes("Epoxy Grout and Glitter")) continue; // Already handled
    
    // Some have spaces around hyphen
    const hyphenIdx = p.name.indexOf('-');
    let baseName = p.name.substring(0, hyphenIdx).trim();
    let variantName = p.name.substring(hyphenIdx + 1).trim();
    
    // For anti-fracture mats etc, if there's no real variant, skip
    if (p.name === "Anti-fracture Mats") continue;
    if (p.name.includes("Ice Grey Slate Cladding - Riven")) {
      baseName = "Ice Grey Slate Cladding";
      variantName = "Riven";
    }
    
    if (!groups[baseName]) groups[baseName] = [];
    groups[baseName].push(p);
  }
  
  for (const [baseName, groupProducts] of Object.entries(groups)) {
    if (groupProducts.length <= 1) continue;
    
    const baseProduct = groupProducts[0];
    
    // Determine if it's size or color based on digits
    const isSize = /\d/.test(baseProduct.name.substring(baseProduct.name.indexOf('-') + 1));
    const optionName = isSize ? "Size" : "Colour";
    
    const variants = [];
    for (const p of groupProducts) {
      let variantName = p.name.substring(p.name.indexOf('-') + 1).trim();
      variants.push({
        _id: new mongoose.Types.ObjectId(),
        name: p.name,
        sku: p.sku || p.sourceSku || "",
        barcode: "",
        price: p.price,
        stock: 500,
        imageUrl: (p.images && p.images.length) ? p.images[0] : "",
        options: {
          [optionName]: variantName
        },
        option1: variantName
      });
    }
    
    const newProduct = {
      ...baseProduct,
      _id: new mongoose.Types.ObjectId(),
      name: baseName,
      price: variants[0].price,
      shopifyOptions: [{ name: optionName }],
      variants: variants,
      images: baseProduct.images || [],
      shopifyImages: [],
      sourceUrl: baseProduct.sourceUrl.split('-')[0] // rough guess
    };
    delete newProduct.shopifyProductId;
    delete newProduct.shopifyVariantId;
    delete newProduct.shopifyHandle;
    delete newProduct.shopifyProductUrl;
    
    console.log(`Merging ${groupProducts.length} variants into ${baseName}`);
    
    await db.collection("products").insertOne(newProduct);
    await syncFullProductToShopify(newProduct, "Tiles Porcelain");
    
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
    
    for (const p of groupProducts) {
      if (p.shopifyProductId) {
        const gid = p.shopifyProductId.startsWith("gid://") ? p.shopifyProductId : `gid://shopify/Product/${p.shopifyProductId}`;
        await deleteShopifyProduct(gid);
      }
      await db.collection("products").deleteOne({ _id: p._id });
    }
  }
  
  console.log("Finished merging all remaining hyphenated products!");
  process.exit(0);
}
main().catch(console.error);
