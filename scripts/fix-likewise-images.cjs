/**
 * Drop the images that do not belong to each Likewise Floors product.
 *
 * The original scrape read each product page's carousel, which shows the
 * product's own photo followed by every sibling colourway in its range, and
 * saved the lot as that product's gallery. So a product carries six images of
 * which one is its own and five belong to other products.
 *
 * Reads the report written by audit-likewise-images.cjs, which identifies each
 * stored image by content — Cloudinary kept the originals byte-for-byte, so a
 * stored image can be matched back to the live uploads/<SKU>.jpg it came from,
 * and therefore to the product that photo really shows.
 *
 * Only images positively identified as another product's are removed. An image
 * that cannot be identified is kept: some are SVG swatches, which carry no
 * content-length to fingerprint and match no live photo, yet are the product's
 * own artwork. A product is left untouched when removing the wrong images
 * would empty its gallery.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-likewise-images.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-likewise-images.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-likewise-images.cjs --rollback <file.json>
 *
 *   --drop-unknown   also drop images that match no live photo (default: keep)
 *   REPORT=path      audit report to read
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const DROP_UNKNOWN = process.argv.includes("--drop-unknown");
/**
 * Let a product end up with no images. Off by default so a bad match can never
 * blank a real gallery; used for the scrape artefacts ("SINGLES", "Related
 * Products") whose every image belongs to some other product.
 */
const ALLOW_EMPTY = process.argv.includes("--allow-empty");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;
const REPORT = process.env.REPORT || path.join(__dirname, "_tmp-likewise-images.json");

(async () => {
  await connectMongo();
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    let n = 0;
    for (const p of data.products || []) {
      await productsCol.updateOne(
        { _id: new mongoose.Types.ObjectId(p._id) },
        { $set: { images: p.images } },
      );
      n += 1;
    }
    console.log(`rolled back ${n} products`);
    await mongoose.disconnect();
    return;
  }

  if (!fs.existsSync(REPORT)) {
    throw new Error(`no audit report at ${REPORT} — run audit-likewise-images.cjs first`);
  }
  const { rows } = JSON.parse(fs.readFileSync(REPORT, "utf8"));

  const brand = await db.collection("brands").findOne({ name: /likewise/i });
  const products = await productsCol
    .find({ brand: brand._id })
    .project({ name: 1, images: 1 })
    .toArray();
  // Keyed by id, not name: 167 names cover several product rows, and a name
  // map silently collapses them so only one of each ever gets rewritten.
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const updates = [];
  const skippedNoMatch = [];
  const skippedNoOwn = [];
  const alreadyClean = [];

  for (const row of rows) {
    if (!row._id) throw new Error("report predates product ids — re-run audit-likewise-images.cjs");
    const doc = byId.get(row._id);
    if (!doc) continue;

    // A product with no live namesake is still cleaned: identifying an image
    // as another product's photo does not depend on matching this one.
    if (!row.matchedLive) skippedNoMatch.push(row);

    const keep = row.images
      .filter((i) => i.kind !== "wrong" && !(DROP_UNKNOWN && i.kind === "unknown"))
      .map((i) => i.url);
    const deduped = [...new Set(keep)];
    const current = doc.images || [];

    // Never strip a product back to nothing, unless asked to.
    if (!deduped.length && current.length && !ALLOW_EMPTY) {
      skippedNoOwn.push(row);
      continue;
    }

    if (deduped.length === current.length && deduped.every((u, i) => u === current[i])) {
      alreadyClean.push(row);
      continue;
    }
    updates.push({ doc, keep: deduped, row });
  }

  const removed = updates.reduce((a, u) => a + ((u.doc.images || []).length - u.keep.length), 0);
  console.log(`products in report        : ${rows.length}`);
  console.log(`already correct           : ${alreadyClean.length}`);
  console.log(`to rewrite                : ${updates.length}`);
  console.log(`images to remove          : ${removed}`);
  console.log(`no live namesake (still cleaned): ${skippedNoMatch.length}`);
  console.log(`would be left with no images: ${skippedNoOwn.length}`);
  console.log(`unknown images            : ${DROP_UNKNOWN ? "dropped" : "kept"}`);

  console.log("\nfirst 15 rewrites:");
  for (const u of updates.slice(0, 15)) {
    console.log(
      `   ${u.row.name.padEnd(28)} ${String((u.doc.images || []).length).padStart(2)} -> ${u.keep.length}   (sku ${u.row.sku})`,
    );
    const kept = new Set(u.keep);
    for (const img of u.row.images) {
      const verb = kept.has(img.url) ? "keep" : "drop";
      console.log(
        `        ${verb} ${img.file.padEnd(30)} ${img.kind}${img.belongsTo ? ` — ${img.belongsTo}` : ""}`,
      );
    }
  }

  if (skippedNoOwn.length) {
    console.log(`\nown photo not among stored images (${skippedNoOwn.length}), first 15:`);
    for (const r of skippedNoOwn.slice(0, 15))
      console.log(`   ! ${r.name.padEnd(28)} sku ${r.sku}  images ${r.total}  wrong ${r.wrong}  unknown ${r.unknown}`);
  }
  if (skippedNoMatch.length) {
    console.log(`\nno product of that name on the site (${skippedNoMatch.length}), first 15:`);
    for (const r of skippedNoMatch.slice(0, 15)) console.log(`   ? ${r.name}  images ${r.total}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const rollback = {
    products: updates.map((u) => ({ _id: String(u.doc._id), images: u.doc.images || [] })),
  };

  const now = new Date();
  const ops = updates.map((u) => ({
    updateOne: {
      filter: { _id: u.doc._id },
      update: { $set: { images: u.keep, updatedAt: now } },
    },
  }));
  for (let i = 0; i < ops.length; i += 200) {
    await productsCol.bulkWrite(ops.slice(i, i + 200), { ordered: false });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-likewise-images-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
  console.log(`\napplied: ${updates.length} products, ${removed} images removed\nrollback: ${file}`);

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
