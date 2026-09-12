/**
 * Check the "blurry images" sheet against what the storefront actually serves.
 *
 * The sheet lists product names reported as having blurry artwork. What makes
 * one look blurry is not the canvas size and not the overall sharpness — both
 * were tried and both misjudged it:
 *
 *  - Canvas size alone calls a 2000x2000 file fine. But RAK's Grant cylinder
 *    sits in the middle of a 604x588 sheet of white occupying maybe 150x350
 *    real pixels, and that is what gets stretched across the gallery.
 *  - Overall sharpness alone calls the RAK-Feeling glass panel the blurriest
 *    image in the catalogue. It is a pale glass panel on white: almost no
 *    edges anywhere, which a Laplacian reads as blur and an eye reads as a
 *    perfectly crisp photograph of something pale.
 *
 * So what is measured is the subject. The uniform border is trimmed away to
 * find the product's own bounding box; its longest side is the resolution that
 * actually reaches the screen, and sharpness is measured only inside it, tile
 * by tile, normalised against each tile's own contrast so that a pale subject
 * is not mistaken for a soft one. The score taken is a high percentile across
 * tiles: a sharp photograph has some genuinely sharp region, a soft one has
 * none anywhere.
 *
 * Everything is measured on the file Shopify serves, not the Cloudinary
 * master, because the CDN copy is what a customer sees.
 *
 * Writes scripts/sheet-blur-audit.json and a CSV of column E values.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-sheet-blur-images.cjs
 *   SHEET=<id>       Google Sheet to read (default: the reported list)
 *   SHARP_MIN=0.65   normalised subject sharpness below this counts as soft
 *   MIN_SUBJECT=400  subject's longest side below this counts as too small
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

const SHEET = process.env.SHEET || "1-4EVO_u6WaXT8RNAM1zgduTILom6jAFj2Gj6H6R9lpQ";
/**
 * Thresholds, set by measuring this sheet's images and looking at the ones
 * either side of the line rather than by picking round numbers.
 *
 * Sharpness: the Decorwall Maxi Panel scores 0.48 and is genuinely soft — its
 * marble veining is out of focus. Its sibling, Decorwall Elegance Mineral
 * Lazurite, scores 0.85 and is crisp, as is the whole RAK-Feeling glass panel
 * family at 0.86-1.04, which is pale rather than blurred. 0.65 separates the
 * one from the others; a threshold of 0.9 cut straight through the glass panel
 * cluster and called two of five blurry and three sharp, which is nonsense
 * for five renderings of the same photograph.
 *
 * Subject size: below about 400px the browser is upscaling enough to show even
 * on a card. Above it the sheet's small-subject images — a 485px lampshade, a
 * 574px smoke detector — are sharp and read as fine.
 */
const MIN_SUBJECT = Number(process.env.MIN_SUBJECT || 400);
const SHARP_MIN = Number(process.env.SHARP_MIN || 0.65);
const OUT = path.join(__dirname, "sheet-blur-audit.json");
const CSV = path.join(__dirname, "sheet-blur-column-e.csv");

/** Working size for the focus measure, so the number compares across sources. */
const FOCUS_EDGE = 512;

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);

/** Minimal CSV row parser — the sheet's fields are quoted and may hold commas. */
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const normalise = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The product's own bounding box, with the uniform backdrop trimmed away.
 *
 * Almost every packshot here is a product floating on white, and the white is
 * not what anyone is looking at. `trim` reports how much it removed, which
 * gives the subject's real pixel size — the number that decides whether the
 * gallery is upscaling.
 */
async function subjectBox(buf, meta) {
  try {
    const { info } = await sharp(buf)
      .trim({ threshold: 12 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width > 8 && info.height > 8) {
      return { width: info.width, height: info.height, trimmed: true };
    }
  } catch {
    /* a picture with no uniform border trims to nothing; use it whole */
  }
  return { width: meta.width || 0, height: meta.height || 0, trimmed: false };
}

/**
 * Sharpness inside the subject, normalised for contrast.
 *
 * Tiled, because a photograph is not uniformly detailed and the question is
 * whether it is sharp *anywhere*. Each tile's Laplacian energy is divided by
 * its own variance, so a pale subject and a dark one are scored alike — this
 * is what stops the RAK-Feeling glass panel reading as the blurriest image in
 * the catalogue. Tiles too flat to carry detail are skipped rather than
 * counted as soft, and the score is the 90th percentile of what remains.
 */
async function subjectSharpness(buf) {
  let pipeline = sharp(buf);
  try {
    pipeline = sharp(await sharp(buf).trim({ threshold: 12 }).toBuffer());
  } catch {
    /* no uniform border to trim */
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
      let sum = 0;
      let sumSq = 0;
      let lapSq = 0;
      let n = 0;
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
      // Too flat to say anything: blank backdrop, or a solid area of product.
      if (variance < 4) continue;
      scores.push(lapSq / n / variance);
    }
  }

  if (!scores.length) return 0;
  scores.sort((a, b) => a - b);
  return scores[Math.min(scores.length - 1, Math.floor(scores.length * 0.9))];
}

async function main() {
  log(`reading sheet ${SHEET}`);
  const res = await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET}/gviz/tq?tqx=out:csv&gid=0`,
  );
  if (!res.ok) throw new Error(`sheet HTTP ${res.status}`);
  const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
  const rows = lines.slice(1).map((l, i) => {
    const c = parseCsvLine(l);
    return { row: i + 2, name: c[0] || "", brand: c[1] || "", category: c[2] || "", note: c[3] || "" };
  });
  log(`${rows.length} product row(s)`);

  await connectMongo();
  const db = mongoose.connection.db;

  const products = await db
    .collection("products")
    .find({}, { projection: { name: 1, images: 1, shopifyImages: 1, brand: 1 } })
    .toArray();
  log(`${products.length} product(s) in the catalogue`);

  const byName = new Map();
  for (const p of products) {
    const key = normalise(p.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(p);
  }

  const results = [];

  for (const row of rows) {
    const key = normalise(row.name);
    let matches = byName.get(key) || [];
    if (!matches.length && key.length > 12) {
      // The sheet truncates a few names ("…Single Ended Ba"), so a stored name
      // may merely start with what the sheet holds.
      matches = products.filter((p) => normalise(p.name).startsWith(key));
    }
    if (!matches.length && key.length > 12) {
      // And it drops the range prefix on others — "Gluedown Glacier Oak SM-RL21"
      // is our "Karndean Art Select Gluedown Glacier Oak SM-RL21" — so the
      // stored name may instead end with what the sheet holds.
      matches = products.filter((p) => normalise(p.name).endsWith(key));
    }
    if (!matches.length) {
      results.push({ ...row, status: "not-found" });
      log(`  row ${row.row}: no product matches "${row.name.slice(0, 55)}"`);
      continue;
    }

    const p = matches[0];
    const mirror = new Map(
      (p.shopifyImages || []).map((l) => [l.sourceUrl, l.shopifyUrl]),
    );
    const stored = (p.images || [])[0] || "";
    const served = mirror.get(stored) || stored;
    if (!served) {
      results.push({ ...row, productId: String(p._id), matched: p.name, status: "no-image" });
      continue;
    }

    try {
      const r = await fetch(served);
      const buf = Buffer.from(await r.arrayBuffer());
      const meta = await sharp(buf).metadata();
      const box = await subjectBox(buf, meta);
      const subject = Math.max(box.width, box.height);
      const sharpness = await subjectSharpness(buf);

      const tooSmall = subject < MIN_SUBJECT;
      const soft = sharpness < SHARP_MIN;
      results.push({
        ...row,
        productId: String(p._id),
        matched: p.name,
        duplicates: matches.length,
        width: meta.width,
        height: meta.height,
        subjectWidth: box.width,
        subjectHeight: box.height,
        subject,
        bytes: buf.length,
        sharpness: Number(sharpness.toFixed(2)),
        tooSmall,
        soft,
        verdict: tooSmall || soft ? "blurry" : "not-blurry",
        reason: tooSmall && soft
          ? `subject only ${subject}px and soft`
          : tooSmall
            ? `subject only ${subject}px of a ${meta.width}x${meta.height} file`
            : soft
              ? "out of focus / upscaled by the supplier"
              : "",
        served,
        stored,
        status: "measured",
      });
      log(
        `  row ${String(row.row).padStart(3)} ${String(meta.width + "x" + meta.height).padStart(11)}` +
          ` subject ${String(box.width + "x" + box.height).padStart(11)}` +
          ` sharp ${sharpness.toFixed(2).padStart(6)}  ${(tooSmall || soft ? "BLURRY " : "ok     ")}` +
          ` ${row.name.slice(0, 42)}`,
      );
    } catch (e) {
      results.push({ ...row, productId: String(p._id), matched: p.name, status: `unreadable: ${e.message}` });
      log(`  row ${row.row}: image unreadable — ${e.message}`);
    }
  }

  const measured = results.filter((r) => r.status === "measured");
  const blurry = measured.filter((r) => r.verdict === "blurry");
  const fine = measured.filter((r) => r.verdict === "not-blurry");
  const unmatched = results.filter((r) => r.status !== "measured");

  fs.writeFileSync(
    OUT,
    `${JSON.stringify(
      { sheet: SHEET, checkedAt: new Date().toISOString(), minSubject: MIN_SUBJECT, sharpMin: SHARP_MIN, results },
      null,
      2,
    )}\n`,
  );

  // Column E, in sheet row order, ready to paste.
  const csv = ["row,product,columnE"];
  for (const r of results) {
    let e = "";
    if (r.status === "measured") {
      e = r.verdict === "not-blurry"
        ? "Not blurry - checked"
        : `Blurry - ${r.reason}`;
    } else if (r.status === "not-found") e = "Product not found in catalogue";
    else if (r.status === "no-image") e = "No image on this product";
    else e = `Could not check (${r.status})`;
    csv.push(`${r.row},"${(r.matched || r.name).replace(/"/g, '""')}","${e}"`);
  }
  fs.writeFileSync(CSV, `${csv.join("\n")}\n`);

  console.log("\n================ RESULT ================");
  console.log(`rows in sheet        : ${rows.length}`);
  console.log(`measured             : ${measured.length}`);
  console.log(`  genuinely blurry   : ${blurry.length}`);
  console.log(`     subject too small: ${measured.filter((r) => r.tooSmall).length}`);
  console.log(`     soft / upscaled  : ${measured.filter((r) => r.soft).length}`);
  console.log(`  NOT blurry         : ${fine.length}`);
  console.log(`could not check      : ${unmatched.length}`);
  console.log(`\nWritten to scripts/${path.basename(OUT)}`);
  console.log(`Column E values     : scripts/${path.basename(CSV)}`);

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch { /* down */ }
  process.exit(1);
});
