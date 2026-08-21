/**
 * Bake Linx Glass TypeTile thumbs (object-cover + scale-[4] center crop)
 * into fixed 128px PNGs so Living doesn't depend on CSS scale quirks.
 *
 * Tiles are baked into public/fakro-products/tiles, uploaded to Cloudinary, and
 * the Fakro subcategory menus point at the Cloudinary URL — public/ is not
 * committed, so a local /fakro-products/tiles/*.png path 404s in production.
 *
 * Usage: node scripts/bake-fakro-type-tiles.cjs
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");
const { uploadPublicFile } = require("./cloudinary-assets.cjs");

const ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(ROOT, "linxglazing", "public", "fakro-products");
const OUT_DIR = path.join(ROOT, "public", "fakro-products", "tiles");

/**
 * Glass TypeTile mapping for pitched types.
 * zoom4 = same as Shop.tsx scale-[4] for FTP-V|FPP-V|FYP-V|FGH-V
 */
/**
 * Glass “line drawing” thumbs are full packshot silhouettes on white.
 * CSS scale-[4] over-crops Living tiles, so bake contain/cover without zoom.
 */
const TILES = [
  {
    key: "pitched-roof-windows/centre-pivot",
    file: "FTP-V_01.jpg",
    fit: "contain",
    out: "centre-pivot.png",
  },
  {
    key: "pitched-roof-windows/top-hung",
    file: "FPP-V_01.jpeg",
    fit: "contain",
    out: "top-hung.png",
  },
  {
    key: "pitched-roof-windows/electric-solar",
    file: "FTP-V_01.jpg",
    fit: "contain",
    out: "electric-solar.png",
  },
  {
    key: "pitched-roof-windows/high-pivot",
    file: "PTP-V_01.jpeg",
    fit: "contain",
    out: "high-pivot.png",
  },
  {
    key: "pitched-roof-windows/balcony",
    file: "FGH-V_01.jpeg",
    fit: "cover",
    out: "balcony.png",
  },
  {
    key: "pitched-roof-windows/conservation",
    file: "FTW-V_01.jpg",
    fit: "cover",
    out: "conservation.png",
  },
  {
    key: "pitched-roof-windows/l-shape-combination",
    file: "BDL_01.jpg",
    fit: "contain",
    out: "l-shape-combination.png",
  },
  {
    key: "pitched-roof-windows/light-tunnels",
    file: "SFS_01.jpg",
    fit: "contain",
    out: "light-tunnels.png",
  },
  {
    key: "pitched-roof-windows/electricals",
    file: "ZWS12_01.jpg",
    fit: "contain",
    out: "electricals.png",
  },
  {
    key: "pitched-roof-windows/flashing-kits",
    file: "EZA_01.png",
    fit: "contain",
    out: "flashing-kits.png",
  },
];

/**
 * Simulate CSS: object-cover into SIZE box, then scale(ZOOM) from center.
 * Equivalent visible area = center SIZE/ZOOM of the covered canvas.
 */
async function bakeTile(srcPath, outPath, { fit = "contain" }) {
  const SIZE = 256;
  await sharp(srcPath)
    .resize(SIZE, SIZE, {
      fit: fit === "cover" ? "cover" : "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      position: "centre",
    })
    .png()
    .toFile(outPath);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const tile of TILES) {
    const src = path.join(SRC_DIR, tile.file);
    if (!fs.existsSync(src)) {
      console.error("MISSING source", tile.file);
      continue;
    }
    const out = path.join(OUT_DIR, tile.out);
    await bakeTile(src, out, tile);
    console.log("baked", tile.out, "←", tile.file, tile.fit || "contain");
  }

  await connectMongo();
  const db = require("mongoose").connection.db;
  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  const parents = await db
    .collection("menus")
    .find({ brand: brand._id, parent: null })
    .toArray();
  const parentBySlug = Object.fromEntries(parents.map((p) => [p.slug, p]));

  let updated = 0;
  for (const tile of TILES) {
    const [parentSlug, typeSlug] = tile.key.split("/");
    const parent = parentBySlug[parentSlug];
    if (!parent) continue;
    // Upload the freshly baked tile — public/ is not committed, so a local
    // path would 404 in production.
    const image = await uploadPublicFile(`/fakro-products/tiles/${tile.out}`);
    const r = await db.collection("menus").updateMany(
      { brand: brand._id, parent: parent._id, slug: typeSlug },
      { $set: { image, updatedAt: new Date() } },
    );
    if (r.modifiedCount) {
      console.log("menu", tile.key, "→", image);
      updated += r.modifiedCount;
    } else {
      console.log("menu same/missing", tile.key);
    }
  }

  console.log("Updated menus:", updated);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
