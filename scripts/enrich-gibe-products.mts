/**
 * Add the fields the first Drench/Tap Warehouse import never captured.
 *
 * Run with tsx, from the project root:
 *   SITE=drench BRAND=drench npx tsx scripts/enrich-gibe-products.mts
 *
 * An enrichment pass, not a re-import. The products already carry their
 * Shopify ids, their mirrored galleries and a stock figure that has since
 * been corrected by hand; rewriting them wholesale would put all of that at
 * risk to add four fields. So this touches only what was missing:
 *
 *   variants          - every purchasable option with its own gallery. The
 *                       old parser read one JSON-LD block of several, so a
 *                       four-finish product looked like a single SKU.
 *   downloads         - datasheets and guides. The anchors use an unquoted
 *                       href, so the old extraction found none at all.
 *   technicalDrawings - the extra gallery tile the shop injects client-side,
 *                       which is why a six-image product arrived with five.
 *   finish            - clears "Select an option first", the selector's
 *                       placeholder text stored as though it were a value.
 *
 * Documents are pointed at our own copies under /product-files where
 * `download-product-files.cjs` has fetched them, and left on the source URL
 * where it has not.
 *
 * Env:
 *   SITE=name   which capture to read (default "drench")
 *   BRAND=slug  which brand to update (default: same as SITE)
 *   DRY_RUN=1   report and write nothing
 *   LIMIT=n     only the first n captured products
 */
import path from "path";
import fs from "fs";

for (const f of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), f);
  if (fs.existsSync(p)) (await import("dotenv")).config({ path: p });
}

const mc = await import("../src/lib/mongoCluster.ts");

const SITE = process.env.SITE || "drench";
const BRAND_SLUG = process.env.BRAND || SITE;
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;

const DATA =
  process.env.GIBE_DATA ||
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/a167de67-d47a-4f6e-aa8a-c11dee9e30bc/scratchpad";

const PDP_FILE = path.join(DATA, SITE + "-pdp.jsonl");
const MANIFEST = path.join(DATA, SITE + "-files-manifest.json");

/** The selector's placeholder, stored as a value by the first import. */
const FINISH_PLACEHOLDER = /^\s*select an option/i;

type Download = { url: string; kind: string; label: string; ext: string; filename: string };
type GalleryItem = { url: string; full?: string; alt?: string; isTechnicalDrawing?: boolean };
type LdVariant = {
  sku: string; mpn: string; name: string; price: number | null;
  availability: string; url: string; options: string[]; optionsText: string;
  tradePrices: { tier: string; price: number | null }[];
  gallery: GalleryItem[];
};
type Rec = {
  url: string; name: string; skipped?: string;
  gallery: GalleryItem[]; technicalDrawings: GalleryItem[];
  downloads: Download[]; ldVariants: LdVariant[]; variantGroups: string[];
};

/**
 * The shop's own document type, mapped onto the schema's enum.
 *
 * `kind` arrives as the attribute name the shop uses — PdfInstallationGuide,
 * PdfCleaningInstructions, PdfDatasheet — so the match is on the meaningful
 * part of that name rather than an exhaustive list.
 */
function downloadType(kind: string, label: string): string {
  const s = (kind + " " + label).toLowerCase();
  if (/install|fitting|assembly/.test(s)) return "install";
  if (/drawing|schematic|dimension/.test(s)) return "drawing";
  if (/certificat|declaration|warranty|guarantee/.test(s)) return "certificate";
  if (/\bpdf\b|datasheet|instruction|manual|care|spec/.test(s)) return "pdf";
  return "other";
}

function readCapture(): Rec[] {
  if (!fs.existsSync(PDP_FILE)) throw new Error("no capture at " + PDP_FILE);
  const out: Rec[] = [];
  const seen = new Set<string>();
  for (const line of fs.readFileSync(PDP_FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Rec;
      if (!r?.url || r.skipped || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push(r);
    } catch { /* a half-written final line */ }
  }
  return out;
}

const manifest: Record<string, { path: string; kind: string; label: string }> =
  fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};

function mapDownloads(rec: Rec) {
  const out = [];
  const seen = new Set<string>();
  for (const d of rec.downloads || []) {
    if (!d?.url || seen.has(d.url)) continue;
    seen.add(d.url);
    const local = manifest[d.url];
    out.push({
      title: d.label || d.filename || "Download",
      // Our copy where we have one; the source until then, so a product is
      // never left pointing at nothing.
      url: local ? local.path : d.url,
      type: downloadType(d.kind, d.label),
      sourceUrl: d.url,
    });
  }
  return out;
}

function mapVariants(rec: Rec, groups: string[]) {
  return (rec.ldVariants || []).map((v, i) => {
    // "Matt White, White Worktop" against ["Finish", "Option"].
    const options: Record<string, string> = {};
    v.options.forEach((val, n) => {
      const key = groups[n] || "Option" + (n + 1);
      options[key] = val;
    });
    const images = (v.gallery || []).map((g) => g.full || g.url).filter(Boolean);
    const trade = (v.tradePrices || []).filter((t) => typeof t.price === "number");
    return {
      name: v.name || v.optionsText || v.sku,
      sku: v.sku,
      externalId: v.sku,
      options,
      option1: v.options[0] || "",
      option2: v.options[1] || "",
      option3: v.options[2] || "",
      price: v.price,
      tradePrice: trade.length ? Math.min(...trade.map((t) => Number(t.price))) : null,
      available: !/outofstock/i.test(v.availability || ""),
      imageUrl: images[0] || "",
      images,
      position: i,
      isDefault: i === 0,
    };
  });
}

/* ------------------------------------------------------------------ *
 * driver
 * ------------------------------------------------------------------ */

const recs = readCapture().slice(0, LIMIT);
console.log("site      : " + SITE);
console.log("brand     : " + BRAND_SLUG);
console.log("capture   : " + recs.length + " products");
console.log("manifest  : " + Object.keys(manifest).length + " downloaded files");
console.log("mode      : " + (DRY_RUN ? "DRY RUN" : "LIVE"));
console.log("");

const withVariants = recs.filter((r) => (r.ldVariants || []).length).length;
const withDownloads = recs.filter((r) => (r.downloads || []).length).length;
const withDrawings = recs.filter((r) => (r.technicalDrawings || []).length).length;
const variantImgs = recs.reduce(
  (a, r) => a + (r.ldVariants || []).reduce((b, v) => b + (v.gallery || []).length, 0),
  0,
);
console.log("in the capture:");
console.log("   with variants        : " + withVariants);
console.log("   with downloads       : " + withDownloads);
console.log("   with technical drawing: " + withDrawings);
console.log("   variant images        : " + variantImgs);
console.log("");

const Brand = await mc.modelFor("primary", "Brand");
const brand: any = await Brand.findOne({ slug: BRAND_SLUG }).lean();
if (!brand) throw new Error("brand not found: " + BRAND_SLUG);
const { model: Product } = await mc.productModelForBrand(brand._id);

/*
 * One read and batched writes, not a round trip per product.
 *
 * Matching 5,557 captured products with `findOne` each means 5,557 separate
 * journeys to Atlas, which takes the better part of an hour from here. The
 * source URL is indexed-by-value in the capture, so the whole id map is one
 * projection and the updates go in batches.
 */
const index = new Map<string, unknown>();
const cursor = Product.find({ brand: brand._id })
  .select({ _id: 1, "specs.sourceUrl": 1, sourceUrl: 1, finish: 1 })
  .lean()
  .cursor();

const junkFinish: unknown[] = [];
for await (const d of cursor as any) {
  const key = d?.specs?.sourceUrl || d?.sourceUrl;
  if (key) index.set(String(key), d._id);
  if (typeof d?.finish === "string" && FINISH_PLACEHOLDER.test(d.finish)) {
    junkFinish.push(d._id);
  }
}
console.log("products in db: " + index.size);
console.log("placeholder finish to clear: " + junkFinish.length);
console.log("");

let matched = 0, updated = 0, missing = 0, unchanged = 0;
let ops: any[] = [];

async function flush() {
  if (DRY_RUN || !ops.length) { ops = []; return; }
  await Product.bulkWrite(ops, { ordered: false });
  ops = [];
}

for (const rec of recs) {
  const id = index.get(rec.url);
  if (!id) { missing += 1; continue; }
  matched += 1;

  const downloads = mapDownloads(rec);
  const variants = mapVariants(rec, rec.variantGroups || []);
  const drawings = (rec.technicalDrawings || [])
    .map((t) => t.full || t.url)
    .filter(Boolean);

  const set: Record<string, unknown> = {};
  if (downloads.length) set.downloads = downloads;
  if (drawings.length) set.technicalDrawings = drawings;
  if (variants.length) {
    set.variants = variants;
    set.variantGroups = rec.variantGroups || [];
  }
  if (!Object.keys(set).length) { unchanged += 1; continue; }

  ops.push({ updateOne: { filter: { _id: id }, update: { $set: set } } });
  updated += 1;

  if (updated <= 4) {
    console.log("  " + String(rec.name).slice(0, 44).padEnd(46) +
      "variants=" + variants.length +
      " downloads=" + downloads.length +
      " drawings=" + drawings.length);
  }
  if (ops.length >= 500) {
    await flush();
    console.log("  written " + updated + " / matched " + matched);
  }
}
await flush();

// The placeholder is not a finish, and it is on products the capture may not
// even touch, so it is cleared in its own pass.
if (junkFinish.length && !DRY_RUN) {
  const r = await Product.updateMany(
    { _id: { $in: junkFinish } },
    { $set: { finish: "" } },
  );
  console.log("cleared placeholder finish on " + r.modifiedCount + " products");
}

console.log("");
console.log("matched in db : " + matched);
console.log("updated       : " + updated);
console.log("nothing to add: " + unchanged);
console.log("not in db     : " + missing);
process.exit(0);
