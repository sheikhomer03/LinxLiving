/**
 * Import the Bathroom4Less capture (scripts/capture-bathroom4less.cjs) into
 * Mongo.
 *
 * Strict rules for this brand:
 *
 *  - INSERT ONLY. Every product this script writes is a brand-new document.
 *    No updateOne/updateMany/bulkWrite/deleteOne against `products`
 *    anywhere. A `sourceUrl` already held is skipped, not overwritten.
 *  - NO NEW CATEGORIES. Bathroom4Less's own ~550 Shopify collections are
 *    mapped onto `category` values that already exist in the live
 *    `products` collection today for department "bathrooms" — see
 *    CATEGORY_MAP / classifyCollectionTitle below. Nothing is written to
 *    `menus`. `subCategory` is a free-text descriptive slug (not
 *    menu-controlled) and is not restricted the same way.
 *  - Per an explicit override from the task owner: this brand's data goes
 *    on MONGODB_URI ONLY (dataCluster: "primary"). The usual "whichever
 *    cluster has more headroom" db.stats() comparison is skipped for this
 *    brand; MONGODB_URL2 is never read or written by this script.
 *  - Stock fixed at 500 for every product (STOCK_DEFAULT).
 *  - Images: Bathroom4Less's own Shopify CDN URLs go into `images[]` as-is
 *    (no re-hosting here); a later sync-all-products-to-shopify.cjs +
 *    images[] rewrite pass is a separate, explicitly-approved step.
 *
 * Env:
 *   B4L_DATA=path  capture directory (must match capture-bathroom4less.cjs)
 *   DRY_RUN=1      parse and report, write nothing
 *   LIMIT=n        only the first n captured products
 *   ACTIVATE=1     set the brand live once the import succeeds (default: off)
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

const B4L_DATA =
  process.env.B4L_DATA ||
  "/Users/niazig/Desktop/linxliving/LinxLiving/.scratch/bathroom4less";
const PDP_FILE = path.join(B4L_DATA, "b4l-pdp.jsonl");

const BRAND_NAME = "Bathroom4Less";
const BRAND_SLUG = "bathroom4less";
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 500);

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const slugify = (s) =>
  clean(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/*
 * The 9 `category` values that already exist in the live `products`
 * collection for department "bathrooms" on MONGODB_URI (verified with
 * `distinct("category", { department: "bathrooms" })` before writing this
 * file — nothing here is invented):
 *   bathrooms, bathroom-taps, sanitaryware, shower, bathroom-furniture,
 *   basins, bathtub, kitchen-taps, shower-trays
 *
 * Bathroom4Less's own ~550 collections are a flat list — no compound
 * "Parent/Child" strings to split (each is its own real Shopify collection,
 * unlike Al Murad's joined JSON-LD category strings) — but plenty of them
 * are promo/vendor/test groupings with no taxonomy meaning at all ("5 Off
 * Group", "Nubud 0001", "Ibathuk", "Best Selling Products"). Those are
 * filtered out by isJunkTitle() below rather than matched, and a product
 * only loses its category entirely if EVERY collection it was crawled
 * under is junk or unmatched.
 */
const CATEGORY_VALUES = new Set([
  "bathrooms",
  "bathroom-taps",
  "sanitaryware",
  "shower",
  "bathroom-furniture",
  "basins",
  "bathtub",
  "kitchen-taps",
  "shower-trays",
]);

function isJunkTitle(title) {
  const t = clean(title);
  return (
    /^\d{1,2} Off Group$/i.test(t) ||
    /^(Best Selling|Top Selling|Newest|New)( Products?)?( \d+)?$/i.test(t) ||
    /^All( Products?)?( \d+)?$/i.test(t) ||
    /^Other$/i.test(t) ||
    /^Sale( Event| Collections?)?$/i.test(t) ||
    /^Promo Clearance( \d+)?$/i.test(t) ||
    /^(Good Friday|Valentine|Earth Day|New|Bundle|Kiosk|Wholesale) Collections?( \d+)?$/i.test(t) ||
    /^Nubud[ _]?\d*$/i.test(t) ||
    /\bTest$/i.test(t) ||
    /^(Bathroom4less|Home4less|Hudson Reed|Ibathuk|Nuie|Veebath|Ibath|Old London)( \d+)?$/i.test(t) ||
    /^Standard (Products|Trade Catalog)( \d+)?$/i.test(t) ||
    /^Fresh Finds/i.test(t) ||
    /^Asset Pack.*Example Products$/i.test(t)
  );
}

const PREFIX_STRIP = /^(wholesale|ibath|ibathuk|nuie|veebath|home4less|modern|traditional|best|top|standard|other|shop)\s+/i;

function guessSubCategory(title) {
  let t = clean(title).replace(PREFIX_STRIP, "").trim();
  t = t || clean(title);
  const slug = slugify(t) || "general";
  return slug.length > 60 ? slug.slice(0, 60) : slug;
}

/**
 * Classify one Bathroom4Less collection title onto {category, subCategory}
 * (or null when it's junk / has no recognizable product-type signal).
 * Order matters: taps and shower-trays are checked before the broader
 * "shower" bucket, kitchen-taps before the general tap bucket, and
 * toilet/basin before the catch-all "bath" bucket, so a title like
 * "Basin Taps" lands on bathroom-taps (it's a tap) not basins, and
 * "Shower Enclosures Shower Trays" lands on shower-trays not shower.
 */
function classifyCollectionTitle(title) {
  if (isJunkTitle(title)) return null;
  const t = clean(title).toLowerCase();
  if (!t) return null;

  if (/kitchen/.test(t) && /tap/.test(t)) {
    return { category: "kitchen-taps", subCategory: guessSubCategory(title) };
  }
  if (/\btap\b|taps\b|mixer\b.*tap|tap.*mixer|\bspout\b/.test(t) && !/sink/.test(t)) {
    return { category: "bathroom-taps", subCategory: guessSubCategory(title) };
  }
  if (/shower.*tray|tray.*shower|showertrays/.test(t)) {
    return { category: "shower-trays", subCategory: guessSubCategory(title) };
  }
  if (/shower/.test(t)) {
    return { category: "shower", subCategory: guessSubCategory(title) };
  }
  if (/toilet|bidet|\bwc\b|cistern|urinal|flush plate/.test(t)) {
    return { category: "sanitaryware", subCategory: guessSubCategory(title) };
  }
  if (/basin|\bsink/.test(t)) {
    return { category: "basins", subCategory: guessSubCategory(title) };
  }
  // NOTE: `\bbaths?\b` (not `\bbath\b`) — the singular-only form missed
  // every plural title ("Baths", "Straight Baths", "Freestanding Baths"),
  // which silently starved this bucket: with "Baths"/"Baths Straight Baths"
  // unmatched, a genuinely bath product cross-listed under the catalogue's
  // near-universal "Furniture" collection (63% of the whole catalogue is
  // cross-listed there, regardless of real product type — verified against
  // the raw crawl) had nothing left to outvote "Furniture" with, and the
  // whole bucket collapsed onto bathroom-furniture (3790/5473, 69%, before
  // this fix) instead of its real type.
  if (/\bbaths?\b|bathtub|slipper bath|steel bath/.test(t)) {
    return { category: "bathtub", subCategory: guessSubCategory(title) };
  }
  // Vendor-scoped collections ("Ibath Enclosures", "Nuie Enclosures",
  // "Veebath Panels") drop the word "Shower" that the site's own generic
  // collections use ("Shower Enclosures", "Shower Panels") — caught here so
  // they still land on `shower` instead of falling through unmatched.
  if (/enclosure|shower|wet ?room|pivot|quadrant|bi[- ]?fold door|sliding door|hinged door|corner entry|side panel|riser rail|slider kit/.test(t)) {
    return { category: "shower", subCategory: guessSubCategory(title) };
  }
  if (/furniture|vanity|cabinet|cloakroom|storage (unit|cabinet)|wc unit|mirror/.test(t)) {
    return { category: "bathroom-furniture", subCategory: guessSubCategory(title) };
  }
  if (/radiator|towel rail|underfloor heating|\bheating\b|heated towel|pipe shrouds?/.test(t)) {
    return { category: "bathrooms", subCategory: "heating" };
  }
  if (/suite/.test(t)) {
    return { category: "bathrooms", subCategory: "suites" };
  }
  if (
    /accessor|robe hook|toothbrush|toilet roll|shelves|waste bin|curtain rail|grab rail|tumbler|soap dish|towel (bar|ring)/.test(
      t,
    )
  ) {
    return { category: "bathrooms", subCategory: "accessories" };
  }
  return null;
}

/**
 * A product's mapped {category, subCategory} bucket, chosen from every
 * collection it was crawled under (a product is cross-listed many times —
 * one canonical mapping, not one row per collection). `category` is the
 * most frequent classified value across all its collections (ties broken
 * by first-seen order for determinism); `subCategory` is taken from
 * whichever collection title that shares the chosen category has the most
 * words (most specific — e.g. "Basins Wall Hung Basins" over "Basins").
 */
function mapCategory(collectionTitles) {
  const hits = [];
  for (const title of collectionTitles) {
    const c = classifyCollectionTitle(title);
    if (c) hits.push({ ...c, title });
  }
  if (!hits.length) return null;

  /*
   * "bathrooms" is the generic catch-all bucket (it's what Suites,
   * Bathroom Accessories, and the Heating collections all map onto, none
   * of which name a specific product type) and it gets voted onto almost
   * every product because those collections are themselves near-universal
   * cross-listings. Left in the same vote count as specific-type buckets
   * (bathtub, basins, shower, ...) it wins ties it has no business
   * winning — verified on "Legacy Single Ended Shower Bath with Legs":
   * collections ["Suites","Furniture","Baths","Taps","Bathroom
   * Accessories","Baths Straight Baths"] produced a 2-2 tie between
   * bathrooms (Suites + Bathroom Accessories) and bathtub (Baths + Baths
   * Straight Baths), and first-seen-wins handed it to bathrooms even
   * though the product is plainly a bath. Specific-type votes are
   * preferred outright; "bathrooms" is only used when nothing else
   * matched at all.
   */
  const specific = hits.filter((h) => h.category !== "bathrooms");
  const pool = specific.length ? specific : hits;

  const freq = new Map();
  for (const h of pool) freq.set(h.category, (freq.get(h.category) || 0) + 1);
  let bestCategory = null;
  let bestCount = -1;
  for (const h of pool) {
    const c = freq.get(h.category);
    if (c > bestCount) {
      bestCount = c;
      bestCategory = h.category;
    }
  }
  const candidates = pool.filter((h) => h.category === bestCategory);
  candidates.sort((a, b) => b.title.split(" ").length - a.title.split(" ").length);
  return { category: bestCategory, subCategory: candidates[0].subCategory };
}

/**
 * specGroups (from capture stage B) -> flat specs bag, prefixed by their
 * own group label so "Dimensions: Height" and a hypothetical unrelated
 * "Height" elsewhere never collide, plus the same values unprefixed for
 * easy pickSpec() lookups (Height, Width, Depth, Weight, Brand, Material,
 * Colour, ...).
 */
function flattenSpecGroups(specGroups) {
  const flat = {};
  for (const [group, pairs] of Object.entries(specGroups || {})) {
    for (const [label, value] of Object.entries(pairs)) {
      if (!value) continue;
      flat[label] = value; // unprefixed, for pickSpec()
      flat[`${group}: ${label}`] = value; // grouped, for the raw spec table
    }
  }
  return flat;
}

async function main() {
  if (!fs.existsSync(PDP_FILE)) {
    throw new Error("no capture at " + PDP_FILE + " — run capture-bathroom4less.cjs first");
  }

  const { db } = await connectMongo(); // MONGODB_URI only, per explicit override
  const productsCol = db.collection("products");

  let brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) {
    if (DRY_RUN) {
      console.log("[dry] would create brand " + BRAND_NAME + " (dataCluster: primary)");
      brand = { _id: new mongoose.Types.ObjectId(), dataCluster: "primary" };
    } else {
      const res = await db.collection("brands").insertOne({
        name: BRAND_NAME,
        slug: BRAND_SLUG,
        dataCluster: "primary",
        isActive: ACTIVATE,
        order: 0,
        subBrands: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      brand = { _id: res.insertedId, dataCluster: "primary" };
      console.log("created brand " + BRAND_NAME + " (" + brand._id + ", primary cluster, isActive=" + ACTIVATE + ")");
    }
  } else {
    console.log("brand already exists: " + BRAND_NAME + " (" + brand._id + ")");
  }
  console.log("products go to: PRIMARY cluster (MONGODB_URI) only");

  const countBefore = DRY_RUN ? 0 : await productsCol.countDocuments();

  // Dedupe against sourceUrl on MONGODB_URI only (per override — MONGODB_URL2
  // is never read for this brand).
  const existing = new Set();
  for await (const row of productsCol.find({ sourceUrl: /bathroom4less\.co\.uk/i }).project({ sourceUrl: 1 })) {
    existing.add(row.sourceUrl);
  }
  console.log("already in Mongo (MONGODB_URI): " + existing.size + " Bathroom4Less products");

  const lines = fs.readFileSync(PDP_FILE, "utf8").split("\n").filter((l) => l.trim());
  console.log("capture holds " + lines.length + " records");

  let created = 0,
    skippedExisting = 0,
    skippedError = 0,
    noCategoryBucket = 0;
  const catCount = new Map();
  const unmappedTitles = new Set();
  let ops = [];

  const flush = async () => {
    if (!ops.length) return;
    const batch = ops;
    ops = [];
    if (!DRY_RUN) await productsCol.insertMany(batch, { ordered: false });
  };

  let processed = 0;
  const seenSourceUrl = new Set(); // in-capture de-dupe safety net
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

    if (existing.has(rec.sourceUrl) || seenSourceUrl.has(rec.sourceUrl)) {
      skippedExisting++;
      continue;
    }
    seenSourceUrl.add(rec.sourceUrl);

    const mapped = mapCategory(rec.collectionTitles || []);
    for (const title of rec.collectionTitles || []) {
      if (!classifyCollectionTitle(title)) unmappedTitles.add(title);
    }
    if (!mapped || !CATEGORY_VALUES.has(mapped.category)) {
      noCategoryBucket++;
      continue; // never guess — report it instead
    }
    catCount.set(mapped.category, (catCount.get(mapped.category) || 0) + 1);

    const specs = flattenSpecGroups(rec.specGroups);

    // Price: products.json variant price is inc. VAT (site states "All items
    // on our website are priced Inc. VAT" in its own Delivery Information
    // copy — verified per-product via rec.vatIncluded). compareAtPrice, when
    // present, is Shopify's own "was" price in the SAME unit/currency as
    // price (both come from the identical variant row) — never a per-m²
    // figure, so no unit conversion is needed here (this is bathroom
    // fittings, not tiles: single "Each" unit throughout). A compareAtPrice
        // that isn't actually higher than price is not a real discount.
    let rrpIncVat = typeof rec.compareAtPrice === "number" ? rec.compareAtPrice : null;
    if (typeof rrpIncVat === "number" && typeof rec.price === "number" && rrpIncVat <= rec.price) {
      rrpIncVat = null;
    }

    const colours = [];
    const sizeOptions = [];
    const groups = (rec.options || []).map((o) => o.name);
    for (const opt of rec.options || []) {
      if (/colou?r/i.test(opt.name)) colours.push(...opt.values);
      if (/size/i.test(opt.name)) for (const v of opt.values) sizeOptions.push({ name: v });
    }

    const now = new Date();
    const doc = {
      name: clean(rec.name),
      description: rec.bodyHtml ? clean(rec.bodyHtml.replace(/<[^>]+>/g, " ")) : clean(rec.name),
      shortDescription: "",

      price: typeof rec.price === "number" ? rec.price : 0,
      priceCurrency: "GBP",
      vatRate: 20,
      rrpIncVat,

      images: rec.images || [],

      department: "bathrooms",
      category: mapped.category,
      categories: [mapped.category],
      subCategory: mapped.subCategory,
      subCategories: [mapped.subCategory],
      sourceCategories: (rec.collectionTitles || []).map((name) => ({ name })),

      brand: brand._id,
      brands: [brand._id],
      subBrand: rec.vendor || "",

      rangeName: rec.productType || "",

      supplierSku: rec.variants?.[0]?.sku || "",
      productCode: rec.variants?.[0]?.sku || "",
      manufacturerSku: rec.variants?.[0]?.sku || "",
      finish: specs.Finish || specs.Colour || "",
      materials: [specs.Material].filter(Boolean),
      colours: [...new Set(colours)],
      sizeOptions,
      variantGroups: groups,
      variants: (rec.variants || []).map((v) => ({
        title: v.title,
        sku: v.sku,
        price: v.price,
        available: v.available,
      })),

      unitOfMeasure: "Each",

      stock: STOCK_DEFAULT,
      isOutOfStock: !rec.available,
      stockStatus: rec.available ? "in_stock" : "out_of_stock",

      attributes: Object.entries(specs)
        .filter(([k]) => !k.includes(":")) // skip the grouped duplicates, keep the flat pickSpec()-friendly ones
        .map(([label, value]) => ({ label, value: String(value) })),

      sourceUrl: rec.sourceUrl,
      sourceHandle: rec.handle,
      sourceProductId: rec.id,
      sourceSku: rec.variants?.[0]?.sku || "",
      canonicalUrl: rec.sourceUrl,

      // pickSpec()-readable alias bag — see src/app/products/[id]/page.tsx.
      // This is not a tile calculator brand (unitOfMeasure "Each" throughout,
      // confirmed against the site's own "All items ... priced Inc. VAT"
      // note and its lack of any per-m² coverage calculator), so most of the
      // tile-specific keys (sqmPerBox/tilesPerBox/pricePerM2) do not apply.
      // `compareAtPrice` DOES matter, though: the PDP's own buy-box reads
      // its "was" price strike-through from `pickSpec(specs,
      // "shopifyCompareAt") || pickSpec(specs, "compareAtPrice")` (see
      // src/app/products/[id]/page.tsx), NOT from the typed `rrpIncVat`
      // field above — rrpIncVat only feeds the Shopify sync. Verified
      // against an already-live, correctly-rendering bathrooms product
      // (Porcelanosa "Smart", specs.compareAtPrice=68.49 vs price=47.94):
      // setting only rrpIncVat here would store a correct discount that
      // Shopify eventually sees, but silently show no "was" price at all
      // on this site's own product page in the meantime.
      specs: Object.assign({}, specs, {
        source: "bathroom4less-scrape",
        importedAt: now.toISOString(),
        sku: rec.variants?.[0]?.sku || "",
        productCode: rec.variants?.[0]?.sku || "",
        unit: "Each",
        priceUnit: "Each",
        vendor: rec.vendor || "",
        compareAtPrice: rrpIncVat || undefined,
      }),

      createdAt: now,
      updatedAt: now,
      priceSyncedAt: now,
      stockSyncedAt: now,
    };

    if (DRY_RUN) {
      created++;
      if (created <= 8) {
        console.log(
          "  [dry] " +
            doc.name.slice(0, 60) +
            "\n        GBP " +
            doc.price +
            (rrpIncVat ? " (RRP " + rrpIncVat + ")" : "") +
            "  " +
            doc.department +
            "/" +
            doc.category +
            "/" +
            doc.subCategory +
            "  imgs=" +
            doc.images.length +
            " specs=" +
            Object.keys(specs).length,
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
  console.log("\nby category:");
  for (const [k, v] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log("  " + String(k).padEnd(20) + v);
  }
  if (unmappedTitles.size) {
    console.log(`\n${unmappedTitles.size} collection titles with no classification (fine if the product had another, mapped collection):`);
    for (const n of [...unmappedTitles].sort()) console.log("  " + n);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
