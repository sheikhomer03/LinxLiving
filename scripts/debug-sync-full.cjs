require("tsx/cjs");
const { connectMongo } = require("./mongo-connect.cjs");
const { reconcileProductMedia } = require("../src/lib/shopify/sync-media.ts");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await connectMongo(process.env.MONGODB_URL2);
  const p = await db.collection("products").findOne({ _id: new (require("mongoose").Types.ObjectId)("6ab6178f3425de2945146087") });
  const result = await reconcileProductMedia(p.shopifyProductId, p.images, p.shopifyImages || []);
  console.log("reconcileProductMedia result:", JSON.stringify(result, null, 2));
  process.exit(0);
}
main().catch(console.error);
