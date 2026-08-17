/**
 * Host the AlunoTec imagery on Cloudinary and write a manifest for the import.
 *
 * Two sources feed the products. The Palora P6 photography arrived as 20MB
 * renders and is resized first by scripts/prepare-alunotec-images.cjs; the
 * smaller product renders come straight out of the price-list PDFs via
 * scripts/extract-alunotec-pdf-images.cjs. Both end up here because Shopify
 * downloads image URLs from the public internet and cannot read a local path.
 *
 * The manual and motorized price lists embed byte-identical artwork, so only
 * the motorized set is uploaded and both categories point at it.
 *
 *   node scripts/upload-alunotec-images-to-cloudinary.cjs
 *   DRY=1  report what would be uploaded, upload nothing
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { v2: cloudinary } = require("cloudinary");

const DRY = process.env.DRY === "1";
const FOLDER = "linx-living/products/alunotec";
const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "public", "alunotec", "web");
const PAGES = path.join(ROOT, "public", "alunotec", "pages");
const MANIFEST = path.join(__dirname, "alunotec-image-manifest.json");

/** Price-list renders worth keeping — "-01" is the AlunoTec logo on every file. */
const PAGE_FILES = [
  "p6-motorized-02.jpg", // pergola, three-quarter view
  "p6-motorized-03.jpg", // zipped blind, elevation
  "p6-motorized-04.jpg", // zipped blind, wide elevation
  "p6-motorized-05.jpg", // frameless sliding door, 3 panels
  "p6-motorized-06.jpg", // frameless sliding door, 4 panels
  "p6-motorized-07.jpg", // frameless sliding door, 6 panels
  "p4-motorized-02.jpg",
  "p4-motorized-03.jpg",
  "p4-motorized-04.jpg",
  "p4-motorized-05.jpg",
  "p4-motorized-06.jpg",
  "p4-motorized-07.jpg",
];

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function main() {
  const jobs = [];
  for (const f of fs.readdirSync(WEB).filter((f) => /\.jpe?g$/i.test(f))) {
    jobs.push({ file: path.join(WEB, f), key: f });
  }
  for (const f of PAGE_FILES) {
    const full = path.join(PAGES, f);
    if (!fs.existsSync(full)) throw new Error(`Missing extracted render: ${full}`);
    jobs.push({ file: full, key: f });
  }

  console.log(`${jobs.length} image(s) to host in ${FOLDER}\n`);
  const urls = {};

  for (const job of jobs) {
    const publicId = path.basename(job.key, path.extname(job.key));
    if (DRY) {
      urls[job.key] =
        `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}` +
        `/image/upload/${FOLDER}/${publicId}.jpg`;
      console.log(`  would upload ${job.key}`);
      continue;
    }
    const res = await cloudinary.uploader.upload(job.file, {
      folder: FOLDER,
      public_id: publicId,
      overwrite: true,
      resource_type: "image",
    });
    urls[job.key] = res.secure_url;
    console.log(`  ${job.key}\n    → ${res.secure_url}`);
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify(urls, null, 2)}\n`);
  console.log(`\n${DRY ? "Dry run" : "Uploaded"}: ${jobs.length} image(s).`);
  console.log(`Manifest written to scripts/${path.basename(MANIFEST)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
