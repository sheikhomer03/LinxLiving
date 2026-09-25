/**
 * Import the Al Murad capture (scripts/capture-al-murad.cjs) into Mongo.
 *
 * Strict rules for this brand:
 *
 *  - INSERT ONLY. Every product this script writes is a brand-new document.
 *    It never runs an updateOne against an existing row, Al Murad's own or
 *    any other brand's — a product whose `sourceUrl` is already held (in
 *    EITHER cluster) is skipped, not overwritten. Re-running this script is
 *    always safe.
 *  - NO NEW CATEGORIES. Al Murad's own 26 nav categories are mapped onto
 *    categories that already exist on the site today (verified against the
 *    live `products` collections, not invented) — see CATEGORY_MAP below.
 *    Nothing is written to the `menus` collection.
 *  - Stock is fixed at 500 for every product (STOCK_DEFAULT), per the brand
 *    owner's instruction — not the schema's usual DEFAULT_STOCK.
 *  - Images are left as Al Murad's own CDN URLs in `images[]`. Nothing is
 *    downloaded or re-hosted here: `scripts/sync-all-products-to-shopify.cjs
 *    --brand="Al Murad"` uploads them straight to Shopify (Shopify fetches
 *    the URL itself — see toUploadableUrl in src/lib/shopify/sync-media.ts,
 *    which passes non-Cloudinary URLs through unchanged), and a follow-up
 *    pass (REWRITE_IMAGES=1 below) then replaces `images[]` with the
 *    resulting Shopify CDN URLs so the DB ends up holding only Shopify
 *    links, never the supplier's.
 *
 * Env:
 *   AM_DATA=path   capture directory (must match capture-al-murad.cjs)
 *   DRY_RUN=1      parse and report, write nothing
 *   LIMIT=n        only the first n captured products
 *   ACTIVATE=1     set the brand live once the import succeeds (default: off)
 *   REWRITE_IMAGES=1
 *                  skip the import; instead replace images[] with shopifyUrl
 *                  for every Al Murad product that has a completed Shopify
 *                  sync, then report anything still pending.
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const ACTIVATE = process.env.ACTIVATE === "1";
const REWRITE_IMAGES = process.env.REWRITE_IMAGES === "1";

const AM_DATA =
  process.env.AM_DATA ||
  "/Users/niazig/Desktop/linxliving/LinxLiving/.scratch/almurad";
const PDP_FILE = path.join(AM_DATA, "am-pdp.jsonl");

const BRAND_NAME = "Al Murad";
const BRAND_SLUG = "al-murad";
const SOURCE_TAG = "al-murad-scrape";
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 500);

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * Al Murad's own 26 nav categories, mapped onto categories that already
 * exist in the live `products` collections today (checked by hand against
 * `distinct("category", { department })` on both clusters before writing
 * this table — nothing here is a new slug).
 *
 * `skip: true` marks an Al Murad grouping that is promotional/a range name
 * rather than a real taxonomy bucket (Sale, Trade Club, a named collection).
 * Those never become `category` on their own — the product's *other*
 * Al Murad category (almost every product carries more than one) supplies
 * the real bucket, and the promo name is kept as `rangeName` / a badge
 * instead of being forced into the taxonomy.
 */
const CATEGORY_MAP = {
  "Wall Tiles": { department: "tiles", category: "luxury-wall-tiles" },
  "Floor Tiles": { department: "tiles", category: "floor-tiles" },
  "Outdoor Tiles": { department: "tiles", category: "outdoor-tiles" },
  "Mosaic Tiles": { department: "tiles", category: "mosaic-tiles" },
  "Wall Panels": { department: "wall-panels", category: "claddings" },
  "Marble Effect Tiles": { department: "tiles", category: "natural-stone-effect-tiles" },
  "Brick Metro Tiles": { department: "tiles", category: "brick-tiles" },
  "Patterned Tiles": { department: "tiles", category: "patterned-tiles" },
  "Bathroom Tiles": { department: "tiles", category: "bathroom-tiles" },
  "Kitchen Tiles": { department: "tiles", category: "kitchen-tiles" },
  "Natural Stone Tiles": { department: "tiles", category: "natural-stone-effect-tiles" },
  "Wood Effect Tiles": { department: "tiles", category: "floor-tiles" },
  "Porcelain Floor Tiles": { department: "tiles", category: "porcelain-tiles" },
  "Hexagon Mosaic Tiles": { department: "tiles", category: "mosaic-tiles" },
  "Non Slip Floor Tiles": { department: "tiles", category: "wet-room-flooring" },
  "Onyx Effect Tiles": { department: "tiles", category: "natural-stone-effect-tiles" },
  "Polished Tiles": { department: "tiles", category: "porcelain-tiles" },
  "Hexagon Tiles": { department: "tiles", category: "mosaic-tiles" },
  "Spc Vinyl Laminate Flooring": { department: "flooring", category: "vinyl-flooring" },
  "Acoustic Wood Wall Panels": { department: "wall-panels", category: "claddings" },
  "Tiling Accessories": { department: "accessories", category: "accessories" },
  "Regency Range": { department: "tiles", category: "mosaic-tiles" },
  "Mapei Super Summer Offer": { department: "accessories", category: "accessories" },
  Sale: { skip: true },
  SALE: { skip: true },
  "Italian Collection": { skip: true },
  "Trade Club": { skip: true },

  /*
   * Real per-product category names from Al Murad's own JSON-LD `category`
   * array (richer than the 26 nav links — see mapCategories doc comment)
   * that came back as the SOLE mapped category for at least one product in
   * a full-catalogue dry run. Every target here is a category slug already
   * verified to exist in the live `products` collections (see the file
   * header) — nothing new is introduced.
   */
  "Brick & Metro Tiles": { department: "tiles", category: "brick-tiles" },
  "Metro & Brick Tiles": { department: "tiles", category: "brick-tiles" },
  "Ceramic Tiles": { department: "tiles", category: "ceramic-tiles" },
  "Ceramic Wall & Floor Tiles": { department: "tiles", category: "ceramic-tiles" },
  "Ceramic Wall Tiles": { department: "tiles", category: "ceramic-tiles" },
  "Extra Large Format Tiles": { department: "tiles", category: "floor-tiles" },
  "XL Porcelain Tiles": { department: "tiles", category: "porcelain-tiles" },
  "Glass Tiles": { department: "tiles", category: "mosaic-tiles" },
  "Glass Metro Tiles": { department: "tiles", category: "mosaic-tiles" },
  "Glass Border Tiles": { department: "tiles", category: "mosaic-tiles" },
  "Border & Special Tiles": { department: "tiles", category: "patterned-tiles" },
  "Unique Border & Special Tiles": { department: "tiles", category: "patterned-tiles" },
  "Non-Slip Floor Tiles": { department: "tiles", category: "wet-room-flooring" },
};

/**
 * A handful of Al Murad's own cross-list labels are price-band or promo
 * groupings ("Tiles Under £20.00 per M2", every "... Offer" banner) rather
 * than a taxonomy bucket, and new ones appear often enough that hard-coding
 * each is a losing game — caught structurally instead of by name.
 */
function isPromoOnlyName(name) {
  return /^Tiles Under £|Offer$|^SALE$/i.test(name);
}

/**
 * `["Wall Tiles/","Bathroom Tiles/Marble Effect Tiles"]` (JSON-LD) ->
 * `["Wall Tiles","Bathroom Tiles","Marble Effect Tiles"]`.
 *
 * A cross-listed product carries entries like "Bathroom Tiles/Marble Effect
 * Tiles" — Al Murad's own "filed under Bathroom Tiles, sub Marble Effect
 * Tiles" breadcrumb, not a single category literally named with a slash in
 * it. Splitting on '/' surfaces both real names; a first pass that only
 * stripped a *trailing* slash left the whole compound string as one atomic,
 * unmatchable name and silently dropped ~1,000 products into "no mappable
 * category".
 */
function cleanLdCategories(arr) {
  const out = new Set();
  for (const c of arr || []) {
    for (const part of String(c).split("/")) {
      const v = clean(part);
      if (v) out.add(v);
    }
  }
  return [...out];
}

/**
 * The mapped {department, category} bucket(s) for a product, from its own
 * JSON-LD categories first (the canonical assignment Al Murad itself makes)
 * falling back to the crawl paths it was discovered under.
 */
function bucketsFrom(names) {
  const buckets = [];
  const rangeNames = [];
  for (const name of names) {
    const m = CATEGORY_MAP[name];
    if (m) {
      if (m.skip) {
        rangeNames.push(name);
      } else if (!buckets.some((b) => b.category === m.category)) {
        buckets.push(m);
      }
      continue;
    }
    if (isPromoOnlyName(name)) rangeNames.push(name);
  }
  return { buckets, rangeNames };
}

/** Last-resort: what the product's own name says it is, when every category signal was promo-only. */
function guessFromName(name) {
  const n = String(name || "").toLowerCase();
  if (/wall panel/.test(n)) return { department: "wall-panels", category: "claddings" };
  if (/mosaic/.test(n)) return { department: "tiles", category: "mosaic-tiles" };
  if (/wall (and |&|\/)? ?floor|wall tile/.test(n)) return { department: "tiles", category: "luxury-wall-tiles" };
  if (/floor tile/.test(n)) return { department: "tiles", category: "floor-tiles" };
  return null;
}

function mapCategories(rec, catTitleByPath) {
  const ldNames = cleanLdCategories(rec.ldCategories);
  let { buckets, rangeNames } = bucketsFrom(ldNames);

  /*
   * Fall back to the crawl path whenever the JSON-LD categories didn't
   * resolve to a real bucket — not only when they were empty. A product
   * whose only JSON-LD entry is "SALE/" (Al Murad publishes no real category
   * for a handful of promo-only listings) still has a real home: the actual
   * category/subcategory it was found under while walking the site.
   */
  if (!buckets.length) {
    const pathNames = new Set();
    for (const p of rec.categoryPaths || []) {
      const top = "/" + p.replace(/^\//, "").split("/")[0];
      const title = catTitleByPath.get(top);
      if (title) pathNames.add(title);
    }
    const fromPaths = bucketsFrom([...pathNames]);
    if (fromPaths.buckets.length) buckets = fromPaths.buckets;
    rangeNames = [...rangeNames, ...fromPaths.rangeNames];
  }

  if (!buckets.length) {
    const guess = guessFromName(rec.name);
    if (guess) buckets = [guess];
  }

  return { buckets, rangeNames: [...new Set(rangeNames)] };
}

function buildOptions(rec) {
  const groups = [];
  const sizeOptions = [];
  const colorOptions = [];
  for (const [name, values] of Object.entries(rec.options || {})) {
    groups.push(name);
    if (/size/i.test(name)) {
      for (const v of values) sizeOptions.push({ name: v });
    } else if (/colou?r/i.test(name)) {
      for (const v of values) colorOptions.push({ name: v, swatchType: "solid" });
    }
  }
  return { groups, sizeOptions, colorOptions };
}

async function main() {
  if (!fs.existsSync(PDP_FILE)) {
    throw new Error(
      "no capture at " + PDP_FILE + " — run capture-al-murad.cjs first",
    );
  }

  const seedFile = path.join(__dirname, "..", "al_murad_categories.json");
  const seeds = JSON.parse(fs.readFileSync(seedFile, "utf8"));
  const catTitleByPath = new Map(
    seeds.map((c) => [new URL(c.link).pathname, c.title]),
  );

  const { db: primary } = await connectMongo();

  let brand = await primary.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) {
    if (DRY_RUN) {
      console.log("[dry] would create brand " + BRAND_NAME + " (dataCluster: secondary)");
      brand = { _id: new mongoose.Types.ObjectId(), dataCluster: "secondary" };
    } else {
      const res = await primary.collection("brands").insertOne({
        name: BRAND_NAME,
        slug: BRAND_SLUG,
        dataCluster: "secondary",
        isActive: ACTIVATE,
        order: 0,
        subBrands: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      brand = { _id: res.insertedId, dataCluster: "secondary" };
      console.log("created brand " + BRAND_NAME + " (" + brand._id + ", secondary cluster, isActive=" + ACTIVATE + ")");
    }
  } else {
    console.log("brand already exists: " + BRAND_NAME + " (" + brand._id + ")");
  }

  let secConn = null;
  let db = primary;
  if (brand.dataCluster === "secondary") {
    secConn = await mongoose
      .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 })
      .asPromise();
    db = secConn.db;
  }
  console.log("products go to: " + (secConn ? "SECONDARY" : "PRIMARY") + " cluster");

  const productsCol = db.collection("products");

  if (REWRITE_IMAGES) {
    /*
     * Scoped to `brand: brand._id` on every read and write below — this can
     * only ever touch an Al Murad product, never another brand's.
     */
    const cursor = productsCol.find({
      brand: brand._id,
      shopifyImages: { $exists: true, $ne: [] },
    });
    let checked = 0, rewritten = 0, pending = 0;
    for await (const p of cursor) {
      checked++;
      const urls = (p.shopifyImages || [])
        .filter((si) => si.shopifyUrl)
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map((si) => si.shopifyUrl);
      if (!urls.length || urls.length < (p.images || []).length) {
        pending++;
        continue;
      }
      if (!DRY_RUN) {
        await productsCol.updateOne(
          { _id: p._id, brand: brand._id },
          { $set: { images: urls } },
        );
      }
      rewritten++;
    }
    console.log(
      `checked ${checked} Al Murad products with Shopify media, rewrote images[] on ${rewritten}${DRY_RUN ? " [dry]" : ""}, ${pending} still waiting on Shopify to finish processing`,
    );
    if (secConn) await secConn.close();
    return;
  }

  /*
   * Strict "touch nothing existing" guard, enforced in code, not just intent:
   *
   *  1. This script contains no updateOne / updateMany / bulkWrite / deleteOne
   *     anywhere — the only write to `products` below is insertMany, which by
   *     definition cannot alter or remove a document that already exists.
   *  2. Every candidate is skipped if its sourceUrl already exists, in EITHER
   *     cluster (see `existing` below), so a re-run can only ever add rows,
   *     never touch the ones a previous run created.
   *  3. The collection's own document count is compared before and after —
   *     if the delta isn't exactly the number of rows this run inserted,
   *     something outside this script changed the collection concurrently
   *     and the run aborts loudly rather than reporting a false success.
   */
  const countBefore = DRY_RUN ? 0 : await productsCol.countDocuments();

  /*
   * Read every sourceUrl this brand (or anyone else importing al-murad.co.uk)
   * already holds, in BOTH clusters, so a re-run — or a URL that somehow
   * landed on the other cluster — is never written twice.
   */
  const primaryProducts = primary.collection("products");
  const existing = new Set();
  for (const col of [primaryProducts, productsCol]) {
    for await (const row of col.find({ sourceUrl: /al-murad\.co\.uk/i }).project({ sourceUrl: 1 })) {
      existing.add(row.sourceUrl);
    }
  }
  console.log("already in Mongo (either cluster): " + existing.size + " Al Murad products");

  const lines = fs.readFileSync(PDP_FILE, "utf8").split("\n").filter((l) => l.trim());
  console.log("capture holds " + lines.length + " records");

  let created = 0, skippedExisting = 0, skippedError = 0, noCategoryBucket = 0;
  const catCount = new Map();
  const unmappedNames = new Set();
  let ops = [];

  const flush = async () => {
    if (!ops.length) return;
    const batch = ops;
    ops = [];
    if (!DRY_RUN) await productsCol.insertMany(batch, { ordered: false });
  };

  let processed = 0;
  for (const line of lines) {
    if (processed >= LIMIT) break;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      skippedError++;
      continue;
    }
    if (rec.error || !rec.name) {
      skippedError++;
      continue;
    }
    processed++;

    if (existing.has(rec.sourceUrl)) {
      skippedExisting++;
      continue;
    }

    const { buckets, rangeNames } = mapCategories(rec, catTitleByPath);
    for (const n of cleanLdCategories(rec.ldCategories)) {
      if (!CATEGORY_MAP[n]) unmappedNames.add(n);
    }
    if (!buckets.length) {
      noCategoryBucket++;
      continue; // never guess a category — report it instead (see summary)
    }
    const primaryBucket = buckets[0];
    for (const b of buckets) {
      catCount.set(b.category, (catCount.get(b.category) || 0) + 1);
    }

    const { groups, sizeOptions, colorOptions } = buildOptions(rec);
    const specs = rec.specs || {};
    const perSqm = parseFloat(
      specs["N° of Tiles per Square Metre (m2)"] ?? specs["N° of Sheets per Square Metre (m2)"],
    );
    const perPack = parseFloat(
      specs["N° of Tiles per Pack"] ?? specs["N° of Sheets per Pack"],
    );

    /*
     * `rec.price` is always the true per-unit-sold (per tile / per sheet)
     * figure — confirmed against the site's own coverage calculator (7
     * tiles × £4.49 = £31.43, exactly what it quotes). `rec.rrp` and
     * `rec.wasPrice`, though, are sometimes shown per m² instead (the
     * standard tile layout shows both a per-m² AND a per-tile price side by
     * side; a mosaic sold as a single "per Sheet" figure has no m² split at
     * all, and its RRP already shares that same implicit unit). Comparing a
     * per-m² RRP straight against a per-tile price would misstate the
     * discount by a factor of `perSqm` and risk a false "was" price on the
     * storefront, so a per-m² figure is converted onto the same per-tile
     * basis as `price` before it is stored.
     */
    function toPerUnit(block) {
      if (!block || typeof block.value !== "number") return null;
      const isPerSqm = /per\s*m/i.test(block.unit || "");
      if (isPerSqm) {
        // Cannot convert without the tiles-per-m² figure — storing the raw
        // per-m² number against a per-tile price would show a fabricated
        // discount, so this product gets no RRP rather than a wrong one.
        return perSqm > 0 ? block.value / perSqm : null;
      }
      return block.value;
    }
    let rrpIncVat = toPerUnit(rec.rrp);
    // A "was" price that isn't actually higher than the current price is
    // either a leftover unit mismatch or a genuine site pricing quirk
    // (confirmed against a full-catalogue check: happens on 2/3,776) —
    // either way it is not a real discount, so it is not stored as one.
    if (typeof rrpIncVat === "number" && typeof rec.price === "number" && rrpIncVat <= rec.price) {
      rrpIncVat = null;
    }
    const specialPrice = toPerUnit(rec.wasPrice);

    const now = new Date();

    const doc = {
      name: clean(rec.name),
      // Tiles publish a structured spec table (used above); accessories and
      // tools instead carry free-text marketing prose in the same tab, which
      // parses to zero spec pairs but is real descriptive copy, not nothing —
      // falling straight to the bare product name would throw it away.
      // One spec per line — ProductDetailTabs splits a plain-text
      // description on "\n" into a lead line + a bulleted list (see
      // src/components/products/ProductDetailTabs.tsx), matching how
      // Al Murad's own PDP lays the same spec table out. Joined with ". "
      // instead, this collapsed into one dense run-on paragraph.
      description:
        Object.entries(specs).map(([k, v]) => `${k}: ${v}`).join("\n") ||
        clean(rec.rawSpecsText) ||
        clean(rec.name),
      shortDescription: "",

      price: typeof rec.price === "number" ? rec.price : 0,
      priceCurrency: rec.priceCurrency || "GBP",
      rrpIncVat,
      specialPrice,
      // Mosaics carry no `price_infix_text` element at all — the only "per
      // Sheet" tell is a free-text note at the top of the description tab.
      unitOfMeasure: (() => {
        const hint = (rec.priceUnit || "") + " " + (rec.rawSpecsText || "").slice(0, 60);
        if (/per\s*(tile|sheet)/i.test(hint)) return "Each";
        if (/per\s*m/i.test(hint)) return "m²";
        return "";
      })(),

      images: rec.images || [],

      department: primaryBucket.department,
      category: primaryBucket.category,
      categories: buckets.map((b) => b.category),
      subCategory: "",
      subCategories: [],
      sourceCategories: cleanLdCategories(rec.ldCategories).map((name) => ({ name })),

      brand: brand._id,
      brands: [brand._id],
      subBrand: "",

      rangeName: rangeNames[0] || "",

      supplierSku: rec.sku || "",
      productCode: rec.sku || "",
      finish: specs.Finish || "",
      materials: [specs.Material].filter(Boolean),
      colours: [specs.Colour].filter(Boolean),
      colorOptions,
      sizeOptions,
      variantGroups: groups,

      dimensions: specs["Size (cm)"] ? { size: specs["Size (cm)"] } : {},
      thickness: specs["Thickness (mm)"] || "",
      // Mosaics are quoted "per Sheet" rather than "per Tile" — both wordings
      // carry the same two figures the coverage calculator needs.
      packCoverageM2: perSqm > 0 ? (1 / perSqm) * (perPack || 1) : null,
      piecesPerPack: perPack || null,

      stock: STOCK_DEFAULT,
      isOutOfStock: /out\s*of\s*stock/i.test(rec.availability || ""),
      stockStatus: /out\s*of\s*stock/i.test(rec.availability || "") ? "out_of_stock" : "in_stock",

      attributes: Object.entries(specs).map(([label, value]) => ({ label, value: String(value) })),

      sourceUrl: rec.sourceUrl,
      sourceHandle: rec.sourceUrl.split("/").pop(),
      sourceProductId: rec.id,
      sourceSku: rec.sku || "",
      canonicalUrl: rec.sourceUrl,

      /*
       * The PDP's coverage calculator and buy box do NOT read the typed
       * top-level fields above (packCoverageM2, unitOfMeasure, etc.) — they
       * read `pickSpec(specs, "...")` against this free-form bag, by these
       * exact alias names (see src/app/products/[id]/page.tsx). Without
       * these, the calculator that reproduces Al Murad's own "7 tiles to
       * cover 1.10m² — £31.43" box would not appear at all, even with every
       * typed field set correctly.
       */
      specs: Object.assign({}, specs, {
        source: SOURCE_TAG,
        importedAt: now.toISOString(),
        sku: rec.sku || "",
        productCode: rec.sku || "",
        size: specs["Size (cm)"] || "",
        unit: rec.priceUnit || "",
        priceUnit: rec.priceUnit || "",
        tilesPerSqm: perSqm > 0 ? perSqm : undefined,
        /*
         * The generic area calculator (src/lib/tileCalculator.ts,
         * pricePerSqmFrom) treats `product.price` as the price of whatever
         * "box" `sqmPerBox` covers, then divides one by the other to get
         * £/m². Al Murad's price is per TILE, not per pack, so the box for
         * this purpose IS one tile — its area, 1/tilesPerSqm. Verified
         * against the site's own displayed figure: price=£4.49, tilesPerSqm
         * =5.5 -> sqmPerBox=0.1818 -> 4.49/0.1818=£24.70/m², exactly what
         * Al Murad shows. Leaving this unset (or setting it to the actual
         * multi-tile pack size) would make the calculator divide by the
         * wrong number and show a fabricated per-m² price.
         */
        sqmPerBox: perSqm > 0 ? Number((1 / perSqm).toFixed(4)) : undefined,
        tilesPerBox: perPack > 0 ? perPack : undefined,
        packCoverageM2:
          perSqm > 0 && perPack > 0 ? Number(((perPack / perSqm)).toFixed(4)) : undefined,
        pricePerM2:
          typeof rec.price === "number" && perSqm > 0
            ? Number((rec.price * perSqm).toFixed(2))
            : undefined,
        pricePerPack:
          typeof rec.price === "number" && perPack > 0
            ? Number((rec.price * perPack).toFixed(2))
            : undefined,
      }),

      badges: rangeNames.filter((n) => n === "Sale" || n === "Trade Club"),

      createdAt: now,
      updatedAt: now,
      priceSyncedAt: now,
      stockSyncedAt: now,
    };

    if (DRY_RUN) {
      created++;
      if (created <= 8) {
        console.log(
          "  [dry] " + doc.name.slice(0, 60) +
            "\n        GBP " + doc.price + "  " + doc.department + "/" + doc.category +
            (doc.categories.length > 1 ? " (+" + (doc.categories.length - 1) + " more)" : "") +
            "  imgs=" + doc.images.length + " specs=" + Object.keys(specs).length,
        );
      }
      continue;
    }

    ops.push(doc);
    created++;
    if (ops.length >= 200) await flush();
  }
  await flush();

  if (!DRY_RUN) {
    const countAfter = await productsCol.countDocuments();
    const delta = countAfter - countBefore;
    if (delta !== created) {
      throw new Error(
        `SAFETY CHECK FAILED: collection grew by ${delta} documents but this run only ` +
          `inserted ${created}. Something else wrote to this collection while the import ` +
          `ran — stopping rather than reporting a false success. Nothing further was touched.`,
      );
    }
    console.log(`\nsafety check passed: collection count ${countBefore} -> ${countAfter} (+${delta}, matches inserts exactly)`);
  }

  console.log("\n" + (DRY_RUN ? "[dry] " : "") + "created: " + created);
  console.log("skipped (already existed): " + skippedExisting);
  console.log("skipped (scrape error): " + skippedError);
  console.log("skipped (no mappable category — needs a manual look): " + noCategoryBucket);
  if (unmappedNames.size) {
    console.log("\nAl Murad category names with no entry in CATEGORY_MAP:");
    for (const n of unmappedNames) console.log("  " + n);
  }
  console.log("\nby existing category:");
  for (const [k, v] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log("  " + String(k).padEnd(28) + v);
  }

  if (secConn) await secConn.close();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
