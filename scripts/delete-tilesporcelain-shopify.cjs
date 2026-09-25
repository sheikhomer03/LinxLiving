const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const fetch = require("node-fetch");

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = "2024-01";

async function adminToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  }
  const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  return data.access_token;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function queryShopify(query, variables = {}, token) {
  const res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    if (json.errors[0]?.extensions?.code === 'THROTTLED') {
      await sleep(2000);
      return queryShopify(query, variables, token);
    }
    throw new Error(JSON.stringify(json.errors, null, 2));
  }
  return json.data;
}

async function main() {
  const token = await adminToken();
  let hasNextPage = true;
  let cursor = null;
  let deleted = 0;

  while (hasNextPage) {
    const data = await queryShopify(`
      query($cursor: String) {
        products(first: 5, after: $cursor, query: "vendor:'Tiles Porcelain'") {
          pageInfo { hasNextPage endCursor }
          edges { node { id title } }
        }
      }
    `, { cursor }, token);

    const products = data.products.edges;
    if (products.length === 0) break;

    const ids = products.map(p => p.node.id);
    
    // Delete in bulk
    for (const id of ids) {
      await queryShopify(`
        mutation($input: ProductDeleteInput!) {
          productDelete(input: $input) {
            deletedProductId
            userErrors { field message }
          }
        }
      `, { input: { id } }, token);
      deleted++;
      process.stdout.write(`\rDeleted ${deleted} products...`);
      await sleep(100); // Respect Shopify rate limits
    }

    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }
  
  console.log(`\nSuccessfully deleted ${deleted} old Tiles Porcelain products from Shopify.`);
}

main().catch(console.error);
