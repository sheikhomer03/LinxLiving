/**
 * Fills in missing PDP-visible info for the 5 Cambridge Skylights accessory
 * products added by scripts/import-cambridge-accessories.cjs — nothing else.
 *
 * Scoped strictly to those 5 by _id. Adds:
 *   - featureEntries (renders as the "Features" table on the PDP, via
 *     ProductFeaturePacking — see ProductSection.tsx)
 *   - shortDescription (prepended to the Description tab)
 *   - specs.sku (so linxSku's specs.sku fallback resolves)
 *
 * All values below are taken directly from each product's own scraped
 * Shopify description (see the dry-run output from the import script) —
 * nothing invented.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/enrich-cambridge-accessories.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/enrich-cambridge-accessories.cjs --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");

const UPDATES = [
  {
    id: "6a7dabb6f230ebff958b4bfb", // Percenta Nano Coating
    shortDescription:
      "Self-cleaning nano coating that protects glass facades and windows from dirt, condensation and UV damage for up to 36 months.",
    featureEntries: [
      { label: "Coverage", value: "10 ml per sq.m" },
      { label: "Durability", value: "Up to 36 months" },
      { label: "Curing / Drying", value: "30 – 60 minutes" },
      { label: "Shelf life", value: "24 months" },
      { label: "Application temperature", value: "5 – 30°C" },
    ],
  },
  {
    id: "6a7dabb8f230ebff958b4bfc", // Structural Glazing Spacer Tape
    shortDescription:
      "Black double-sided high-tack acrylic adhesive PVC glazing tape for structural spacer systems, compatible with Dow, Sika and GE silicones.",
    featureEntries: [
      {
        label: "Material",
        value: "Modified solvent acrylic, filmic liner",
      },
      {
        label: "Compatibility",
        value: "Approved by Dow, Sika and GE for use with their silicones",
      },
      { label: "Resistance", value: "UV light and water; excellent ageing resistance" },
      { label: "Shelf life", value: "1 year" },
    ],
  },
  {
    id: "6a7dabbaf230ebff958b4bfd", // DOWSIL 895 Structural Glazing
    shortDescription:
      "High-quality black structural glazing sealant from Dow, supplied in a 310ml cartridge.",
    featureEntries: [
      { label: "Colour", value: "Black" },
      { label: "Size", value: "310ml cartridge" },
      { label: "Coverage", value: "100ml per 1m" },
    ],
  },
  {
    id: "6a7dabbbf230ebff958b4bfe", // DOWSIL 791 Weatherproofing
    shortDescription:
      "Low modulus neutral-cure silicone sealant for weatherproofing window and door frames, curtain walling, building facades and expansion joints.",
    featureEntries: [
      { label: "Colour", value: "Black" },
      { label: "Size", value: "310ml cartridge" },
      { label: "Coverage", value: "100ml per m" },
      {
        label: "Adhesion",
        value: "Excellent unprimed adhesion to porous and non-porous substrates",
      },
    ],
  },
  {
    id: "6a7dabbdf230ebff958b4bff", // Fitters pack
    shortDescription:
      "A complete fitting kit bundling structural glazing tape with DOWSIL 895 and DOWSIL 791 sealants.",
    featureEntries: [
      {
        label: "Contains",
        value: "1 x 10m Structural Glazing Spacer Tape",
      },
      { label: "Contains", value: "1 x 310ml DOWSIL 895 Structural Glazing" },
      { label: "Contains", value: "1 x 310ml DOWSIL 791 Weatherproofing" },
    ],
  },
];

async function main() {
  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");
  const { ObjectId } = require("mongodb");

  for (const u of UPDATES) {
    const _id = new ObjectId(u.id);
    const existing = await productsCol.findOne({ _id });
    if (!existing) {
      console.error(`✗ not found: ${u.id}`);
      continue;
    }

    const $set = {
      shortDescription: u.shortDescription,
      featureEntries: u.featureEntries,
      "specs.sku": existing.manufacturerSku || existing.productCode || "",
      updatedAt: new Date(),
    };

    if (!APPLY) {
      console.log(`[dry update] ${existing.name}`);
      console.log(JSON.stringify($set, null, 2));
      continue;
    }

    await productsCol.updateOne({ _id }, { $set });
    console.log(`✓ updated ${existing.name} (${u.id})`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
