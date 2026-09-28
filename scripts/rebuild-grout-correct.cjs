require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const mongoose = require("mongoose");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
require("dotenv").config({ path: ".env.local" });

// The 6 real grout colors from live site
const GROUT_COLORS = [
  { colour: "Red",    sku: "grt-spkz-Red-1",    price: 24.99 },
  { colour: "Black",  sku: "grt-spkz-Black-1",  price: 24.99 },
  { colour: "Brown",  sku: "grt-spkz-Brown-1",  price: 24.99 },
  { colour: "Cream",  sku: "grt-spkz-Cream-1",  price: 24.99 },
  { colour: "Purple", sku: "grt-spkz-Purple-1", price: 24.99 },
  { colour: "Pink",   sku: "grt-spkz-Pink-1",   price: 24.99 },
];

// Real images from live site (3 shared images for all colors)
const GROUT_IMAGES = [
  "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807/g/r/grt-spkz-01_3_1.jpg",
  "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807/g/r/grt-spkz-01_4_1.jpg",
  "https://tilesporcelain.co.uk/media/catalog/product/cache/68cc98e30e2a917236b3fe3faf831807/g/r/grt-spkz-01_9_1.jpg",
];

async function deleteOldGroutProducts(db) {
  // Find and delete all current grout products (both old individual and merged)
  const existing = await db.collection("products").find({
    "specs.Brand": "Tilesporcelain",
    name: /Epoxy Grout and Glitter/
  }).toArray();
  
  console.log(`Found ${existing.length} existing grout products to clean up`);
  
  // Delete their Shopify products
  for (const p of existing) {
    if (p.shopifyProductId) {
      try {
        await shopifyAdminRequest(`
          mutation {
            productDelete(input: { id: "${p.shopifyProductId}" }) {
              deletedProductId
            }
          }
        `);
        console.log(`  Deleted Shopify product: ${p.shopifyProductId}`);
      } catch(e) {
        console.log(`  Could not delete Shopify product: ${e.message}`);
      }
    }
    await db.collection("products").deleteOne({ _id: p._id });
  }
  console.log("Cleaned up all old grout products");
}

async function createShopifyProduct() {
  // Create Shopify product with 6 color variants
  const variantInputs = GROUT_COLORS.map(c => `{
    optionValues: [{ optionName: "Colour", name: "${c.colour}" }]
    price: "${c.price}"
    sku: "${c.sku}"
    inventoryQuantities: [{ availableQuantity: 500, locationId: "gid://shopify/Location/69706637576" }]
    inventoryItem: { tracked: false }
  }`).join(",\n");

  const mediaInputs = GROUT_IMAGES.map(url => `{ originalSource: "${url}", mediaContentType: IMAGE }`).join(",\n");

  const mutation = `
    mutation {
      productCreate(product: {
        title: "Epoxy Grout and Glitter",
        vendor: "Tiles Porcelain",
        productType: "Accessories",
        status: ACTIVE,
        options: [{ name: "Colour", values: [${GROUT_COLORS.map(c => `{ name: "${c.colour}" }`).join(", ")}] }]
        variants: [${variantInputs}]
      },
      media: [${mediaInputs}]
      ) {
        product {
          id
          handle
          options { id name values }
          variants(first: 10) {
            nodes { id sku title }
          }
          media(first: 10) {
            nodes { id status ... on MediaImage { image { url } } }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const result = await shopifyAdminRequest(mutation);
  if (result.productCreate?.userErrors?.length) {
    throw new Error("Shopify errors: " + JSON.stringify(result.productCreate.userErrors));
  }
  return result.productCreate.product;
}

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);

  // Step 1: Clean up all old grout products
  await deleteOldGroutProducts(db);

  // Step 2: Create proper Shopify product
  console.log("Creating new Shopify product...");
  const shopifyProduct = await createShopifyProduct();
  console.log("Created Shopify product:", shopifyProduct.id);

  // Wait a bit for images to process
  await new Promise(r => setTimeout(r, 3000));
  
  // Fetch fresh media with URLs
  const mediaData = await shopifyAdminRequest(`
    query {
      product(id: "${shopifyProduct.id}") {
        media(first: 10) {
          nodes { id status ... on MediaImage { image { url } } }
        }
      }
    }
  `);
  const mediaNodes = mediaData?.product?.media?.nodes || [];
  
  // Build shopifyImages array
  const shopifyImages = GROUT_IMAGES.map((sourceUrl, idx) => {
    const node = mediaNodes[idx];
    return {
      sourceUrl,
      shopifyUrl: node?.image?.url || "",
      mediaId: node?.id || "",
      position: idx
    };
  });

  // Build variants from Shopify response
  const shopifyVariants = shopifyProduct.variants?.nodes || [];
  const variants = GROUT_COLORS.map((c, idx) => {
    const sv = shopifyVariants.find(v => v.sku === c.sku) || shopifyVariants[idx];
    return {
      _id: new mongoose.Types.ObjectId(),
      name: `Epoxy Grout and Glitter - ${c.colour}`,
      sku: c.sku,
      barcode: "",
      price: c.price,
      stock: 500,
      imageUrl: GROUT_IMAGES[0],
      shopifyImageUrl: shopifyImages[0]?.shopifyUrl || "",
      shopifyVariantId: sv?.id || "",
      options: { Colour: c.colour },
      option1: c.colour
    };
  });

  // Step 3: Create MongoDB document
  const mongoProduct = {
    _id: new mongoose.Types.ObjectId(),
    name: "Epoxy Grout and Glitter",
    slug: "epoxy-grout-and-glitter",
    department: "tiles",
    category: "glitter-grout",
    price: 24.99,
    description: "Simply add your epoxy grout and glitter to your shopping cart to get the grout and sparkle colour you desire. Available in 6 colours. Coverage approx 5m².",
    images: GROUT_IMAGES,
    shopifyImages,
    shopifyProductId: shopifyProduct.id,
    shopifyVariantId: shopifyVariants[0]?.id || "",
    shopifyHandle: shopifyProduct.handle,
    shopifyProductUrl: `https://009jgx-g1.myshopify.com/products/${shopifyProduct.handle}`,
    shopifyOptions: [{ name: "Colour", values: GROUT_COLORS.map(c => c.colour) }],
    variants,
    specs: {
      Brand: "Tilesporcelain",
      Type: "Epoxy Grout",
      Coverage: "Approx 5m²",
    },
    sourceUrl: "https://tilesporcelain.co.uk/epoxy-grout-and-glitter",
    createdAt: new Date(),
    updatedAt: new Date()
  };

  await db.collection("products").insertOne(mongoProduct);
  console.log("Inserted MongoDB product:", mongoProduct._id);
  console.log("shopifyImages populated:", shopifyImages.filter(i => i.shopifyUrl).length, "of", shopifyImages.length);
  console.log("Variants:", variants.map(v => v.option1).join(", "));
  console.log("\nDone! Product ID:", mongoProduct._id);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
