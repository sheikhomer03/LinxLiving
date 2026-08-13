/**
 * One-off import: 5 named accessory products from
 * https://cambridgeskylights.co.uk into the Accessories department.
 *
 * Pricing (matches the sitewide "raise-was-keep-price" convention already
 * used by scripts/apply-safe-discounts.cjs — see that file for why the
 * charged price is never derived from the discount):
 *   price (charged)      = sourcePrice * 1.05
 *   discountPercent      = random integer 20-30
 *   specs.compareAtPrice = price / (1 - discountPercent / 100)   ("was")
 *   specs.salePercent    = discountPercent
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/import-cambridge-accessories.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/import-cambridge-accessories.cjs --apply
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

const BASE = "https://cambridgeskylights.co.uk";
const BRAND_NAME = "Cambridge Skylights";
const BRAND_SLUG = "cambridge-skylights";
const SOURCE_TAG = "cambridge-skylights";
const CLOUDINARY_FOLDER = "linx-living/products/accessories";
const APPLY = process.argv.includes("--apply");

const TARGETS = [
  {
    handle: "percenta-nano-coating-for-facade-glasses-and-glass-windows-100ml",
    category: "adhesive-grout-silicone",
  },
  {
    handle: "structural-glazing-spacer-tape-6mm-thick-x-15mm-wide-x-10m",
    category: "adhesive-grout-silicone",
  },
  {
    handle: "dow-corning-dowsil-895-structural-glazing",
    category: "adhesive-grout-silicone",
  },
  {
    handle: "dow-corning-dowsil-791-weather-proofing",
    category: "adhesive-grout-silicone",
  },
  {
    handle: "fitters-pack-1",
    category: "installation-materials",
  },
];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function absUrl(src) {
  if (!src) return "";
  if (/^https?:/i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  return `${BASE}${src.startsWith("/") ? "" : "/"}${src}`;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

async function fetchProductJs(handle) {
  const res = await fetch(`${BASE}/products/${handle}.js`, {
    headers: { "User-Agent": "Mozilla/5.0 LinxAccessoriesImport/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${handle}`);
  return res.json();
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = absUrl(imageUrl).split("?")[0];
  if (!clean) return "";
  if (!APPLY) return clean; // dry run — keep the source URL for review
  const result = await cloudinary.uploader.upload(clean, {
    folder: CLOUDINARY_FOLDER,
    public_id: String(publicId).slice(0, 180),
    overwrite: true,
    resource_type: "image",
  });
  return result.secure_url || clean;
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  const existing = await brands.findOne({ slug: BRAND_SLUG });
  if (existing) return existing._id;
  if (!APPLY) return "DRY-RUN-BRAND-ID";
  const now = new Date();
  const result = await brands.insertOne({
    name: BRAND_NAME,
    slug: BRAND_SLUG,
    order: 0,
    isActive: true,
    image: "",
    uiName: "Linx Square",
    createdAt: now,
    updatedAt: now,
  });
  return result.insertedId;
}

async function main() {
  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  const brandId = await ensureBrand(db);
  console.log(`Brand: ${BRAND_NAME} (${brandId})`);

  const results = [];

  for (const target of TARGETS) {
    try {
      const existing = await productsCol.findOne({
        "specs.sourceUrl": `${BASE}/products/${target.handle}`,
      });
      if (existing) {
        console.log(`SKIP (already imported): ${target.handle} -> ${existing._id}`);
        results.push({
          handle: target.handle,
          skipped: true,
          id: String(existing._id),
        });
        continue;
      }

      const productJs = await fetchProductJs(target.handle);

      const sourcePrice = Number(productJs.price || 0) / 100;
      const price = round2(sourcePrice * 1.05);
      const discountPercent = randomInt(20, 30);
      const compareAtPrice = round2(price / (1 - discountPercent / 100));
      const stock = randomInt(300, 500);

      const images = [];
      for (let i = 0; i < (productJs.images || []).length; i++) {
        const uploaded = await uploadRemoteImage(
          productJs.images[i],
          `${slugify(target.handle)}-${i + 1}`,
        );
        if (uploaded) images.push(uploaded);
      }

      const description =
        String(productJs.description || "")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .trim() || `${productJs.title} from Cambridge Skylights.`;

      const now = new Date();
      const doc = {
        name: productJs.title,
        description: description.slice(0, 50000),
        price,
        images,
        department: "accessories",
        category: target.category,
        subCategory: "",
        brand: brandId,
        stock,
        stockStatus: "in_stock",
        manufacturerSku: String(productJs.variants?.[0]?.sku || ""),
        productCode: String(productJs.variants?.[0]?.sku || ""),
        specs: {
          source: SOURCE_TAG,
          sourceUrl: `${BASE}/products/${target.handle}`,
          sourceType: productJs.type || "",
          sourceVendor: productJs.vendor || "",
          compareAtPrice,
          salePercent: discountPercent,
          salePriceMode: "raise-was-keep-price",
          saleOriginalPrice: price,
          saleAppliedAt: now.toISOString(),
        },
        showSpecs: true,
        createdAt: now,
        updatedAt: now,
      };

      if (!APPLY) {
        console.log(
          `[dry create] ${doc.name} price=£${price} was=£${compareAtPrice} (${discountPercent}% off) stock=${stock} images=${images.length}`,
        );
        results.push({ handle: target.handle, dryRun: true, ...doc });
        continue;
      }

      const result = await productsCol.insertOne(doc);
      console.log(
        `+ created ${doc.name} (${result.insertedId}) price=£${price} was=£${compareAtPrice} (${discountPercent}% off) stock=${stock} images=${images.length}`,
      );
      results.push({
        handle: target.handle,
        id: String(result.insertedId),
        name: doc.name,
        price,
        compareAtPrice,
        discountPercent,
        stock,
      });
    } catch (e) {
      console.error(`✗ ${target.handle}: ${e.message}`);
      results.push({ handle: target.handle, error: e.message });
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
