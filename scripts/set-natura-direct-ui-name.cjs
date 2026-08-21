/**
 * Set UI name "Linx Square" for Natura Flooring + Direct Flooring Online.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/set-natura-direct-ui-name.cjs
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");

const NAMES = ["Natura Flooring", "Direct Flooring Online"];
const UI_NAME = "Linx Square";

async function main() {
  const { db } = await connectMongo();
  for (const name of NAMES) {
    const brand = await db.collection("brands").findOne({ name });
    if (!brand) {
      console.log("NOT FOUND:", name);
      continue;
    }
    const res = await db.collection("brands").updateOne(
      { _id: brand._id },
      { $set: { uiName: UI_NAME, updatedAt: new Date() } },
    );
    console.log({
      name: brand.name,
      slug: brand.slug,
      previousUiName: brand.uiName || null,
      uiName: UI_NAME,
      modified: res.modifiedCount,
    });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
