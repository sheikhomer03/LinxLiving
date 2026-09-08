/**
 * Recompute the LINX taxonomy on the Luxury Flooring import.
 *
 * The first import took the primary category from whichever crawled listing
 * page reached a product first. Several of that store's listings are virtual
 * categories that pull in anything matching a filter, so a solid oak
 * herringbone appears on the Engineered Wood and Parquet pages as well as its
 * own — and the crawl filed it under Engineered Wood, leaving the Parquet
 * department with 128 members and no primaries at all.
 *
 * The product's own `sourceCategories` say what the thing is; the crawl (kept
 * in `specs.sourcePaths`) says where the site surfaces it. This rewrites
 * `category` / `categories` / `subCategory` / `subCategories` on that basis,
 * using data already stored — no refetch, and the galleries are untouched.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-luxury-flooring-taxonomy.cjs
 *
 *   DRY_RUN=1   report the changes without writing
 */
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const SOURCE_TAG = "luxury-flooring-scrape";

/** Same roots and nav order as the importer. */
const MAIN_NAV = [
  { slug: "engineered-wood-flooring", department: "flooring" },
  { slug: "vinyl-flooring", department: "flooring" },
  { slug: "laminate-flooring", department: "flooring" },
  { slug: "parquet-flooring", department: "flooring" },
  { slug: "solid-wood-flooring", department: "flooring" },
  { slug: "accessories", department: "accessories" },
];

const EXCLUDED_ROOTS = new Set([
  "sale",
  "clearance",
  "special-offers",
  "black-friday-special-offers",
  "cyber-monday-special-offers",
  "christmas-special-offers",
]);

const isRoot = (x) => MAIN_NAV.some((n) => n.slug === x);
const navRank = (x) => MAIN_NAV.findIndex((n) => n.slug === x);
const rootOf = (x) => String(x || "").split("/")[0];
const rootsOf = (list) => [...new Set(list.map(rootOf).filter(isRoot))];

async function main() {
  const { db } = await connectMongo();
  const products = db.collection("products");

  const docs = await products
    .find(
      { "specs.source": SOURCE_TAG },
      {
        projection: {
          name: 1,
          category: 1,
          categories: 1,
          subCategory: 1,
          subCategories: 1,
          department: 1,
          sourceCategories: 1,
          "specs.sourcePaths": 1,
        },
      },
    )
    .toArray();

  console.log(`${docs.length} Luxury Flooring product(s)`);

  const rollback = [];
  let changed = 0;
  let unchanged = 0;
  let orphaned = 0;

  for (const d of docs) {
    const ownPaths = (d.sourceCategories || [])
      .map((c) => c && c.urlPath)
      .filter(Boolean);
    const crawlPaths = ((d.specs || {}).sourcePaths || []).filter(Boolean);

    const paths = [...new Set([...ownPaths, ...crawlPaths])].filter(
      (x) => isRoot(rootOf(x)) && !String(x).split("/").some((s) => EXCLUDED_ROOTS.has(s)),
    );

    const pool = rootsOf(ownPaths).length ? rootsOf(ownPaths) : rootsOf(crawlPaths);
    if (!pool.length) {
      // Nothing outside the promotional shelves — leave it alone and report it.
      orphaned += 1;
      console.log(`  ! ${d.name}: no category outside SALE/Clearance; left as-is`);
      continue;
    }

    const root = pool.sort((a, b) => navRank(a) - navRank(b))[0];
    const nav = MAIN_NAV.find((n) => n.slug === root);
    const subPaths = paths.filter((x) => x !== root && !isRoot(x));
    const subSlugs = [
      ...new Set(subPaths.map((x) => x.split("/").pop()).filter(Boolean)),
    ];
    const categories = rootsOf(paths);

    const next = {
      department: nav.department,
      category: root,
      categories,
      subCategory: subSlugs[0] || "",
      subCategories: subSlugs,
    };

    const same =
      d.category === next.category &&
      d.department === next.department &&
      d.subCategory === next.subCategory &&
      JSON.stringify(d.categories || []) === JSON.stringify(next.categories) &&
      JSON.stringify(d.subCategories || []) === JSON.stringify(next.subCategories);
    if (same) {
      unchanged += 1;
      continue;
    }

    rollback.push({
      _id: String(d._id),
      from: {
        department: d.department,
        category: d.category,
        categories: d.categories || [],
        subCategory: d.subCategory,
        subCategories: d.subCategories || [],
      },
      to: next,
    });

    if (!DRY_RUN) {
      await products.updateOne(
        { _id: d._id },
        { $set: { ...next, updatedAt: new Date() } },
      );
    }
    changed += 1;
  }

  if (rollback.length && !DRY_RUN) {
    const file = path.join(
      __dirname,
      "..",
      `rollback-luxury-flooring-taxonomy-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
    console.log(`Rollback written: ${path.basename(file)}`);
  }

  console.log(`\n${DRY_RUN ? "[dry] " : ""}changed: ${changed}`);
  console.log(`unchanged: ${unchanged}`);
  console.log(`no usable category: ${orphaned}`);

  const after = {};
  for (const n of MAIN_NAV) {
    after[n.slug] = {
      primary: await products.countDocuments({
        "specs.source": SOURCE_TAG,
        category: n.slug,
      }),
      member: await products.countDocuments({
        "specs.source": SOURCE_TAG,
        categories: n.slug,
      }),
    };
  }
  console.log("\nprimary / member by root:");
  for (const [k, v] of Object.entries(after)) {
    console.log(`  ${k.padEnd(26)} ${String(v.primary).padStart(4)} / ${v.member}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
