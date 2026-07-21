/**
 * Import Linx Trade categories + products from a local Dropbox extract
 * (Britmet Lightweight Roofing shared folder).
 *
 * 1) Download the Dropbox folder (browser Download button is fastest for multi-GB):
 *    https://www.dropbox.com/scl/fo/5rtby5ut5jrzszozcna2n/AOZrb7xtiu8eSH3fN0C4ml4?rlkey=09u4gwtznkyn2msri1fdgqq7f&dl=1
 * 2) Extract into: tmp/britmet-dropbox/extracted
 * 3) Run:
 *    node --require ./scripts/mongo-dns.cjs scripts/import-linx-trade-dropbox.cjs
 *
 * Optional:
 *    DROPBOX_EXTRACT_DIR=D:\path\to\extracted
 *    DRY_RUN=1
 *    MAX_PRODUCTS_PER_CATEGORY=40
 *    MAX_IMAGES_PER_PRODUCT=6
 *    SKIP_MARKETING=1 (default)
 */
const path = require("path");
const fs = require("fs");
const dns = require("dns");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

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

const EXTRACT_DIR =
  process.env.DROPBOX_EXTRACT_DIR ||
  path.join(__dirname, "..", "tmp", "britmet-dropbox", "extracted");
const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_MARKETING = process.env.SKIP_MARKETING !== "0";
const MAX_PRODUCTS_PER_CATEGORY = Number(
  process.env.MAX_PRODUCTS_PER_CATEGORY || 40,
);
const MAX_IMAGES_PER_PRODUCT = Number(process.env.MAX_IMAGES_PER_PRODUCT || 6);
const DEFAULT_PRICE = Number(process.env.DEFAULT_PRICE || 0);
const DEFAULT_STOCK = Number(process.env.DEFAULT_STOCK || 25);

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".tif",
  ".tiff",
  ".bmp",
]);
const SKIP_NAME_RE =
  /marketing|brochure|datasheet|tech(?:nical)?|install|warranty|pdf|thumb|icon|logo|desktop\.ini|__macosx|\.ds_store/i;

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanFolderName(name) {
  return String(name)
    .replace(/^\d+[\.\-\_\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isImageFile(filePath) {
  return IMAGE_EXT.has(path.extname(filePath).toLowerCase());
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => !SKIP_NAME_RE.test(n) && !n.startsWith("."))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function collectImages(dir, acc = [], depth = 0) {
  if (depth > 4 || acc.length >= 80) return acc;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_NAME_RE.test(entry.name)) continue;
      collectImages(full, acc, depth + 1);
    } else if (entry.isFile() && isImageFile(full) && !SKIP_NAME_RE.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Build category → products map from Dropbox extract.
 *
 * Supported layouts:
 * A) Category / ProductName / image.jpg
 * B) Category / image.jpg  (each image becomes a product)
 * C) Category / Colour / image.jpg (colour treated as product)
 */
function discoverCatalog(root) {
  const categories = [];
  const topDirs = listDirs(root);

  // Sometimes zip extracts with a single wrapper folder
  const effectiveRoot =
    topDirs.length === 1 &&
    /britmet|lightweight|roofing|commodity/i.test(topDirs[0])
      ? path.join(root, topDirs[0])
      : root;

  for (const dirName of listDirs(effectiveRoot)) {
    const cleaned = cleanFolderName(dirName);
    if (SKIP_MARKETING && /marketing|brochure|pr\b|press/i.test(cleaned)) {
      console.log(`  skip marketing: ${dirName}`);
      continue;
    }

    const categoryPath = path.join(effectiveRoot, dirName);
    const childDirs = listDirs(categoryPath);
    const products = [];

    if (childDirs.length > 0) {
      for (const child of childDirs.slice(0, MAX_PRODUCTS_PER_CATEGORY)) {
        const productPath = path.join(categoryPath, child);
        const images = collectImages(productPath).slice(0, MAX_IMAGES_PER_PRODUCT);
        if (!images.length) continue;
        products.push({
          name: cleanFolderName(child),
          images,
        });
      }
    }

    // Flat images under category
    if (!products.length) {
      const flatImages = collectImages(categoryPath, [], 1).filter((img) => {
        // only direct-ish files: depth already limited; keep unique basenames
        return path.dirname(img) === categoryPath;
      });
      const images =
        flatImages.length > 0
          ? flatImages
          : collectImages(categoryPath).slice(0, MAX_PRODUCTS_PER_CATEGORY);

      for (const img of images.slice(0, MAX_PRODUCTS_PER_CATEGORY)) {
        const base = path.basename(img, path.extname(img));
        products.push({
          name: cleanFolderName(base).replace(/[_-]+/g, " "),
          images: [img],
        });
      }
    }

    if (!products.length) {
      console.log(`  skip empty category: ${dirName}`);
      continue;
    }

    categories.push({
      name: cleaned,
      slug: slugify(cleaned),
      folder: dirName,
      products,
    });
  }

  return categories;
}

function uploadImage(filePath, publicId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        folder: "linx-living/products/linx-trade",
        public_id: publicId,
        overwrite: true,
        resource_type: "image",
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result.secure_url);
      },
    );
  });
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: "linx-trade" });
  if (!brand) {
    const now = new Date();
    const insert = {
      name: "LINX TRADE",
      slug: "linx-trade",
      order: 3,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    const result = await brands.insertOne(insert);
    brand = { ...insert, _id: result.insertedId };
    console.log("Created brand LINX TRADE");
  } else {
    console.log(`Using brand: ${brand.name} (${brand._id})`);
  }
  return brand;
}

async function ensureCategoryMenu(db, brandId, category, order) {
  const menus = db.collection("menus");
  let menu = await menus.findOne({ slug: category.slug, parent: null });
  const now = new Date();
  if (!menu) {
    const insert = {
      name: category.name,
      slug: category.slug,
      parent: null,
      brand: brandId,
      order,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    if (!DRY_RUN) {
      const result = await menus.insertOne(insert);
      menu = { ...insert, _id: result.insertedId };
    } else {
      menu = { ...insert, _id: "dry-run" };
    }
    console.log(`  + category: ${category.name}`);
  } else {
    if (!DRY_RUN) {
      await menus.updateOne(
        { _id: menu._id },
        {
          $set: {
            name: category.name,
            brand: brandId,
            isActive: true,
            updatedAt: now,
          },
        },
      );
    }
    console.log(`  · category exists: ${category.name}`);
  }
  return menu;
}

async function upsertProduct(db, product, categorySlug, imageUrls) {
  const products = db.collection("products");
  const now = new Date();
  const existing = await products.findOne({
    name: product.name,
    category: categorySlug,
  });

  const description =
    product.name +
    " — Linx Trade lightweight roofing range. Contact us for trade pricing and specification.";

  const doc = {
    name: product.name,
    description,
    price: existing?.price ?? DEFAULT_PRICE,
    stock: existing?.stock ?? DEFAULT_STOCK,
    category: categorySlug,
    subCategory: "",
    brand: undefined, // set by caller
    images: imageUrls,
    tagline: "Linx Trade",
    schematicImage: "",
    specs: {
      Brand: "Linx Trade",
      Range: categorySlug,
      Source: "Dropbox import",
    },
    showSpecs: true,
    updatedAt: now,
  };

  return { existing, doc };
}

async function main() {
  if (
    !process.env.MONGODB_URI ||
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("Missing MongoDB or Cloudinary env vars");
  }

  if (!fs.existsSync(EXTRACT_DIR)) {
    throw new Error(
      `Extract folder not found:\n  ${EXTRACT_DIR}\n\nDownload & extract the Dropbox folder there, then re-run.`,
    );
  }

  console.log("Scanning:", EXTRACT_DIR);
  const catalog = discoverCatalog(EXTRACT_DIR);
  console.log(
    `Found ${catalog.length} categories, ${catalog.reduce((n, c) => n + c.products.length, 0)} products`,
  );
  for (const c of catalog) {
    console.log(`  - ${c.name}: ${c.products.length} products`);
  }

  if (!catalog.length) {
    throw new Error("No categories/products discovered in extract folder");
  }

  if (DRY_RUN) {
    console.log("DRY_RUN=1 — not writing to DB / Cloudinary");
    return;
  }

  console.log("Connecting MongoDB…");
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  let created = 0;
  let updated = 0;
  let uploaded = 0;
  let failedImages = 0;

  for (let i = 0; i < catalog.length; i++) {
    const category = catalog[i];
    console.log(`\nCategory: ${category.name}`);
    const menu = await ensureCategoryMenu(db, brand._id, category, 100 + i);

    // Set category cover from first product image if empty
    if (category.products[0]?.images?.[0] && !menu.image) {
      try {
        const coverUrl = await uploadImage(
          category.products[0].images[0],
          `menu-${category.slug}-cover`,
        );
        await db.collection("menus").updateOne(
          { _id: menu._id },
          { $set: { image: coverUrl, updatedAt: new Date() } },
        );
        uploaded++;
      } catch (err) {
        console.log(`  cover upload failed: ${err.message}`);
        failedImages++;
      }
    }

    for (const product of category.products) {
      const imageUrls = [];
      for (let j = 0; j < product.images.length; j++) {
        const file = product.images[j];
        const publicId = `${category.slug}-${slugify(product.name)}-${j + 1}`;
        try {
          const url = await uploadImage(file, publicId);
          imageUrls.push(url);
          uploaded++;
          process.stdout.write(".");
        } catch (err) {
          failedImages++;
          console.log(`\n  image fail ${path.basename(file)}: ${err.message}`);
        }
      }
      if (!imageUrls.length) continue;

      const { existing, doc } = await upsertProduct(
        db,
        product,
        category.slug,
        imageUrls,
      );
      doc.brand = brand._id;

      if (existing) {
        await productsCol.updateOne(
          { _id: existing._id },
          {
            $set: {
              ...doc,
              price: existing.price || doc.price,
              stock: existing.stock || doc.stock,
            },
          },
        );
        updated++;
      } else {
        await productsCol.insertOne({ ...doc, createdAt: new Date() });
        created++;
      }
    }
    console.log("");
  }

  console.log("\nDone.");
  console.log(`  products created: ${created}`);
  console.log(`  products updated: ${updated}`);
  console.log(`  images uploaded:  ${uploaded}`);
  console.log(`  image failures:   ${failedImages}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
