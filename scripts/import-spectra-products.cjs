/**
 * Import Spectra trade price list into MongoDB + Cloudinary.
 *
 * Usage: node --require ./scripts/mongo-dns.cjs scripts/import-spectra-products.cjs
 */
const path = require("path");
const dns = require("dns");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const XLSX = require("xlsx");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const EXCEL_PATH = path.join(
  __dirname,
  "..",
  "Trades Spectra Price List 2026.xlsx",
);
const SPECTRA_JSON =
  "https://spectratileandhome.com/collections/all/products.json?limit=250";
const MATCH_THRESHOLD = 55;
const STOCK_DEFAULT = 50;

/** Manual Excel name → Spectra title (only when names differ but product is the same). */
const MANUAL_ALIASES = {
  "new zali mentos blue": "Mentos Blue - Carving Collection",
  "onyx brown gloss": "ONYX BROWN",
  "perlino cemento gloss": "PERLINO CEMENTO",
  "plaza white gloss": "PLAZA WHITE",
  "regal crema gloss": "REGAL CREMA",
  "regal silver gloss": "Regal Silver – Matt Collection",
  "alaska white": "ALASKA WHITE MATT",
  "calacatta creama": "CALACATTA CREMA",
  "calacatta creama matt": "CALACATTA CREMA",
  "moon creama": "MOON CREMA",
  "bottochino creama matt carving": "Bottochino Crema - Carving Collection",
  "florin pista matt carving": "Florian Pista - Carving Collection",
  "florin sky matt carving": "Florian Sky - Carving Collection",
};

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanName(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(s) {
  return cleanName(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/creama/g, "crema")
    .replace(/florin/g, "florian")
    .replace(/traventine/g, "travertine")
    .replace(/[^\w\s]/g, " ")
    .replace(
      /\b(glossy|gloss|high|matt|satin|carving|collection|non|rectified|thick|6mm|mm)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function tokenScore(a, b) {
  const ta = normalizeName(a).split(" ").filter(Boolean);
  const tb = normalizeName(b).split(" ").filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  const inter = ta.filter((t) => setB.has(t)).length;
  return (inter / Math.max(ta.length, tb.length)) * 100;
}

function matchScore(excelName, shopTitle) {
  const ne = normalizeName(excelName);
  const ns = normalizeName(shopTitle);
  if (!ne || !ns) return 0;
  if (ne === ns) return 100;
  if (ns.includes(ne) || ne.includes(ns)) return 90;
  return tokenScore(excelName, shopTitle);
}

function findBestMatch(excelName, catalog) {
  const aliasKey = cleanName(excelName).toLowerCase();
  const aliasTitle = MANUAL_ALIASES[aliasKey];
  if (aliasTitle) {
    const aliased = catalog.find(
      (p) => cleanName(p.title).toLowerCase() === aliasTitle.toLowerCase(),
    );
    if (aliased) return { product: aliased, score: 100 };
  }

  let best = null;
  let bestScore = 0;
  for (const product of catalog) {
    const score = matchScore(excelName, product.title);
    const handleScore = matchScore(
      excelName,
      product.handle.replace(/-/g, " "),
    );
    const s = Math.max(score, handleScore);
    if (s > bestScore) {
      bestScore = s;
      best = product;
    }
  }
  return { product: best, score: bestScore };
}

async function fetchCatalog() {
  const res = await fetch(SPECTRA_JSON, {
    headers: { "User-Agent": "LinxLivingImporter/1.0" },
  });
  if (!res.ok) throw new Error(`Spectra fetch failed: ${res.status}`);
  const data = await res.json();
  return data.products || [];
}

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "LinxLivingImporter/1.0" },
  });
  if (!res.ok) throw new Error(`Image download failed ${res.status}: ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function uploadToCloudinary(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "linx-living/products/spectra",
        public_id: publicId,
        overwrite: true,
        resource_type: "image",
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
    stream.end(buffer);
  });
}

function readExcelRows() {
  const wb = XLSX.readFile(EXCEL_PATH);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    defval: "",
  });
  return rows
    .map((r) => {
      const name = cleanName(r["Name:"]);
      const finish = cleanName(r["Finish:"]) || "Gloss";
      const size = cleanName(r["Size:"]);
      const sqm = cleanName(r["SQM Per Box"]);
      const priceEx = Number(r["Price ex VAT"]);
      const promoRaw = r["Promotion!"];
      const promo =
        promoRaw === "" || promoRaw == null ? null : Number(promoRaw);
      // Sell at list price (ex VAT); keep promo in specs when present
      const price = priceEx;
      return { name, finish, size, sqm, priceEx, promo, price };
    })
    .filter((r) => r.name && !Number.isNaN(r.price) && r.price > 0);
}

async function ensureFinishMenus(db, finishes) {
  const menus = db.collection("menus");
  const map = {};
  let order = 10;
  for (const finish of finishes) {
    const slug = slugify(finish);
    let doc = await menus.findOne({ slug, parent: null });
    if (!doc) {
      const now = new Date();
      const insert = {
        name: finish,
        slug,
        parent: null,
        order: order++,
        isActive: true,
        image: "",
        createdAt: now,
        updatedAt: now,
      };
      const result = await menus.insertOne(insert);
      doc = { ...insert, _id: result.insertedId };
      console.log(`  + menu created: ${finish} (${slug})`);
    } else {
      console.log(`  · menu exists: ${finish} (${slug})`);
    }
    map[finish] = doc;
  }
  return map;
}

async function main() {
  if (
    !process.env.MONGODB_URI ||
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("Missing MongoDB or Cloudinary env vars");
  }

  console.log("Reading Excel…");
  const rows = readExcelRows();
  console.log(`  ${rows.length} products in spreadsheet`);

  const finishes = [...new Set(rows.map((r) => r.finish))];
  console.log("Finishes:", finishes.join(", "));

  console.log("Fetching Spectra catalog…");
  const catalog = await fetchCatalog();
  console.log(`  ${catalog.length} products on Spectra site`);

  console.log("Connecting MongoDB…");
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  console.log("Ensuring Finish categories…");
  const menuMap = await ensureFinishMenus(db, finishes);

  const report = {
    created: 0,
    updated: 0,
    matched: 0,
    unmatched: [],
    errors: [],
  };

  for (const row of rows) {
    const label = `${row.name} [${row.finish} / ${row.size}]`;
    try {
      const { product: match, score } = findBestMatch(row.name, catalog);
      let imageUrls = [];

      if (match && score >= MATCH_THRESHOLD) {
        report.matched++;
        const sources = (match.images || [])
          .map((img) => (typeof img === "string" ? img : img.src))
          .filter(Boolean)
          .slice(0, 1); // primary product image only

        for (let i = 0; i < sources.length; i++) {
          try {
            const buf = await downloadBuffer(sources[i]);
            const publicId = `${slugify(row.name)}-${row.size}-${i + 1}`;
            const uploaded = await uploadToCloudinary(buf, publicId);
            imageUrls.push(uploaded.secure_url);
          } catch (imgErr) {
            console.warn(`  ! image fail for ${label}:`, imgErr.message);
          }
        }
        console.log(
          `  ✓ matched "${row.name}" → "${match.title}" (${score.toFixed(0)}%) images=${imageUrls.length}`,
        );
      } else {
        report.unmatched.push({
          name: row.name,
          best: match?.title || null,
          score: Number(score.toFixed(1)),
        });
        console.log(
          `  ○ no solid image match for "${row.name}" (best: ${match?.title || "none"} @ ${score.toFixed(0)}%)`,
        );
      }

      const categorySlug = menuMap[row.finish].slug;
      const description = [
        `${row.name} porcelain tile in ${row.finish.toLowerCase()} finish.`,
        row.size ? `Size: ${row.size}.` : "",
        row.sqm ? `Coverage: ${row.sqm} per box.` : "",
        "Trade pricing from Spectra 2026 price list.",
      ]
        .filter(Boolean)
        .join(" ");

      const specs = {
        size: row.size,
        finish: row.finish,
        sqmPerBox: row.sqm,
        priceExVat: row.priceEx,
        ...(row.promo != null && !Number.isNaN(row.promo)
          ? { promotionalPrice: row.promo }
          : {}),
        source: "Spectra Trade Price List 2026",
        ...(match
          ? {
              spectraHandle: match.handle,
              spectraTitle: match.title,
              matchScore: score,
            }
          : {}),
      };

      const existing = await productsCol.findOne({
        name: row.name,
        category: categorySlug,
        "specs.size": row.size,
      });

      const now = new Date();
      if (existing) {
        const update = {
          price: row.price,
          description,
          category: categorySlug,
          stock: existing.stock ?? STOCK_DEFAULT,
          tagline: `${row.size} · ${row.finish}`,
          specs,
          showSpecs: true,
          updatedAt: now,
        };
        if (imageUrls.length) update.images = imageUrls;
        await productsCol.updateOne({ _id: existing._id }, { $set: update });
        report.updated++;
      } else {
        await productsCol.insertOne({
          name: row.name,
          description,
          price: row.price,
          images: imageUrls,
          category: categorySlug,
          subCategory: "",
          stock: STOCK_DEFAULT,
          tagline: `${row.size} · ${row.finish}`,
          schematicImage: "",
          specs,
          showSpecs: true,
          createdAt: now,
          updatedAt: now,
        });
        report.created++;
      }
    } catch (err) {
      report.errors.push({ name: row.name, error: err.message });
      console.error(`  ✗ ${label}:`, err.message);
    }
  }

  console.log("\n========== IMPORT SUMMARY ==========");
  console.log(`Created:  ${report.created}`);
  console.log(`Updated:  ${report.updated}`);
  console.log(`Matched images: ${report.matched}`);
  console.log(`Unmatched images: ${report.unmatched.length}`);
  if (report.unmatched.length) {
    console.log("\nUnmatched (no/low-confidence Spectra image):");
    for (const u of report.unmatched) {
      console.log(
        `  - ${u.name} (best: ${u.best || "—"} @ ${u.score})`,
      );
    }
  }
  if (report.errors.length) {
    console.log("\nErrors:");
    for (const e of report.errors) console.log(`  - ${e.name}: ${e.error}`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
