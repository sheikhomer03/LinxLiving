const { connectMongo } = require("./mongo-connect.cjs");
require("dotenv").config({ path: ".env.local" });

const UPDATE_VARIANT = `
  mutation productVariantUpdate($input: ProductVariantInput!) {
    productVariantUpdate(input: $input) {
      productVariant { id price }
      userErrors { field message }
    }
  }
`;

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const products = await db.collection("products").find({
    "specs.Brand": "Tilesporcelain",
    shopifyVariantId: { $exists: true, $ne: null }
  }).toArray();

  console.log(`Found ${products.length} Tiles Porcelain products with Shopify variants.`);
  
  let success = 0;
  let failed = 0;
  const graphqlUrl = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/graphql.json`;
  const token = process.env.SHOPIFY_CLIENT_SECRET;

  for (const p of products) {
    if (!p.price) continue;
    try {
      const response = await fetch(graphqlUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          query: UPDATE_VARIANT,
          variables: {
            input: {
              id: p.shopifyVariantId,
              price: p.price.toString()
            }
          }
        })
      });
      const data = await response.json();
      
      if (data.errors || data.data?.productVariantUpdate?.userErrors?.length > 0) {
        console.error(`Failed ${p.shopifyVariantId}:`, data.errors || data.data.productVariantUpdate.userErrors);
        failed++;
      } else {
        success++;
        process.stdout.write(".");
      }
    } catch (e) {
      console.error(`Failed ${p.shopifyVariantId}:`, e.message);
      failed++;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`\nFinished! Success: ${success}, Failed: ${failed}`);
  process.exit(0);
}

main().catch(console.error);
