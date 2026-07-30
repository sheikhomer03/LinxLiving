/**
 * Set Fakro parent category menu images from child type images or products.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");

(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  const menus = db.collection("menus");
  const products = db.collection("products");

  const parents = ["loft-ladders", "blinds-accessories"];
  const report = [];

  for (const slug of parents) {
    const parent = await menus.findOne({
      brand: brand._id,
      slug,
      parent: null,
    });
    if (!parent) {
      report.push({ slug, error: "missing parent" });
      continue;
    }

    let image = (parent.image || "").trim();
    if (!image) {
      const child = await menus.findOne({
        brand: brand._id,
        parent: parent._id,
        image: { $exists: true, $nin: [null, ""] },
      });
      if (child?.image) image = child.image;
    }
    if (!image) {
      const product = await products.findOne(
        {
          brand: brand._id,
          category: slug,
          "images.0": { $exists: true },
        },
        { projection: { images: 1 }, sort: { updatedAt: -1 } },
      );
      if (product?.images?.[0]) image = product.images[0];
    }

    if (image && image !== parent.image) {
      await menus.updateOne(
        { _id: parent._id },
        { $set: { image, updatedAt: new Date() } },
      );
      report.push({ slug, updated: true, image });
    } else {
      report.push({
        slug,
        updated: false,
        image: parent.image || null,
        note: image ? "already set" : "no image source yet",
      });
    }
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
