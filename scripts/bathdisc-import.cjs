/**
 * Import the built Bathdisc catalogue (.scratch/bathdisc/v2/bathdisc-final.json)
 * — insert-only, into the database named by TARGET (no default, on purpose).
 *
 * - Brand "Bathdisc" is created in the target DB's brand registry (uiName
 *   "Linx Square" like the other resold brands), isActive false until reviewed.
 *   The maker (Crosswater, Lefroy Brooks …) is kept in specs.Manufacturer.
 * - Every product is a NEW document tagged specs.source = "bathdisc-scrape".
 *   Nothing that already exists is updated or deleted. A product whose
 *   sourceUrl / sourceProductId is already in either cluster is skipped.
 * - Live Bathdisc prices (inc VAT) per variant, stock 500, sold by quantity
 *   (Bathdisc has no area calculator).
 * - The product count is checked before and after the insert.
 *
 * Env: TARGET=db1|db2 (required)   DRY_RUN=1 report only   LIMIT=n   ONLY=text
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const TARGET = String(process.env.TARGET || "").toLowerCase();
if (!["db1", "db2"].includes(TARGET)) throw new Error("TARGET=db1 or TARGET=db2 is required");
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const ONLY = (process.env.ONLY || "").toLowerCase();
const SOURCE_TAG = "bathdisc-scrape";
const BRAND = { name: "Bathdisc", slug: "bathdisc", uiName: "Linx Square" };
const STOCK = 500;
const FINAL = path.join(__dirname, "../.scratch/bathdisc/v2/bathdisc-final.json");
const BACKUP_DIR = path.join(__dirname, "../backups");
const PROGRESS = path.join(__dirname, "../.scratch/bathdisc/v2/progress.log");
const log = (m) => { const line = `[${new Date().toISOString()}] IMPORT ${m}`; console.log(line); fs.appendFileSync(PROGRESS, line + "\n"); };

/** Brands are registered in DB1; a DB2 brand carries dataCluster "secondary". */
async function ensureBrand(db1) {
  const col = db1.collection("brands");
  const existing = await col.findOne({ slug: BRAND.slug });
  if (existing) return existing;
  const now = new Date();
  const doc = {
    name: BRAND.name, uiName: BRAND.uiName, slug: BRAND.slug, order: 0, isActive: false, image: "",
    supplier: null, subBrands: [], dataCluster: TARGET === "db2" ? "secondary" : "primary",
    shopifyCollectionId: null, shopifySyncError: null, shopifySyncedAt: null,
    createdAt: now, updatedAt: now, __v: 0,
  };
  if (DRY_RUN) return { ...doc, _id: new ObjectId() };
  const { insertedId } = await col.insertOne(doc);
  log(`brand created: ${BRAND.name} (${insertedId}), inactive (hidden) until you approve, dataCluster=${doc.dataCluster}`);
  return { ...doc, _id: insertedId };
}

function toDoc(p, brandId, now) {
  const d = p.variants[0];
  return {
    name: p.name,
    description: p.description,
    shortDescription: p.shortDescription,
    price: d.price,
    priceCurrency: "GBP",
    vatRate: 20,
    images: p.images,
    department: p.department,
    category: p.category,
    categories: [p.category],
    subCategory: p.subCategory || "",
    subCategories: p.subCategory ? [p.subCategory] : [],
    brand: brandId,
    brands: [brandId],
    subBrand: "",
    supplierSku: d.sku,
    stock: STOCK,
    isOutOfStock: false,
    stockStatus: "in_stock",
    soldPerUnit: true,
    areaCalculator: false,
    weight: d.weight,
    weightUnit: "kg",
    sourceUrl: p.sourceUrl,
    canonicalUrl: p.sourceUrl,
    sourceProductId: p.key,
    sourceSku: d.sku,
    sourceType: p.sourceType,
    sourceHandle: p.sourceHandle,
    supplierCategory: p.productType,
    keywords: p.tags,
    variantGroups: p.variantGroups,
    shopifyOptions: p.shopifyOptions,
    variants: p.variants.map((v) => ({
      _id: new ObjectId(),
      name: v.name,
      sku: v.sku,
      barcode: v.barcode,
      options: v.options,
      option1: v.option1 || "",
      option2: v.option2 || "",
      option3: v.option3 || "",
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      stock: STOCK,
      imageUrl: v.imageUrl,
      images: v.images,
      weight: v.weight,
      available: v.available,
      externalId: v.externalId,
      isDefault: v.isDefault,
      position: v.position,
      sourceUrl: v.sourceUrl,
    })),
    specs: {
      ...p.specs,
      sku: p.variants.length === 1 ? d.sku : "",
      ...(p.aliases?.length ? { alsoListedAs: p.aliases.map((a) => a.title) } : {}),
      source: SOURCE_TAG,
      sourceUrl: p.sourceUrl,
      importedAt: now.toISOString(),
    },
    shopifyProductId: null,
    shopifyVariantId: null,
    shopifySyncError: null,
    shopifySyncedAt: null,
    shopifyImages: [],
    shopifyHandle: "",
    shopifyProductUrl: "",
    createdAt: now,
    updatedAt: now,
  };
}

async function main() {
  let products = JSON.parse(fs.readFileSync(FINAL, "utf8"));
  if (ONLY) products = products.filter((p) => p.name.toLowerCase().includes(ONLY));
  products = products.slice(0, LIMIT);

  const c1 = new MongoClient(process.env.MONGODB_URI);
  const c2 = new MongoClient(process.env.MONGODB_URL2);
  await Promise.all([c1.connect(), c2.connect()]);
  const target = (TARGET === "db1" ? c1 : c2).db().collection("products");

  // dedupe against BOTH clusters
  const urls = products.map((p) => p.sourceUrl);
  const keys = products.map((p) => p.key);
  const q = { $or: [{ sourceUrl: { $in: urls } }, { "specs.sourceUrl": { $in: urls } }, { sourceProductId: { $in: keys } }] };
  const proj = { projection: { sourceUrl: 1, "specs.sourceUrl": 1, sourceProductId: 1 } };
  const existing = [...(await c1.db().collection("products").find(q, proj).toArray()), ...(await c2.db().collection("products").find(q, proj).toArray())];
  const taken = new Set(existing.flatMap((e) => [e.sourceUrl, e.specs?.sourceUrl, e.sourceProductId]).filter(Boolean));

  const brand = await ensureBrand(c1.db());
  const now = new Date();
  const docs = [];
  let skipped = 0;
  for (const p of products) {
    if (taken.has(p.sourceUrl) || taken.has(p.key)) { skipped++; continue; }
    docs.push(toDoc(p, brand._id, now));
  }
  const before = await target.countDocuments();
  log(`${DRY_RUN ? "[dry run] " : ""}target ${TARGET.toUpperCase()}: ${docs.length} to insert (${docs.reduce((n, d) => n + d.variants.length, 0)} variants), ${skipped} already present; products before: ${before}`);
  const byDept = {};
  for (const d of docs) byDept[d.department] = (byDept[d.department] || 0) + 1;
  log(`by department: ${JSON.stringify(byDept)}`);
  if (DRY_RUN || !docs.length) { await Promise.all([c1.close(), c2.close()]); return; }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUP_DIR, `bathdisc-import-${now.toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(docs));
  let inserted = 0;
  log(`backup written; inserting ${docs.length} products in batches of 100`);
  for (let i = 0; i < docs.length; i += 100) {
    inserted += (await target.insertMany(docs.slice(i, i + 100), { ordered: true })).insertedCount;
    log(`inserted ${inserted}/${docs.length}`);
  }
  const after = await target.countDocuments();
  log(`DONE: inserted ${inserted}; products before ${before}, after ${after}`);
  if (after - before !== inserted) { log("COUNT CHECK FAILED"); throw new Error(`count check failed: before ${before}, after ${after}, inserted ${inserted}`); }
  log("count check passed");
  await Promise.all([c1.close(), c2.close()]);
}

main().catch((e) => { console.error(e); process.exit(1); });
