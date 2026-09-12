/**
 * Import the Floors4Trade catalogue.
 *
 * Floors4Trade is a Shopify store behind a B2B login: trade prices only render
 * for a signed-in buyer, so the capture step runs with the operator's own
 * session cookies and writes four files this script reads. Nothing here calls
 * the supplier — re-running is free and deterministic.
 *
 *   f4t-products.json     705 products from /products.json (price, variants, images)
 *   f4t-pdp.json          per-product specs, downloads and stock text
 *   f4t-collections.json  collection handle -> product handles
 *   f4t-nav.json          the mega-menu: main category -> group -> sub-category
 *
 * Taxonomy follows the supplier's own menu. Their three main categories become
 * category menus under this brand; their group headings become the `group` on
 * each sub-category, exactly as the storefront renders them. Carpets sit in the
 * Flooring department — there is no Carpets department and the two are sold
 * side by side.
 *
 * The 23 spec fields the PDP publishes land on the typed fields added to the
 * Product schema for this import, and are kept verbatim in `specs` as well, so
 * a mapping decision here never loses the supplier's own wording.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-floors4trade.cjs
 *
 *   DRY_RUN=1   report without writing
 *   LIMIT=20    only the first N products
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
const SOURCE_TAG = "floors4trade-scrape";
const BRAND_NAME = "Floors4Trade";
const ORIGIN = "https://floors4trade.co.uk";

const DATA =
  process.env.F4T_DATA ||
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/0cfb49ac-502f-4604-b3ad-3029aa7f0b96/scratchpad";
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

/** Their main categories, and the department each belongs to. */
const MAIN = {
  Flooring: { slug: "flooring", name: "Flooring", department: "flooring", order: 0 },
  Carpets: { slug: "carpets", name: "Carpets", department: "flooring", order: 1 },
  Accessories: { slug: "accessories", name: "Accessories", department: "accessories", order: 2 },
};

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const num = (v) => {
  const m = String(v ?? "").match(/-?[0-9]+(?:\.[0-9]+)?/);
  return m ? Number(m[0]) : null;
};
const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** "View All X" repeats the group's own collection; it is navigation, not a facet. */
const isViewAll = (label) => /^view all\b/i.test(String(label || "").trim());

function buildTaxonomy(nav) {
  // collection handle -> [{ main, group, label }]
  const map = new Map();
  const order = [];
  for (const cat of nav) {
    const main = MAIN[cat.name];
    if (!main) continue;
    const groups = [];
    for (const g of cat.groups) {
      const links = [];
      for (const l of g.links) {
        if (!l.href?.startsWith("/collections/")) continue;
        const handle = l.href.split("/collections/")[1].split(/[?#]/)[0];
        // "View All" is navigation, so it earns no menu entry — but it is still
        // the group's own collection, and some products sit in nothing else.
        // Dropping it from the map too would orphan them.
        if (!isViewAll(l.label)) links.push({ handle, label: l.label });
        if (!map.has(handle)) map.set(handle, []);
        map.get(handle).push({ main: main.slug, group: g.group, label: l.label });
      }
      if (links.length) groups.push({ group: g.group, links });
    }
    order.push({ ...main, groups });
  }
  return { map, order };
}

/** Accessories has no group headings — a flat list read off the nav panel. */
function accessoriesFlat(homeHtml) {
  // Scope to the Accessories <li> itself; a character window around the link
  // spills into the neighbouring panels and invents sub-categories.
  const item = homeHtml
    .split(/<li class="f4th__item">/)
    .slice(1)
    .find((b) => {
      const top = b.match(/<a class="f4th__top"[^>]*>([\s\S]*?)<\/a>/);
      return top && /^accessories$/i.test(strip(top[1]));
    });
  if (!item) return [];
  const panel = item.split(/<\/li>/)[0];
  const out = [];
  for (const m of panel.matchAll(/<a class="f4th__lnk"[^>]*href="\/collections\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const label = strip(m[2]);
    if (!label) continue;
    // "All Accessories" is the category root, kept for mapping, not as a facet.
    if (isViewAll(label) || /^all accessories$/i.test(label)) continue;
    out.push({ handle: m[1], label });
  }
  return out;
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

async function main() {
  const { db } = await connectMongo();
  const products = read("f4t-products.json");
  const pdp = new Map(read("f4t-pdp.json").map((p) => [p.handle, p]));
  const collections = read("f4t-collections.json");
  const nav = read("f4t-nav.json");
  const homeHtml = fs.readFileSync(path.join(DATA, "f4t-home.html"), "utf8");

  const brand = await db.collection("brands").findOne({ name: BRAND_NAME });
  if (!brand) throw new Error(`Brand "${BRAND_NAME}" not found — create it first`);

  const { map: colMap, order: mainOrder } = buildTaxonomy(nav);
  const accFlat = accessoriesFlat(homeHtml);
  for (const a of accFlat) {
    if (!colMap.has(a.handle)) colMap.set(a.handle, []);
    colMap.get(a.handle).push({ main: "accessories", group: "", label: a.label });
  }
  // The category root itself, so accessories filed under nothing narrower still
  // resolve to a category rather than being skipped.
  if (!colMap.has("accessories-underlay")) colMap.set("accessories-underlay", []);
  colMap.get("accessories-underlay").push({ main: "accessories", group: "", label: "Accessories" });

  // handle -> collections it belongs to
  const memberOf = new Map();
  for (const [handle, items] of Object.entries(collections)) {
    for (const h of items) {
      if (!memberOf.has(h)) memberOf.set(h, []);
      memberOf.get(h).push(handle);
    }
  }

  // ---- menus -------------------------------------------------------------
  const departments = await db.collection("departments").find({}).toArray();
  const deptId = (slug) => departments.find((d) => d.slug === slug)?._id || null;

  const menuStats = [];
  for (const m of mainOrder) {
    const catId = await ensureMenu(
      db,
      { slug: m.slug, level: "category", brand: brand._id },
      { name: m.name, parent: null, order: m.order, group: "", department: deptId(m.department) },
    );
    let n = 0;
    for (const g of m.groups) {
      for (const l of g.links) {
        await ensureMenu(
          db,
          { slug: l.handle, level: "subcategory", brand: brand._id, parent: catId },
          { name: l.label, group: g.group, department: deptId(m.department) },
        );
        n += 1;
      }
    }
    if (m.slug === "accessories") {
      for (const a of accFlat) {
        await ensureMenu(
          db,
          { slug: a.handle, level: "subcategory", brand: brand._id, parent: catId },
          { name: a.label, group: "", department: deptId(m.department) },
        );
        n += 1;
      }
    }
    menuStats.push(`${m.name}: ${m.groups.length} groups, ${n} sub-categories`);
  }
  console.log("menus:\n  " + menuStats.join("\n  "));

  // ---- products ----------------------------------------------------------
  const productsCol = db.collection("products");
  let created = 0, updated = 0, skipped = 0, unfiled = 0;
  const seenSpecKeys = new Set();

  for (const p of products.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
    const extra = pdp.get(p.handle) || {};
    const specs = extra.specs || {};
    Object.keys(specs).forEach((k) => seenSpecKeys.add(k));

    const cols = memberOf.get(p.handle) || [];
    let hits = cols.flatMap((c) => colMap.get(c) || []);
    /*
     * A handful of lines — sheet vinyl, safety floor, wall panels, a pallet
     * special, a sample — sell on the site but appear nowhere in its menu.
     * Dropping them would lose stock we hold, so they are filed at category
     * level with no sub-category, which is exactly what the supplier shows.
     */
    if (!hits.length) {
      const t = `${p.product_type || ""} ${p.title || ""}`.toLowerCase();
      const main = /underlay|adhesive|trim|profile|accessor|beading|nosing|threshold/.test(t)
        ? "accessories"
        : "flooring";
      hits = [{ main, group: "", label: "" }];
      unfiled += 1;
    }

    // Primary placement follows the supplier's own menu order.
    const mainRank = (s) => mainOrder.findIndex((m) => m.slug === s);
    const primary = hits.slice().sort((a, b) => mainRank(a.main) - mainRank(b.main))[0];
    const mainDef = mainOrder.find((m) => m.slug === primary.main);
    const categories = [...new Set(hits.map((h) => h.main))];
    const subCategories = [...new Set(cols.filter((c) => colMap.has(c)))];

    const variants = p.variants || [];
    const v0 = variants[0] || {};
    const price = Number(v0.price) || 0;
    const packCoverage = num(specs["Pack coverage"]);

    const images = (p.images || []).map((i) => i.src).filter(Boolean);
    const now = new Date();

    const doc = {
      name: p.title,
      description: p.body_html || "",
      shortDescription: strip(p.body_html).slice(0, 300),
      price,
      priceCurrency: "GBP",
      rrpIncVat: specs["Estimated retail price"] && /^[£0-9]/.test(specs["Estimated retail price"])
        ? num(specs["Estimated retail price"])
        : null,
      stockStatus: /in stock/i.test(extra.stockText || "") ? "in-stock" : "",
      stockAvailabilityText: specs["Stock / lead time"] || extra.stockText || "",
      images,
      department: mainDef.department,
      category: primary.main,
      categories,
      subCategory: subCategories[0] || "",
      subCategories,
      brand: brand._id,
      brands: [brand._id],
      subBrand: "",
      rangeName: specs["Collection"] || "",
      warranty: specs["Warranty"] || "",
      supplierCategory: cols.join(" | "),

      // Typed trade fields added to the schema for this import.
      construction: specs["Construction"] || "",
      wearLayer: specs["Wear layer"] || "",
      useClass: specs["Use class"] || "",
      thickness: specs["Thickness"] || "",
      lockingSystem: specs["Locking system"] || "",
      installationMethod: specs["Installation method"] || "",
      integratedUnderlay: specs["Integrated underlay"] || "",
      waterproof: specs["Waterproof"] || "",
      impactSoundReduction: specs["Impact sound reduction"] || "",
      underfloorHeating: specs["Underfloor heating"] || "",
      pileType: specs["Pile type"] || "",
      fibre: specs["Fibre"] || "",
      availableWidths: specs["Available widths"]
        ? specs["Available widths"].split(/\s*[\/,·]\s*/).filter(Boolean)
        : [],
      madeInBritain: specs["Made in Britain"] || "",
      packCoverageM2: packCoverage,
      piecesPerPack: num(specs["Pieces per pack"]),
      packsAvailable: num(specs["Packs / quantities"]),

      dimensions: specs["Dimensions"] ? { size: specs["Dimensions"] } : {},
      downloads: (extra.downloads || []).map((d) => ({ name: d.label, url: d.url })),
      areaCalculator: packCoverage > 0,

      sourceProductId: String(p.id),
      sourceHandle: p.handle,
      sourceSku: v0.sku || "",
      sourceUrl: `${ORIGIN}/products/${p.handle}`,
      sourceType: p.product_type || "",
      keywords: p.tags || [],

      variants: variants.map((v) => ({
        name: v.title,
        sku: v.sku || "",
        price: Number(v.price) || 0,
        barcode: v.barcode || "",
        available: !!v.available,
        image: v.featured_image?.src || "",
      })),

      specs: {
        ...specs,
        /*
         * Pack coverage under the keys the rest of the app already reads.
         * The PDP resolves coverage through `sqmPerBox`, and
         * `verifyConfiguredUnitPrice` only treats a rate as per-m2 when
         * `pricePerM2` is set — without both, a pack price is read as a per-m2
         * price and checkout rejects the basket as tampered.
         */
        ...(packCoverage > 0 && price > 0
          ? {
              sqmPerBox: packCoverage,
              pricePerM2: Math.round((price / packCoverage) * 100) / 100,
            }
          : {}),
        manufacturer: specs["Manufacturer"] || p.vendor || "",
        source: SOURCE_TAG,
        sourceUrl: `${ORIGIN}/products/${p.handle}`,
        sourceVendor: p.vendor || "",
        sourceProductType: p.product_type || "",
        sourceCollections: cols,
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
          `  [dry] ${doc.name}\n        £${doc.price} cat=${doc.category} subs=${doc.subCategories.length} imgs=${images.length} cover=${packCoverage ?? "-"} specs=${Object.keys(specs).length}`,
        );
      }
      continue;
    }

    const existing = await productsCol.findOne({
      "specs.source": SOURCE_TAG,
      $or: [{ sourceHandle: p.handle }, { sourceProductId: String(p.id) }],
    });
    if (existing) {
      if (!images.length && existing.images?.length) doc.images = existing.images;
      await productsCol.updateOne({ _id: existing._id }, { $set: doc });
      updated += 1;
    } else {
      await productsCol.insertOne({ ...doc, createdAt: now });
      created += 1;
    }
  }

  console.log(
    `\n${DRY_RUN ? "[dry] " : ""}created ${created}, updated ${updated}, skipped ${skipped}, ` +
      `unfiled ${unfiled} (real products the supplier's menu does not surface)`,
  );
  console.log(`spec fields seen: ${seenSpecKeys.size}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
