/**
 * Remove `images` from products whose gallery is fully mirrored to Shopify.
 *
 * `resolveGalleryImages` (src/lib/productImage.ts) now builds the gallery from
 * `shopifyImages` ordered by `position`, and only consults `images` for
 * entries the pairing does not cover. So for a product where every image has a
 * pair, `images` is no longer read by anything that renders.
 *
 * Skipped deliberately:
 *   - products with any unpaired image — dropping the array would lose exactly
 *     those pictures, since nothing else records them
 *   - products with no pairs at all
 *
 * The removed arrays are written to a rollback file first. Note the URLs in it
 * point at Cloudinary, so if those files have since been deleted the rollback
 * restores the list but not the images themselves.
 *
 * Env:
 *   DRY_RUN=1   report only
 *   LIMIT=n     cap products changed
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const bare = (u) => String(u || "").split("?")[0];

async function main() {
  const { db } = await connectMongo();
  const P = db.collection("products");
  const brands = await db.collection("brands").find({}).project({ name: 1 }).toArray();
  const bn = new Map(brands.map((b) => [String(b._id), b.name]));

  const before = await db.stats();
  console.log(DRY_RUN ? "MODE: DRY RUN" : "MODE: LIVE");
  console.log("billed before : " + ((before.dataSize + before.indexSize) / 1048576).toFixed(2) + " MB");
  console.log("");

  const rollback = [];
  let ops = [];
  let scanned = 0, cleared = 0, keptGaps = 0, keptNoPairs = 0, bytesFreed = 0;
  const skipByBrand = new Map();
  let lastId = null;

  for (;;) {
    if (cleared >= LIMIT) break;
    const q = { "images.0": { $exists: true } };
    if (lastId) q._id = { $gt: lastId };
    const page = await P.find(q)
      .project({ images: 1, shopifyImages: 1, brand: 1 })
      .sort({ _id: 1 })
      .limit(500)
      .toArray();
    if (!page.length) break;

    for (const p of page) {
      lastId = p._id;
      scanned += 1;
      const imgs = (p.images || []).filter(Boolean);
      const paired = new Set(
        (p.shopifyImages || [])
          .filter((s) => s && s.shopifyUrl && String(s.shopifyUrl).trim())
          .map((s) => bare(s.sourceUrl)),
      );

      if (!paired.size) {
        keptNoPairs += 1;
        const k = bn.get(String(p.brand)) || "(none)";
        skipByBrand.set(k, (skipByBrand.get(k) || 0) + 1);
        continue;
      }
      const missing = imgs.filter((u) => !paired.has(bare(u)));
      if (missing.length) {
        keptGaps += 1;
        const k = bn.get(String(p.brand)) || "(none)";
        skipByBrand.set(k, (skipByBrand.get(k) || 0) + 1);
        continue;
      }

      if (cleared >= LIMIT) break;
      bytesFreed += Buffer.byteLength(JSON.stringify(imgs));
      rollback.push({ _id: String(p._id), images: imgs });
      ops.push({ updateOne: { filter: { _id: p._id }, update: { $unset: { images: "" } } } });
      cleared += 1;
    }

    if (!DRY_RUN && ops.length >= 500) {
      await P.bulkWrite(ops, { ordered: false });
      ops = [];
    }
    if (scanned % 5000 < 500) {
      console.log("  scanned " + scanned + "  cleared " + cleared + "  kept " + (keptGaps + keptNoPairs));
    }
  }

  if (!DRY_RUN && ops.length) await P.bulkWrite(ops, { ordered: false });

  if (!DRY_RUN && rollback.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(__dirname, "..", "rollback-product-images-" + stamp + ".json");
    fs.writeFileSync(file, JSON.stringify(rollback));
    console.log("");
    console.log("rollback written: " + path.basename(file) + "  (" + rollback.length + " products)");
  }

  console.log("");
  console.log((DRY_RUN ? "[dry] " : "") + "scanned " + scanned);
  console.log("  images removed       : " + cleared);
  console.log("  kept (partial gaps)  : " + keptGaps);
  console.log("  kept (no pairs)      : " + keptNoPairs);
  console.log("  array bytes removed  : " + (bytesFreed / 1048576).toFixed(2) + " MB (logical)");

  if (skipByBrand.size) {
    console.log("");
    console.log("kept, by brand:");
    for (const [k, v] of [...skipByBrand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log("  " + String(k).padEnd(26) + v);
    }
  }

  if (!DRY_RUN) {
    const after = await db.stats();
    console.log("");
    console.log("billed after  : " + ((after.dataSize + after.indexSize) / 1048576).toFixed(2) + " MB / 512 MB");
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
