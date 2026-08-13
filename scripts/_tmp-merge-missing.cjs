const { connectMongo } = require("./mongo-connect.cjs");
const fs = require("fs");

(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;
  const { ObjectId } = require("mongodb");
  const report = require("/tmp/broken-images-report.json");

  const brokenIds = report.unreachableProducts.map(p => new ObjectId(p.id));
  const deptById = new Map();
  const priceById = new Map();
  const stockById = new Map();
  const cursor = db.collection("products").find(
    { _id: { $in: brokenIds } },
    { projection: { department: 1, price: 1, stock: 1 } }
  );
  for await (const p of cursor) {
    deptById.set(String(p._id), p.department || "");
    priceById.set(String(p._id), p.price);
    stockById.set(String(p._id), p.stock);
  }

  const rows = [];
  for (const p of report.products) {
    rows.push({
      name: p.name, brand: p.brand, department: p.department || "",
      category: p.category || "", subCategory: p.subCategory || "",
      price: null, stock: null, issue: "no-images", detail: ""
    });
  }
  for (const p of report.unreachableProducts) {
    rows.push({
      name: p.name, brand: p.brand,
      department: deptById.get(p.id) || "",
      category: p.category || "", subCategory: p.subCategory || "",
      price: priceById.get(p.id), stock: stockById.get(p.id),
      issue: p.issue, detail: p.image
    });
  }
  rows.sort((a,b)=> (a.department||"zzz").localeCompare(b.department||"zzz") || a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
  fs.writeFileSync("/tmp/combined-missing-fixed.json", JSON.stringify(rows, null, 1));

  const byDept = {};
  for (const r of rows) byDept[r.department || "(blank)"] = (byDept[r.department || "(blank)"]||0)+1;
  console.log("TOTAL", rows.length);
  console.log(JSON.stringify(byDept, null, 1));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
