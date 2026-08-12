/**
 * OCR Spectra PDF page images, match product names, upload to Cloudinary.
 *
 * Expects images already extracted to scripts/_tmp-spectra-pdf/img-*.jpg
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/match-spectra-pdf-images.cjs
 *   DRY_RUN=1
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
const sharp = require("sharp");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const PDF_IMG_DIR = path.join(__dirname, "_tmp-spectra-pdf");
const OCR_CACHE = path.join(__dirname, "_tmp-spectra-pdf-ocr.json");
const LOG = path.join(__dirname, "_tmp-spectra-pdf-match.log");
const DRY_RUN = process.env.DRY_RUN === "1";
const ONLY_MISSING = process.env.ONLY_MISSING !== "0"; // default: only products without Cloudinary

function log(...args) {
  const line = args.map(String).join(" ");
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/creama/g, "crema")
    .replace(/traventine/g, "travertine")
    .replace(/florin/g, "florian")
    .replace(/satvario/g, "statuario")
    .replace(/vanesia/g, "venezia")
    .replace(/[^\w\s]/g, " ")
    .replace(
      /\b(glossy|gloss|high|matt|satin|carving|collection|non|rectified|thick|6mm|mm|600x1200|600x900|600x600|60x90|60x60)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function tokenScore(a, b) {
  const ta = normalizeName(a).split(" ").filter((t) => t.length > 1);
  const tb = normalizeName(b).split(" ").filter((t) => t.length > 1);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  const inter = ta.filter((t) => setB.has(t)).length;
  return (inter / Math.max(ta.length, tb.length)) * 100;
}

function matchScore(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (nb.includes(na) || na.includes(nb)) return 92;
  return tokenScore(a, b);
}

function hasCloudinary(images) {
  return (images || []).some(
    (u) => typeof u === "string" && /cloudinary\.com/i.test(u),
  );
}

/** Pull likely product title lines from OCR text (bottom labels are short uppercase-ish). */
function extractCandidateTitles(ocrText) {
  const lines = String(ocrText || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const skip =
    /spectra|porcelain|discover|versatility|mm\b|www\.|http|page|\d+\s*x\s*\d+/i;
  const out = [];
  for (const line of lines) {
    if (line.length < 4 || line.length > 60) continue;
    if (skip.test(line)) continue;
    // Prefer lines that look like product names
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    if (letters < 4) continue;
    out.push(line);
  }
  // Also whole text compressed (sometimes OCR joins)
  const joined = lines.join(" ");
  const m = joined.match(
    /\b([A-Z][A-Z0-9][A-Z0-9 \-/']{2,50})\b/g,
  );
  if (m) {
    for (const x of m) {
      const t = x.trim();
      if (t.length >= 4 && t.length <= 55 && !skip.test(t)) out.push(t);
    }
  }
  return [...new Set(out)];
}

async function ocrImage(filePath, worker) {
  // Crop bottom-left where product names sit (from catalog layout)
  const meta = await sharp(filePath).metadata();
  const w = meta.width || 1536;
  const h = meta.height || 1085;
  const left = 0;
  const top = Math.floor(h * 0.78);
  const width = Math.floor(w * 0.55);
  const height = h - top;
  const cropBuf = await sharp(filePath)
    .extract({ left, top, width, height })
    .greyscale()
    .normalize()
    .png()
    .toBuffer();

  const {
    data: { text },
  } = await worker.recognize(cropBuf);
  // Also light pass on full image if crop empty
  let fullText = text || "";
  if (!extractCandidateTitles(fullText).length) {
    const {
      data: { text: t2 },
    } = await worker.recognize(filePath);
    fullText = `${fullText}\n${t2 || ""}`;
  }
  return fullText;
}

function uploadLocal(filePath, publicId) {
  if (DRY_RUN) return Promise.resolve(`dry://${path.basename(filePath)}`);
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        folder: "linx-living/products/spectra/pdf",
        public_id: publicId.slice(0, 180),
        overwrite: true,
        resource_type: "image",
      },
      (err, result) => (err ? reject(err) : resolve(result.secure_url)),
    );
  });
}

async function main() {
  fs.writeFileSync(LOG, `Spectra PDF match ${new Date().toISOString()}\n`);

  const files = fs
    .readdirSync(PDF_IMG_DIR)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort()
    .map((f) => path.join(PDF_IMG_DIR, f));
  if (!files.length) throw new Error(`No images in ${PDF_IMG_DIR}`);
  log(`PDF page images: ${files.length}`);

  let Tesseract;
  try {
    Tesseract = require("tesseract.js");
  } catch {
    throw new Error(
      "tesseract.js not installed. Run: npm install tesseract.js --no-save",
    );
  }

  let ocrMap = {};
  if (fs.existsSync(OCR_CACHE) && process.env.REOCR !== "1") {
    ocrMap = JSON.parse(fs.readFileSync(OCR_CACHE, "utf8"));
    log(`Loaded OCR cache: ${Object.keys(ocrMap).length} pages`);
  } else {
    const worker = await Tesseract.createWorker("eng");
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const base = path.basename(f);
      try {
        const text = await ocrImage(f, worker);
        ocrMap[base] = {
          text,
          titles: extractCandidateTitles(text),
        };
        if ((i + 1) % 10 === 0 || i === 0) {
          log(`OCR ${i + 1}/${files.length}: ${base} → ${ocrMap[base].titles.slice(0, 3).join(" | ")}`);
          fs.writeFileSync(OCR_CACHE, JSON.stringify(ocrMap, null, 2));
        }
      } catch (e) {
        log(`OCR fail ${base}: ${e.message}`);
        ocrMap[base] = { text: "", titles: [] };
      }
    }
    await worker.terminate();
    fs.writeFileSync(OCR_CACHE, JSON.stringify(ocrMap, null, 2));
    log("OCR complete");
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "spectra" });
  if (!brand) throw new Error("Spectra brand not found");

  let products = await db
    .collection("products")
    .find({ brand: brand._id })
    .project({ name: 1, images: 1, specs: 1 })
    .toArray();

  if (ONLY_MISSING) {
    products = products.filter((p) => !hasCloudinary(p.images));
  }
  log(`Target products: ${products.length}`);

  const pages = Object.entries(ocrMap).map(([file, data]) => ({
    file,
    path: path.join(PDF_IMG_DIR, file),
    titles: data.titles || [],
    text: data.text || "",
  }));

  let matched = 0;
  let updated = 0;
  const report = [];

  for (const p of products) {
    let best = null;
    let bestScore = 0;
    let bestTitle = "";

    for (const page of pages) {
      const candidates = [
        ...page.titles,
        // also try full OCR blob loosely
        page.text.slice(0, 200),
      ];
      for (const title of candidates) {
        const s = matchScore(p.name, title);
        if (s > bestScore) {
          bestScore = s;
          best = page;
          bestTitle = title;
        }
      }
      // Direct: product normalized name appears in OCR text
      const nn = normalizeName(p.name);
      const nt = normalizeName(page.text);
      if (nn.length >= 5 && nt.includes(nn)) {
        const s = 95;
        if (s > bestScore) {
          bestScore = s;
          best = page;
          bestTitle = nn;
        }
      }
    }

    if (!best || bestScore < 60) {
      report.push({
        product: p.name,
        status: "NO_MATCH",
        score: bestScore,
        title: bestTitle,
      });
      log(`NO MATCH ${p.name} (best=${bestScore.toFixed(0)} ${bestTitle})`);
      continue;
    }

    matched += 1;
    try {
      const publicId = `pdf-${slugify(p.name)}`;
      const url = await uploadLocal(best.path, publicId);
      if (!DRY_RUN) {
        const images = [url];
        // keep any existing non-empty if somehow mixed
        for (const u of p.images || []) {
          if (typeof u === "string" && u.trim() && !images.includes(u)) {
            // drop shopify if we now have cloudinary cover
            if (/cdn\.shopify\.com/i.test(u)) continue;
            images.push(u);
          }
        }
        await db.collection("products").updateOne(
          { _id: p._id, brand: brand._id },
          {
            $set: {
              images,
              updatedAt: new Date(),
              "specs.pdfImageSource": best.file,
              "specs.pdfMatchScore": bestScore,
              "specs.pdfMatchTitle": bestTitle,
            },
          },
        );
      }
      updated += 1;
      report.push({
        product: p.name,
        status: "OK",
        score: bestScore,
        title: bestTitle,
        file: best.file,
        url,
      });
      log(
        `MATCH ${p.name} ← ${best.file} (${bestScore.toFixed(0)}) "${bestTitle}"`,
      );
    } catch (e) {
      report.push({
        product: p.name,
        status: "UPLOAD_FAIL",
        error: e.message,
      });
      log(`UPLOAD FAIL ${p.name}: ${e.message}`);
    }
  }

  fs.writeFileSync(
    path.join(__dirname, "_tmp-spectra-pdf-match-report.json"),
    JSON.stringify({ at: new Date().toISOString(), matched, updated, report }, null, 2),
  );
  log(`\nDone matched=${matched} updated=${updated} targets=${products.length}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
