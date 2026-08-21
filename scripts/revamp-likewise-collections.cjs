/**
 * Revamp Likewise Floors taxonomy to match the live site:
 *   Main category → Sub-category (product_collection) → Products
 *
 * Scrapes https://likewisefloors.com, rebuilds brand menus, remaps products.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/revamp-likewise-collections.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/revamp-likewise-collections.cjs --apply
 *
 * Options:
 *   --apply     write to Mongo (default is dry-run)
 *   --discover  only scrape + write JSON report
 */
require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env"),
});
const fs = require("fs");
const path = require("path");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://likewisefloors.com";
const BRAND_SLUG = "likewisefloors";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36";
const APPLY = process.argv.includes("--apply");
const DISCOVER_ONLY = process.argv.includes("--discover");
const OUT = path.join(__dirname, "_tmp-likewise-revamp-map.json");

/** Homepage / trusted-brands main categories (site order). */
const MAIN_CATEGORIES = [
  { name: "Carpet", slug: "carpet" },
  { name: "Vinyl", slug: "vinyl" },
  { name: "Laminate", slug: "laminate" },
  { name: "Luxury Vinyl Tile", slug: "luxury-vinyl-tile" },
  { name: "Wood", slug: "wood" },
  { name: "Rugs & Matting", slug: "mats-runners" },
  { name: "Artificial Grass", slug: "grass" },
];

function log(...args) {
  console.log(...args);
}

function decode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&rarr;/g, "")
    .replace(/→/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return {
    json: await r.json(),
    total: Number(r.headers.get("x-wp-total") || 0) || 0,
  };
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

async function paginateProductsByCollection(collectionId) {
  const perPage = 100;
  const out = [];
  let page = 1;
  for (;;) {
    const url = `${BASE}/wp-json/wp/v2/product?product_collection=${collectionId}&per_page=${perPage}&page=${page}&_fields=id,slug,link,sku,title`;
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (r.status === 400 || r.status === 404) break;
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    const batch = await r.json();
    if (!Array.isArray(batch) || !batch.length) break;
    for (const p of batch) {
      out.push({
        id: p.id,
        slug: p.slug,
        sku: p.sku || "",
        name: decode(p.title?.rendered || p.slug),
        url: p.link || `${BASE}/product/${p.slug}/`,
      });
    }
    const totalPages = Number(r.headers.get("x-wp-totalpages") || 1);
    if (page >= totalPages) break;
    page += 1;
  }
  return out;
}

async function paginateProductsByCategory(categoryId) {
  const perPage = 100;
  const out = [];
  let page = 1;
  for (;;) {
    const url = `${BASE}/wp-json/wp/v2/product?product_cat=${categoryId}&per_page=${perPage}&page=${page}&_fields=id,slug,link,sku,title`;
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (r.status === 400 || r.status === 404) break;
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    const batch = await r.json();
    if (!Array.isArray(batch) || !batch.length) break;
    for (const p of batch) {
      out.push({
        id: p.id,
        slug: p.slug,
        sku: p.sku || "",
        name: decode(p.title?.rendered || p.slug),
        url: p.link || `${BASE}/product/${p.slug}/`,
      });
    }
    const totalPages = Number(r.headers.get("x-wp-totalpages") || 1);
    if (page >= totalPages) break;
    page += 1;
  }
  return out;
}

function collectionSlugsFromCategoryPage(html) {
  const re = /\/collection\/([a-z0-9-]+)\/?/gi;
  const seen = new Set();
  const slugs = [];
  let m;
  while ((m = re.exec(html))) {
    const s = m[1].toLowerCase();
    if (seen.has(s)) continue;
    seen.add(s);
    slugs.push(s);
  }
  return slugs;
}

async function scrapeTaxonomy() {
  const { json: productCats } = await fetchJson(
    `${BASE}/wp-json/wc/store/v1/products/categories?per_page=100`,
  );
  const { json: collections } = await fetchJson(
    `${BASE}/wp-json/wp/v2/product_collection?per_page=100`,
  );
  const catBySlug = new Map(productCats.map((c) => [c.slug, c]));
  const colBySlug = new Map(collections.map((c) => [c.slug, c]));

  const tree = [];
  /** @type {Map<string, { category: string, subCategory: string, collectionName: string, sku: string, name: string, url: string }>} */
  const productMap = new Map();

  for (let i = 0; i < MAIN_CATEGORIES.length; i++) {
    const main = MAIN_CATEGORIES[i];
    const tax = catBySlug.get(main.slug);
    if (!tax) {
      log(`WARN missing product_cat ${main.slug}`);
      continue;
    }

    let pageCollectionSlugs = [];
    try {
      const html = await fetchText(
        `${BASE}/product-category/${main.slug}/`,
      );
      pageCollectionSlugs = collectionSlugsFromCategoryPage(html);
    } catch (e) {
      log(`WARN category page ${main.slug}: ${e.message}`);
    }

    const colNodes = [];
    for (const colSlug of pageCollectionSlugs) {
      const col = colBySlug.get(colSlug);
      if (!col) {
        log(`  WARN collection not in API: ${colSlug}`);
        continue;
      }
      const products = await paginateProductsByCollection(col.id);
      log(
        `  ${main.slug} / ${col.slug}: ${products.length} products (api count=${col.count})`,
      );
      for (const p of products) {
        if (productMap.has(p.slug)) continue; // first collection wins
        productMap.set(p.slug, {
          category: main.slug,
          subCategory: col.slug,
          collectionName: decode(col.name),
          sku: p.sku,
          name: p.name,
          url: p.url,
        });
      }
      colNodes.push({
        name: decode(col.name),
        slug: col.slug,
        apiCount: col.count,
        scrapedProducts: products.length,
        productSlugs: products.map((p) => p.slug),
      });
    }

    // Products in main category with no collection assignment
    const catProducts = await paginateProductsByCategory(tax.id);
    let uncollected = 0;
    for (const p of catProducts) {
      if (productMap.has(p.slug)) {
        // Prefer this main category if already assigned under a different one
        const cur = productMap.get(p.slug);
        if (cur.category !== main.slug && !cur._locked) {
          // keep existing if it already has a collection; only override empty
        }
        continue;
      }
      productMap.set(p.slug, {
        category: main.slug,
        subCategory: "",
        collectionName: "",
        sku: p.sku,
        name: p.name,
        url: p.url,
      });
      uncollected += 1;
    }

    tree.push({
      name: main.name,
      slug: main.slug,
      order: i,
      apiProductCount: tax.count,
      scrapedCategoryProducts: catProducts.length,
      collections: colNodes,
      productsWithoutCollection: uncollected,
    });
    log(
      `## ${main.name}: cats=${catProducts.length} collections=${colNodes.length} uncollected=${uncollected}`,
    );
  }

  return { tree, productMap, productCats, collections };
}

async function applyToDb(tree, productMap) {
  const conn = await connectMongo();
  const db = conn.db;
  const brands = db.collection("brands");
  const menus = db.collection("menus");
  const products = db.collection("products");

  const brand = await brands.findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Brand likewisefloors not found");

  const flooringDept = await db.collection("departments").findOne({
    slug: "flooring",
  });
  const deptId = flooringDept?._id || null;

  const now = new Date();
  const keepMainSlugs = new Set(tree.map((t) => t.slug));
  const keepSubSlugs = new Set();
  for (const t of tree) {
    for (const c of t.collections) keepSubSlugs.add(c.slug);
  }

  const menuByKey = new Map(); // `${parentId||'root'}:${slug}` → menu

  // Ensure main category menus
  for (const main of tree) {
    let menu = await menus.findOne({
      brand: brand._id,
      slug: main.slug,
      parent: null,
    });
    const fields = {
      name: main.name,
      slug: main.slug,
      parent: null,
      brand: brand._id,
      order: main.order,
      isActive: true,
      department: deptId,
      updatedAt: now,
    };
    if (!menu) {
      if (APPLY) {
        const r = await menus.insertOne({
          ...fields,
          image: "",
          createdAt: now,
        });
        menu = { _id: r.insertedId, ...fields };
        log(`+ menu main ${main.name}`);
      } else {
        menu = { _id: `dry-${main.slug}`, ...fields };
        log(`[dry] + menu main ${main.name}`);
      }
    } else if (APPLY) {
      await menus.updateOne(
        { _id: menu._id },
        { $set: fields },
      );
      menu = { ...menu, ...fields };
      log(`~ menu main ${main.name}`);
    } else {
      log(`[dry] ~ menu main ${main.name}`);
    }
    menuByKey.set(`root:${main.slug}`, menu);

    // Ensure collection (subcategory) menus
    for (let j = 0; j < main.collections.length; j++) {
      const col = main.collections[j];
      let child = await menus.findOne({
        brand: brand._id,
        slug: col.slug,
        parent: menu._id,
      });
      // Also find orphan child with same slug under wrong/missing parent
      if (!child && APPLY) {
        child = await menus.findOne({
          brand: brand._id,
          slug: col.slug,
        });
      }
      const childFields = {
        name: col.name,
        slug: col.slug,
        parent: menu._id,
        brand: brand._id,
        order: j,
        isActive: true,
        department: deptId,
        updatedAt: now,
      };
      if (!child) {
        if (APPLY) {
          const r = await menus.insertOne({
            ...childFields,
            image: "",
            createdAt: now,
          });
          child = { _id: r.insertedId, ...childFields };
          log(`  + sub ${main.slug}/${col.slug}`);
        } else {
          child = { _id: `dry-${col.slug}`, ...childFields };
          log(`  [dry] + sub ${main.slug}/${col.slug}`);
        }
      } else if (APPLY) {
        await menus.updateOne({ _id: child._id }, { $set: childFields });
        child = { ...child, ...childFields };
        log(`  ~ sub ${main.slug}/${col.slug}`);
      } else {
        log(`  [dry] ~ sub ${main.slug}/${col.slug}`);
      }
      menuByKey.set(`${main.slug}:${col.slug}`, child);
    }
  }

  // Deactivate obsolete Likewise menus (old flat cats not in new tree)
  const allBrandMenus = await menus
    .find({ brand: brand._id })
    .project({ _id: 1, slug: 1, parent: 1, name: 1, isActive: 1 })
    .toArray();
  let deactivated = 0;
  for (const m of allBrandMenus) {
    const isMain = !m.parent && keepMainSlugs.has(m.slug);
    const isSub = m.parent && keepSubSlugs.has(m.slug);
    if (isMain || isSub) continue;
    if (m.isActive === false) continue;
    if (APPLY) {
      await menus.updateOne(
        { _id: m._id },
        { $set: { isActive: false, updatedAt: now } },
      );
    }
    deactivated += 1;
    log(`${APPLY ? "" : "[dry] "}- deactivate menu ${m.name} (${m.slug})`);
  }

  // Index DB products for matching
  const dbProducts = await products
    .find({ brand: brand._id })
    .project({
      _id: 1,
      name: 1,
      category: 1,
      subCategory: 1,
      specs: 1,
    })
    .toArray();

  const bySlug = new Map();
  const bySku = new Map();
  const byUrl = new Map();
  for (const p of dbProducts) {
    const likeSlug = String(p.specs?.likewiseSlug || "").trim().toLowerCase();
    const sku = String(p.specs?.sku || p.specs?.likewiseSku || "")
      .trim()
      .toLowerCase();
    const src = String(p.specs?.sourceUrl || "");
    const fromUrl = (src.match(/\/product\/([^/]+)\/?/) || [])[1];
    if (likeSlug) bySlug.set(likeSlug, p);
    if (fromUrl) bySlug.set(fromUrl.toLowerCase(), p);
    if (sku) bySku.set(sku, p);
    if (src) byUrl.set(src.replace(/\/$/, ""), p);
  }

  let matched = 0;
  let updated = 0;
  let unmatched = 0;
  const unmatchedSamples = [];

  for (const [slug, info] of productMap) {
    let doc =
      bySlug.get(slug.toLowerCase()) ||
      (info.sku ? bySku.get(String(info.sku).toLowerCase()) : null) ||
      (info.url ? byUrl.get(info.url.replace(/\/$/, "")) : null);

    if (!doc) {
      unmatched += 1;
      if (unmatchedSamples.length < 15) {
        unmatchedSamples.push({ slug, sku: info.sku, name: info.name });
      }
      continue;
    }
    matched += 1;

    const set = {
      category: info.category,
      subCategory: info.subCategory || "",
      department: "flooring",
      updatedAt: now,
      "specs.collection": info.collectionName || "",
      "specs.collectionSlug": info.subCategory || "",
      "specs.likewiseSlug": slug,
      "specs.sourceUrl": info.url,
    };
    if (info.sku) set["specs.sku"] = info.sku;

    const changed =
      doc.category !== set.category ||
      String(doc.subCategory || "") !== String(set.subCategory || "");

    if (changed) {
      if (APPLY) {
        await products.updateOne({ _id: doc._id }, { $set: set });
      }
      updated += 1;
    } else if (APPLY) {
      // still refresh specs collection fields
      await products.updateOne({ _id: doc._id }, { $set: set });
    }
  }

  // Products in DB not found on scrape map — leave as-is but report
  const mappedSlugs = new Set(
    [...productMap.keys()].map((s) => s.toLowerCase()),
  );
  let dbOnly = 0;
  for (const p of dbProducts) {
    const likeSlug = String(p.specs?.likewiseSlug || "").trim().toLowerCase();
    const fromUrl = (
      String(p.specs?.sourceUrl || "").match(/\/product\/([^/]+)\/?/) || []
    )[1];
    const key = likeSlug || (fromUrl ? fromUrl.toLowerCase() : "");
    if (key && mappedSlugs.has(key)) continue;
    dbOnly += 1;
  }

  const summary = {
    apply: APPLY,
    brand: brand.slug,
    mainCategories: tree.length,
    collections: tree.reduce((a, t) => a + t.collections.length, 0),
    scrapedProductAssignments: productMap.size,
    menusDeactivated: deactivated,
    dbProducts: dbProducts.length,
    matched,
    categorySubcategoryUpdated: updated,
    unmatchedOnSiteNotInDb: unmatched,
    unmatchedSamples,
    dbProductsNotInScrapeMap: dbOnly,
  };

  log("\n=== APPLY SUMMARY ===");
  log(JSON.stringify(summary, null, 2));
  return summary;
}

(async () => {
  log(
    `Likewise collection revamp ${APPLY ? "APPLY" : "DRY-RUN"} ${new Date().toISOString()}`,
  );
  const { tree, productMap } = await scrapeTaxonomy();

  const report = {
    at: new Date().toISOString(),
    apply: APPLY,
    mainCategories: tree.length,
    totalCollections: tree.reduce((a, t) => a + t.collections.length, 0),
    productAssignments: productMap.size,
    withCollection: [...productMap.values()].filter((p) => p.subCategory)
      .length,
    withoutCollection: [...productMap.values()].filter((p) => !p.subCategory)
      .length,
    tree: tree.map((t) => ({
      name: t.name,
      slug: t.slug,
      apiProductCount: t.apiProductCount,
      collections: t.collections.map((c) => ({
        name: c.name,
        slug: c.slug,
        products: c.scrapedProducts,
      })),
      productsWithoutCollection: t.productsWithoutCollection,
    })),
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  log(`Wrote ${OUT}`);

  if (DISCOVER_ONLY) {
    log("Discover-only — skipping DB.");
    process.exit(0);
  }

  await applyToDb(tree, productMap);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
