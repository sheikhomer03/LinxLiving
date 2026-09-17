/**
 * Import the drench.co.uk capture into Mongo under the "Drench" brand.
 *
 * Reads only what `capture-drench.cjs` wrote, so it is safe to re-run: the
 * crawl is never repeated and every product upserts on its source URL.
 *
 * Deliberately does NOT write menus or departments. The brand's taxonomy
 * lives on the product records (category / subCategory / sourceCategories)
 * so the existing mega-menu is left exactly as it is.
 *
 * Env:
 *   DRY_RUN=1   parse and report, write nothing
 *   LIMIT=n     only the first n captured products
 *   ACTIVATE=1  set the brand live once the import succeeds
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const ACTIVATE = process.env.ACTIVATE === "1";

const SOURCE_TAG = "drench-scrape";
const BRAND_NAME = "Drench";
/** Mirrors DEFAULT_STOCK in src/models/Product.ts — the raw driver bypasses it. */
const DEFAULT_STOCK = 1000;
const IMG_ORIGIN = "https://img.drench.co.uk";

const DATA =
  process.env.DRENCH_DATA ||
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/a167de67-d47a-4f6e-aa8a-c11dee9e30bc/scratchpad";

const PDP_FILE = path.join(DATA, "drench-pdp.jsonl");
const NAV_FILE = path.join(DATA, "drench-nav.json");

const SKIP_NAV = ["/c/sale", "/c/ideas/", "/help", "/c/brands"];

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const pathOf = (u) => String(u || "").replace(/^https?:\/\/[^/]+/, "").split("?")[0];

/** Absolute URL for an image the capture stored as a site-relative path. */
function imgUrl(u) {
  const s = String(u || "");
  if (!s) return "";
  if (s.startsWith("http")) return s;
  if (s.startsWith("//")) return "https:" + s;
  return IMG_ORIGIN + (s.startsWith("/") ? s : "/" + s);
}

function readCapture() {
  const rows = [];
  let bad = 0;
  for (const line of fs.readFileSync(PDP_FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      bad += 1;
    }
  }
  return { rows, bad };
}

/**
 * Nav lookup: any category URL -> which top-level category it sits under and
 * which dropdown group it was printed in. The group is what keeps the
 * subcategories from being mixed together once they are on a product.
 */
function buildNavIndex(nav) {
  const byUrl = new Map();
  for (const top of nav) {
    if (SKIP_NAV.includes(top.url)) continue;
    byUrl.set(pathOf(top.url), { top: top.title, group: "", title: top.title });
    for (const g of top.groups) {
      if (g.groupUrl) {
        byUrl.set(pathOf(g.groupUrl), { top: top.title, group: g.group, title: g.group });
      }
      for (const c of g.children) {
        byUrl.set(pathOf(c.url), { top: top.title, group: g.group, title: c.title });
      }
    }
  }
  return byUrl;
}

/** Every card seen anywhere in the crawl, keyed by product path. */
function buildCardIndex(rows) {
  const byPath = new Map();
  for (const r of rows) {
    for (const c of r.cards || []) {
      if (!c.url) continue;
      const key = pathOf(c.url);
      const prev = byPath.get(key);
      // Prefer the richest record of a product we have seen more than once.
      if (!prev || (c.previews || []).length > (prev.previews || []).length) {
        byPath.set(key, c);
      }
    }
  }
  return byPath;
}

function buildVariants(rec, card) {
  const previews = (rec.variants && rec.variants.length ? rec.variants : null) ||
    (card && card.previews) ||
    [];
  return previews.map((p, i) => ({
    name: clean(p.name) || clean(p.sku),
    sku: p.sku || "",
    options: {},
    // Previews carry no price of their own; the parent's price is the honest
    // default and a re-scrape of the variant URL can refine it later.
    price: typeof rec.price === "number" ? rec.price : null,
    tradePrice: null,
    imageUrl: imgUrl(p.image),
    swatchUrl: imgUrl(p.swatch),
    option1: clean(p.name),
    isDefault: i === 0,
    available: true,
    externalId: p.guid || "",
    sourceUrl: p.url ? "https://www.drench.co.uk" + p.url : "",
    position: i,
  }));
}

async function main() {
  if (!fs.existsSync(PDP_FILE)) throw new Error("no capture at " + PDP_FILE);
  const nav = JSON.parse(fs.readFileSync(NAV_FILE, "utf8"));
  const navIndex = buildNavIndex(nav);
  const { rows, bad } = readCapture();

  const usable = rows.filter((r) => !r.error && !r.skipped && r.name);
  const skippedSale = rows.filter((r) => r.skipped === "sale").length;
  const errored = rows.filter((r) => r.error).length;
  console.log(
    "capture: " + rows.length + " lines (" + usable.length + " usable, " +
      skippedSale + " sale, " + errored + " errors, " + bad + " unparsable)",
  );

  const cardIndex = buildCardIndex(rows);
  console.log("card index: " + cardIndex.size + " products with card data");

  const { db } = await connectMongo();
  const brand = await db.collection("brands").findOne({ name: BRAND_NAME });
  if (!brand) throw new Error('Brand "' + BRAND_NAME + '" not found — create it first');

  const productsCol = db.collection("products");
  const entries = LIMIT === Infinity ? usable : usable.slice(0, LIMIT);

  let created = 0;
  let updated = 0;
  let noCategory = 0;
  let noPrice = 0;
  let withVariants = 0;
  const catCount = new Map();
  const specLabels = new Set();

  for (const r of entries) {
    const trail = (r.breadcrumb || []).filter(
      (b) => b.url && b.url.includes("/c/"),
    );
    const mapped = trail
      .map((b) => navIndex.get(pathOf(b.url)))
      .filter(Boolean);

    const topHit = mapped.find((m) => m.top && m.title === m.top) || mapped[0];
    const leafHit = mapped.length ? mapped[mapped.length - 1] : null;

    const category = clean(topHit ? topHit.top : "");
    const subCategory = clean(
      leafHit && leafHit.title !== category ? leafHit.title : "",
    );
    const group = clean(leafHit ? leafHit.group : "");
    if (!category) noCategory += 1;
    catCount.set(category || "(none)", (catCount.get(category || "(none)") || 0) + 1);

    const gallery = r.gallery || [];
    const images = gallery.filter((g) => !g.isTechnicalDrawing).map((g) => g.full);
    const drawings = gallery.filter((g) => g.isTechnicalDrawing).map((g) => g.full);

    const specRows = (r.specs || []).filter((s) => s.label && s.value);
    for (const s of specRows) specLabels.add(s.label);
    const specMap = Object.fromEntries(specRows.map((s) => [s.label, s.value]));

    const sections = r.sections || [];
    const description =
      (sections.find((s) => /^description$/i.test(s.heading)) || {}).html ||
      r.ldDescription ||
      "";

    const card = cardIndex.get(pathOf(r.url));
    const variants = buildVariants(r, card);
    if (variants.length) withVariants += 1;

    const price = typeof r.price === "number" ? r.price : null;
    if (!price) noPrice += 1;

    const tiers = (r.tradeTiers || []).map((t) => ({
      tier: t.tier,
      price: t.price,
    }));

    const now = new Date();
    const doc = {
      name: clean(r.name || r.h1),
      description,
      shortDescription: clean(r.ldDescription).slice(0, 300),

      price: price || 0,
      priceCurrency: "GBP",
      rrpIncVat: typeof r.rrp === "number" && r.rrp > 0 ? r.rrp : null,
      tierPrices: tiers,

      images,
      technicalDrawings: drawings,

      // Department is deliberately left empty — the mapping onto the existing
      // 24 departments is a separate decision, and a wrong value here would
      // file 5,600 products under a department page they do not belong on.
      department: "",
      category,
      categories: category ? [category] : [],
      subCategory,
      subCategories: subCategory ? [subCategory] : [],
      sourceCategories: [{ name: subCategory || category, group }],

      brand: brand._id,
      brands: [brand._id],
      subBrand: "",

      supplierSku: r.sku || "",
      manufacturerSku: r.mpn || "",
      productCode: r.sku || "",
      finish: specMap.Finish || "",
      warranty: specMap.Guarantee || specMap.Warranty || "",
      materials: [specMap.Material, specMap["Frame Material"], specMap["Basin Material"]]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i),
      colours: [specMap.Colour, specMap.Color].filter(Boolean),
      features: r.keyFeatures || [],

      attributes: specRows.map((s) => ({ label: s.label, value: s.value })),
      productSections: sections.map((s) => ({
        heading: s.heading,
        html: s.html,
        text: s.text,
        rows: [],
      })),

      variants,
      // The capture only carries a stock figure when the page happened to
      // include its own product-card blob, which most do not. Inserting
      // through the raw driver skips the schema default, so leaving it unset
      // lands a missing field that reads as zero and shows the product as out
      // of stock. Fall back to the same default the model would have applied.
      stock: typeof r.stock === "number" && r.stock > 0 ? r.stock : DEFAULT_STOCK,
      isOutOfStock: /outofstock/i.test(r.availability || ""),
      // Underscore, not a hyphen: the Product schema enum accepts
      // in_stock | low_stock | out_of_stock | made_to_order | preorder.
      // Inserting through the raw driver skips Mongoose validation, so a wrong
      // value lands silently here and only fails later when a webhook tries to
      // save the document through the model.
      stockStatus: /instock/i.test(r.availability || "") ? "in_stock" : "",

      metaTitle: r.metaTitle || "",
      metaDescription: r.metaDescription || "",
      canonicalUrl: r.canonical || r.url,
      sourceUrl: r.url,
      sourceHandle: pathOf(r.url).replace(/^\/p\//, ""),
      sourceProductId: r.guid || r.productId || "",
      sourceSku: r.sku || "",

      specs: Object.assign({}, specMap, {
        source: SOURCE_TAG,
        sourceUrl: r.url,
        sourceBrand: r.manufacturer || "",
        sourceCategoryPath: r.categoryPath || "",
        navGroup: group,
        rrp: r.rrp ?? null,
        percentageSaving: r.percentageSaving || "",
        onSaleAtSource: !!r.onSale,
        importedAt: now.toISOString(),
      }),

      updatedAt: now,
      priceSyncedAt: now,
      stockSyncedAt: now,
    };

    if (DRY_RUN) {
      created += 1;
      if (created <= 5) {
        console.log(
          "  [dry] " + doc.name.slice(0, 62) +
            "\n        GBP " + doc.price + "  cat=" + (doc.category || "-") +
            " / " + (doc.subCategory || "-") + "  group=" + (group || "-") +
            "  imgs=" + images.length + " specs=" + specRows.length +
            " variants=" + variants.length,
        );
      }
      continue;
    }

    const existing = await productsCol.findOne({
      "specs.source": SOURCE_TAG,
      sourceUrl: r.url,
    });
    if (existing) {
      if (!images.length && existing.images && existing.images.length) {
        doc.images = existing.images;
      }
      await productsCol.updateOne({ _id: existing._id }, { $set: doc });
      updated += 1;
    } else {
      await productsCol.insertOne(Object.assign({ createdAt: now }, doc));
      created += 1;
    }
  }

  console.log(
    "\n" + (DRY_RUN ? "[dry] " : "") + "created " + created + ", updated " + updated,
  );
  console.log(
    "  " + withVariants + " with variants, " + noCategory +
      " without a category, " + noPrice + " without a price",
  );
  console.log("  spec labels seen: " + specLabels.size);
  console.log("\nby category:");
  for (const [k, v] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log("  " + String(k).padEnd(24) + v);
  }

  if (ACTIVATE && !DRY_RUN) {
    await db
      .collection("brands")
      .updateOne({ _id: brand._id }, { $set: { isActive: true, updatedAt: new Date() } });
    console.log('\nbrand "' + BRAND_NAME + '" is now ACTIVE');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
