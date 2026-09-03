/**
 * Import the Royal Bathrooms catalogue.
 *
 * royalbathrooms.co.uk is Magento behind Cloudflare, and every automated
 * client — curl, headless and headed Playwright alike — is answered with an
 * interactive Turnstile challenge. So the capture step runs through a Chrome
 * the operator launched themselves with `--remote-debugging-port=9222` and
 * cleared by hand once; the crawler attaches over CDP and inherits that
 * clearance. Their GraphQL endpoint is open but times out at 60s on five
 * products, so the capture reads the same HTML a shopper gets, which is both
 * faster (~1s a page) and exactly what the brief asked to mirror.
 *
 * Nothing here calls the supplier — re-running is free and deterministic.
 *
 *   rb-nav.json       the mega-menu: main category -> group -> sub-category
 *   rb-urls.json      product URL -> the menu nodes it appears under
 *   rb-pdp.jsonl      per-product PDP capture (specs, sections, variants), one
 *                     JSON object per line — 4,326 products is far too much to
 *                     rewrite as a single object on every flush
 *
 * Taxonomy follows the supplier's own menu rather than their Magento category
 * tree, which carries faceting branches ("Popular Sizes", "Shop By Size") the
 * brief excludes. Their nine main categories become category menus under this
 * brand; their group headings become the `group` on each sub-category, exactly
 * as the storefront renders them. The four faceting groups — By Shape, By
 * Range, By Size, By Colour — were dropped at capture time.
 *
 * Everything sits in the Bathrooms department, including Heating: these are
 * bathroom towel rails and radiators, and splitting one supplier's menu across
 * two departments is what the RAK import already decided against.
 *
 * Sale products are excluded, as asked. A product is a sale product when the
 * supplier files it under the Sale menu; the exclusion happens here rather
 * than at capture so the decision can be reversed without re-crawling.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-royal-bathrooms.cjs
 *
 *   DRY_RUN=1     report without writing
 *   LIMIT=20      only the first N products
 *   WITH_SALE=1   include the sale products too
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const WITH_SALE = process.env.WITH_SALE === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const SOURCE_TAG = "royal-bathrooms-scrape";
const BRAND_NAME = "Royal Bathrooms";
const ORIGIN = "https://royalbathrooms.co.uk";
const DEPARTMENT = "bathrooms";

const DATA =
  process.env.RB_DATA ||
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/f0410c4f-56b1-4b33-b7e1-8b122e1db286/scratchpad";
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

/** The capture store, one JSON object per line, keyed by product URL. */
function readCapture(f) {
  const out = new Map();
  for (const line of fs.readFileSync(path.join(DATA, f), "utf8").split("\n")) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r && r.url && !r.error) out.set(r.url, r);
  }
  return out;
}

/** Their menu label for the discount aisle — a merchandising view, not a range. */
const isSaleMenu = (name) => /^sale$/i.test(String(name || "").trim());

/**
 * Page furniture that is not product content.
 *
 * The PDP accordions are captured by their heading, and the same sweep also
 * picks up the newsletter block and the footer columns, which would otherwise
 * be stored as product sections and rendered on our own PDP.
 */
const NOISE_SECTIONS = [
  /sign up/i, /newsletter/i, /^my account$/i, /^information$/i, /^contact$/i,
  /why buy from us/i, /^follow us$/i, /^customer service$/i,
];

/** The last path segment is the supplier's own handle: /suites/x/y.html -> y */
const handleOf = (href) =>
  String(href || "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\.html$/, "")
    .split("/")
    .filter(Boolean)
    .pop() || "";

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const num = (v) => {
  const m = String(v ?? "").match(/-?[0-9]+(?:\.[0-9]+)?/);
  return m ? Number(m[0]) : null;
};

/**
 * The menu, as menus for us.
 *
 * A group with children contributes its name to each child as `group`; a group
 * with none is a leaf the supplier sells straight from the panel (Furniture
 * Packs, Tall Storage Units, WC Units, Tap Accessories) and becomes a
 * sub-category in its own right.
 */
function buildTaxonomy(nav) {
  const mains = [];
  for (const [order, m] of nav.entries()) {
    if (isSaleMenu(m.name)) continue;
    const main = { name: m.name, slug: handleOf(m.href), order, subs: [] };
    for (const g of m.groups) {
      if (g.subs.length) {
        for (const s of g.subs) main.subs.push({ name: s.name, slug: handleOf(s.href), group: g.group });
      } else {
        main.subs.push({ name: g.group, slug: handleOf(g.href), group: "" });
      }
    }
    mains.push(main);
  }
  return mains;
}

async function ensureMenu(db, filter, set) {
  const menus = db.collection("menus");
  const found = await menus.findOne(filter);
  if (found) {
    if (!DRY_RUN) await menus.updateOne({ _id: found._id }, { $set: { ...set, updatedAt: new Date() } });
    return found._id;
  }
  if (DRY_RUN) return null;
  const now = new Date();
  const r = await menus.insertOne({ ...filter, ...set, createdAt: now, updatedAt: now });
  return r.insertedId;
}

/** Variants come from the configurable matrix the PDP embeds for its picker. */
function buildVariants(p) {
  const attr = (p.optionAttributes || [])[0];
  if (!attr) return [];
  return (attr.options || []).map((o, i) => {
    const pid = (o.products || [])[0];
    const prices = (p.variantPrices || {})[pid] || {};
    const imgs = (p.variantImages || {})[pid] || [];
    const img = imgs.find((x) => x && x.isMain) || imgs[0] || null;
    const final = prices.finalPrice ? Number(prices.finalPrice.amount) : null;
    const old = prices.oldPrice ? Number(prices.oldPrice.amount) : null;
    return {
      name: o.label,
      option1: o.label,
      options: { [attr.label || attr.code]: o.label },
      price: final,
      // Magento repeats the final price in `oldPrice` when nothing is off, so
      // a was-price is only real when it is actually higher.
      compareAtPrice: old && final && old > final ? old : null,
      imageUrl: img ? img.full : "",
      externalId: String(pid || ""),
      position: i,
      available: true,
    };
  });
}

async function main() {
  const { db } = await connectMongo();
  const nav = read("rb-nav.json");
  const urls = read("rb-urls.json").products;
  const pdp = readCapture("rb-pdp.jsonl");

  const brand = await db.collection("brands").findOne({ name: BRAND_NAME });
  if (!brand) throw new Error(`Brand "${BRAND_NAME}" not found — create it first`);
  const department = await db.collection("departments").findOne({ slug: DEPARTMENT });
  if (!department) throw new Error(`Department "${DEPARTMENT}" not found`);

  const mains = buildTaxonomy(nav);

  // ---- menus -------------------------------------------------------------
  const menuStats = [];
  for (const m of mains) {
    const catId = await ensureMenu(
      db,
      { slug: m.slug, level: "category", brand: brand._id },
      { name: m.name, parent: null, order: m.order, group: "", department: department._id },
    );
    for (const s of m.subs) {
      await ensureMenu(
        db,
        { slug: s.slug, level: "subcategory", brand: brand._id, parent: catId },
        { name: s.name, group: s.group, department: department._id },
      );
    }
    const groups = new Set(m.subs.map((s) => s.group).filter(Boolean));
    menuStats.push(`${m.name}: ${groups.size} groups, ${m.subs.length} sub-categories`);
  }
  console.log("menus:\n  " + menuStats.join("\n  "));

  // Menu name -> slug, per main, so a product's captured paths resolve to menus.
  const mainSlugByName = new Map(mains.map((m) => [m.name, m.slug]));
  const subSlugByName = new Map();
  for (const m of mains) for (const s of m.subs) subSlugByName.set(`${m.name}|${s.name}`, s.slug);

  // ---- products ----------------------------------------------------------
  const productsCol = db.collection("products");
  let created = 0, updated = 0, skippedSale = 0, skippedError = 0, noPrice = 0;
  const sectionHeadings = new Set();
  const specLabels = new Set();

  const entries = [...pdp.entries()].slice(0, LIMIT === Infinity ? undefined : LIMIT);
  for (const [url, p] of entries) {
    if (p.error) { skippedError += 1; continue; }
    const discovered = urls[url] || {};
    if (discovered.sale && !WITH_SALE) { skippedSale += 1; continue; }

    const paths = discovered.paths || [];
    const categories = [...new Set(paths.map((x) => mainSlugByName.get(x.main)).filter(Boolean))];
    const subCategories = [
      ...new Set(
        paths
          .map((x) => subSlugByName.get(`${x.main}|${x.sub || x.group}`))
          .filter(Boolean),
      ),
    ];

    const specRows = (p.specs || []).filter((s) => s.label && s.value);
    for (const s of specRows) specLabels.add(s.label);
    const spec = Object.fromEntries(specRows.map((s) => [s.label, s.value]));

    const sections = (p.sections || [])
      .filter((s) => !NOISE_SECTIONS.some((rx) => rx.test(s.title)))
      .filter((s) => clean(s.text).length > 2);
    for (const s of sections) sectionHeadings.add(s.title);

    const details = sections.find((s) => /^product details$/i.test(s.title));
    const dimensions = sections.find((s) => /^product dimensions$/i.test(s.title));
    const variants = buildVariants(p);
    const price = Number(p.price) || (variants.length ? Math.min(...variants.map((v) => v.price || Infinity)) : 0);
    if (!price) noPrice += 1;

    const images = [...new Set((p.gallery || []).filter(Boolean))];
    const now = new Date();

    const doc = {
      name: p.name || p.h1 || "",
      description: (details && details.html) || p.ldDescription || "",
      shortDescription: clean((details && details.text) || p.ldDescription || "").slice(0, 300),
      price: Number.isFinite(price) ? price : 0,
      priceCurrency: p.currency || "GBP",
      images,
      department: DEPARTMENT,
      category: categories[0] || "",
      categories,
      subCategory: subCategories[0] || "",
      subCategories,
      brand: brand._id,
      brands: [brand._id],
      subBrand: "",

      supplierSku: p.sku || "",
      manufacturerSku: p.mpn || "",
      productCode: p.sku || "",
      rangeName: spec.Range || "",
      warranty: spec.Guarantee || spec.Warranty || "",
      finish: spec.Finish || "",
      materials: [spec.Material, spec["Unit Material"], spec["Frame Material"], spec["Basin Material"], spec["Toilet Material"]]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i),
      colours: [spec.Colour, spec.Color].filter(Boolean),

      /* The specification table verbatim, and again as a map so a PDP can ask
       * for one label without walking the rows. */
      attributes: specRows.map((s) => ({ label: s.label, value: s.value })),
      productSections: sections.map((s) => ({ heading: s.title, html: s.html, text: s.text, rows: [] })),
      dimensionRows: dimensions
        ? specRows.filter((s) => /width|height|depth|projection|adjustment|diameter|length/i.test(s.label))
        : [],

      variants,
      stockStatus: /instock/i.test(p.availability || "") ? "in-stock" : "",
      isOutOfStock: /outofstock/i.test(p.availability || ""),

      metaTitle: p.metaTitle || "",
      metaDescription: p.metaDescription || "",
      canonicalUrl: p.canonical || url,
      sourceUrl: url,
      sourceHandle: handleOf(url),
      sourceProductId: String(discovered.productId || p.productId || ""),
      sourceSku: p.sku || "",
      sourceType: spec.Type || "",
      sourceCategories: paths.map((x) => ({ name: x.sub || x.group || x.main, group: x.group || "" })),

      specs: {
        ...spec,
        source: SOURCE_TAG,
        sourceUrl: url,
        sourceBrand: p.brand || BRAND_NAME,
        sourceCategoryPath: p.categoryPath || "",
        onSaleAtSource: !!discovered.sale,
        importedAt: now.toISOString(),
      },
      updatedAt: now,
      priceSyncedAt: now,
      stockSyncedAt: now,
    };

    if (DRY_RUN) {
      created += 1;
      if (created <= 5) {
        console.log(
          `  [dry] ${doc.name}\n        £${doc.price} cat=${doc.category} subs=${doc.subCategories.length} imgs=${images.length} specs=${specRows.length} sections=${sections.length} variants=${variants.length}`,
        );
      }
      continue;
    }

    const existing = await productsCol.findOne({
      "specs.source": SOURCE_TAG,
      $or: [{ sourceUrl: url }, { sourceSku: p.sku || "\u0000" }],
    });
    if (existing) {
      if (!images.length && existing.images && existing.images.length) doc.images = existing.images;
      await productsCol.updateOne({ _id: existing._id }, { $set: doc });
      updated += 1;
    } else {
      await productsCol.insertOne({ ...doc, createdAt: now });
      created += 1;
    }
  }

  console.log(
    `\n${DRY_RUN ? "[dry] " : ""}created ${created}, updated ${updated}, ` +
      `skipped ${skippedSale} sale products, ${skippedError} capture errors, ${noPrice} without a price`,
  );
  console.log(`spec labels seen: ${specLabels.size}`);
  console.log(`section headings seen: ${sectionHeadings.size}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
