require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");
const { assetUrl } = require("./cloudinary-assets.cjs");

/** Exact live Glass Flat Roof TypeTile srcs (Playwright scrape). */
const EXACT = {
  "fixed-frameless":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784750301/linx-products/cambridge-gallery/cambridge/80EU03/gallery-1.png",
  "manual-opening":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784750577/linx-products/cambridge-gallery/cambridge/80EW01/gallery-1.png",
  "electric-opening": assetUrl("/fakro-products/DEF-D_01.jpeg"),
  "walk-on":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784750983/linx-products/cambridge-gallery/cambridge/80EM01/gallery-1.png",
  dome: "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784750289/linx-products/cambridge-gallery/cambridge/80BC01/gallery-1.png",
  "roof-access":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784750713/linx-products/cambridge-gallery/cambridge/80EL05/gallery-1.png",
};

(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  const parent = await db.collection("menus").findOne({
    brand: brand._id,
    slug: "flat-roof-windows",
    parent: null,
  });
  if (!parent) throw new Error("flat-roof-windows parent missing");

  for (const [slug, image] of Object.entries(EXACT)) {
    const r = await db.collection("menus").updateMany(
      { brand: brand._id, parent: parent._id, slug },
      { $set: { image, updatedAt: new Date() } },
    );
    console.log(slug, "matched", r.matchedCount, "→", image);
  }

  const kids = await db
    .collection("menus")
    .find({ brand: brand._id, parent: parent._id })
    .project({ slug: 1, image: 1 })
    .toArray();
  console.log("\nCurrent flat-roof children:");
  for (const k of kids.sort((a, b) => a.slug.localeCompare(b.slug))) {
    console.log(" ", k.slug, "=", k.image);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
