/**
 * Four UFHS products carry the site's page furniture instead of a product shot.
 *
 * `restore-ufhs-missing-images.cjs` was pointed at products whose gallery is
 * empty on theunderfloorheatingstore.com. With no gallery to read it fell back
 * to whatever <img> the page carried, so all four ended up with the *same*
 * eight files, byte for byte: a 1204x630 banner, a few 621x377 content strips
 * and two 32x43 payment icons. The source still publishes no photograph for
 * any of them, so there is nothing to re-pull — the gallery belongs empty.
 *
 * Removes the mirrored media from Shopify and clears the Mongo galleries. The
 * Cloudinary staging copies are left in place; the rollback file names them.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-ufhs-page-furniture-images.cjs
 *
 *   DRY=1                  report only, change nothing
 *   ROLLBACK=<file>        restore images/shopifyImages from a previous run
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY = process.env.DRY === "1";
const ROLLBACK_FILE = process.env.ROLLBACK || "";
const BRAND_ID = "6a722de4958ec684cd75f123";

const HANDLES = [
  "warmup-perimeter-expansion-strip-8mm-x-150mm-x-25m",
  "grundfos-upm3-auto-pump",
  "thermaskirt-installation-spares-kit",
  "thermaskirt-cleanser-and-inhibitor-kit",
];

/**
 * The furniture, by byte length. Every one of the four holds exactly this set,
 * which is what identifies it as page chrome rather than a product photograph:
 * a gallery scraped per product would not repeat byte for byte across four
 * unrelated lines. Guarding on it means a product whose images have since been
 * corrected is left alone.
 */
const FURNITURE_SIZES = [525443, 163347, 157195, 178116, 482, 297693, 528, 260106];

async function sizeOf(url) {
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return -1;
    return Number(res.headers.get("content-length") || -1);
  } catch {
    return -1;
  }
}

async function deleteShopifyMedia(productId, mediaIds) {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  try {
    const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
    const data = await shopifyAdminRequest(
      `
      mutation DeleteProductMedia($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          deletedMediaIds
          userErrors { field message }
        }
      }
    `,
      { productId, mediaIds },
    );
    const errs = data.productDeleteMedia?.userErrors || [];
    if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
    return (data.productDeleteMedia?.deletedMediaIds || []).length;
  } finally {
    unregister();
  }
}

/** Every media node on the product, so nothing mirrored earlier is left behind. */
async function liveMediaIds(productId) {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  try {
    const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
    const data = await shopifyAdminRequest(
      `query($id: ID!) { product(id: $id) { media(first: 50) { nodes { id ... on MediaImage { image { url } } } } } }`,
      { id: productId },
    );
    return (data.product?.media?.nodes || []).map((n) => n.id);
  } finally {
    unregister();
  }
}

async function restore(products) {
  const data = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
  for (const p of data.products || []) {
    await products.updateOne(
      { _id: new mongoose.Types.ObjectId(p.id) },
      { $set: { images: p.images, shopifyImages: p.shopifyImages, updatedAt: new Date() } },
    );
    console.log("  restored " + p.name + " (" + p.images.length + " image(s) in Mongo)");
  }
  console.log("\nMongo restored. Shopify media was deleted and is not recreated here — a");
  console.log("normal product sync re-uploads from the Cloudinary URLs now back in place.");
}

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const products = db.collection("products");

  if (ROLLBACK_FILE) return restore(products);

  const docs = await products
    .find(
      { brand: new mongoose.Types.ObjectId(BRAND_ID), "specs.ufhsHandle": { $in: HANDLES } },
      { projection: { name: 1, images: 1, shopifyImages: 1, shopifyProductId: 1, specs: 1 } },
    )
    .toArray();

  if (docs.length !== HANDLES.length) {
    console.log("! expected " + HANDLES.length + " products, found " + docs.length);
  }

  const rollback = [];
  let mediaDeleted = 0;

  for (const doc of docs) {
    const imgs = (doc.images || []).filter(Boolean);
    console.log("\n" + doc.name);
    console.log("  handle: " + doc.specs.ufhsHandle + "  images: " + imgs.length);

    const sizes = [];
    for (const u of imgs) sizes.push(await sizeOf(u));
    const isFurniture =
      sizes.length === FURNITURE_SIZES.length &&
      [...sizes].sort((a, b) => a - b).join(",") ===
        [...FURNITURE_SIZES].sort((a, b) => a - b).join(",");

    if (!isFurniture) {
      console.log("  · gallery no longer matches the furniture set — left untouched");
      console.log("    sizes: " + sizes.join(", "));
      continue;
    }
    console.log("  · confirmed page furniture (" + sizes.join("B, ") + "B)");

    if (DRY) {
      console.log("  · DRY: would clear " + imgs.length + " image(s) and their Shopify media");
      continue;
    }

    rollback.push({
      id: String(doc._id),
      name: doc.name,
      handle: doc.specs.ufhsHandle,
      shopifyProductId: doc.shopifyProductId || null,
      images: imgs,
      shopifyImages: doc.shopifyImages || [],
    });

    if (doc.shopifyProductId) {
      const ids = await liveMediaIds(doc.shopifyProductId);
      if (ids.length) {
        const n = await deleteShopifyMedia(doc.shopifyProductId, ids);
        mediaDeleted += n;
        console.log("  · deleted " + n + " Shopify media");
      } else {
        console.log("  · no Shopify media to delete");
      }
    }

    await products.updateOne(
      { _id: doc._id },
      {
        $set: {
          images: [],
          shopifyImages: [],
          "specs.imagesNote":
            "No photograph published for this product on theunderfloorheatingstore.com. A restore run had filled the gallery with the site's own page furniture (banner and payment icons), identical across four products; removed 2026-09-03.",
          "specs.imagesUnavailable": true,
          "specs.imagesRefreshedAt": new Date().toISOString(),
          shopifySyncedAt: new Date(),
          shopifySyncError: "",
          updatedAt: new Date(),
        },
      },
    );
    console.log("  · Mongo gallery cleared");
  }

  if (rollback.length) {
    const file = path.join(
      __dirname,
      "..",
      "rollback-ufhs-page-furniture-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json",
    );
    fs.writeFileSync(
      file,
      JSON.stringify({ clearedAt: new Date().toISOString(), products: rollback }, null, 2),
    );
    console.log("\nrollback: " + path.basename(file));
  }
  console.log(
    "\nproducts cleared: " + rollback.length + "   Shopify media deleted: " + mediaDeleted,
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
