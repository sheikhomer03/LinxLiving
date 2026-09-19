/**
 * Build the `finishes` swatch row, the way FAKRO already does it.
 *
 * FAKRO stores its finishes as `OptionExtraSchema` rows —
 * `{name, imageUrl, priceAdjustment, sortOrder}` — and the PDP renders them
 * as a row of picture swatches above the buy box. Drench captures the same
 * thing as a variant axis, so the information is there but reaches the page
 * only as a dropdown of words.
 *
 * This derives the swatch row from the variants: one entry per value of the
 * finish-like axis, its picture taken from that variant's own mirrored
 * gallery, and `priceAdjustment` set from the cheapest variant carrying that
 * value so the swatch can show "+£50" the way FAKRO's does.
 *
 * Only mirrored images are used. The storefront renders `cdn.shopify.com`
 * and Cloudinary; a supplier URL would be dropped and leave a blank swatch,
 * so a value without a mirrored picture is given a name and no image rather
 * than a broken one.
 *
 * Env:
 *   BRAND=slug  brand to build (default "drench")
 *   AXIS=name   which axis is the finish (default: Finish, Colour, Color)
 *   DRY_RUN=1   report only
 *   LIMIT=n     only the first n products
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BRAND_SLUG = process.env.BRAND || "drench";
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
/** Axis names that describe an appearance rather than a size or quantity. */
const FINISH_AXES = (process.env.AXIS || "finish,colour,color,shade")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

async function main() {
  const { db: primary } = await connectMongo();
  const brand = await primary.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("brand not found: " + BRAND_SLUG);

  let db = primary;
  let secConn = null;
  if (brand.dataCluster === "secondary") {
    secConn = await mongoose
      .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 })
      .asPromise();
    db = secConn.db;
  }
  const P = db.collection("products");

  const filter = {
    brand: brand._id,
    "variants.1": { $exists: true },
    "variantGroups.0": { $exists: true },
  };
  const total = await P.countDocuments(filter);
  console.log("brand   : " + brand.name);
  console.log("scanning: " + total + " products with variants" + (DRY_RUN ? "   (DRY RUN)" : ""));
  console.log("");

  let scanned = 0, built = 0, noAxis = 0, noImages = 0, swatches = 0;
  let ops = [];
  const flush = async () => {
    if (!DRY_RUN && ops.length) await P.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for await (const doc of P.find(filter).limit(LIMIT === Infinity ? 0 : LIMIT)) {
    scanned += 1;
    const groups = doc.variantGroups || [];
    const idx = groups.findIndex((g) =>
      FINISH_AXES.includes(String(g || "").trim().toLowerCase()),
    );
    if (idx === -1) { noAxis += 1; continue; }

    const key = "option" + (idx + 1);
    const rows = new Map();
    for (const v of doc.variants || []) {
      const name = String(v[key] || "").trim();
      if (!name) continue;
      const mirrored = (v.shopifyImages || [])
        .map((p) => String(p.shopifyUrl || "").trim())
        .filter(Boolean);
      const price = Number(v.price);
      const prev = rows.get(name);
      if (!prev) {
        rows.set(name, { name, imageUrl: mirrored[0] || "", price: Number.isFinite(price) ? price : null });
      } else {
        // Keep the first picture found, and the lowest price for the value.
        if (!prev.imageUrl && mirrored[0]) prev.imageUrl = mirrored[0];
        if (Number.isFinite(price) && (prev.price == null || price < prev.price)) {
          prev.price = price;
        }
      }
    }
    if (rows.size < 2) { noAxis += 1; continue; }

    const list = [...rows.values()];
    if (!list.some((r) => r.imageUrl)) { noImages += 1; continue; }

    /*
     * `priceAdjustment` is the uplift over the cheapest finish, which is how
     * FAKRO's swatches read — the base finish shows nothing, the dearer ones
     * show what they add.
     */
    const base = Math.min(...list.map((r) => (r.price == null ? Infinity : r.price)));
    const finishes = list.map((r, i) => ({
      name: r.name,
      imageUrl: r.imageUrl,
      priceAdjustment:
        r.price != null && Number.isFinite(base) ? Math.round((r.price - base) * 100) / 100 : 0,
      sortOrder: i,
    }));

    built += 1;
    swatches += finishes.length;
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { finishes } } } });
    if (built <= 4) {
      console.log("  " + String(doc.name).slice(0, 40).padEnd(42) +
        groups[idx] + ": " + finishes.map((f) => f.name + (f.imageUrl ? "" : "(no img)")).slice(0, 4).join(", "));
    }
    if (ops.length >= 500) await flush();
  }
  await flush();

  console.log("");
  console.log("scanned          : " + scanned);
  console.log("finish rows built: " + built + "   (" + swatches + " swatches)");
  console.log("no finish axis   : " + noAxis);
  console.log("no mirrored image: " + noImages + "   (re-run once the image mirror catches up)");
  if (secConn) await secConn.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
