/**
 * Drop non-image URLs the Drench gallery parser picked up.
 *
 * `parseGallery()` matched any `img.drench.co.uk` anchor inside the gallery
 * markup, which on some pages includes a link whose path ends `/products` —
 * a directory, not a file. Shopify refuses it ("the specified directory name
 * is reserved"), and because media is created alongside the product the whole
 * productCreate fails, which is why 40 products never synced.
 *
 * Removes only entries whose filename has no image extension. Writes a
 * rollback file first.
 *
 * Env:
 *   DRY_RUN=1  report only
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const BRAND_SLUG = "drench";
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/i;

/** A usable image URL ends in an image file, not a directory. */
function isRealImage(url) {
  const file = String(url || "").split("?")[0].split("/").pop() || "";
  return IMAGE_EXT.test(file);
}

async function main() {
  const { db } = await connectMongo();
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("brand not found: " + BRAND_SLUG);

  const P = db.collection("products");
  const total = await P.countDocuments({ brand: brand._id });
  console.log(BRAND_SLUG + " products: " + total + (DRY_RUN ? "   (DRY RUN)" : ""));
  console.log("");

  const rollback = [];
  let ops = [];
  let scanned = 0, affected = 0, removed = 0;
  const badNames = new Map();
  let lastId = null;

  for (;;) {
    const q = { brand: brand._id };
    if (lastId) q._id = { $gt: lastId };
    const page = await P.find(q)
      .project({ images: 1, technicalDrawings: 1 })
      .sort({ _id: 1 })
      .limit(500)
      .toArray();
    if (!page.length) break;

    for (const p of page) {
      lastId = p._id;
      scanned += 1;

      const imgs = Array.isArray(p.images) ? p.images : [];
      const draw = Array.isArray(p.technicalDrawings) ? p.technicalDrawings : [];
      const keepImgs = imgs.filter(isRealImage);
      const keepDraw = draw.filter(isRealImage);
      const dropped = (imgs.length - keepImgs.length) + (draw.length - keepDraw.length);
      if (!dropped) continue;

      for (const u of imgs.concat(draw)) {
        if (isRealImage(u)) continue;
        const file = String(u).split("?")[0].split("/").pop() || "(empty)";
        badNames.set(file, (badNames.get(file) || 0) + 1);
      }

      affected += 1;
      removed += dropped;
      rollback.push({ _id: String(p._id), images: imgs, technicalDrawings: draw });
      ops.push({
        updateOne: {
          filter: { _id: p._id },
          update: { $set: { images: keepImgs, technicalDrawings: keepDraw } },
        },
      });
    }

    if (!DRY_RUN && ops.length >= 500) {
      await P.bulkWrite(ops, { ordered: false });
      ops = [];
    }
    if (scanned % 2000 < 500) console.log("  scanned " + scanned + "/" + total);
  }

  if (!DRY_RUN && ops.length) await P.bulkWrite(ops, { ordered: false });

  if (!DRY_RUN && rollback.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(__dirname, "..", "rollback-drench-bogus-images-" + stamp + ".json");
    fs.writeFileSync(file, JSON.stringify(rollback));
    console.log("");
    console.log("rollback written: " + path.basename(file) + "  (" + rollback.length + " documents)");
  }

  console.log("");
  console.log((DRY_RUN ? "[dry] " : "") + "scanned " + scanned +
    ", products affected " + affected + ", entries removed " + removed);
  console.log("");
  console.log("rejected filenames:");
  for (const [k, v] of [...badNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log("  " + k.slice(0, 40).padEnd(42) + v);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
