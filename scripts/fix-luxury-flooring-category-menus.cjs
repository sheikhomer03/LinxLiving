/**
 * Repair the Luxury Flooring category menus, then finish the group prune.
 *
 * Three faults, all confined to this brand and all left by the import:
 *
 *   1. `engineered-wood-flooring` and `solid-wood-flooring` were parented under
 *      the `accessories` menu instead of sitting at the top level, so two of the
 *      five flooring categories hung off Accessories.
 *   2. `solid-wood-flooring` exists twice as a category menu — two import runs,
 *      29 Aug 16:26 and 16:56 — so a `findOne` lookup picks one arbitrarily and
 *      the other never gets maintained.
 *   3. Following from 2, the earlier prune only reached one of the two, leaving
 *      solid wood with its Finish / Shade / Species / Width groups intact.
 *
 * This reparents, merges the duplicate, and re-applies the prune across *every*
 * matching category menu rather than the first one found: keep "Shop By Room"
 * and the style group (renamed to "Floor Style"), drop the rest.
 *
 * Other brands own categories with these same slugs — Natura Flooring and
 * Direct Flooring Online both have a solid-wood-flooring — so every read and
 * write here is filtered on the Luxury Flooring brand id, and any document that
 * fails that check is skipped and reported rather than touched.
 *
 * The `level: "subcategory"` entries slugged engineered-wood-flooring and
 * solid-wood-flooring under Accessories are genuine accessory pages ("beading
 * for engineered wood") and are deliberately left alone; only `level:
 * "category"` documents are reparented.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-luxury-flooring-category-menus.cjs
 *
 *   DRY_RUN=1   report the changes without writing
 */
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";

const FLOORING = [
  "engineered-wood-flooring",
  "vinyl-flooring",
  "laminate-flooring",
  "parquet-flooring",
  "solid-wood-flooring",
];

const ROOM_GROUP = "Shop By Room";
const STYLE_GROUP = "Floor Style";

const isRoomGroup = (g) => /^shop\s*by\s*room$/i.test(String(g || ""));
const isStyleGroup = (g) => /^(floor style|plank effect)$/i.test(String(g || ""));

/** Vinyl's ungrouped children are in the source store's nav; regroup, don't drop. */
const REGROUP = {
  "vinyl-flooring": {
    "bathroom-vinyl-flooring": ROOM_GROUP,
    "underlay-attached-vinyl": STYLE_GROUP,
    "waterproof-vinyl-flooring": STYLE_GROUP,
  },
};

async function main() {
  const { db } = await connectMongo();
  const menus = db.collection("menus");

  const brand = await db
    .collection("brands")
    .findOne({ name: /^luxury flooring$/i });
  if (!brand) throw new Error("Luxury Flooring brand not found");
  const brandIds = [brand._id, String(brand._id)];
  const ownedByBrand = (m) => brandIds.some((id) => String(id) === String(m.brand));

  const rollback = [];
  const foreign = [];
  let reparented = 0;
  let merged = 0;
  let movedKids = 0;
  let deleted = 0;
  let regrouped = 0;
  let renamed = 0;

  const childrenOf = async (menu) => {
    const kids = await menus
      .find({ parent: { $in: [menu._id, String(menu._id)] } })
      .toArray();
    const mine = kids.filter(ownedByBrand);
    kids.filter((k) => !ownedByBrand(k)).forEach((k) => foreign.push(k));
    return mine;
  };

  for (const slug of FLOORING) {
    const cats = (
      await menus.find({ slug, level: "category", brand: { $in: brandIds } }).toArray()
    ).filter(ownedByBrand);

    if (!cats.length) {
      console.log(`### ${slug}: no category menu for this brand; skipped`);
      continue;
    }

    // The correctly placed menu wins; failing that the fullest, then the oldest.
    const counts = new Map();
    for (const c of cats) counts.set(String(c._id), (await childrenOf(c)).length);
    const survivor = cats.sort(
      (a, b) =>
        (a.parent ? 1 : 0) - (b.parent ? 1 : 0) ||
        counts.get(String(b._id)) - counts.get(String(a._id)) ||
        new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
    )[0];

    console.log(`### ${slug}  (${cats.length} category menu${cats.length > 1 ? "s" : ""})`);

    // 1. Lift the survivor to the top level.
    if (survivor.parent) {
      const p = await menus.findOne({ _id: survivor.parent });
      rollback.push({
        _id: String(survivor._id),
        op: "update",
        slug,
        from: { parent: String(survivor.parent) },
        to: { parent: null },
      });
      if (!DRY_RUN) {
        await menus.updateOne(
          { _id: survivor._id },
          { $set: { parent: null, updatedAt: new Date() } },
        );
      }
      reparented += 1;
      console.log(`   reparented to top level (was under "${p ? p.slug : survivor.parent}")`);
    }

    // 2. Fold any duplicate category menus into the survivor.
    const survivorKids = await childrenOf(survivor);
    const haveSlug = new Set(survivorKids.map((k) => k.slug));
    for (const loser of cats.filter((c) => String(c._id) !== String(survivor._id))) {
      const kids = await childrenOf(loser);
      for (const k of kids) {
        if (haveSlug.has(k.slug)) {
          rollback.push({ _id: String(k._id), op: "delete", slug: k.slug, doc: k });
          if (!DRY_RUN) await menus.deleteOne({ _id: k._id });
          deleted += 1;
        } else {
          haveSlug.add(k.slug);
          rollback.push({
            _id: String(k._id),
            op: "update",
            slug: k.slug,
            from: { parent: String(k.parent) },
            to: { parent: String(survivor._id) },
          });
          if (!DRY_RUN) {
            await menus.updateOne(
              { _id: k._id },
              { $set: { parent: survivor._id, updatedAt: new Date() } },
            );
          }
          movedKids += 1;
        }
      }
      rollback.push({ _id: String(loser._id), op: "delete", slug, doc: loser });
      if (!DRY_RUN) await menus.deleteOne({ _id: loser._id });
      merged += 1;
      console.log(
        `   merged duplicate ${String(loser._id)}: ${kids.length} children (${movedKids} moved, rest were dupes)`,
      );
    }

    // 3. Prune to the two groups.
    const kids = await childrenOf(survivor);
    const regroupMap = REGROUP[slug] || {};
    const keep = [];
    const drop = [];
    for (const k of kids) {
      const target =
        regroupMap[k.slug] ||
        (isRoomGroup(k.group) ? ROOM_GROUP : isStyleGroup(k.group) ? STYLE_GROUP : null);
      if (target) keep.push({ menu: k, group: target });
      else drop.push(k);
    }

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
      const counted = [];
      for (const e of entries) {
        counted.push({ e, n: (await childrenOf(e.menu)).length });
      }
      counted.sort(
        (a, b) => b.n - a.n || String(a.e.menu._id).localeCompare(String(b.e.menu._id)),
      );
      survivors.push(counted[0].e);
      counted.slice(1).forEach((c) => drop.push(c.e.menu));
    }

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
      rollback.push({ _id: String(k._id), op: "delete", slug: k.slug, doc: k });
      if (!DRY_RUN) await menus.deleteOne({ _id: k._id });
      deleted += 1;
    }

    const groups = {};
    survivors.forEach((e) => {
      (groups[e.group] ||= []).push(e.menu.slug);
    });
    for (const [g, list] of Object.entries(groups)) {
      console.log(`   ${g} (${list.length}): ${list.sort().join(", ")}`);
    }
    console.log(`   removed ${drop.length}\n`);
  }

  if (foreign.length) {
    console.log(`!! ${foreign.length} menu(s) under these parents belong to another brand and were skipped:`);
    foreign.forEach((f) => console.log(`   ${f.slug} (brand ${f.brand})`));
  }

  if (rollback.length && !DRY_RUN) {
    const file = path.join(
      __dirname,
      "..",
      `rollback-luxury-flooring-category-menus-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
    console.log(`Rollback written: ${path.basename(file)}`);
  }

  console.log(
    `${DRY_RUN ? "[dry] " : ""}reparented ${reparented}, merged ${merged} duplicate menu(s), ` +
      `moved ${movedKids} children, deleted ${deleted}, renamed ${renamed}, regrouped ${regrouped}`,
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
