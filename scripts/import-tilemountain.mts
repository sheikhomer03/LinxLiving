/**
 * Import the tilemountain.co.uk capture into the SECONDARY cluster.
 *
 * Run with tsx, from the project root:
 *   npx tsx scripts/import-tilemountain.mts
 *
 * TypeScript rather than a .cjs script on purpose: this imports the real
 * Mongoose models, so every write gets the schema's defaults and validation.
 * The Drench import went in through the raw driver and put 5,670 products in
 * with a `stockStatus` outside the enum and no stock figure, which broke
 * every inbound webhook and showed the whole brand as out of stock.
 *
 * Reads `tm-pdp.jsonl` and `tm-cats.json` from `capture-tilemountain.cjs`.
 * Makes no network calls, so it can be re-run as the mapping is refined.
 *
 * Where things go: the brand document lives in the PRIMARY, because that is
 * the routing registry `clusterForBrand` reads, and carries
 * `dataCluster: "secondary"` so its products — and anything created under it
 * later — land in the second cluster.
 *
 * Two corrections carried over from Drench:
 *  - categories are stored as SLUGS, since the listing matches slugs exactly
 *    and Drench's display names ("Toilets & Basins") reached no category page;
 *  - `department` is always set, or the products sit outside every department
 *    page and the mega menu.
 *
 * Env:
 *   DRY_RUN=1   report the mapping and write nothing
 *   LIMIT=n     import only the first n products
 *   FRESH=1     delete this brand's existing products first
 */
import path from "path";
import fs from "fs";

for (const f of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), f);
  if (fs.existsSync(p)) (await import("dotenv")).config({ path: p });
}

const mc = await import("../src/lib/mongoCluster.ts");

const DATA =
  process.env.TM_DATA ||
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/a167de67-d47a-4f6e-aa8a-c11dee9e30bc/scratchpad";

const PDP_FILE = path.join(DATA, "tm-pdp.jsonl");
const CAT_FILE = path.join(DATA, "tm-cats.json");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const FRESH = process.env.FRESH === "1";

const BRAND_NAME = "Tile Mountain";
const BRAND_SLUG = "tile-mountain";
const SOURCE = "tilemountain-scrape";
/** Mirrors DEFAULT_STOCK in src/models/Product.ts. */
const DEFAULT_STOCK = 1000;

type Rec = {
  slug: string; url: string; sku: string | null; name: string;
  description: string | null; keyFeatures: string[];
  price: number | null; rrp: number | null; priceUnit: "sqm" | "each";
  availability: string | null; stock: number | null; stockUnit: string | null;
  images: string[]; attributes: Record<string, string>;
  size: string | null; boxQuantity: number | null; tilesPerSqm: number | null;
  sqmPerBox: number | null; variants: Record<string, unknown>;
  related: string[]; onSale: boolean;
};

type Member = { path: string; label: string; total: number };

/* ------------------------------------------------------------------ *
 * mapping
 * ------------------------------------------------------------------ */

/**
 * Which Linx department a Tile Mountain category belongs to.
 *
 * Driven by their URL prefix rather than the label: their own structure
 * already separates flooring and accessories from tiles, and underfloor
 * heating sits under accessories on their side but belongs with heating here.
 */
function departmentFor(catPath: string): string {
  if (/^\/accessories\/electric-underfloor-heating/.test(catPath)) return "heating";
  if (/^\/accessories/.test(catPath)) return "accessories";
  if (/^\/flooring/.test(catPath)) return "flooring";
  return "tiles";
}

/** The last path segment — already a slug on this site. */
function slugOf(catPath: string): string {
  return String(catPath || "").split("/").filter(Boolean).pop() || "";
}

/**
 * Catch-alls and merchandising shelves. They are the biggest categories on
 * the site, so picking "the largest" without excluding them files most of
 * the catalogue under "all-tiles-collection", which describes nothing.
 */
const NOT_A_CATEGORY = new Set([
  "all-tiles-collection", "best-sellers", "new-in", "new", "sale", "clearance",
  "cheap-tiles", "value-tiles", "offers", "tile-colours", "wall-tiles-by-colour",
  "flooring", "accessories", "tiles",
]);

/** The type-led categories, preferred over a room or colour shelf. */
const TYPE_CATEGORY =
  /(porcelain|ceramic|natural-stone|mosaic|metro|brick|quarry|paving|victorian|terrazzo|marble-effect|wood-effect|stone-effect|concrete-effect|patterned|luxury-vinyl|laminate|real-wood|spc|herringbone|parquet)/;

/**
 * The category a product is filed under, and the narrower one below it.
 *
 * A product sits in a dozen of their categories at once — "porcelain-tiles",
 * "grey-tiles", "bathroom-floor-tiles". The smallest is the most descriptive,
 * so it becomes the sub-category, and a broader type category above it
 * becomes the category.
 */
function chooseCategories(memberships: Member[]) {
  if (!memberships.length) {
    return { category: "", subCategory: "", department: "tiles" };
  }
  const sorted = [...memberships].sort((a, b) => a.total - b.total);
  const narrow = sorted[0];
  const department = departmentFor(narrow.path);
  const subCategory = slugOf(narrow.path);

  const candidates = sorted.filter(
    (c) =>
      departmentFor(c.path) === department &&
      !NOT_A_CATEGORY.has(slugOf(c.path)) &&
      slugOf(c.path) !== subCategory,
  );

  // A type category ("porcelain-tiles") says more than a room or colour
  // shelf ("bathroom-tiles", "grey-tiles"); among those, the broadest wins.
  const typed = candidates.filter((c) => TYPE_CATEGORY.test(slugOf(c.path)));
  const pool = typed.length ? typed : candidates;
  const chosen = pool.length ? pool[pool.length - 1] : null;

  return {
    category: chosen ? slugOf(chosen.path) : subCategory,
    subCategory: chosen ? subCategory : "",
    department,
  };
}

function escapeHtml(s: string) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSpecs(rec: Rec, allCats: string[]) {
  const specs: Record<string, unknown> = {
    source: SOURCE,
    sourceUrl: rec.url,
    sku: rec.sku || "",
  };

  for (const [k, v] of Object.entries(rec.attributes || {})) {
    if (k === "SKU") continue;
    specs[k] = v;
  }
  if (rec.size) specs.size = rec.size;

  /*
   * What the storefront's area calculator reads.
   *
   * `pricePerM2` is what makes a product sell by the square metre at all —
   * `resolveStorefrontUnitPrice` reads its absence as a unit price — and
   * `sqmPerBox` is what rounds a requested area up to whole boxes.
   */
  if (rec.priceUnit === "sqm" && (rec.price ?? 0) > 0) specs.pricePerM2 = rec.price;
  if (rec.sqmPerBox) specs.sqmPerBox = String(rec.sqmPerBox);
  if (rec.boxQuantity) specs.boxQuantity = String(rec.boxQuantity);
  if (rec.tilesPerSqm) specs.tilesPerSqm = String(rec.tilesPerSqm);
  if (rec.rrp) specs.compareAtPrice = rec.rrp;
  if (rec.variants && Object.keys(rec.variants).length) specs.sourceVariants = rec.variants;
  if (allCats.length) specs.sourceCategories = allCats;

  return specs;
}

function toProduct(rec: Rec, memberships: Member[], brandId: unknown) {
  const chosen = chooseCategories(memberships);
  const allCats = memberships.map((m) => slugOf(m.path));
  const perSqm = rec.priceUnit === "sqm";

  /*
   * Their stock figure is square metres for anything sold by area and a
   * plain count otherwise; either way it is a quantity, which is what the
   * field holds. A product with no figure takes the schema default rather
   * than zero, which the storefront would read as out of stock.
   */
  const stock =
    rec.stock != null && Number.isFinite(rec.stock) && rec.stock > 0
      ? Math.round(rec.stock)
      : DEFAULT_STOCK;

  const inStock = String(rec.availability || "").toLowerCase() !== "outofstock";

  const description = [
    rec.description || "",
    rec.keyFeatures?.length
      ? "<ul>" + rec.keyFeatures.map((f) => "<li>" + escapeHtml(f) + "</li>").join("") + "</ul>"
      : "",
  ].filter(Boolean).join("\n");

  return {
    name: rec.name,
    description,
    price: Number(rec.price) || 0,
    stock,
    isOutOfStock: !inStock,
    stockStatus: inStock ? "in_stock" : "out_of_stock",
    category: chosen.category,
    subCategory: chosen.subCategory,
    department: chosen.department,
    brand: brandId,
    images: Array.isArray(rec.images) ? rec.images : [],
    features: Array.isArray(rec.keyFeatures) ? rec.keyFeatures : [],
    specs: buildSpecs(rec, allCats),
    supplierSku: rec.sku || "",
    // Tiles and flooring are sold by the square metre; accessories are not.
    soldPerUnit: !perSqm,
    isActive: true,
  };
}

/* ------------------------------------------------------------------ *
 * capture files
 * ------------------------------------------------------------------ */

function readCapture(): Rec[] {
  if (!fs.existsSync(PDP_FILE)) throw new Error("no capture at " + PDP_FILE);
  const out: Rec[] = [];
  const seen = new Set<string>();
  for (const line of fs.readFileSync(PDP_FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Rec;
      if (r?.slug && r?.name && !seen.has(r.slug)) { seen.add(r.slug); out.push(r); }
    } catch { /* a half-written final line */ }
  }
  return out;
}

function membershipIndex(): Map<string, Member[]> {
  const idx = new Map<string, Member[]>();
  if (!fs.existsSync(CAT_FILE)) return idx;
  for (const c of JSON.parse(fs.readFileSync(CAT_FILE, "utf8"))) {
    for (const slug of c.products) {
      if (!idx.has(slug)) idx.set(slug, []);
      idx.get(slug)!.push({ path: c.path, label: c.label, total: c.total });
    }
  }
  return idx;
}

/* ------------------------------------------------------------------ *
 * driver
 * ------------------------------------------------------------------ */

const recs = readCapture();
const memberships = membershipIndex();

console.log("capture   : " + recs.length + " products");
console.log("mode      : " + (DRY_RUN ? "DRY RUN" : "LIVE"));
console.log("");

const byDept: Record<string, number> = {};
const sample: string[] = [];
for (const r of recs) {
  const c = chooseCategories(memberships.get(r.slug) || []);
  byDept[c.department] = (byDept[c.department] || 0) + 1;
  if (sample.length < 6) {
    sample.push(
      "  " + r.name.slice(0, 44).padEnd(46) + c.department.padEnd(12) +
      (c.category || "-").padEnd(26) + (c.subCategory || "-"),
    );
  }
}
console.log("department split:");
for (const [d, n] of Object.entries(byDept).sort((a, b) => b[1] - a[1])) {
  console.log("  " + d.padEnd(14) + n);
}
console.log("");
console.log("  " + "name".padEnd(46) + "department".padEnd(12) + "category".padEnd(26) + "subCategory");
sample.forEach((s) => console.log(s));
console.log("");
console.log("priced        : " + recs.filter((r) => Number(r.price) > 0).length + "/" + recs.length);
console.log("with images   : " + recs.filter((r) => r.images?.length).length + "/" + recs.length);
console.log("sold per m2   : " + recs.filter((r) => r.priceUnit === "sqm").length + "/" + recs.length);
console.log("with coverage : " + recs.filter((r) => r.sqmPerBox).length + "/" + recs.length + "   (area calculator)");
console.log("");

if (DRY_RUN) process.exit(0);

// ---- brand: primary registry, pointed at the secondary -----------------
const Brand = await mc.modelFor("primary", "Brand");
let brand: any = await Brand.findOne({ slug: BRAND_SLUG });
if (!brand) {
  brand = await Brand.create({
    name: BRAND_NAME,
    slug: BRAND_SLUG,
    isActive: true,
    dataCluster: "secondary",
  });
  console.log("brand created: " + BRAND_NAME + " -> secondary  (" + brand._id + ")");
} else {
  if (brand.dataCluster !== "secondary") {
    brand.dataCluster = "secondary";
    await brand.save();
  }
  console.log("brand exists : " + BRAND_NAME + "  (" + brand._id + ")");
}
mc.invalidateBrandRoutes();

// ---- products: secondary cluster ---------------------------------------
const Product = await mc.modelFor("secondary", "Product");

if (FRESH) {
  const r = await Product.deleteMany({ brand: brand._id });
  console.log("FRESH: removed " + r.deletedCount + " existing products");
}

let created = 0, updated = 0, failed = 0;
const slice = recs.slice(0, LIMIT);

for (let i = 0; i < slice.length; i++) {
  const rec = slice[i];
  try {
    const doc = toProduct(rec, memberships.get(rec.slug) || [], brand._id);
    const existing: any = await Product.findOne({
      brand: brand._id,
      "specs.sourceUrl": rec.url,
    });
    if (existing) {
      Object.assign(existing, doc);
      await existing.save();
      updated++;
    } else {
      await Product.create(doc);
      created++;
    }
  } catch (e) {
    failed++;
    if (failed <= 10) console.error("  failed " + rec.slug + ": " + (e as Error).message);
  }
  if ((i + 1) % 200 === 0) {
    console.log("  " + (i + 1) + "/" + slice.length + "  created=" + created + " updated=" + updated + " failed=" + failed);
  }
}

console.log("");
console.log("created : " + created);
console.log("updated : " + updated);
console.log("failed  : " + failed);
console.log("in secondary: " + (await Product.countDocuments({ brand: brand._id })));
process.exit(0);
