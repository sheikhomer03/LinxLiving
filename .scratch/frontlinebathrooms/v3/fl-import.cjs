/**
 * Frontline Bathrooms — INSERT the prepared catalogue (v3/fl-final.json) into
 * DB1 (MONGODB_URI). PREPARED, NOT RUN — needs --write.
 *
 * - DB1 only; DB2 is never opened.
 * - Brand "Frontline Bathrooms" is created in DB1 if missing (dataCluster
 *   primary, uiName "Linx Square" like the other resold brands, isActive false
 *   until reviewed). Frontline's own brands (Aqua, RAK, Grohe…) stay in specs.Brand.
 * - Insert-only: a product whose sourceUrl/groupKey or any F code already exists
 *   on any DB1 product is skipped. Nothing existing is updated or deleted.
 * - Every product tagged specs.source = "frontline-scrape"; stock 500 everywhere.
 * - All Frontline docs are backed up before, and the product count is checked
 *   after (must grow by exactly the number inserted).
 *
 *   node .scratch/frontlinebathrooms/v3/fl-import.cjs            # preview
 *   node .scratch/frontlinebathrooms/v3/fl-import.cjs --write    # insert (only when approved)
 */
const path = require("path");
const ROOT = path.join(__dirname, "../../..");
require(path.join(ROOT, "node_modules/dotenv")).config({ path: path.join(ROOT, ".env.local"), quiet: true });
require("dns").setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));

const WRITE = process.argv.includes("--write");
const SOURCE_TAG = "frontline-scrape";
const BRAND = { name: "Frontline Bathrooms", slug: "frontline-bathrooms", uiName: "Linx Square" };
const STOCK = 500;
const plain = (html) => String(html || "").replace(/<li>/g, "• ").replace(/<[^>]+>/g, " ").replace(/&#8211;/g, "–").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const norm = (s) => String(s || "").trim().toUpperCase();

async function ensureBrand(db) {
  const col = db.collection("brands");
  const existing = await col.findOne({ slug: BRAND.slug });
  if (existing) return existing;
  const now = new Date();
  const doc = { name: BRAND.name, uiName: BRAND.uiName, slug: BRAND.slug, order: 0, isActive: false, image: "", supplier: null, subBrands: [], dataCluster: "primary", shopifyCollectionId: null, shopifySyncError: null, shopifySyncedAt: null, createdAt: now, updatedAt: now };
  if (!WRITE) return { ...doc, _id: new ObjectId(), preview: true };
  const { insertedId } = await col.insertOne(doc);
  console.log(`brand created in DB1: ${BRAND.name} (${insertedId}), hidden until reviewed`);
  return { ...doc, _id: insertedId };
}

function toDoc(p, brandId, now) {
  return {
    name: p.name,
    description: p.description || `<p>${p.name}</p>`,
    shortDescription: plain(p.description).slice(0, 300),
    price: p.price,
    priceCurrency: "GBP",
    vatRate: 20,
    images: p.images,
    department: p.department,
    category: p.category,
    categories: p.category ? [p.category] : [],
    subCategory: p.subCategory || "",
    subCategories: p.subCategory ? [p.subCategory] : [],
    brand: brandId,
    brands: [brandId],
    rangeName: p.specs.Range || "",
    supplierSku: p.sku,
    stock: STOCK,
    isOutOfStock: false,
    stockStatus: "in_stock",
    ...(p.soldPerUnit !== undefined ? { soldPerUnit: p.soldPerUnit } : {}),
    sourceUrl: p.sourceUrl,
    canonicalUrl: p.sourceUrl,
    sourceProductId: p.groupKey,
    shopifyOptions: p.shopifyOptions,
    variants: p.variants.map((v) => ({ _id: new ObjectId(), ...v, stock: STOCK })),
    specs: { ...p.specs, source: SOURCE_TAG, sourceUrl: p.sourceUrl, sourcePageIds: p.sourcePageIds, importedAt: now.toISOString() },
    shopifyProductId: null, shopifyVariantId: null, shopifySyncError: null, shopifySyncedAt: null, shopifyImages: [], shopifyHandle: "", shopifyProductUrl: "",
    createdAt: now,
    updatedAt: now,
  };
}

async function main() {
  const products = JSON.parse(fs.readFileSync(path.join(__dirname, "fl-final.json"), "utf8"));
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db();
  const col = db.collection("products");
  const brand = await ensureBrand(db);

  const skus = [...new Set(products.flatMap((p) => p.variants.map((v) => v.sku)))];
  const variantsOf = (s) => [...new Set([s, s.toUpperCase(), s.toLowerCase()])];
  const clash = await col.find({ $or: [
    { supplierSku: { $in: skus.flatMap(variantsOf) } }, { "variants.sku": { $in: skus.flatMap(variantsOf) } },
    { sourceProductId: { $in: products.map((p) => p.groupKey) } }, { sourceUrl: { $in: products.map((p) => p.sourceUrl) } },
  ] }, { projection: { supplierSku: 1, "variants.sku": 1, sourceProductId: 1, sourceUrl: 1 } }).toArray();
  const takenSku = new Set(clash.flatMap((d) => [d.supplierSku, ...(d.variants || []).map((v) => v.sku)].map(norm)));
  const takenKey = new Set(clash.flatMap((d) => [d.sourceProductId, d.sourceUrl]));

  const now = new Date();
  const docs = [], skipped = [];
  for (const p of products) {
    if (p.variants.some((v) => takenSku.has(norm(v.sku))) || takenKey.has(p.groupKey) || takenKey.has(p.sourceUrl)) skipped.push(p.name);
    else docs.push(toDoc(p, brand._id, now));
  }
  console.log(`DB1: ${docs.length} to insert (${docs.reduce((a, d) => a + d.variants.length, 0)} variants), ${skipped.length} skipped because they already exist`);
  if (skipped.length) console.log(" skipped:", skipped.slice(0, 20));
  if (!WRITE) { console.log("preview only — nothing written (add --write when approved)"); await c.close(); return; }

  const existing = await col.find({ "specs.source": SOURCE_TAG }).toArray();
  const backup = path.join(ROOT, "backups", `frontline-import-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify({ existingFrontlineDocs: existing }, null, 1));
  const before = await col.countDocuments();
  for (let i = 0; i < docs.length; i += 200) await col.insertMany(docs.slice(i, i + 200), { ordered: false });
  const after = await col.countDocuments();
  if (after - before !== docs.length) throw new Error(`count check failed: +${after - before}, expected +${docs.length}`);
  console.log(`inserted ${docs.length} into DB1 (count ${before} → ${after}); backup ${path.relative(ROOT, backup)}`);
  await c.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
