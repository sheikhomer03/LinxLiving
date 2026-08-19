/**
 * Host the Oscar catalogue pages on Cloudinary and repoint the products at them.
 *
 * The pages were extracted straight out of the supplier PDFs into
 * public/oscar/pages, which serves them fine on our own storefront. Shopify
 * cannot fetch a local path, though — it downloads image URLs from the public
 * internet — so a synced product arrived with no media at all. Every other
 * product image in the catalogue is already on Cloudinary; these join them.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/upload-oscar-images-to-cloudinary.cjs
 *   DRY=1  report what would be uploaded, upload nothing
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY = process.env.DRY === "1";
const FOLDER = "linx-living/products/oscar-pergola";
const PAGES = path.join(__dirname, "..", "public", "oscar", "pages");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function upload(file) {
  const publicId = path.basename(file, ".jpg");
  const res = await cloudinary.uploader.upload(path.join(PAGES, file), {
    folder: FOLDER,
    public_id: publicId,
    overwrite: true,
    resource_type: "image",
  });
  return res.secure_url;
}

async function main() {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "oscar-pergola" });
  const products = await db.collection("products").find({ brand: brand._id }).toArray();

  // Only the pages the products actually reference.
  const wanted = new Set();
  for (const p of products) {
    for (const img of p.images || []) wanted.add(path.basename(img));
    if (p.schematicImage) wanted.add(path.basename(p.schematicImage));
  }
  const files = [...wanted].filter((f) => fs.existsSync(path.join(PAGES, f)));
  console.log(`${files.length} image(s) to host: ${files.join(", ")}\n`);

  const urls = {};
  for (const f of files) {
    if (DRY) {
      console.log(`  would upload ${f}`);
      urls[f] = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${FOLDER}/${path.basename(f, ".jpg")}.jpg`;
      continue;
    }
    urls[f] = await upload(f);
    console.log(`  uploaded ${f}\n    → ${urls[f]}`);
  }

  console.log("");
  for (const p of products) {
    const images = (p.images || []).map((i) => urls[path.basename(i)] || i);
    const schematicImage = p.schematicImage
      ? urls[path.basename(p.schematicImage)] || p.schematicImage
      : "";
    if (!DRY) {
      await db.collection("products").updateOne(
        { _id: p._id },
        { $set: { images, schematicImage, updatedAt: new Date() } },
      );
    }
    console.log(
      `${DRY ? "would repoint" : "repointed"} ${p.name} → ${images.length} image(s)`,
    );
  }

  if (DRY) console.log("\nDRY=1 — nothing uploaded or written.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
