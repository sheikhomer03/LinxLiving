/**
 * Seed the 20 LINX departments and backfill product.department + menu links.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/seed-linx-departments.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/seed-linx-departments.cjs --backfill
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");

const LINX_DEPARTMENTS = [
  { name: "Windows & Doors", slug: "windows-and-doors" },
  { name: "Rooflights & Glass", slug: "rooflights-and-glass" },
  { name: "Outdoor Living", slug: "outdoor-living" },
  { name: "Kitchens", slug: "kitchens" },
  { name: "Bathrooms", slug: "bathrooms" },
  { name: "Flooring", slug: "flooring" },
  { name: "Furniture", slug: "furniture" },
  { name: "Lighting", slug: "lighting" },
  { name: "Renewable Energy", slug: "renewable-energy" },
  { name: "Building Materials", slug: "building-materials" },
  { name: "Plumbing", slug: "plumbing" },
  { name: "Electrical", slug: "electrical" },
  { name: "Ventilation", slug: "ventilation" },
  { name: "Tools & Workwear", slug: "tools-and-workwear" },
  { name: "Ironmongery & Hardware", slug: "ironmongery-and-hardware" },
  { name: "Smart Home & Security", slug: "smart-home-and-security" },
  { name: "Garden & Landscaping", slug: "garden-and-landscaping" },
  { name: "Drainage", slug: "drainage" },
  { name: "Heating & Cooling", slug: "heating-and-cooling" },
  { name: "Paint & Decorating", slug: "paint-and-decorating" },
];

function inferDepartmentSlug({ brandSlug, categorySlug, categoryName }) {
  const brand = String(brandSlug || "").toLowerCase();
  const cat = `${categorySlug || ""} ${categoryName || ""}`.toLowerCase();
  const hay = `${brand} ${cat}`;

  if (/fakro|velux|keylite|sterling|rooflight|skylight|sun.?tunnel|flashing|blind/.test(hay)) {
    return "rooflights-and-glass";
  }
  if (/noken|bathroom|sanitary|shower|basin|toilet|tap/.test(hay)) return "bathrooms";
  if (/porcelanosa|tile|ceramic|floor|likewise|laminate|vinyl|carpet|lvt|wood/.test(hay)) {
    if (/kitchen/.test(cat)) return "kitchens";
    if (/bath/.test(cat)) return "bathrooms";
    if (/floor|carpet|vinyl|laminate|lvt|wood|grass|rug|mat/.test(cat) || /likewise/.test(brand)) {
      return "flooring";
    }
    return "building-materials";
  }
  if (/window|door|upvc|aluminium|bifold|sliding/.test(cat)) return "windows-and-doors";
  if (/solar|ev.?charg|heat.?pump|battery|inverter|renewable/.test(cat)) return "renewable-energy";
  if (/kitchen/.test(cat)) return "kitchens";
  if (/garden|deck|pergola|outdoor/.test(cat)) return "outdoor-living";
  if (/light|lamp|led/.test(cat)) return "lighting";
  if (/plumb|pipe|valve/.test(cat)) return "plumbing";
  if (/electric|cable|socket/.test(cat)) return "electrical";
  if (/heat|radiator|boiler|cool|air.?con/.test(cat)) return "heating-and-cooling";
  if (/paint|decor/.test(cat)) return "paint-and-decorating";
  if (/drain/.test(cat)) return "drainage";
  if (/ventil|mvhr/.test(cat)) return "ventilation";
  if (/tool|workwear/.test(cat)) return "tools-and-workwear";
  if (/ironmong|hardware|hinge|handle/.test(cat)) return "ironmongery-and-hardware";
  if (/smart|security|cctv|alarm/.test(cat)) return "smart-home-and-security";
  if (/furniture|sofa|table|chair/.test(cat)) return "furniture";
  return "building-materials";
}

async function main() {
  const doBackfill = process.argv.includes("--backfill");
  const { db, client } = await connectMongo();
  const departments = db.collection("departments");
  const products = db.collection("products");
  const menus = db.collection("menus");
  const brands = db.collection("brands");

  let created = 0;
  let updated = 0;
  const now = new Date();
  for (let i = 0; i < LINX_DEPARTMENTS.length; i++) {
    const d = LINX_DEPARTMENTS[i];
    const res = await departments.updateOne(
      { slug: d.slug },
      {
        $set: {
          name: d.name,
          slug: d.slug,
          order: i,
          isActive: true,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
          image: "",
          description: "",
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount) created += 1;
    else if (res.modifiedCount) updated += 1;
  }
  console.log(`Departments: ${created} created, ${updated} updated, ${LINX_DEPARTMENTS.length} total`);

  if (!doBackfill) {
    console.log("Done (pass --backfill to assign products/menus).");
    await client.close();
    return;
  }

  const deptDocs = await departments.find({}).project({ _id: 1, slug: 1 }).toArray();
  const deptBySlug = new Map(deptDocs.map((d) => [d.slug, d._id]));
  const brandDocs = await brands.find({}).project({ _id: 1, slug: 1, name: 1 }).toArray();
  const brandById = new Map(brandDocs.map((b) => [String(b._id), b]));

  const missing = await products
    .find({
      $or: [
        { department: "" },
        { department: null },
        { department: { $exists: false } },
      ],
    })
    .project({ _id: 1, name: 1, category: 1, subCategory: 1, brand: 1 })
    .toArray();

  let productsUpdated = 0;
  const bulk = [];
  for (const p of missing) {
    const brand = p.brand ? brandById.get(String(p.brand)) : null;
    const slug = inferDepartmentSlug({
      brandSlug: brand?.slug,
      categorySlug: p.category,
      categoryName: p.category,
    });
    bulk.push({
      updateOne: {
        filter: { _id: p._id },
        update: { $set: { department: slug } },
      },
    });
    if (bulk.length >= 500) {
      await products.bulkWrite(bulk);
      productsUpdated += bulk.length;
      bulk.length = 0;
      process.stdout.write(`\rProducts backfilled: ${productsUpdated}`);
    }
  }
  if (bulk.length) {
    await products.bulkWrite(bulk);
    productsUpdated += bulk.length;
  }
  console.log(`\nProducts updated: ${productsUpdated}`);

  const topMenus = await menus
    .find({
      parent: null,
      $or: [{ department: null }, { department: { $exists: false } }],
    })
    .project({ _id: 1, name: 1, slug: 1, brand: 1 })
    .toArray();

  let menusLinked = 0;
  for (const m of topMenus) {
    const brand = m.brand ? brandById.get(String(m.brand)) : null;
    const slug = inferDepartmentSlug({
      brandSlug: brand?.slug,
      categorySlug: m.slug,
      categoryName: m.name,
    });
    const deptId = deptBySlug.get(slug);
    if (!deptId) continue;
    await menus.updateOne(
      { _id: m._id },
      { $set: { department: deptId, level: "category" } },
    );
    menusLinked += 1;
  }
  await menus.updateMany(
    { parent: { $ne: null }, level: { $ne: "subcategory" } },
    { $set: { level: "subcategory" } },
  );
  console.log(`Menus linked: ${menusLinked}`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
