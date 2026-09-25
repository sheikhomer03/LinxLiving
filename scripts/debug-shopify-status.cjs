require("tsx/cjs");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const data = await shopifyAdminRequest(`
    query {
      product(id: "gid://shopify/Product/12298701865224") {
        media(first: 10) {
          nodes { 
            id 
            status 
            ... on MediaImage {
              image { url }
            }
          }
        }
      }
    }
  `);
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}
main().catch(console.error);
