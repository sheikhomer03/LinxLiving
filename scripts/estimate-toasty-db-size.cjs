/**
 * Estimate the Mongo footprint of a Gibe capture, before importing it.
 *
 * Measures real BSON of the documents the importer would write, not the
 * capture file: the capture keeps crawl-only scaffolding (recommendation
 * cards, the dataLayer echo, and on a card-less shop a byte-identical copy of
 * the variant matrix) that never reaches the database.
 *
 * Reports the product documents plus an index allowance, so the figure can be
 * compared against an Atlas "Data Size" reading directly.
 *
 * Env:
 *   SITE=name      which capture (default "toasty")
 *   GIBE_DATA=dir  capture directory
 */
const path = require("path");
const fs = require("fs");
const { BSON } = require("bson");

const SITE = process.env.SITE || "toasty";
const DATA = process.env.GIBE_DATA || path.join(__dirname, "..", ".capture");
const PDP_FILE = path.join(DATA, SITE + "-pdp.jsonl");

const MB = (v) => (v / 1048576).toFixed(2) + " MB";
const KB = (v) => (v / 1024).toFixed(1) + " KB";

/** Fields the capture carries for crawling that are never stored. */
const DISCARD = new Set(["cards", "dataLayerItems", "ldVariants", "capturedAt", "h1", "variantSource"]);

/**
 * Build the document the importer would write. Mirrors the field mapping the
 * Gibe importer uses, so the measurement reflects stored shape rather than
 * crawl shape.
 */
function toProductDoc(r) {
  const gallery = r.galleryAllVariants && r.galleryAllVariants.length ? r.galleryAllVariants : r.gallery || [];
  const variants = (r.variants || []).map((v) => ({
    name: v.name || "",
    sku: v.sku || "",
    options: (v.options || []).reduce((a, o, i) => Object.assign(a, { ["option" + (i + 1)]: o }), {}),
    price: v.price ?? null,
    stock: 0,
    imageUrl: (v.gallery && v.gallery[0] && v.gallery[0].url) || "",
    available: /InStock/i.test(v.availability || ""),
    externalId: v.mpn || "",
    compareAtPrice: null,
  }));
  return {
    name: r.name || "",
    description: (r.sections || []).map((s) => s.html || "").join("\n") || r.ldDescription || "",
    shortDescription: r.ldDescription || "",
    price: r.price ?? null,
    rrpIncVat: r.rrp ?? null,
    originalPrice: r.originalPrice ?? null,
    retailPrice: r.retailPrice ?? null,
    tradeSaving: r.tradeSaving ?? null,
    priceCurrency: "GBP",
    tierPrices: r.tradeTiers || [],
    images: gallery.map((g) => g.url),
    technicalDrawings: (r.technicalDrawings || []).map((t) => t.url),
    downloads: (r.downloads || []).map((d) => ({ name: d.title || d.name || "", url: d.url, kind: d.kind || "" })),
    variants,
    variantGroups: r.variantGroups || [],
    variantOptionsText: r.variantOptionsText || "",
    isVariant: !!r.isVariant,
    specs: (r.specs || []).reduce((a, s) => Object.assign(a, { [s.label]: s.value }), {}),
    productSections: (r.sections || []).map((s) => ({ title: s.heading || "", html: s.html || "" })),
    features: r.keyFeatures || [],
    sourceCategories: (r.breadcrumb || []).slice(1, -1).map((b) => ({ name: b.name, url: b.url })),
    category: "", subCategory: "", department: "",
    supplierSku: r.sku || "", manufacturerSku: r.mpn || "", productCode: r.sku || "",
    sourceUrl: r.url, canonicalUrl: r.canonical || r.url, sourceHandle: (r.url || "").split("/p/")[1] || "",
    sourceProductId: r.productId || r.guid || "", sourceSku: r.sku || "",
    metaTitle: r.metaTitle || "", metaDescription: r.metaDescription || "",
    stock: 0, isOutOfStock: !/InStock/i.test(r.availability || ""), stockStatus: "",
    brand: "000000000000000000000000",
    createdAt: new Date(), updatedAt: new Date(),
  };
}

const lines = fs.readFileSync(PDP_FILE, "utf8").split("\n").filter((l) => l.trim());
const rows = [];
for (const l of lines) { try { rows.push(JSON.parse(l)); } catch { /* skip */ } }
const ok = rows.filter((r) => !r.error && !r.skipped);
if (!ok.length) throw new Error("no usable records — aborting");

let docBytes = 0;
let capBytes = 0;
const byField = {};
let variantCount = 0, imageCount = 0, fileCount = 0;
const files = new Set();

for (const r of ok) {
  capBytes += Buffer.byteLength(JSON.stringify(r));
  const d = toProductDoc(r);
  docBytes += BSON.calculateObjectSize(d);
  for (const [k, v] of Object.entries(d)) {
    byField[k] = (byField[k] || 0) + BSON.calculateObjectSize({ [k]: v });
  }
  variantCount += d.variants.length;
  imageCount += d.images.length;
  for (const f of r.downloads || []) files.add(f.url);
}

const n = ok.length;
const TOTAL_PRODUCTS = Number(process.env.TOTAL) || n;
const perDoc = docBytes / n;
const projected = perDoc * TOTAL_PRODUCTS;
// Atlas "Data Size" counts documents; indexes are reported separately but
// consume the same tier allowance, so both are shown.
const INDEX_RATIO = 0.32; // measured on this cluster: 87.61 MB index / 274 MB data

console.log(`capture: ${n} products measured (${SITE})`);
console.log(`capture file per product : ${KB(capBytes / n)}`);
console.log(`stored document per product: ${KB(perDoc)}`);
console.log(`  variants ${(variantCount / n).toFixed(1)}/product · images ${(imageCount / n).toFixed(1)}/product`);
console.log("\ntop fields by stored size (per product):");
for (const [k, v] of Object.entries(byField).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${k.padEnd(18)} ${KB(v / n)}`);
}
console.log(`\n=== projection for ${TOTAL_PRODUCTS} products ===`);
console.log(`documents      : ${MB(projected)}`);
console.log(`indexes (~32%) : ${MB(projected * INDEX_RATIO)}`);
console.log(`TOTAL          : ${MB(projected * (1 + INDEX_RATIO))}`);
console.log(`distinct PDFs referenced: ${files.size}`);
