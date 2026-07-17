/**
 * Fix Spectra images:
 * - Clear images on low-confidence / unmatched products
 * - Re-upload full galleries only when matchScore >= 55
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const dns = require("dns");
const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MIN_SCORE = 55;

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "LinxLivingImporter/1.0" },
  });
  if (!res.ok) throw new Error(`download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function uploadToCloudinary(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "linx-living/products/spectra",
        public_id: publicId,
        overwrite: true,
        resource_type: "image",
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });
}

async function fetchSpectraImages(handle) {
  const res = await fetch(
    `https://spectratileandhome.com/products/${handle}.json`,
    { headers: { "User-Agent": "LinxLivingImporter/1.0" } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.product?.images || [])
    .map((img) => (typeof img === "string" ? img : img.src))
    .filter(Boolean);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection("products");

  // 1) Clear wrong images from weak matches
  const weak = await col.updateMany(
    {
      $or: [
        { "specs.matchScore": { $lt: MIN_SCORE } },
        { "specs.matchScore": { $exists: false }, "specs.spectraHandle": { $exists: true } },
      ],
    },
    {
      $set: { images: [], updatedAt: new Date() },
      $unset: {
        "specs.spectraHandle": "",
        "specs.spectraTitle": "",
        "specs.matchScore": "",
      },
    },
  );
  console.log(`Cleared weak/false matches: ${weak.modifiedCount}`);

  // Also clear products that never had a solid score but somehow have spectraHandle without score >= 55
  // (handled above)

  const products = await col
    .find({
      "specs.spectraHandle": { $exists: true, $ne: "" },
      "specs.matchScore": { $gte: MIN_SCORE },
    })
    .toArray();

  console.log(`Refreshing solid matches: ${products.length}`);

  let updated = 0;
  let failed = 0;

  for (const product of products) {
    const handle = product.specs.spectraHandle;
    try {
      const sources = await fetchSpectraImages(handle);
      if (!sources.length) {
        console.log(`  ○ no images: ${product.name}`);
        continue;
      }

      const urls = [];
      for (let i = 0; i < Math.min(sources.length, 3); i++) {
        const buf = await downloadBuffer(sources[i]);
        const size = product.specs?.size || "na";
        const publicId = `${slugify(product.name)}-${size}-${i + 1}`;
        const uploaded = await uploadToCloudinary(buf, publicId);
        urls.push(uploaded.secure_url);
      }

      await col.updateOne(
        { _id: product._id },
        { $set: { images: urls, updatedAt: new Date() } },
      );
      updated++;
      console.log(`  ✓ ${product.name} → ${urls.length} images`);
    } catch (err) {
      failed++;
      console.warn(`  ✗ ${product.name}:`, err.message);
    }
  }

  const withImg = await col.countDocuments({ "images.0": { $exists: true } });
  const noImg = await col.countDocuments({
    $or: [{ images: { $size: 0 } }, { images: { $exists: false } }],
  });
  console.log(`\nDone. Updated ${updated}, failed ${failed}`);
  console.log(`Products with images: ${withImg}, without: ${noImg}`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
