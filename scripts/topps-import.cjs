/**
 * Import the built Topps Tiles catalogue (.scratch/toppstiles/v2/topps-final.json)
 * into DB1 (MONGODB_URI) — insert-only.
 *
 * - Brand "Topps Tiles" is created in DB1 (dataCluster primary, uiName
 *   "Linx Square" like the other resold brands), isActive false until reviewed.
 * - Every product is a NEW document tagged specs.source = "topps-scrape".
 *   Nothing that already exists is updated or deleted. A product whose
 *   sourceUrl (or sourceProductId) is already in either cluster is skipped.
 * - Stock 500 on every product and variant (playbook rule).
 * - The product count is checked before and after; the run throws if the
 *   delta is not exactly what was inserted.
 *
 * Env: DRY_RUN=1  report only      LIMIT=n  first n listings      ONLY=text  name contains
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const ONLY = (process.env.ONLY || "").toLowerCase();
const SOURCE_TAG = "topps-scrape";
const BRAND = { name: "Topps Tiles", slug: "topps-tiles", uiName: "Linx Square" };
const STOCK = 500;
const FINAL = path.join(__dirname, "../.scratch/toppstiles/v2/topps-final.json");
const BACKUP_DIR = path.join(__dirname, "../backups");

async function ensureBrand(db) {
  const col = db.collection("brands");
  const existing = await col.findOne({ slug: BRAND.slug });
  if (existing) return existing;
  const now = new Date();
  const doc = {
    name: BRAND.name, uiName: BRAND.uiName, slug: BRAND.slug, order: 0, isActive: false, image: "",
    supplier: null, subBrands: [], dataCluster: "primary",
    shopifyCollectionId: null, shopifySyncError: null, shopifySyncedAt: null,
    createdAt: now, updatedAt: now, __v: 0,
  };
  if (DRY_RUN) return { ...doc, _id: new ObjectId() };
  const { insertedId } = await col.insertOne(doc);
  console.log(`brand created in DB1: ${BRAND.name} (${insertedId}), hidden until reviewed`);
  return { ...doc, _id: insertedId };
}

function toDoc(p, brandId, now) {
  const d = p.variants[0];
  const calc = p.calc.uniformCalc;
  const variants = p.variants.map((v) => ({
    _id: new ObjectId(),
    name: v.name,
    sku: v.sku,
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
    attributes: v.attributes,
    // how this variant is sold, kept per variant: ranges mix tiles and boxes
    sellUnit: v.sellUnit,
    coverageM2: v.coverageM2,
    pricePerSqm: v.pricePerSqm,
    tilesPerBox: v.tilesPerBox,
    sourceUrl: v.sourceUrl,
    sampleSku: v.sampleSku,
  }));
  return {
    name: p.name,
    description: p.description,
    shortDescription: p.shortDescription,
    price: p.variants.length > 1 ? d.price : p.price,
    priceCurrency: "GBP",
    vatRate: 20,
    images: p.images,
    externalVideos: p.externalVideos,
    department: p.department,
    category: p.category,
    categories: [p.category],
    subCategory: p.subCategory || "",
    subCategories: p.subCategory ? [p.subCategory] : [],
    brand: brandId,
    brands: [brandId],
    subBrand: "",
    rangeName: p.specs.Range || "",
    supplierCategory: "",
    supplierSku: d.sku,
    stock: STOCK,
    isOutOfStock: false,
    stockStatus: "in_stock",
    // m² calculator only where every variant shares one coverage; ranges that
    // mix tile sizes are sold by quantity so no size is quoted wrongly
    soldPerUnit: !calc,
    areaCalculator: calc,
    pricePerSqm: d.pricePerSqm,
    packPrice: calc && d.sellUnit === "Box" ? d.price : null,
    packCoverageM2: calc ? d.coverageM2 : null,
    piecesPerPack: calc && d.tilesPerBox ? d.tilesPerBox : null,
    weight: d.weight,
    weightUnit: "kg",
    freeSample: Boolean(p.sampleSku),
    sampleSku: p.sampleSku || "",
    sourceUrl: p.sourceUrl,
    canonicalUrl: p.sourceUrl,
    sourceProductId: p.sourceProductId,
    sourceSku: p.sourceSku,
    sourceType: p.sourceType,
    sourceHandle: p.sourceUrl.replace(/^https?:\/\/[^/]+\//, ""),
    metaTitle: p.metaTitle.replace(/\s*\|\s*Topps Tiles\s*$/i, ""),
    metaDescription: p.metaDescription,
    variantGroups: p.variantGroups,
    shopifyOptions: p.shopifyOptions,
    variants,
    specs: {
      ...p.specs,
      ...(Object.keys(p.swatches || {}).length ? { optionSwatches: p.swatches } : {}),
      ...(p.absorbed ? { absorbedSourceUrls: p.absorbed } : {}),
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
  const col1 = c1.db().collection("products");
  const col2 = c2.db().collection("products");

  // dedupe against BOTH clusters
  const urls = products.flatMap((p) => [p.sourceUrl, ...p.variants.map((v) => v.sourceUrl)]);
  const keys = products.map((p) => p.sourceProductId);
  const q = { $or: [{ sourceUrl: { $in: urls } }, { "specs.sourceUrl": { $in: urls } }, { sourceProductId: { $in: keys } }] };
  const existing = [...(await col1.find(q, { projection: { sourceUrl: 1, "specs.sourceUrl": 1, sourceProductId: 1 } }).toArray()),
    ...(await col2.find(q, { projection: { sourceUrl: 1, "specs.sourceUrl": 1, sourceProductId: 1 } }).toArray())];
  const taken = new Set(existing.flatMap((e) => [e.sourceUrl, e.specs?.sourceUrl, e.sourceProductId]).filter(Boolean));

  const brand = await ensureBrand(c1.db());
  const now = new Date();
  const docs = [];
  let skipped = 0;
  for (const p of products) {
    if (taken.has(p.sourceUrl) || taken.has(p.sourceProductId)) { skipped++; continue; }
    docs.push(toDoc(p, brand._id, now));
  }

  const before = await col1.countDocuments();
  console.log(`${DRY_RUN ? "[dry run] " : ""}${docs.length} to insert, ${skipped} already present; DB1 products before: ${before}`);
  const byCat = {};
  for (const d of docs) byCat[`${d.department}/${d.category}/${d.subCategory}`] = (byCat[`${d.department}/${d.category}/${d.subCategory}`] || 0) + 1;
  console.log(byCat);
  if (DRY_RUN || !docs.length) { await Promise.all([c1.close(), c2.close()]); return; }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUP_DIR, `topps-import-${now.toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(docs));

  let inserted = 0;
  for (let i = 0; i < docs.length; i += 100) {
    const r = await col1.insertMany(docs.slice(i, i + 100), { ordered: true });
    inserted += r.insertedCount;
  }
  const after = await col1.countDocuments();
  console.log(`inserted ${inserted}; DB1 products after: ${after}`);
  if (after - before !== inserted) throw new Error(`count check failed: before ${before}, after ${after}, inserted ${inserted}`);
  await Promise.all([c1.close(), c2.close()]);
}

main().catch((e) => { console.error(e); process.exit(1); });
