/**
 * Import the built Better Bathrooms catalogue (work/bb-final.json) into DB2.
 *
 * - Brand "Better Bathrooms" lives in DB2 alongside its products (by the
 *   owner's choice — the storefront's brand registry reads DB1, so the brand
 *   stays unlisted there), isActive false.
 * - Products go to the secondary cluster (MONGODB_URL2), tagged
 *   specs.source = "bb-scrape". Only rows carrying that tag are ever updated;
 *   nothing that already existed is touched.
 * - Re-running updates in place (matched on the build's group key) and keeps
 *   every Shopify id already recorded on the product and on each variant.
 *
 * Env: DRY_RUN=1   report only
 *      LIMIT=n     first n products
 *      ONLY=text   products whose name contains text (case-insensitive)
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
const SOURCE_TAG = "bb-scrape";
const BRAND = { name: "Better Bathrooms", slug: "better-bathrooms" };
const STOCK = 500;
const FINAL = path.join(__dirname, "../.scratch/betterbathrooms/work/bb-final.json");

const plain = (html) => String(html || "").replace(/<li>/g, "• ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const SHOPIFY_VARIANT_FIELDS = ["shopifyVariantId", "shopifyInventoryItemId", "shopifyImageUrl", "shopifyMediaId"];

async function ensureBrand(db) {
  const col = db.collection("brands");
  const existing = await col.findOne({ slug: BRAND.slug });
  if (existing) {
    return existing;
  }
  const now = new Date();
  const doc = {
    name: BRAND.name, uiName: "", slug: BRAND.slug, order: 0, isActive: false, image: "",
    supplier: null, subBrands: [], dataCluster: "secondary",
    shopifyCollectionId: null, shopifySyncError: null, shopifySyncedAt: null,
    createdAt: now, updatedAt: now, __v: 0,
  };
  if (DRY_RUN) return { ...doc, _id: new ObjectId() };
  const { insertedId } = await col.insertOne(doc);
  console.log(`brand created in DB2: ${BRAND.name} (${insertedId}), hidden, dataCluster=secondary`);
  return { ...doc, _id: insertedId };
}

function toDoc(p, brandId, now) {
  return {
    name: p.name,
    description: p.description || `<p>${p.name}</p>`,
    shortDescription: plain(p.description).slice(0, 300),
    price: p.price,
    priceCurrency: "GBP",
    images: p.images,
    department: p.department,
    category: p.category,
    categories: p.category ? [p.category] : [],
    subCategory: p.subCategory || "",
    subCategories: p.subCategory ? [p.subCategory] : [],
    brand: brandId,
    brands: [brandId],
    supplierSku: p.sku || "",
    stock: STOCK,
    isOutOfStock: false,
    stockStatus: "in_stock",
    sourceUrl: p.sourceUrl,
    sourceProductId: p.groupKey,
    specs: { ...p.specs, source: SOURCE_TAG, sourceUrl: p.sourceUrl, importedAt: now.toISOString() },
    shopifyOptions: p.shopifyOptions,
    updatedAt: now,
  };
}

function mergeVariants(built, existing) {
  const bySku = new Map((existing || []).map((v) => [v.sku, v]));
  return built.map((v) => {
    const prev = bySku.get(v.sku);
    const row = { _id: prev?._id || new ObjectId(), ...v, stock: STOCK };
    if (prev) for (const f of SHOPIFY_VARIANT_FIELDS) if (prev[f]) row[f] = prev[f];
    return row;
  });
}

async function main() {
  let products = JSON.parse(fs.readFileSync(FINAL, "utf8"));
  if (ONLY) { const alts = ONLY.split("|").map((s) => s.trim()).filter(Boolean); products = products.filter((p) => alts.some((a) => p.name.toLowerCase() === a)); }
  if (process.env.EXCLUDE_CLEARANCE === "1") products = products.filter((p) => p.specs?.Condition !== "Graded / open box");
  products = products.slice(0, LIMIT);

  const secondaryClient = new MongoClient(process.env.MONGODB_URL2);
  await secondaryClient.connect();
  const brand = await ensureBrand(secondaryClient.db());
  const col = secondaryClient.db().collection("products");

  let created = 0, updated = 0;
  const now = new Date();
  const existingRows = await col.find({ "specs.source": SOURCE_TAG }, { projection: { sourceProductId: 1, variants: 1 } }).toArray();
  const existingByKey = new Map(existingRows.map((r) => [r.sourceProductId, r]));
  const ops = [];
  for (const p of products) {
    const existing = existingByKey.get(p.groupKey);
    const doc = toDoc(p, brand._id, now);
    doc.variants = mergeVariants(p.variants, existing?.variants);
    if (existing) {
      // content only — Shopify ids, handle and image links stay as recorded
      ops.push({ updateOne: { filter: { _id: existing._id }, update: { $set: doc } } });
      updated++;
    } else {
      ops.push({ insertOne: { document: { ...doc, createdAt: now } } });
      created++;
    }
  }
  if (!DRY_RUN) for (let i = 0; i < ops.length; i += 200) await col.bulkWrite(ops.slice(i, i + 200), { ordered: false });
  console.log(`${DRY_RUN ? "[dry run] " : ""}${created} created, ${updated} updated (of ${products.length}) in DB2; brand ${brand._id}`);
  await secondaryClient.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
