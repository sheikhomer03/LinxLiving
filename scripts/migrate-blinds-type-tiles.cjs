require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");
const { assetUrl } = require("./cloudinary-assets.cjs");

/**
 * Exact live Glass Blinds & Accessories TypeTile srcs (Playwright scrape),
 * resolved to Cloudinary. Local `public/` paths 404 in production.
 */
const EXACT = {
  blinds: assetUrl(
    "/fakro-products/BT-Manual-Venetian-Blind-in-Colour-140-AJP-I_01.jpg",
  ),
  accessories: assetUrl("/fakro-products/XDK_01.jpg"),
};

(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  const parent = await db.collection("menus").findOne({
    brand: brand._id,
    slug: "blinds-accessories",
    parent: null,
  });
  if (!parent) throw new Error("blinds-accessories parent missing");

  for (const [slug, image] of Object.entries(EXACT)) {
    const r = await db.collection("menus").updateMany(
      { brand: brand._id, parent: parent._id, slug },
      { $set: { image, updatedAt: new Date() } },
    );
    console.log(slug, "matched", r.matchedCount, "→", image);
  }

  // Parent cover: use blinds tile (Glass parent often empty)
  await db.collection("menus").updateOne(
    { _id: parent._id },
    { $set: { image: EXACT.blinds, updatedAt: new Date() } },
  );
  console.log("parent blinds-accessories →", EXACT.blinds);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
