/**
 * Trim the Luxury Flooring dropdowns to what the source store actually shows.
 *
 * The import took its sub-categories from the crawl, which reaches listing pages
 * the store publishes but does not link from its menu — an `office` room page in
 * every category, a `bathroom` under engineered wood, `bevelled-edges` and
 * `square-edge` under Floor Style. They are real pages with real products; they
 * are simply not in the source store's navigation, so they do not belong in ours.
 *
 * Membership is decided against a live capture of the store's mega-menu
 * (scripts/../lf-live.json, produced from the homepage HTML) rather than against
 * the crawl. An entry is kept when the menu links its slug, or when the menu
 * shows its label pointing at a layered-nav filter instead of a category page —
 * laminate's Herringbone and Parquet are filter links there, but they are on
 * screen, so our equivalents stay.
 *
 * Removals only: sub-categories the source store lists and we lack are reported,
 * not created, since creating them would need product mappings we do not have.
 *
 * Products are untouched — they carry sub-categories by slug, not by menu id.
 * Only the Luxury Flooring brand is read or written; other brands own categories
 * with these same slugs and are filtered out by brand id.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/align-luxury-flooring-nav-to-source.cjs
 *
 *   DRY_RUN=1   report the changes without writing
 *   LIVE=<path> override the captured menu (default: ../lf-live.json)
 */
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIVE_FILE = process.env.LIVE || path.join(__dirname, "..", "lf-live.json");

const GROUPS = [
  { key: "room", name: "Shop By Room" },
  { key: "style", name: "Floor Style" },
];

const kebab = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Our slugs carry the category as a suffix the store's labels omit
 * ("herringbone-laminate-flooring" for a link labelled "Herringbone"), so
 * compare the slug with that suffix stripped as well as whole.
 */
function slugForms(slug, category) {
  const forms = new Set([slug]);
  const tail = category.replace(/^.*?-/, "");
  for (const suffix of [`-${category}`, `-${tail}`, "-flooring"]) {
    if (slug.endsWith(suffix)) forms.add(slug.slice(0, -suffix.length));
  }
  return [...forms].filter(Boolean);
}

/** An entry stays if the live menu links its slug, or shows its label. */
function matchesLive(ourSlug, category, liveEntries) {
  const forms = slugForms(ourSlug, category);
  for (const e of liveEntries) {
    if (e.slug && e.slug === ourSlug) return e;
    if (e.slug && forms.includes(e.slug)) return e;
    const label = kebab(e.label);
    if (forms.includes(label)) return e;
    if (label && forms.some((f) => f === label.replace(/s$/, ""))) return e;
  }
  return null;
}

async function main() {
  const live = JSON.parse(fs.readFileSync(LIVE_FILE, "utf8"));
  const { db } = await connectMongo();
  const menus = db.collection("menus");

  const brand = await db
    .collection("brands")
    .findOne({ name: /^luxury flooring$/i });
  if (!brand) throw new Error("Luxury Flooring brand not found");
  const brandIds = [brand._id, String(brand._id)];
  const ownedByBrand = (m) => brandIds.some((id) => String(id) === String(m.brand));

  const rollback = [];
  const skipped = [];
  let removed = 0;
  let keptWithChildren = 0;

  for (const [category, groups] of Object.entries(live)) {
    const cat = await menus.findOne({
      slug: category,
      level: "category",
      brand: { $in: brandIds },
    });
    if (!cat || !ownedByBrand(cat)) {
      console.log(`### ${category}: no category menu for this brand; skipped`);
      continue;
    }

    console.log(`### ${category}`);
    for (const { key, name } of GROUPS) {
      const liveEntries = groups[key] || [];
      const kids = (
        await menus
          .find({ parent: { $in: [cat._id, String(cat._id)] }, group: name })
          .toArray()
      ).filter(ownedByBrand);

      const drop = [];
      const keep = [];
      for (const k of kids) {
        const hit = matchesLive(k.slug, category, liveEntries);
        if (hit) keep.push({ k, via: hit.slug === k.slug ? "slug" : `label "${hit.label}"` });
        else drop.push(k);
      }

      // Never strand a subtree: a node with children is reported, not deleted.
      const safeDrop = [];
      for (const k of drop) {
        const n = await menus.countDocuments({
          parent: { $in: [k._id, String(k._id)] },
        });
        if (n) {
          keptWithChildren += 1;
          skipped.push({ category, group: name, slug: k.slug, children: n });
        } else safeDrop.push(k);
      }

      console.log(`  ${name}: ours ${kids.length} → ${keep.length + (drop.length - safeDrop.length)}  (live shows ${liveEntries.length})`);
      for (const k of safeDrop) console.log(`     REMOVE  ${k.slug}`);
      for (const s of skipped.filter((x) => x.category === category && x.group === name))
        console.log(`     KEPT (has ${s.children} child menus, would orphan): ${s.slug}`);

      const missing = liveEntries.filter(
        (e) => e.slug && !kids.some((k) => matchesLive(k.slug, category, [e])),
      );
      for (const m of missing) console.log(`     (live has, we lack: ${m.slug})`);

      for (const k of safeDrop) {
        rollback.push({ _id: String(k._id), op: "delete", slug: k.slug, doc: k });
        if (!DRY_RUN) await menus.deleteOne({ _id: k._id });
        removed += 1;
      }
    }
    console.log("");
  }

  if (rollback.length && !DRY_RUN) {
    const file = path.join(
      __dirname,
      "..",
      `rollback-luxury-flooring-nav-align-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
    console.log(`Rollback written: ${path.basename(file)}`);
  }

  console.log(
    `${DRY_RUN ? "[dry] " : ""}removed ${removed}` +
      (keptWithChildren ? `, kept ${keptWithChildren} that would have orphaned children` : ""),
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
