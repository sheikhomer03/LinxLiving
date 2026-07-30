/**
 * Export all Living products to XLSX.
 * Columns: name, code, price, category, subcategory, brand, description, image yes/no
 *
 * Usage: node --require ./scripts/mongo-dns.cjs scripts/export-all-products-xlsx.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const path = require("path");
const XLSX = require("xlsx");
const { connectMongo } = require("./mongo-connect.cjs");

(async () => {
  const conn = await connectMongo();
  const db = conn.db;

  const brands = await db.collection("brands").find({}).project({ name: 1, slug: 1 }).toArray();
  const brandById = new Map(brands.map((b) => [String(b._id), b]));

  const products = await db
    .collection("products")
    .find({})
    .project({
      name: 1,
      price: 1,
      category: 1,
      subCategory: 1,
      brand: 1,
      description: 1,
      images: 1,
      specs: 1,
    })
    .toArray();

  const rows = products.map((p) => {
    const brand = p.brand ? brandById.get(String(p.brand)) : null;
    const imgs = (p.images || []).filter((s) => typeof s === "string" && s.trim());
    const code =
      p.specs?.sku ||
      p.specs?.productCode ||
      p.specs?.SKU ||
      p.specs?.["Product code"] ||
      "";
    return {
      Name: p.name || "",
      Code: String(code || ""),
      Price: typeof p.price === "number" ? p.price : Number(p.price) || 0,
      Category: p.category || "",
      Subcategory: p.subCategory || "",
      Brand: brand?.name || brand?.slug || "",
      Description: String(p.description || "").slice(0, 32000),
      Image: imgs.length ? "yes" : "no",
    };
  });

  rows.sort((a, b) =>
    String(a.Brand).localeCompare(String(b.Brand)) ||
    String(a.Category).localeCompare(String(b.Category)) ||
    String(a.Name).localeCompare(String(b.Name)),
  );

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  const out = path.join(
    __dirname,
    "..",
    `linx-living-products-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
  XLSX.writeFile(wb, out);

  const withImg = rows.filter((r) => r.Image === "yes").length;
  console.log(
    JSON.stringify(
      {
        total: rows.length,
        withImage: withImg,
        withoutImage: rows.length - withImg,
        file: out,
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
