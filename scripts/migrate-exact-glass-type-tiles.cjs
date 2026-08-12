/**
 * Set Fakro pitched type tiles to the EXACT imageSrc values scraped from
 * live linxglass.co.uk Shop TypeTiles (Playwright).
 *
 * Usage: node scripts/migrate-exact-glass-type-tiles.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");
const { assetUrl } = require("./cloudinary-assets.cjs");

/** Exact live Glass TypeTile srcs (scraped 2026-08-03). */
const EXACT = {
  "pitched-roof-windows/centre-pivot":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784749072/linx-products/cambridge-gallery/cambridge/879F01/gallery-1.png",
  "pitched-roof-windows/top-hung":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784750744/linx-products/cambridge-gallery/cambridge/87CY02/gallery-1.png",
  "pitched-roof-windows/electric-solar":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784751103/linx-products/cambridge-gallery/cambridge/875Y01/gallery-1.png",
  "pitched-roof-windows/conservation": assetUrl("/fakro-products/FTW-V_01.jpg"),
  "pitched-roof-windows/high-pivot": assetUrl("/fakro-products/FYW-V_01.jpg"),
  "pitched-roof-windows/balcony": assetUrl("/fakro-products/FGH-V_01.jpeg"),
  "pitched-roof-windows/l-shape-combination": assetUrl("/fakro-products/BDL_01.jpg"),
  "pitched-roof-windows/light-tunnels": assetUrl("/fakro-products/SFS_01.jpg"),
  "pitched-roof-windows/electricals": assetUrl("/fakro-products/ZWS12_01.jpg"),
  "pitched-roof-windows/flashing-kits":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784750086/linx-products/cambridge-gallery/cambridge/83412/gallery-1.png",
};

(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  const parents = await db
    .collection("menus")
    .find({ brand: brand._id, parent: null })
    .toArray();
  const parentBySlug = Object.fromEntries(parents.map((p) => [p.slug, p]));

  for (const [key, image] of Object.entries(EXACT)) {
    const [parentSlug, typeSlug] = key.split("/");
    const parent = parentBySlug[parentSlug];
    if (!parent) {
      console.warn("missing parent", parentSlug);
      continue;
    }
    const r = await db.collection("menus").updateMany(
      { brand: brand._id, parent: parent._id, slug: typeSlug },
      { $set: { image, updatedAt: new Date() } },
    );
    console.log("set", key, "→", image, `(matched ${r.matchedCount})`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
