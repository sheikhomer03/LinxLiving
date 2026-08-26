/**
 * Export the catalogue to XLSX with a tab per brand and a tab per category.
 *
 * The sibling script, export-brand-products-xlsx.cjs, writes one long sheet of
 * everything plus a rollup. This one is for the question "what do we sell, and
 * where does each product sit?" — so every brand and every category gets its
 * own sheet, and each product row names its brand, department, category and
 * subcategory so a filtered view still says where the product belongs.
 *
 * Sheets:
 *   Overview          — totals and a guide to the rest of the workbook
 *   Brands            — one row per brand: products, priced, imaged, price range
 *   Categories        — one row per category: department, products, brands
 *   Brand x Department— the coverage grid, brands down, departments across
 *   All Products      — every product, one row
 *   B - <brand>       — one sheet per brand
 *   C - <category>    — one sheet per category
 *
 * Sheet names are prefixed because Excel treats them case-insensitively and a
 * brand and a category can otherwise collide (the Decorwall brand and the
 * decorwall category), and truncated to Excel's 31-character limit with a
 * numeric suffix where that truncation collides.
 *
 * Usage: node scripts/export-products-by-brand-and-category.cjs
 *        OUT=/path/to/file.xlsx node scripts/export-products-by-brand-and-category.cjs
 */
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const { connectMongo } = require("./mongo-connect.cjs");
const { loadLookups, buildRow } = require("./lib/product-rows.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

/**
 * Columns for the per-brand and per-category sheets.
 *
 * Shorter than the full export on purpose: descriptions and spec blobs are
 * what make that file tens of megabytes, and repeating them across ~150 sheets
 * would triple it. This set answers where a product sits and what it costs.
 */
const COLUMNS = [
  "Brand",
  "Product Name",
  "SKU",
  "Department",
  "Category",
  "Subcategory",
  "Price (£)",
  "Stock",
  "Stock Status",
  "Images",
  "On Storefront",
  "Product ID",
];

const WIDTHS = {
  Brand: 24,
  "Product Name": 52,
  SKU: 20,
  Department: 20,
  Category: 24,
  Subcategory: 26,
  "Price (£)": 12,
  Stock: 9,
  "Stock Status": 14,
  Images: 8,
  "On Storefront": 14,
  "Product ID": 26,
};

const BLANK = "(none)";

/** Excel rejects []:*?/\ in a sheet name and caps it at 31 characters. */
function sheetNamer() {
  const used = new Set();
  return (prefix, label) => {
    const cleaned = String(label || BLANK).replace(/[[\]:*?/\\]/g, "-");
    let name = `${prefix}${cleaned}`.slice(0, 31).trim();
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
    for (let i = 2; ; i += 1) {
      const suffix = ` ${i}`;
      const candidate = `${name.slice(0, 31 - suffix.length)}${suffix}`;
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase());
        return candidate;
      }
    }
  };
}

function addSheet(wb, name, rows, header) {
  const ws = XLSX.utils.json_to_sheet(rows, header ? { header } : undefined);
  if (ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  const keys = header || Object.keys(rows[0] || {});
  ws["!cols"] = keys.map((k) => ({ wch: WIDTHS[k] || 16 }));
  XLSX.utils.book_append_sheet(wb, ws, name);
}

/** Priced and photographed — the two rules the storefront listings apply. */
function onStorefront(full) {
  const price = Number(full["Price (£)"]);
  return price > 0 && Number(full.Images) > 0 ? "Yes" : "No";
}

(async () => {
  const conn = await connectMongo();
  const db = conn.db;

  const lookups = await loadLookups(db);
  const products = await db.collection("products").find({}).toArray();

  const rows = products
    .map((p) => {
      const full = buildRow(p, lookups);
      const row = {};
      for (const key of COLUMNS) row[key] = full[key] ?? "";
      row.Brand = full.Brand || BLANK;
      row.Department = full.Department || BLANK;
      row.Category = full.Category || BLANK;
      row.Subcategory = full.Subcategory || BLANK;
      row["On Storefront"] = onStorefront(full);
      return row;
    })
    .sort(
      (a, b) =>
        a.Brand.localeCompare(b.Brand) ||
        a.Category.localeCompare(b.Category) ||
        String(a["Product Name"]).localeCompare(String(b["Product Name"])),
    );

  const groupBy = (key) => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r[key])) map.set(r[key], []);
      map.get(r[key]).push(r);
    }
    return new Map([...map].sort((a, b) => b[1].length - a[1].length));
  };

  const byBrand = groupBy("Brand");
  const byCategory = groupBy("Category");
  const departments = [...new Set(rows.map((r) => r.Department))].sort();

  const stats = (list) => {
    const prices = list
      .map((r) => Number(r["Price (£)"]))
      .filter((n) => Number.isFinite(n) && n > 0);
    return {
      Products: list.length,
      "On Storefront": list.filter((r) => r["On Storefront"] === "Yes").length,
      "With Price": prices.length,
      "With Image": list.filter((r) => Number(r.Images) > 0).length,
      "Min Price (£)": prices.length ? Math.min(...prices) : "",
      "Max Price (£)": prices.length ? Math.max(...prices) : "",
    };
  };

  const brandSummary = [...byBrand].map(([brand, list]) => ({
    Brand: brand,
    ...stats(list),
    Departments: [...new Set(list.map((r) => r.Department))].sort().join(", "),
    Categories: new Set(list.map((r) => r.Category)).size,
  }));

  const categorySummary = [...byCategory].map(([category, list]) => ({
    Category: category,
    Department: [...new Set(list.map((r) => r.Department))].sort().join(", "),
    ...stats(list),
    Brands: [...new Set(list.map((r) => r.Brand))].sort().join(", "),
    Subcategories: new Set(list.map((r) => r.Subcategory)).size,
  }));

  // Brands down the side, departments across the top: which brand supplies
  // what, at a glance, without opening a single per-brand sheet.
  const matrix = [...byBrand].map(([brand, list]) => {
    const row = { Brand: brand, Total: list.length };
    for (const dept of departments) {
      row[dept] = list.filter((r) => r.Department === dept).length || "";
    }
    return row;
  });

  const wb = XLSX.utils.book_new();
  const nameFor = sheetNamer();

  const overview = [
    { Item: "Products", Value: rows.length },
    { Item: "On storefront (priced and photographed)", Value: rows.filter((r) => r["On Storefront"] === "Yes").length },
    { Item: "Brands", Value: byBrand.size },
    { Item: "Departments", Value: departments.length },
    { Item: "Categories", Value: byCategory.size },
    { Item: "Subcategories", Value: new Set(rows.map((r) => r.Subcategory)).size },
    { Item: "", Value: "" },
    { Item: "Brands", Value: "one row per brand — products, coverage, price range" },
    { Item: "Categories", Value: "one row per category — its department, brands, counts" },
    { Item: "Brand x Department", Value: "coverage grid: brands down, departments across" },
    { Item: "All Products", Value: "every product, one row" },
    { Item: "B - …", Value: "one sheet per brand" },
    { Item: "C - …", Value: "one sheet per category" },
    { Item: "", Value: "" },
    { Item: "Generated", Value: new Date().toISOString().slice(0, 16).replace("T", " ") },
  ];
  const wsOverview = XLSX.utils.json_to_sheet(overview);
  wsOverview["!cols"] = [{ wch: 44 }, { wch: 62 }];
  XLSX.utils.book_append_sheet(wb, wsOverview, "Overview");

  addSheet(wb, "Brands", brandSummary);
  addSheet(wb, "Categories", categorySummary);
  addSheet(wb, "Brand x Department", matrix);
  addSheet(wb, "All Products", rows, COLUMNS);

  for (const [brand, list] of byBrand) {
    addSheet(wb, nameFor("B - ", brand), list, COLUMNS);
  }
  for (const [category, list] of byCategory) {
    addSheet(wb, nameFor("C - ", category), list, COLUMNS);
  }

  const out =
    process.env.OUT ||
    path.join(
      __dirname,
      "..",
      `LINX-Products-By-Brand-And-Category-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  // SheetJS writes uncompressed by default, which is several times the size.
  XLSX.writeFile(wb, out, { compression: true });

  console.log(
    JSON.stringify(
      {
        file: out,
        sizeMB: Math.round((fs.statSync(out).size / 1024 / 1024) * 100) / 100,
        sheets: wb.SheetNames.length,
        products: rows.length,
        brands: byBrand.size,
        categories: byCategory.size,
        departments: departments.length,
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
