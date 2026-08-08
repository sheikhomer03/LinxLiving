/**
 * Set Britmet storefront UI name to "Linx Roof" (admin name stays Britmet).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/set-britmet-ui-name.cjs
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");

async function main() {
  const { db } = await connectMongo();
  const brand = await db.collection("brands").findOne({
    $or: [{ slug: "britmet" }, { name: /^britmet$/i }],
  });
  if (!brand) throw new Error("Britmet brand not found");

  const uiName = "Linx Roof";
  const res = await db.collection("brands").updateOne(
    { _id: brand._id },
    { $set: { uiName, updatedAt: new Date() } },
  );
  console.log({
    name: brand.name,
    slug: brand.slug,
    previousUiName: brand.uiName || null,
    uiName,
    matched: res.matchedCount,
    modified: res.modifiedCount,
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
