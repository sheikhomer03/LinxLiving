/**
 * Import the Porcious UK porcelain tile range (21 designs / 29 Glossy-Matt
 * SKUs) from local source files into the live Tiles department.
 *
 * Source data:
 *   Product Images & Catelogues/PORCIOUS UK DATA/<design folder>/*.jpg  — images
 *   Product Images & Catelogues/Porcious UK Catalogue.pdf               — technical spec + packing (page 12)
 *   Product Images & Catelogues/30X60 UK.pdf | 60X60 UK.pdf | 60X120 UK.pdf — per-size zone rate cards (uploaded as downloadable references)
 *
 * Pricing: card/default price = Zone 1, "Up to 20 sqm" bracket, £ per m².
 * Was price = price / (1 - discount), discount fixed at 20/25/30% by size
 * tier so the badge always reads a round number. Full 4-zone x 4-bracket
 * rate card is stored in specs.zonePricing for a future PDP zone selector.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/import-porcious-tiles.cjs            # dry run (no writes, no uploads)
 *   node --require ./scripts/mongo-dns.cjs scripts/import-porcious-tiles.cjs --apply
 */

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const { ObjectId } = require("mongodb");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const ZONE = 1; // default zone shown on the product card until a PDP zone-selector is built
const PRICE_INCREASE_MULTIPLIER = 1.45; // +45% across every size/zone/bracket; "was" scales automatically since it's derived from "now"
const MINIMUM_ORDER_M2 = 10; // customer must order at least this many m² of a given product

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const IMAGE_ROOT =
  "/Users/niazig/Desktop/linxliving/Product Images & Catelogues/PORCIOUS UK DATA";
const PDF_ROOT = "/Users/niazig/Desktop/linxliving/Product Images & Catelogues";

const TILES_DEPARTMENT_ID = new ObjectId("6a732f893c8c62276d15fb6f"); // existing "Tiles" department
const EXISTING_600x600_CATEGORY_ID = new ObjectId("6a78c97b611684ddb3ce0cb4"); // existing "600x600 Tiles"

// --- Zone x bracket rate card, £ per m² (from Porcious UK zone pricing) ---
// Base (pre-markup) figures — scaled by PRICE_INCREASE_MULTIPLIER below before use.
const BASE_RATE_CARD = {
  "300x600": {
    zone1: { upto20: 11.5, "20to35": 10.0, "35plus1": 8.5, "54plus": 7.5 },
    zone2: { upto20: 12.0, "20to35": 10.5, "35plus1": 8.5, "54plus": 8.0 },
    zone3: { upto20: 13.0, "20to35": 11.5, "35plus1": 9.0, "54plus": 8.0 },
    zone4: { upto20: 13.5, "20to35": 11.5, "35plus1": 9.5, "54plus": 8.0 },
  },
  "600x600": {
    zone1: { upto20: 12.5, "20to35": 11.0, "35plus1": 9.5, "57plus": 8.5 },
    zone2: { upto20: 13.0, "20to35": 11.5, "35plus1": 9.5, "57plus": 9.0 },
    zone3: { upto20: 14.0, "20to35": 12.5, "35plus1": 10.0, "57plus": 9.0 },
    zone4: { upto20: 14.5, "20to35": 12.5, "35plus1": 10.5, "57plus": 9.0 },
  },
  "600x1200": {
    zone1: { upto20: 13.5, "20to35": 12.0, "35plus1": 10.0, "46plus": 9.5 },
    zone2: { upto20: 14.0, "20to35": 12.5, "35plus1": 10.5, "46plus": 10.0 },
    zone3: { upto20: 15.0, "20to35": 13.0, "35plus1": 11.0, "46plus": 10.5 },
    zone4: { upto20: 15.5, "20to35": 13.5, "35plus1": 11.0, "46plus": 10.5 },
  },
  "600x1200hd": {
    zone1: { upto20: 14.5, "20to35": 13.0, "35plus1": 11.0, "46plus": 10.5 },
    zone2: { upto20: 15.0, "20to35": 13.5, "35plus1": 11.5, "46plus": 11.0 },
    zone3: { upto20: 16.5, "20to35": 14.0, "35plus1": 12.0, "46plus": 11.5 },
    zone4: { upto20: 17.0, "20to35": 14.5, "35plus1": 12.0, "46plus": 11.5 },
  },
};

function scaleRate(v) {
  return Math.round(v * PRICE_INCREASE_MULTIPLIER * 100) / 100;
}

const RATE_CARD = Object.fromEntries(
  Object.entries(BASE_RATE_CARD).map(([tier, zones]) => [
    tier,
    Object.fromEntries(
      Object.entries(zones).map(([zone, brackets]) => [
        zone,
        Object.fromEntries(Object.entries(brackets).map(([b, v]) => [b, scaleRate(v)])),
      ]),
    ),
  ]),
);

const DISCOUNT_BY_TIER = {
  "300x600": 20,
  "600x600": 25,
  "600x1200": 30,
  "600x1200hd": 25,
};

const PACKING = {
  "300x600": { tilesPerBox: 5, sqmPerBox: 0.9, weightKg: 17.5, boxesPerPallet: 60, coveragePerPalletM2: 54.0 },
  "600x600": { tilesPerBox: 4, sqmPerBox: 1.44, weightKg: 26.5, boxesPerPallet: 40, coveragePerPalletM2: 57.6 },
  "600x1200": { tilesPerBox: 2, sqmPerBox: 1.44, weightKg: 27.5, boxesPerPallet: 32, coveragePerPalletM2: 46.08 },
  "600x1200hd": { tilesPerBox: 2, sqmPerBox: 1.44, weightKg: 27.5, boxesPerPallet: 32, coveragePerPalletM2: 46.08 },
};

const TIER_SIZE_LABEL = {
  "300x600": "300 x 600mm",
  "600x600": "600 x 600mm",
  "600x1200": "600 x 1200mm",
  "600x1200hd": "600 x 1200mm (High Gloss)",
};

const PDF_FILES = {
  "300x600": "30X60 UK.pdf",
  "600x600": "60X60 UK.pdf",
  "600x1200": "60X120 UK.pdf",
  "600x1200hd": "60X120 UK.pdf",
};

// New categories to create under Tiles; 600x600 reuses the existing one.
const CATEGORY_DEFS = {
  "300x600": { name: "300x600 Tiles", slug: "300x600-tiles", existingId: null },
  "600x600": { name: "600x600 Tiles", slug: "600x600-tiles", existingId: EXISTING_600x600_CATEGORY_ID },
  "600x1200": { name: "600x1200 Tiles", slug: "600x1200-tiles", existingId: null },
  "600x1200hd": { name: "600x1200 Tiles", slug: "600x1200-tiles", existingId: null }, // shares the 600x1200 category
};

const TECHNICAL_SPEC = {
  standard: "ISO13006:2018 / EN14411 Gr.BIa",
  characteristics: [
    { name: "Deviation in Length & Width", standard: "±0.5%", porcious: "±0.2%", test: "ISO-10545-2" },
    { name: "Deviation in Thickness", standard: "±5.0%", porcious: "±4.0%", test: "ISO-10545-2" },
    { name: "Straightness of Side", standard: "±0.5%", porcious: "±0.15%", test: "ISO-10545-2" },
    { name: "Rectangularity", standard: "±0.6%", porcious: "±0.2%", test: "ISO-10545-2" },
    { name: "Surface Flatness", standard: "±0.5%", porcious: "±0.2%", test: "ISO-10545-2" },
    { name: "Colour Difference", standard: "Unaltered", porcious: "Slight variation possible between batches", test: "ISO-10545-16" },
    { name: "Glossiness", standard: "As per manufacturer", porcious: "Sharp", test: "Glossometer" },
    { name: "Water Absorption", standard: "< 0.5%", porcious: "< 0.5%", test: "ISO 10545-3" },
    { name: "Bulk Density", standard: "> 2.0 g/cc", porcious: "> 2.0 g/mm²", test: "DIN 51082" },
    { name: "Modulus of Rupture", standard: "Min. 35 N/mm²", porcious: "Min. 35 N/mm²", test: "ISO 10545-4" },
    { name: "Breaking Strength", standard: "Min. 1300 N", porcious: "Min. 1700 N", test: "ISO 10545-4" },
    { name: "Impact Resistance", standard: "As per manufacturer", porcious: "Min. 0.55", test: "ISO 10545-5" },
    { name: "Surface Abrasion Resistance", standard: "As per manufacturer", porcious: "Min. Class-4", test: "ISO 10545-7" },
    { name: "MOH's Hardness", standard: "As per manufacturer", porcious: "Min. 5", test: "EN 101" },
    { name: "Frost Resistance", standard: "No damage", porcious: "No damage", test: "ISO 10545-12" },
    { name: "Thermal Shock Resistance", standard: "No damage", porcious: "No damage", test: "ISO 10545-9" },
    { name: "Moisture Expansion", standard: "Nil", porcious: "0.1 (mm/3)", test: "ISO 10545-10" },
    { name: "Thermal Expansion (COE)", standard: "Max. 9.0x10-6", porcious: "Max. 6.5x10-6", test: "ISO 10545-8" },
    { name: "Crazing Resistance", standard: "As per manufacturer", porcious: "Min. 7 cycles", test: "ISO 10545-11" },
    { name: "Chemical Resistance", standard: "No damage", porcious: "No damage", test: "ISO 10545-13" },
    { name: "Stain Resistance", standard: "Resistant", porcious: "Resistant", test: "ISO 10545-14" },
  ],
};

const CARE_INSTRUCTIONS =
  "Install with a 2-3mm joint; fixes with a suitable bond adhesive/epoxy as for natural or engineered stone. " +
  "On kitchen tops keep a minimum 50mm clearance from the outer edge to any hole or groove. Edges can be machine- " +
  "or hand-finished; where polished, the straight edge should end in a chamfer of at least 1mm. After cutting, " +
  "wash with plenty of water and dry with a squeegee; a mild acid-based detergent removes fabrication dust. " +
  "After installation remove adhesive residue with a cloth dampened in acetone or solvent, then clean with water " +
  "and a neutral detergent using a sponge or damp cloth — never an abrasive sponge or detergent. For everyday " +
  "cleaning use hot water and a neutral detergent with a soft cloth, and wipe up spills (coffee, wine, oil) promptly.";

// --- 29 SKUs across 21 design folders ---
const PRODUCTS = [
  { code: "C004D-MT-060", tier: "300x600", finish: "Matt", folder: "1.1.CALCITE ANTRACITE-30X60 MATT", name: "Calcite Anthracite 30X60 Matt",
    description: "Glazed porcelain in a matt finish with a deep charcoal, stone-effect surface carrying fine natural veining. Reads as a grounding, contemporary anthracite — suited to feature walls, bathroom floors and hallways where a darker stone look is wanted without the cost or upkeep of real stone." },
  { code: "C003D-MT-060", tier: "300x600", finish: "Matt", folder: "1.2.CALCITE GREY-30X60 MATT", name: "Calcite Grey 30X60 Matt",
    description: "Glazed porcelain in a matt finish, cool mid-grey with soft stone veining running through the surface. A versatile neutral that works equally well as a kitchen splashback, bathroom wall or hallway floor." },
  { code: "C002D-MT-060", tier: "300x600", finish: "Matt", folder: "1.3.CALCITE SAND-30X60 MATT", name: "Calcite Sand 30X60 Matt",
    description: "Glazed porcelain in a matt finish, warm sand-beige stone-effect with subtle natural markings. Brings warmth to kitchens and living spaces and pairs well with timber and brass fittings." },
  { code: "R002D-GL-060", tier: "300x600", finish: "Glossy", folder: "2.ROCCO SILVER-30X60 GLOSSY", name: "Rocco Silver 30X60 Glossy",
    description: "Glazed porcelain in a high-shine glossy finish, pale silver-grey with a soft marble-effect surface. The reflective finish lifts light in smaller rooms — well suited to bathrooms, en-suites and splashbacks." },
  { code: "S001D-GL-060", tier: "300x600", finish: "Glossy", folder: "3.1.STATUARIO CARINA WHITE-30X60 GLOSSY & MATT", name: "Statuario Carina White 30X60 Glossy",
    description: "Glazed porcelain in a glossy finish, classic white Statuario marble-look with soft grey veining. A timeless, light-reflecting choice for bathrooms and kitchens wanting a marble aesthetic." },
  { code: "S001D-MT-060", tier: "300x600", finish: "Matt", folder: "3.1.STATUARIO CARINA WHITE-30X60 GLOSSY & MATT", name: "Statuario Carina White 30X60 Matt",
    description: "Glazed porcelain in a matt finish, classic white Statuario marble-look with soft grey veining. Same elegant marble character as the glossy variant, in a softer, non-reflective surface — well suited to larger floor areas." },

  { code: "S001B-GL-040", tier: "600x600", finish: "Glossy", folder: "3.2.STATUARIO CARINA WHITE-60X60-GLOSSY & MATT", name: "Statuario Carina White 60X60 Glossy",
    description: "Glazed porcelain, glossy, white Statuario marble-look with soft grey veining, in the larger 600x600 format for fewer grout lines across bigger floor areas." },
  { code: "S001B-MT-040", tier: "600x600", finish: "Matt", folder: "3.2.STATUARIO CARINA WHITE-60X60-GLOSSY & MATT", name: "Statuario Carina White 60X60 Matt",
    description: "Glazed porcelain, matt, white Statuario marble-look with soft grey veining, in the larger 600x600 format for fewer grout lines across bigger floor areas." },
  { code: "S002B-GL-040", tier: "600x600", finish: "Glossy", folder: "4.STATUARIO CARINA GOLD-60X60-GLOSSY & MATT", name: "Statuario Carina Gold 60X60 Glossy",
    description: "Glazed porcelain, glossy, white marble-effect ground threaded with warm gold veining. A statement finish for feature floors, hearths and bathroom walls." },
  { code: "S002B-MT-040", tier: "600x600", finish: "Matt", folder: "4.STATUARIO CARINA GOLD-60X60-GLOSSY & MATT", name: "Statuario Carina Gold 60X60 Matt",
    description: "Glazed porcelain, matt, white marble-effect ground threaded with warm gold veining. Same statement gold-veined marble look, softened in a non-reflective matt surface." },
  { code: "Q001B-MT-040", tier: "600x600", finish: "Matt", folder: "5.1.Quarzo Grey-60X60-MATT-60X60-MATT", name: "Quarzo Grey 60X60 Matt",
    description: "Glazed porcelain, matt, terrazzo-inspired grey ground with fine coloured fleck detailing. A contemporary alternative to solid stone, suited to kitchens, hallways and open-plan living." },
  { code: "Q002B-MT-040", tier: "600x600", finish: "Matt", folder: "5.2.Quarzo Grey Decor-60X60-MATT", name: "Quarzo Grey Décor 60X60 Matt",
    description: "Glazed porcelain, matt, the bolder decor companion to Quarzo Grey with larger, more prominent coloured chips on the same grey ground — designed to be mixed with the plain Quarzo Grey as a feature or border tile." },
  { code: "C001B-GL-040", tier: "600x600", finish: "Glossy", folder: "6.1.CONCEPT SILVER-60X60-MATT & GLOSSY", name: "Concept Silver 60X60 Glossy",
    description: "Glazed porcelain, glossy, understated silver-grey concrete-look surface. A quiet neutral base that works in almost any room." },
  { code: "C001B-MT-040", tier: "600x600", finish: "Matt", folder: "6.1.CONCEPT SILVER-60X60-MATT & GLOSSY", name: "Concept Silver 60X60 Matt",
    description: "Glazed porcelain, matt, understated silver-grey concrete-look surface. A quiet, non-reflective neutral base that works in almost any room." },
  { code: "G002B-AS-040", tier: "600x600", finish: "Anti-Slip R11", folder: "7.1.GLEM BIANCO-60X60-ANTISLIP R11", name: "Glem Bianco 60X60 Anti-Slip (R11)",
    description: "Glazed porcelain with an R11-rated anti-slip surface in a pale stone-effect finish. Engineered for wet or exterior areas — wetrooms, patios, commercial floors — where safe footing matters." },
  { code: "G001B-AS-040", tier: "600x600", finish: "Anti-Slip R11", folder: "7.2.GLEM GRIS-60X60-ANTISLIP R11", name: "Glem Gris 60X60 Anti-Slip (R11)",
    description: "Glazed porcelain with an R11-rated anti-slip surface in a warm grey stone-effect finish. Engineered for wet or exterior areas — wetrooms, patios, commercial floors — where safe footing matters." },

  { code: "C001C-GL-032", tier: "600x1200", finish: "Glossy", folder: "6.2.CONCEPT SILVER-60X120-GLOSSY & MATT", name: "Concept Silver 60X120 Glossy",
    description: "Glazed porcelain, glossy, understated silver-grey concrete-look surface, now in a large-format slab for a near-seamless floor with minimal grout lines." },
  { code: "C001C-MT-032", tier: "600x1200", finish: "Matt", folder: "6.2.CONCEPT SILVER-60X120-GLOSSY & MATT", name: "Concept Silver 60X120 Matt",
    description: "Glazed porcelain, matt, understated silver-grey concrete-look surface, now in a large-format slab for a near-seamless floor with minimal grout lines." },
  { code: "A001C-MT-032", tier: "600x1200", finish: "Matt", folder: "8.1.ARIA BIANCO-ARIA SILVER-60X120-MATT", name: "Aria Bianco 60X120 Matt",
    description: "Glazed porcelain, matt, soft off-white concrete-look large-format slab. Brings an airy, Scandinavian-influenced feel to open-plan living and bathroom floors." },
  { code: "A003C-MT-032", tier: "600x1200", finish: "Matt", folder: "8.2.ARIA SILVER-60X120-MATT", name: "Aria Silver 60X120 Matt",
    description: "Glazed porcelain, matt, mid-grey concrete-effect large-format slab. A calm, industrial-chic finish for floors and feature walls." },
  { code: "A002C-MT-032", tier: "600x1200", finish: "Matt", folder: "8.3.ARIA ANTHRACITE-ARIA SILVER-60X120-MATT", name: "Aria Anthracite 60X120 Matt",
    description: "Glazed porcelain, matt, deep charcoal concrete-look large-format slab. A striking, dark neutral for feature floors and walls." },
  { code: "S003C-GL-032", tier: "600x1200", finish: "Glossy", folder: "9.STATUARIO DALLAS SILVER-60X120-GLOSSY & MATT", name: "Statuario Dallas Silver 60X120 Glossy",
    description: "Glazed porcelain, glossy, large-format white Statuario marble-effect slab with fine grey veining, for a seamless luxury floor." },
  { code: "S003C-MT-032", tier: "600x1200", finish: "Matt", folder: "9.STATUARIO DALLAS SILVER-60X120-GLOSSY & MATT", name: "Statuario Dallas Silver 60X120 Matt",
    description: "Glazed porcelain, matt, large-format white Statuario marble-effect slab with fine grey veining, for a seamless luxury floor." },
  { code: "S004C-GL-032", tier: "600x1200", finish: "Glossy", folder: "10.STATUARIO DALLAS GOLD-60X120-GLOSSY & MATT", name: "Statuario Dallas Gold 60X120 Glossy",
    description: "Glazed porcelain, glossy, large-format white marble-effect slab with rich gold veining — a bold statement floor or feature wall." },
  { code: "S004C-MT-032", tier: "600x1200", finish: "Matt", folder: "10.STATUARIO DALLAS GOLD-60X120-GLOSSY & MATT", name: "Statuario Dallas Gold 60X120 Matt",
    description: "Glazed porcelain, matt, large-format white marble-effect slab with rich gold veining — a bold statement floor or feature wall." },
  { code: "B002C-GL-032", tier: "600x1200", finish: "Glossy", folder: "11.BORRA ONYX SILVER-60X120-GLOSSY & MATT", name: "Borra Onyx Silver 60X120 Glossy",
    description: "Glazed porcelain, glossy, pale onyx-effect large-format slab with soft crystalline veining, for elevated bathrooms and living spaces." },
  { code: "B002C-MT-032", tier: "600x1200", finish: "Matt", folder: "11.BORRA ONYX SILVER-60X120-GLOSSY & MATT", name: "Borra Onyx Silver 60X120 Matt",
    description: "Glazed porcelain, matt, pale onyx-effect large-format slab with soft crystalline veining, for elevated bathrooms and living spaces." },

  { code: "L001C-HG-032", tier: "600x1200hd", finish: "High Gloss", folder: "12.LEON MARQUINA BLACK-60X120-HIGH GLOSS", name: "Leon Marquina Black 60X120 High Gloss",
    description: "Glazed porcelain in a mirror-like high-gloss finish, dramatic black marble-effect ground with fine white veining. A large-format statement slab for feature floors and walls." },
  { code: "R001C-HG-032", tier: "600x1200hd", finish: "High Gloss", folder: "13.ROMANO BLACK-60X120-HIGH GLOSS", name: "Romano Black 60X120 High Gloss",
    description: "Glazed porcelain in a high-gloss finish, black marble-effect ground with warm gold-toned veining. A large-format statement slab suited to feature installations and luxury interiors." },
];

function pricingFor(tier) {
  const price = RATE_CARD[tier].zone1.upto20;
  const discount = DISCOUNT_BY_TIER[tier];
  const compareAtPrice = Math.round((price / (1 - discount / 100)) * 100) / 100;
  return { price, compareAtPrice, discount };
}

function listImages(folder) {
  const dir = path.join(IMAGE_ROOT, folder);
  if (!fs.existsSync(dir)) return null;
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .map((f) => path.join(dir, f));
}

async function ensureBrand(db) {
  const slug = "porcious";
  const existing = await db.collection("brands").findOne({ slug });
  if (existing) return existing._id;
  if (!APPLY) return "PREVIEW-BRAND-ID";
  const res = await db.collection("brands").insertOne({
    name: "Porcious",
    uiName: "Porcious",
    slug,
    order: 0,
    isActive: true,
    image: "",
    subBrands: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return res.insertedId;
}

async function ensureCategory(db, tier) {
  const def = CATEGORY_DEFS[tier];
  if (def.existingId) return def.existingId;
  const existing = await db
    .collection("menus")
    .findOne({ slug: def.slug, department: TILES_DEPARTMENT_ID });
  if (existing) return existing._id;
  if (!APPLY) return `PREVIEW-CATEGORY-${def.slug}`;
  const res = await db.collection("menus").insertOne({
    name: def.name,
    slug: def.slug,
    parent: null,
    order: 0,
    isActive: true,
    image: "",
    brand: null,
    subBrand: "",
    subBrands: [],
    department: TILES_DEPARTMENT_ID,
    level: "category",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return res.insertedId;
}

async function uploadTierPdf(tier, cache) {
  // Descoped: this Cloudinary account has a hard 10MB raw-file cap and these
  // PDFs are 22-46MB — chunked upload can't get past an account-level limit.
  // Decision: skip PDF hosting entirely, products ship without a datasheet link.
  return null;
  // eslint-disable-next-line no-unreachable
  const filename = PDF_FILES[tier];
  if (cache.has(filename)) return cache.get(filename);
  const filePath = path.join(PDF_ROOT, filename);
  if (!fs.existsSync(filePath)) {
    cache.set(filename, null);
    return null;
  }
  if (!APPLY) {
    const url = `PREVIEW-PDF-URL(${filename})`;
    cache.set(filename, url);
    return url;
  }
  // Files are 22-46MB, well over this account's 10MB single-request raw-upload
  // cap — upload_large chunks the request (default 20MB/chunk) to get around it.
  // NOTE: upload_large only resolves as a Promise when given no callback in
  // some SDK versions but not others — pass an explicit callback and wrap it
  // ourselves so this never silently resolves to a non-result.
  try {
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_large(
        filePath,
        {
          resource_type: "raw",
          folder: "linx-living/documents/porcious-tiles",
          public_id: filename.replace(/\.pdf$/i, "").replace(/\s+/g, "-").toLowerCase(),
          overwrite: false,
          chunk_size: 6000000,
        },
        (error, res) => (error ? reject(error) : resolve(res)),
      );
    });
    if (!result || !result.secure_url) throw new Error("upload_large returned no secure_url");
    cache.set(filename, result.secure_url);
    return result.secure_url;
  } catch (e) {
    console.error(`WARNING: PDF upload failed for ${filename} (${e.message}) — continuing without it.`);
    cache.set(filename, null);
    return null;
  }
}

async function uploadImages(files) {
  if (!APPLY) return files.map((f) => `PREVIEW-IMG-URL(${path.basename(f)})`);
  const urls = [];
  for (const filePath of files) {
    try {
      const result = await cloudinary.uploader.upload(filePath, {
        folder: "linx-living/products/porcious-tiles",
        overwrite: false,
      });
      urls.push(result.secure_url);
    } catch (e) {
      console.error(`WARNING: image upload failed for ${path.basename(filePath)} (${e.message}) — skipping it.`);
    }
  }
  return urls;
}

async function main() {
  console.log(APPLY ? "*** APPLY MODE — writing to live DB + Cloudinary ***" : "DRY RUN — no writes, no uploads. Pass --apply to write.");
  console.log(`Zone (card default): ${ZONE}`);

  const conn = await connectMongo();
  const db = conn.db;

  const brandId = await ensureBrand(db);
  const categoryIds = {};
  for (const tier of Object.keys(CATEGORY_DEFS)) {
    categoryIds[tier] = await ensureCategory(db, tier);
  }

  const pdfCache = new Map();
  const rows = [];
  let missing = 0;

  for (const p of PRODUCTS) {
    const files = listImages(p.folder);
    if (!files || files.length === 0) {
      console.error(`MISSING IMAGES for ${p.name} (${p.code}) — folder: ${p.folder}`);
      missing++;
      continue;
    }

    const existing = await db.collection("products").findOne({
      $or: [{ supplierSku: p.code }, { linxSku: p.code }],
    });
    if (existing) {
      console.log(`SKIP (already exists): ${p.name} (${p.code})`);
      continue;
    }

    const { price, compareAtPrice, discount } = pricingFor(p.tier);
    const packing = PACKING[p.tier];
    const pdfUrl = await uploadTierPdf(p.tier, pdfCache);
    const imageUrls = await uploadImages(files);

    const stock = 800 + Math.floor(Math.random() * 201); // 800-1000 inclusive

    const doc = {
      name: p.name,
      description:
        `${p.description}` +
        (pdfUrl ? ` Full technical & pricing datasheet: ${pdfUrl}` : ""),
      shortDescription: p.description,
      price,
      images: imageUrls,
      department: "tiles",
      category: CATEGORY_DEFS[p.tier].slug,
      subCategory: p.finish,
      brand: brandId,
      brands: [brandId],
      supplierSku: p.code,
      linxSku: p.code,
      productCode: p.code,
      stock,
      stockStatus: "in_stock",
      isOutOfStock: false,
      vatRate: 20,
      downloads: pdfUrl
        ? [{ label: `${TIER_SIZE_LABEL[p.tier]} Pricing & Delivery Zones`, url: pdfUrl }]
        : [],
      specs: {
        size: TIER_SIZE_LABEL[p.tier],
        finish: p.finish,
        unit: "per m2",
        pricePerM2: price,
        sqmPerBox: packing.sqmPerBox,
        tilesPerBox: packing.tilesPerBox,
        tilesPerSqm: Math.round((packing.tilesPerBox / packing.sqmPerBox) * 100) / 100,
        boxWeightKg: packing.weightKg,
        boxesPerPallet: packing.boxesPerPallet,
        coveragePerPalletM2: packing.coveragePerPalletM2,
        compareAtPrice,
        salePercent: discount,
        salePriceMode: "raise-was-keep-price",
        saleOriginalPrice: price,
        minimumOrderM2: MINIMUM_ORDER_M2,
        minimumOrderBoxes: Math.ceil(MINIMUM_ORDER_M2 / packing.sqmPerBox),
        deliveryZoneDefault: ZONE,
        zonePricing: RATE_CARD[p.tier],
        technicalSpecification: TECHNICAL_SPEC,
        careInstructions: CARE_INSTRUCTIONS,
        datasheetUrl: pdfUrl,
        manufacturer: "Porcious UK Ltd",
        material: "Glazed porcelain",
      },
      showSpecs: true,
    };

    rows.push({ doc, imageCount: files.length });

    if (APPLY) {
      await db.collection("products").insertOne(doc);
      console.log(`INSERTED: ${p.name} (${p.code})`);
    } else {
      console.log(
        `PREVIEW: ${p.name} | ${p.code} | category=${doc.category} | now £${price}/m² | was £${compareAtPrice}/m² | ${discount}% OFF | min order=${MINIMUM_ORDER_M2}m² (${doc.specs.minimumOrderBoxes} boxes) | stock=${stock} | images=${files.length}`,
      );
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Products processed: ${rows.length} / ${PRODUCTS.length}`);
  if (missing) console.log(`Missing image folders: ${missing}`);
  console.log(`Brand: Porcious (${brandId})`);
  console.log("Categories:", categoryIds);
  if (!APPLY) console.log("\nNo writes were made. Re-run with --apply to write to the live DB and upload to Cloudinary.");

  await conn.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e.message, e.stack);
  process.exit(1);
});
