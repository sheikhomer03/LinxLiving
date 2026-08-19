/**
 * Export every RAK Ceramics product that has no image, with the reason why.
 *
 * A bare list of codes is not actionable — what RAK need to be told is which
 * gap is theirs to fill. So each row carries the reason the importer found no
 * picture, worked out against the crawl of their own shared Drive folder:
 * whether the range is absent from the folder entirely, whether the file is
 * there but corrupt, whether only a technical PDF carries the code, or whether
 * the code simply appears nowhere.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/export-rak-missing-images-xlsx.cjs
 *
 *   OUT=<path>   where to write (default: RAK-products-without-images.xlsx)
 */
const fs = require("fs");
const path = require("path");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const XLSX = require("xlsx");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const OUT = process.env.OUT
  ? path.resolve(process.env.OUT)
  : path.join(__dirname, "..", "RAK-products-without-images.xlsx");
const MANIFEST = path.join(__dirname, "rak-drive-manifest.json");
const SITE = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const normCode = (s) =>
  String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/**
 * Files RAK uploaded as the right size but entirely zero bytes. Google's own
 * CDN refuses to decode them, so they are indistinguishable from a missing
 * file to anything downstream — worth naming separately, because unlike the
 * other gaps this one is a broken upload rather than a photograph never taken.
 */
const CORRUPT = new Set([
  "RAKSHW0001", "RAKSHW0001B", "RAKSHW0002", "RAKSHW0002B",
  "RAKSHW0003", "RAKSHW0003B", "RAKSHW0004", "RAKSHW0004B",
  "RAKSHW0005", "RAKSHW0005B", "RAKSHW0006", "RAKSHW0006B",
]);

async function main() {
  if (!fs.existsSync(MANIFEST)) {
    throw new Error(`No Drive manifest at ${MANIFEST} — run crawl-rak-drive-images.cjs`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

  // Which codes the Drive folder names at all, and on what kind of file.
  const imageCodes = new Set();
  const documentCodes = new Set();
  const imageBasenames = [];
  const folderSegments = new Set();
  for (const file of manifest.files) {
    for (const segment of file.trail) folderSegments.add(normCode(segment));
    const base = file.name.replace(/\.[a-z0-9]+$/i, "");
    const normalized = normCode(base);
    const tokens = new Set([
      normalized,
      ...base.split(/[^A-Za-z0-9]+/).filter(Boolean).map(normCode),
    ]);
    const sink =
      file.type === "image" ? imageCodes : file.type === "document" ? documentCodes : null;
    if (!sink) continue;
    for (const token of tokens) if (token.length >= 5) sink.add(token);
    if (file.type === "image") imageBasenames.push(normalized);
  }

  const conn = await connectMongo();
  const db = conn.db;
  const brand = await db.collection("brands").findOne({ slug: "rak-ceramics" });
  if (!brand) throw new Error("RAK CERAMICS brand not found");

  const products = await db
    .collection("products")
    .find({
      brand: brand._id,
      $or: [{ images: { $size: 0 } }, { images: { $exists: false } }, { images: null }],
    })
    .sort({ rangeName: 1, productCode: 1 })
    .toArray();

  /** Does the Drive folder carry a folder for this range at all? */
  const rangeInDrive = (range) => {
    const full = normCode(range);
    const bare = normCode(String(range).replace(/^RAK-?/i, ""));
    if (!bare || bare.length < 4) return true;
    return [...folderSegments].some((s) => s === full || s.includes(bare));
  };

  const reasonFor = (product) => {
    const code = normCode(product.productCode);
    const legacy = normCode(product.legacyProductCode);
    const codes = [code, legacy].filter((c) => c && c.length >= 5);

    if (CORRUPT.has(String(product.productCode).toUpperCase())) {
      return "File in Drive is corrupt (zero bytes) — needs re-uploading";
    }
    if (codes.some((c) => imageCodes.has(c))) {
      return "Image named in Drive but unusable";
    }
    if (codes.some((c) => documentCodes.has(c))) {
      return "Only a technical PDF carries this code — no photograph";
    }
    const prefix = codes.some(
      (c) => c.length >= 7 && imageBasenames.some((b) => b.length >= 7 && b.startsWith(c.slice(0, -1)) && b !== c),
    );
    if (prefix) {
      return "Only a near-match exists (different finish) — not used";
    }
    if (!rangeInDrive(product.rangeName)) {
      return `Range "${product.rangeName}" has no folder in the Drive at all`;
    }
    return "Code appears nowhere in the Drive folder";
  };

  const rows = products.map((p) => ({
    "Product Code": p.productCode || "",
    "2023 Old Code": p.legacyProductCode || "",
    Barcode: p.barcode || "",
    Range: p.rangeName || "",
    "RAK Category": p.supplierCategory || "",
    "Product Description": p.name || "",
    "Price inc VAT": p.rrpIncVat ?? p.price ?? "",
    "RRP ex VAT": p.rrpExVat ?? "",
    "Site Category": p.category || "",
    "Site Subcategory": p.subCategory || "",
    "Unit of Measure": p.unitOfMeasure || "",
    "RAK Status": p.supplierProductStatus || "",
    "Why no image": reasonFor(p),
    "Product page": `${SITE}/products/${p._id}`,
    "Shopify product": p.shopifyProductUrl || "",
  }));

  const summary = new Map();
  for (const r of rows) {
    summary.set(r["Why no image"], (summary.get(r["Why no image"]) || 0) + 1);
  }
  const byRange = new Map();
  for (const r of rows) byRange.set(r.Range, (byRange.get(r.Range) || 0) + 1);

  const book = XLSX.utils.book_new();

  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 22 }, { wch: 20 },
    { wch: 60 }, { wch: 13 }, { wch: 12 }, { wch: 20 }, { wch: 24 },
    { wch: 15 }, { wch: 11 }, { wch: 52 }, { wch: 58 }, { wch: 58 },
  ];
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: rows.length, c: 14 },
  }) };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(book, sheet, "Products without images");

  const reasonSheet = XLSX.utils.json_to_sheet(
    [...summary.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ Reason: reason, Products: count })),
  );
  reasonSheet["!cols"] = [{ wch: 58 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(book, reasonSheet, "By reason");

  const rangeSheet = XLSX.utils.json_to_sheet(
    [...byRange.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([range, count]) => ({ Range: range, Products: count })),
  );
  rangeSheet["!cols"] = [{ wch: 34 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(book, rangeSheet, "By range");

  XLSX.writeFile(book, OUT);

  console.log(`${rows.length} product(s) without images → ${OUT}`);
  console.log("\nBy reason:");
  for (const [reason, count] of [...summary.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${reason}`);
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
