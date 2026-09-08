/**
 * Reduce the Luxury Flooring nav to two groups per flooring category.
 *
 * The import mirrored every grouping axis the source store publishes — Finish,
 * Shade, Thickness, Width, Range, Species, Construction, Joining Method — which
 * gave the five flooring dropdowns up to ten headings each. Only "Shop By Room"
 * and the style group earn their place in the menu; the rest are better served
 * by the layered filters on the listing page, which is how the source store
 * itself surfaces them.
 *
 * This keeps those two groups, deletes the other children, and along the way:
 *   - renames "Plank Effect" to "Floor Style" (the source store's own heading)
 *   - regroups vinyl's three ungrouped children, which the source store does
 *     show in the nav, into the two groups being kept
 *   - drops duplicate menus inside the kept groups (solid wood carried every
 *     room twice)
 *
 * Products are untouched: they carry sub-categories by slug, not by menu id, so
 * every tag survives — the sub-category simply stops being reachable from the
 * dropdown.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/prune-luxury-flooring-menu-groups.cjs
 *
 *   DRY_RUN=1   report the changes without writing
 */
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";

const CATEGORIES = [
  "engineered-wood-flooring",
  "vinyl-flooring",
  "laminate-flooring",
  "parquet-flooring",
  "solid-wood-flooring",
];

const ROOM_GROUP = "Shop By Room";
const STYLE_GROUP = "Floor Style";

/** The heading this rename replaces, plus the target itself so a re-run is a no-op. */
const isRoomGroup = (g) => /^shop\s*by\s*room$/i.test(String(g || ""));
const isStyleGroup = (g) => /^(floor style|plank effect)$/i.test(String(g || ""));

/**
 * Vinyl's three ungrouped children are in the source store's dropdown, so they
 * are regrouped rather than dropped with the rest.
 */
const REGROUP = {
  "vinyl-flooring": {
    "bathroom-vinyl-flooring": ROOM_GROUP,
    "underlay-attached-vinyl": STYLE_GROUP,
    "waterproof-vinyl-flooring": STYLE_GROUP,
  },
};

/** Of a set of same-slug siblings, the one to keep: has children, then lowest order, then oldest. */
function pickSurvivor(dupes) {
  return dupes.sort(
    (a, b) =>
      (b.childCount || 0) - (a.childCount || 0) ||
      (a.order ?? 1e9) - (b.order ?? 1e9) ||
      String(a._id).localeCompare(String(b._id)),
  )[0];
}

async function main() {
  const { db } = await connectMongo();
  const menus = db.collection("menus");

  const brand = await db
    .collection("brands")
    .findOne({ name: /^luxury flooring$/i });
  if (!brand) throw new Error("Luxury Flooring brand not found");
  const brandIds = [brand._id, String(brand._id)];

  const rollback = [];
  let deleted = 0;
  let regrouped = 0;
  let renamed = 0;
  let deduped = 0;

  for (const slug of CATEGORIES) {
    const cat = await menus.findOne({ slug, brand: { $in: brandIds } });
    if (!cat) {
      console.log(`### ${slug}: no menu under this brand; skipped`);
      continue;
    }

    const kids = await menus
      .find({ parent: { $in: [cat._id, String(cat._id)] } })
      .toArray();

    // Children of children, so a survivor with a subtree is never the one dropped.
    for (const k of kids) {
      k.childCount = await menus.countDocuments({
        parent: { $in: [k._id, String(k._id)] },
      });
    }

    const regroupMap = REGROUP[slug] || {};
    const keep = [];
    const drop = [];

    for (const k of kids) {
      const target = regroupMap[k.slug];
      if (target) {
        keep.push({ menu: k, group: target });
      } else if (isRoomGroup(k.group)) {
        keep.push({ menu: k, group: ROOM_GROUP });
      } else if (isStyleGroup(k.group)) {
        keep.push({ menu: k, group: STYLE_GROUP });
      } else {
        drop.push(k);
      }
    }

    // Duplicate slugs among the survivors collapse to one menu each.
    const bySlug = {};
    keep.forEach((e) => {
      (bySlug[e.menu.slug] ||= []).push(e);
    });
    const survivors = [];
    for (const entries of Object.values(bySlug)) {
      if (entries.length === 1) {
        survivors.push(entries[0]);
        continue;
      }
      const winner = pickSurvivor(entries.map((e) => e.menu));
      for (const e of entries) {
        if (String(e.menu._id) === String(winner._id)) survivors.push(e);
        else {
          drop.push(e.menu);
          deduped += 1;
        }
      }
    }

    // Group moves and the Plank Effect → Floor Style rename.
    for (const e of survivors) {
      if (e.menu.group === e.group) continue;
      rollback.push({
        _id: String(e.menu._id),
        op: "update",
        slug: e.menu.slug,
        from: { group: e.menu.group ?? "" },
        to: { group: e.group },
      });
      if (!DRY_RUN) {
        await menus.updateOne(
          { _id: e.menu._id },
          { $set: { group: e.group, updatedAt: new Date() } },
        );
      }
      if (regroupMap[e.menu.slug]) regrouped += 1;
      else renamed += 1;
    }

    for (const k of drop) {
      const { childCount, ...doc } = k;
      rollback.push({ _id: String(k._id), op: "delete", slug: k.slug, doc });
      if (!DRY_RUN) await menus.deleteOne({ _id: k._id });
      deleted += 1;
    }

    const groups = {};
    survivors.forEach((e) => {
      (groups[e.group] ||= []).push(e.menu.slug);
    });
    console.log(`### ${slug}: ${kids.length} children → ${survivors.length}`);
    for (const [g, list] of Object.entries(groups)) {
      console.log(`   ${g} (${list.length}): ${list.sort().join(", ")}`);
    }
    console.log(`   removed ${drop.length}`);
    console.log("");
  }

  if (rollback.length && !DRY_RUN) {
    const file = path.join(
      __dirname,
      "..",
      `rollback-luxury-flooring-menu-groups-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
    console.log(`Rollback written: ${path.basename(file)}`);
  }

  console.log(
    `${DRY_RUN ? "[dry] " : ""}deleted ${deleted} (of which ${deduped} duplicates), ` +
      `renamed ${renamed}, regrouped ${regrouped}`,
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
