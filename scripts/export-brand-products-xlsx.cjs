/**
 * Export every product to XLSX, grouped by brand, with pricing + detail columns.
 *
 * Column layout comes from scripts/lib/product-rows.cjs, shared with the
 * Google Sheet sync so the two never drift apart.
 *
 * Sheets:
 *   All Products  — one row per product (brand, name, price, details …)
 *   By Brand      — per-brand counts, price range, image/description coverage
 *   Variants      — one row per variant for products that have them
 *
 * Usage: node scripts/export-brand-products-xlsx.cjs
 *        OUT=/path/to/file.xlsx node scripts/export-brand-products-xlsx.cjs
 *        DESC_MAX=32000 node scripts/export-brand-products-xlsx.cjs   # full copy
 */
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const { connectMongo } = require("./mongo-connect.cjs");
const {
  COLUMNS,
  loadLookups,
  buildRow,
  buildVariantRows,
  compareRows,
} = require("./lib/product-rows.cjs");

// .env.local is the real env file in this repo; fall back to .env.
for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

(async () => {
  const conn = await connectMongo();
  const db = conn.db;

  const lookups = await loadLookups(db);
  const products = await db.collection("products").find({}).toArray();

  const rows = products.map((p) => buildRow(p, lookups)).sort(compareRows);
  const variantRows = products
    .flatMap((p) => buildVariantRows(p, lookups))
    .sort(
      (a, b) =>
        String(a.Brand).localeCompare(String(b.Brand)) ||
        String(a["Product Name"]).localeCompare(String(b["Product Name"])),
    );

  // Per-brand rollup.
  const byBrand = new Map();
  for (const r of rows) {
    const key = r.Brand;
    if (!byBrand.has(key)) {
      byBrand.set(key, {
        Brand: key,
        Products: 0,
        withImage: 0,
        withDesc: 0,
        priced: 0,
        min: null,
        max: null,
        sum: 0,
      });
    }
    const s = byBrand.get(key);
    s.Products += 1;
    if (r.Images > 0) s.withImage += 1;
    if (r.Description) s.withDesc += 1;
    const price = typeof r["Price (£)"] === "number" ? r["Price (£)"] : null;
    if (price != null && price > 0) {
      s.priced += 1;
      s.sum += price;
      s.min = s.min == null ? price : Math.min(s.min, price);
      s.max = s.max == null ? price : Math.max(s.max, price);
    }
  }
  const summary = [...byBrand.values()]
    .map((s) => ({
      Brand: s.Brand,
      Products: s.Products,
      "With Image": s.withImage,
      "With Description": s.withDesc,
      "With Price": s.priced,
      "Min Price (£)": s.min ?? "",
      "Max Price (£)": s.max ?? "",
      "Avg Price (£)": s.priced ? Math.round((s.sum / s.priced) * 100) / 100 : "",
    }))
    .sort((a, b) => b.Products - a.Products || a.Brand.localeCompare(b.Brand));

  const wb = XLSX.utils.book_new();

  const widths = {
    "Product Name": 46,
    Description: 70,
    "Short Description": 45,
    Features: 40,
    Dimensions: 34,
    Specs: 34,
    "Main Image": 40,
    Brand: 22,
    Category: 20,
    Subcategory: 22,
    Department: 18,
    SKU: 18,
    "Product ID": 26,
  };

  const wsAll = XLSX.utils.json_to_sheet(rows, { header: COLUMNS });
  wsAll["!autofilter"] = { ref: wsAll["!ref"] };
  wsAll["!freeze"] = { xSplit: 0, ySplit: 1 };
  wsAll["!cols"] = COLUMNS.map((k) => ({ wch: widths[k] || 14 }));
  XLSX.utils.book_append_sheet(wb, wsAll, "All Products");

  const wsSummary = XLSX.utils.json_to_sheet(summary);
  wsSummary["!cols"] = [{ wch: 26 }, ...Array(7).fill({ wch: 15 })];
  XLSX.utils.book_append_sheet(wb, wsSummary, "By Brand");

  if (variantRows.length) {
    const wsVar = XLSX.utils.json_to_sheet(variantRows);
    wsVar["!autofilter"] = { ref: wsVar["!ref"] };
    wsVar["!freeze"] = { xSplit: 0, ySplit: 1 };
    wsVar["!cols"] = [
      { wch: 22 },
      { wch: 44 },
      { wch: 34 },
      { wch: 18 },
      ...Array(9).fill({ wch: 14 }),
    ];
    XLSX.utils.book_append_sheet(wb, wsVar, "Variants");
  }

  const out =
    process.env.OUT ||
    path.join(
      __dirname,
      "..",
      `linx-living-products-by-brand-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  // SheetJS writes xlsx uncompressed by default — ~45MB at this row count.
  XLSX.writeFile(wb, out, { compression: true });

  console.log(
    JSON.stringify(
      {
        file: out,
        products: rows.length,
        brands: summary.length,
        variants: variantRows.length,
        withImage: rows.filter((r) => r.Images > 0).length,
        withPrice: rows.filter((r) => Number(r["Price (£)"]) > 0).length,
        topBrands: summary.slice(0, 15),
      },
      null,
      2,
    ),
  );

  await conn.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
