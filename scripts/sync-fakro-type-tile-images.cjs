/**
 * Set Fakro subcategory menu images to the exact Linx Glass type-tile packshots
 * (local /fakro-products/* assets + Glass scale crop for FTP-V/FPP-V/FYP-V/FGH-V).
 *
 * Usage: node scripts/sync-fakro-type-tile-images.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");
const { assetUrl } = require("./cloudinary-assets.cjs");

const DRY = process.argv.includes("--dry");

/**
 * Exact Glass "Shop by type" thumbnails for Fakro pitched types.
 * Packshots originally lived in linxglazing/public/fakro-products and were copied
 * into this repo's public/; they are now on Cloudinary, since public/ is not
 * committed and local paths 404 in production. `assetUrl` maps old path -> URL.
 * FTP-V / FPP-V / FYP-V / FGH-V rely on scale-[4] in ShopBySubcategory (same as Glass Shop.tsx).
 */
const TYPE_TILE_IMAGES = {
  // Pitched — match Linx Glass TypeTile sources (packshots + Glass zoom rules)
  "pitched-roof-windows/centre-pivot": assetUrl("/fakro-products/FTT-U8_01.jpeg"),
  "pitched-roof-windows/top-hung": assetUrl("/fakro-products/FPP-V_01.jpeg"),
  "pitched-roof-windows/electric-solar": assetUrl("/fakro-products/FTP-V_01.jpg"),
  "pitched-roof-windows/conservation": assetUrl("/fakro-products/FTW-V_01.jpg"),
  "pitched-roof-windows/high-pivot": assetUrl("/fakro-products/FYP-V_01.jpg"),
  "pitched-roof-windows/balcony": assetUrl("/fakro-products/FGH-V_01.jpeg"),
  "pitched-roof-windows/l-shape-combination": assetUrl("/fakro-products/BDL_01.jpg"),
  // Glass light-tunnel tile uses SFS packshot (FAKRO logo), not the long SRS tube
  "pitched-roof-windows/light-tunnels": assetUrl("/fakro-products/SFS_01.jpg"),
  "pitched-roof-windows/electricals": assetUrl("/fakro-products/ZWS12_01.jpg"),
  "pitched-roof-windows/flashing-kits": assetUrl("/fakro-products/EKB-S_01.jpg"),

  // Flat (Glass uses product / type covers; packshots where we have them)
  "flat-roof-windows/electric-opening": assetUrl("/fakro-products/DEF-D_01.jpeg"),
  "flat-roof-windows/roof-access":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1783542993/linx-products/linx-products/fakro/WGT_01.jpg",
  "flat-roof-windows/dome":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784750289/linx-products/cambridge-gallery/cambridge/80BC01/gallery-1.png",
  "flat-roof-windows/fixed-frameless":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784750301/linx-products/cambridge-gallery/cambridge/80EU03/gallery-1.png",
  "flat-roof-windows/manual-opening":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784750577/linx-products/cambridge-gallery/cambridge/80EW01/gallery-1.png",
  "flat-roof-windows/walk-on":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784750983/linx-products/cambridge-gallery/cambridge/80EM01/gallery-1.png",

  // Blinds
  "blinds-accessories/blinds": assetUrl("/fakro-products/ARS-I_01.jpg"),
  "blinds-accessories/accessories": assetUrl("/fakro-products/XDP_01.jpg"),

  // Loft ladders — Glass admin type covers
  "loft-ladders/wooden":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784881195/linx-products/loft-ladders/type-wooden.png",
  "loft-ladders/metal":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784881198/linx-products/loft-ladders/type-metal.png",
  "loft-ladders/scissor":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784881201/linx-products/loft-ladders/type-scissor.png",
};

(async () => {
  console.log(DRY ? "DRY RUN" : "WRITE");
  await connectMongo();
  const db = require("mongoose").connection.db;
  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  if (!brand) throw new Error("FAKRO brand missing");

  const parents = await db
    .collection("menus")
    .find({ brand: brand._id, parent: null })
    .toArray();
  const parentBySlug = Object.fromEntries(parents.map((p) => [p.slug, p]));

  let updated = 0;
  for (const [key, image] of Object.entries(TYPE_TILE_IMAGES)) {
    const [parentSlug, typeSlug] = key.split("/");
    const parent = parentBySlug[parentSlug];
    if (!parent) {
      console.warn("missing parent", parentSlug);
      continue;
    }
    const menus = await db
      .collection("menus")
      .find({ brand: brand._id, parent: parent._id, slug: typeSlug })
      .toArray();
    if (!menus.length) {
      console.warn("missing menu", key);
      continue;
    }
    for (const menu of menus) {
      if (menu.image === image) {
        console.log("same", key);
        continue;
      }
      console.log(`update ${key}\n  was ${menu.image || "(empty)"}\n  now ${image}`);
      if (!DRY) {
        await db.collection("menus").updateOne(
          { _id: menu._id },
          { $set: { image, updatedAt: new Date() } },
        );
      }
      updated++;
    }
  }

  console.log(`\n${DRY ? "Would update" : "Updated"} ${updated}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
