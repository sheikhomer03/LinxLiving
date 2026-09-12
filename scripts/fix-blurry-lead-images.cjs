/**
 * Promote a sharp image out of the gallery where the lead one is blurry.
 *
 * Reads the verdicts in sheet-blur-audit.json and, for each product it called
 * blurry, re-measures every image in that product's gallery. Where a later
 * image is both big enough and sharp enough, it becomes the lead; where none
 * is, the product is left alone and reported, because the fix then has to come
 * from the supplier and guessing at it does more harm than the blur.
 *
 * That last point is the reason this does not go looking on supplier pages.
 * Probing theunderfloorheatingstore.com for better artwork returned the same
 * three files for all three Grant cylinders — an accessory-kit diagram and two
 * marketing graphics — because the product photo genuinely is that small there.
 * Promoting those would have put the wrong picture on three products.
 *
 * Nothing is deleted: the blurry image stays in the gallery behind the new
 * lead, and the rollback file restores the previous order exactly.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-blurry-lead-images.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-blurry-lead-images.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-blurry-lead-images.cjs --rollback <file.json>
 *
 * Shopify serves the storefront's images, so follow an apply with
 *   IDS=<ids> node --require ./scripts/mongo-dns.cjs scripts/sync-all-products-to-shopify.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/harvest-shopify-image-urls.cjs
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const sharp = require("sharp");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

const AUDIT = path.join(__dirname, "sheet-blur-audit.json");
const MIN_SUBJECT = Number(process.env.MIN_SUBJECT || 400);
const SHARP_MIN = Number(process.env.SHARP_MIN || 0.65);
const FOCUS_EDGE = 512;

/** The product's own bounding box, with the uniform backdrop trimmed away. */
async function subjectBox(buf, meta) {
  try {
    const { info } = await sharp(buf).trim({ threshold: 12 }).raw().toBuffer({ resolveWithObject: true });
    if (info.width > 8 && info.height > 8) return { width: info.width, height: info.height };
  } catch {
    /* nothing uniform to trim */
  }
  return { width: meta.width || 0, height: meta.height || 0 };
}

/** Contrast-normalised sharpness inside the subject; see audit-sheet-blur-images.cjs. */
async function sharpnessOf(buf) {
  let pipeline = sharp(buf);
  try {
    pipeline = sharp(await sharp(buf).trim({ threshold: 12 }).toBuffer());
  } catch {
    /* no uniform border */
  }
  const { data, info } = await pipeline
    .greyscale()
    .resize(FOCUS_EDGE, FOCUS_EDGE, { fit: "inside", withoutEnlargement: false })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h } = info;
  const TILE = 32;
  const scores = [];
  for (let ty = 0; ty + TILE <= h; ty += TILE) {
    for (let tx = 0; tx + TILE <= w; tx += TILE) {
      let sum = 0, sumSq = 0, lapSq = 0, n = 0;
      for (let y = ty + 1; y < ty + TILE - 1; y++) {
        for (let x = tx + 1; x < tx + TILE - 1; x++) {
          const i = y * w + x;
          const v = data[i];
          sum += v;
          sumSq += v * v;
          const lap = 4 * v - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
          lapSq += lap * lap;
          n++;
        }
      }
      if (!n) continue;
      const variance = sumSq / n - (sum / n) ** 2;
      if (variance < 4) continue;
      scores.push(lapSq / n / variance);
    }
  }
  if (!scores.length) return 0;
  scores.sort((a, b) => a - b);
  return scores[Math.min(scores.length - 1, Math.floor(scores.length * 0.9))];
}

(async () => {
  await connectMongo();
  const db = mongoose.connection.db;
  const products = db.collection("products");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    let n = 0;
    for (const p of data.products || []) {
      await products.updateOne(
        { _id: new mongoose.Types.ObjectId(p._id) },
        { $set: { images: p.images } },
      );
      n += 1;
    }
    console.log(`rolled back ${n} product(s)`);
    await mongoose.disconnect();
    return;
  }

  if (!fs.existsSync(AUDIT)) {
    throw new Error("no sheet-blur-audit.json — run audit-sheet-blur-images.cjs first");
  }
  const audit = JSON.parse(fs.readFileSync(AUDIT, "utf8"));
  const blurry = audit.results.filter((r) => r.verdict === "blurry" && r.productId);
  console.log(`${blurry.length} product(s) the audit called blurry\n`);

  const updates = [];
  const stuck = [];

  for (const row of blurry) {
    const p = await products.findOne(
      { _id: new mongoose.Types.ObjectId(row.productId) },
      { projection: { name: 1, images: 1, shopifyImages: 1 } },
    );
    if (!p) continue;
    const mirror = new Map((p.shopifyImages || []).map((l) => [l.sourceUrl, l.shopifyUrl]));

    let best = null;
    for (const [i, stored] of (p.images || []).entries()) {
      if (i === 0) continue; // the lead is the one we are replacing
      try {
        const r = await fetch(mirror.get(stored) || stored);
        if (!r.ok) continue;
        const b = Buffer.from(await r.arrayBuffer());
        const meta = await sharp(b).metadata();
        const box = await subjectBox(b, meta);
        const subject = Math.max(box.width, box.height);
        const sh = await sharpnessOf(b);
        if (subject >= MIN_SUBJECT && sh >= SHARP_MIN && (!best || subject > best.subject)) {
          best = { index: i, stored, subject, sharpness: sh };
        }
      } catch {
        /* unreadable images cannot be promoted */
      }
    }

    if (!best) {
      stuck.push({ ...row, name: p.name });
      console.log(`  ${p.name.slice(0, 58)}\n     no usable image in the gallery — needs supplier artwork`);
      continue;
    }
    updates.push({ doc: p, best });
    console.log(
      `  ${p.name.slice(0, 58)}\n     lead [0] (subject ${row.subject}px, sharp ${row.sharpness})` +
        ` -> [${best.index}] (subject ${best.subject}px, sharp ${best.sharpness.toFixed(2)})`,
    );
  }

  console.log(`\nfixable here : ${updates.length}`);
  console.log(`needs artwork: ${stuck.length}`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const rollback = {
    products: updates.map((u) => ({
      _id: String(u.doc._id),
      name: u.doc.name,
      images: u.doc.images || [],
    })),
  };

  const now = new Date();
  for (const u of updates) {
    const rest = (u.doc.images || []).filter((x) => x !== u.best.stored);
    await products.updateOne(
      { _id: u.doc._id },
      { $set: { images: [u.best.stored, ...rest], updatedAt: now } },
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-blurry-lead-images-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(rollback, null, 2)}\n`);
  console.log(`\napplied to ${updates.length} product(s)`);
  console.log(`rollback: ${file}`);
  if (updates.length) {
    console.log(
      `\nnow mirror to Shopify:\n  IDS=${updates.map((u) => u.doc._id).join(",")} ` +
        `node --require ./scripts/mongo-dns.cjs scripts/sync-all-products-to-shopify.cjs`,
    );
  }

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch { /* down */ }
  process.exit(1);
});
