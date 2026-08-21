/**
 * Export products that have no usable image URL, with brand name.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/export-products-missing-images-xlsx.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const path = require("path");
const XLSX = require("xlsx");
const { connectMongo } = require("./mongo-connect.cjs");

function hasImage(images) {
  return (images || []).some((s) => typeof s === "string" && s.trim());
}

(async () => {
  const conn = await connectMongo();
  const db = conn.db;

  const brands = await db
    .collection("brands")
    .find({})
    .project({ name: 1, slug: 1 })
    .toArray();
  const brandById = new Map(brands.map((b) => [String(b._id), b]));

  const products = await db
    .collection("products")
    .find({})
    .project({
      name: 1,
      price: 1,
      category: 1,
      subCategory: 1,
      department: 1,
      brand: 1,
      stock: 1,
      images: 1,
      specs: 1,
      shopifyProductId: 1,
    })
    .toArray();

  const missing = products.filter((p) => !hasImage(p.images));

  const rows = missing.map((p) => {
    const brand = p.brand ? brandById.get(String(p.brand)) : null;
    const code =
      p.specs?.sku ||
      p.specs?.productCode ||
      p.specs?.SKU ||
      p.specs?.["Product code"] ||
      "";
    return {
      "Product ID": String(p._id),
      Name: p.name || "",
      Brand: brand?.name || brand?.slug || "(none)",
      "Brand slug": brand?.slug || "",
      Department: p.department || "",
      Category: p.category || "",
      Subcategory: p.subCategory || "",
      Code: String(code || ""),
      Price: typeof p.price === "number" ? p.price : Number(p.price) || 0,
      Stock: typeof p.stock === "number" ? p.stock : "",
      "Shopify product ID": p.shopifyProductId
        ? String(p.shopifyProductId)
        : "",
      "Source URL": String(p.specs?.sourceUrl || ""),
    };
  });

  rows.sort(
    (a, b) =>
      String(a.Brand).localeCompare(String(b.Brand)) ||
      String(a.Category).localeCompare(String(b.Category)) ||
      String(a.Name).localeCompare(String(b.Name)),
  );

  const brandCounts = {};
  for (const r of rows) {
    const b = r.Brand || "(none)";
    brandCounts[b] = (brandCounts[b] || 0) + 1;
  }
  const summary = Object.entries(brandCounts)
    .map(([Brand, Count]) => ({ Brand, Count }))
    .sort((a, b) => b.Count - a.Count || String(a.Brand).localeCompare(b.Brand));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Missing Images");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "By Brand");

  const out =
    process.env.OUT ||
    path.join(
      __dirname,
      "..",
      `linx-living-products-missing-images-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  XLSX.writeFile(wb, out);

  console.log(
    JSON.stringify(
      {
        totalProducts: products.length,
        missingImages: rows.length,
        brandsAffected: summary.length,
        file: out,
        topBrands: summary.slice(0, 15),
      },
      null,
      2,
    ),
  );

  await conn.close?.();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
