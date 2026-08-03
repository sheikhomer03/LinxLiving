/**
 * Refresh Mongo product.images from live Shopify media.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/refresh-product-shopify-images.cjs <mongoProductId>
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { ObjectId } = require("mongodb");
const { connectMongo } = require("./mongo-connect.cjs");

const productId = process.argv[2];
if (!productId) {
  console.error("Pass a Mongo product id");
  process.exit(1);
}

function isCloudinary(url) {
  return /res\.cloudinary\.com|cloudinary\.com/i.test(String(url || ""));
}

async function getShopifyToken(domain, clientId, clientSecret) {
  const res = await fetch(
    `https://${domain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    },
  );
  const json = await res.json();
  if (!json.access_token) {
    throw new Error(
      `Shopify token failed: ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json.access_token;
}

async function main() {
  const domain = String(
    process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP || "",
  )
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const version = process.env.SHOPIFY_API_VERSION || "2025-07";
  const clientId = process.env.SHOPIFY_CLIENT_ID || "";
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || "";
  const staticToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";

  if (!domain || (!staticToken && !(clientId && clientSecret))) {
    throw new Error("Missing Shopify credentials");
  }

  const token =
    staticToken || (await getShopifyToken(domain, clientId, clientSecret));

  const { db, client } = await connectMongo();
  const products = db.collection("products");
  const product = await products.findOne({
    _id: new ObjectId(productId),
  });
  if (!product) {
    throw new Error("Product not found");
  }

  const existing = Array.isArray(product.images) ? product.images : [];
  const cloudinary = existing.filter(isCloudinary);
  if (cloudinary.length) {
    console.log(
      "Already has Cloudinary images — not overwriting:",
      cloudinary.length,
    );
    await client.close();
    return;
  }

  const shopifyId = String(product.shopifyProductId || "");
  if (!shopifyId.startsWith("gid://shopify/Product/")) {
    throw new Error("Product has no shopifyProductId");
  }

  const gql = await fetch(
    `https://${domain}/admin/api/${version}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: `
          query ($id: ID!) {
            product(id: $id) {
              title
              featuredImage { url }
              media(first: 30) {
                nodes {
                  preview { image { url } }
                  ... on MediaImage { image { url } }
                }
              }
            }
          }
        `,
        variables: { id: shopifyId },
      }),
    },
  );
  const json = await gql.json();
  const sp = json?.data?.product;
  if (!sp) {
    console.error(JSON.stringify(json, null, 2));
    throw new Error("Product not found in Shopify");
  }

  const urls = (sp.media?.nodes || [])
    .map((n) => n?.image?.url || n?.preview?.image?.url)
    .filter(Boolean);
  if (sp.featuredImage?.url && !urls.includes(sp.featuredImage.url)) {
    urls.unshift(sp.featuredImage.url);
  }

  console.log("Mongo:", product.name);
  console.log("Shopify:", sp.title);
  console.log("Stored images:", existing.length);
  console.log("Live Shopify media:", urls.length);

  const working = [];
  for (const u of urls) {
    const r = await fetch(u, { method: "HEAD", redirect: "follow" });
    console.log(r.status, u.slice(0, 130));
    if (r.status >= 200 && r.status < 400) working.push(u);
  }

  if (!working.length) {
    console.error(
      "\nNo working image URLs on Shopify either (all 404).\n" +
        "The files were removed from the Shopify CDN. Fix by re-uploading\n" +
        "images in Shopify Admin or uploading to Cloudinary for this product.",
    );
    await client.close();
    process.exit(2);
  }

  await products.updateOne(
    { _id: new ObjectId(productId) },
    { $set: { images: working, updatedAt: new Date() } },
  );
  console.log("Updated Mongo with", working.length, "working image(s)");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
