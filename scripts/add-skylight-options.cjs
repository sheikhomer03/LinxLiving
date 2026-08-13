/**
 * Adds the Roof Pitch picker + priced add-on checkboxes (Structural Glazing
 * Tape, Self-cleaning coating) to the 32 Cambridge Skylights products only —
 * scoped by department+brand, touching nothing else.
 *
 * Reuses existing Product schema fields already rendered by ProductSection:
 *   finishes  -> ProductFinishPicker (image-swatch grid), heading overridden
 *                to "Roof pitch" for these products only (see
 *                ProductOptionPickers.tsx / ProductSection.tsx isSkylightImport)
 *   flashings -> rendered as independent checkboxes (ProductAddonCheckboxList)
 *                instead of the single-select dropdown every other product
 *                with `flashings` gets, again gated on isSkylightImport.
 *
 * Roof pitch icons uploaded to Cloudinary from the source site's own Cloudlift
 * option-set icons. Add-on checkbox images reuse the already-imported
 * Structural Tape / Percenta Nano Coating product photos (no re-upload).
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/add-skylight-options.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/add-skylight-options.cjs --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const APPLY = process.argv.includes("--apply");
const CLOUDINARY_FOLDER = "linx-living/products/skylights";

const STRUCTURAL_TAPE_ID = "6a7dabb8f230ebff958b4bfc";
const PERCENTA_ID = "6a7dabb6f230ebff958b4bfb";

const ROOF_PITCH_ICONS = [
  {
    name: "Flat roof (0° - 10°)",
    src: "https://cdn.shopify.com/s/files/1/0691/7197/0322/files/a_THC8_1.png",
  },
  {
    name: "Low pitched (11° - 35°)",
    src: "https://cdn.shopify.com/s/files/1/0691/7197/0322/files/a_Q7yz_2.png",
  },
  {
    name: "Pitched roof (36° - 45°)",
    src: "https://cdn.shopify.com/s/files/1/0691/7197/0322/files/a_OCJD_3.png",
  },
];

async function uploadIcon(src, publicId) {
  if (!APPLY) return src;
  const result = await cloudinary.uploader.upload(src, {
    folder: CLOUDINARY_FOLDER,
    public_id: publicId,
    overwrite: true,
    resource_type: "image",
  });
  return result.secure_url || src;
}

async function main() {
  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");
  const { ObjectId } = require("mongodb");

  const tape = await productsCol.findOne({ _id: new ObjectId(STRUCTURAL_TAPE_ID) });
  const coating = await productsCol.findOne({ _id: new ObjectId(PERCENTA_ID) });
  if (!tape || !coating) {
    throw new Error("Could not find the Structural Tape / Percenta products to link.");
  }

  console.log("Uploading 3 roof-pitch icons…");
  const finishes = [];
  for (let i = 0; i < ROOF_PITCH_ICONS.length; i++) {
    const icon = ROOF_PITCH_ICONS[i];
    const imageUrl = await uploadIcon(icon.src, `roof-pitch-icon-${i + 1}`);
    finishes.push({
      name: icon.name,
      imageUrl,
      priceAdjustment: 0,
      sortOrder: i,
    });
  }

  const flashings = [
    {
      name: "Add Structural Glazing Tape",
      imageUrl: tape.images?.[0] || "",
      priceAdjustment: Number(tape.price) || 0,
      sortOrder: 0,
    },
    {
      name: "Self-cleaning coating",
      imageUrl: coating.images?.[0] || "",
      priceAdjustment: Number(coating.price) || 0,
      sortOrder: 1,
    },
  ];

  console.log(
    `Add-ons: Structural Glazing Tape +£${flashings[0].priceAdjustment}, Self-cleaning coating +£${flashings[1].priceAdjustment}`,
  );

  const targets = await productsCol
    .find({ department: "rooflights-and-glass", "specs.source": "cambridge-skylights" })
    .project({ name: 1 })
    .toArray();
  console.log(`Found ${targets.length} skylight products to update`);

  if (!APPLY) {
    console.log("finishes:", JSON.stringify(finishes, null, 2));
    console.log("flashings:", JSON.stringify(flashings, null, 2));
    console.log("Re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  const res = await productsCol.updateMany(
    { department: "rooflights-and-glass", "specs.source": "cambridge-skylights" },
    { $set: { finishes, flashings, updatedAt: now } },
  );
  console.log(`✓ updated ${res.modifiedCount} products`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
