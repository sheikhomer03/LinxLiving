/**
 * Put the four finish groups back under the main that owns them, and realign
 * "Knobs & Handles" with the live navbar.
 *
 * The importer attached "Warm Finishes", "Cool Finishes", "Dark Finishes" and
 * "Colourful Finishes" to Knobs & Handles. On plankhardware.com those groups
 * belong to the dedicated "By Finish" main (/collections/shop-by-finish) —
 * Knobs & Handles has a flat "By Finish" column of eight finishes instead,
 * which the DB already holds correctly. The result was a Knobs & Handles panel
 * of 9 groups / 43 rows against the site's 5 / 35, and a By Finish hub of 3
 * rows against the site's 11.
 *
 * This moves the eight misplaced rows to the By Finish hub, restores the two
 * finishes it was missing there, renames "Kitchen Cabinets" back to "Kitchen"
 * in the By Room column, and renumbers `order` so both panels bucket their
 * groups in the site's sequence (the menu UI buckets by group in first-child
 * order, so `order` is what fixes group order too).
 *
 * Nothing about products changes — membership is by slug, and no slug moves.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-plank-finish-groups.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-plank-finish-groups.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-plank-finish-groups.cjs --rollback <file.json>
 *
 * Target state below is the live nav as parsed on 2026-08-13; re-check with
 * scripts/_tmp-plank-kh-panel.cjs before re-running after a site change.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

/** parent slug -> ordered [group, [ [childSlug, label], … ] ] */
const TARGET = {
  "all-cabinet-hardware": [
    ["All Knobs & Handles", [
      ["knobs", "Knobs"],
      ["handles", "Handles"],
      ["appliance-pulls", "Long Handles"],
      ["cup-pulls", "Cup Pulls"],
      ["cabinet-knobs-with-backplates", "Knobs with Backplates"],
      ["cabinet-handles-with-backplates", "Handles with Backplates"],
      ["edge-pulls", "Edge Pulls"],
      ["all-cabinet-hardware-all", "All Knobs & Handles"],
    ]],
    ["By Finish", [
      ["brass-hardware", "Satin Brass"],
      ["unlacquered-brass-hardware", "Unlacquered Brass"],
      ["aged-brass-hardware", "Aged Brass"],
      ["heirloom-brass-collection", "Heirloom Brass"],
      ["antique-brass-hardware", "Antique Brass"],
      ["blackened-bronze-collection", "Blackened Bronze"],
      ["polished-nickel-hardware", "Polished Nickel"],
      ["colourful-hardware", "Colourful"],
    ]],
    ["By Collection", [
      ["bobbin-collection", "BOBBIN"],
      ["esben-collection", "ESBEN"],
      ["peyton-collection", "PEYTON"],
      ["becker-collection", "BECKER Grooved"],
      ["kepler-collection", "KEPLER Knurled"],
      ["grayson-collection", "GRAYSON"],
      ["squiggle-wavey-collection", "SQUIGGLE"],
      ["alva-collection", "ALVA"],
    ]],
    ["By Room", [
      ["kitchen-hardware", "Kitchen"],
      ["bathroom-hardware", "Bathroom"],
      ["bedroom-hardware", "Bedroom"],
      ["living-room-hardware", "Living Room"],
      ["nursery-hardware", "Nursery & Children's Room"],
      ["utility-room-hardware", "Utility Room"],
      ["hallway-hardware", "Hallway"],
      ["home-office-hardware", "Home Office"],
    ]],
    ["By Project", [
      ["hardware-for-upcycle-projects", "Furniture Upcycling"],
      ["wardrobe-handles", "Wardrobes"],
      ["kitchen-hardware", "Kitchen Cabinets"],
    ]],
  ],
  "shop-by-finish": [
    ["Warm Finishes", [
      ["unlacquered-brass-hardware", "Unlacquered Brass"],
      ["brass-hardware", "Satin Brass"],
      ["aged-brass-hardware", "Aged Brass"],
      ["heirloom-brass-collection", "Heirloom Brass"],
      ["antique-brass-hardware", "Antique Brass"],
    ]],
    ["Cool Finishes", [
      ["polished-nickel-hardware", "Polished Nickel"],
      ["stainless-steel-hardware", "Stainless Steel"],
    ]],
    ["Dark Finishes", [
      ["black-hardware", "Black"],
      ["blackened-bronze-collection", "Blackened Bronze"],
      ["antique-brass-hardware", "Antique Brass"],
    ]],
    ["Colourful Finishes", [
      ["colourful-hardware", "All Colourful Hardware"],
    ]],
  ],
};

/** Groups sitting under Knobs & Handles that the By Finish hub owns. */
const MISPLACED = new Set([
  "Warm Finishes",
  "Cool Finishes",
  "Dark Finishes",
  "Colourful Finishes",
]);

async function main() {
  await connectMongo();
  const db = mongoose.connection.db;
  const menus = db.collection("menus");

  if (ROLLBACK) {
    const saved = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    for (const r of saved.changes) {
      await menus.updateOne(
        { _id: new mongoose.Types.ObjectId(r._id) },
        {
          $set: {
            parent: r.before.parent
              ? new mongoose.Types.ObjectId(r.before.parent)
              : null,
            group: r.before.group,
            name: r.before.name,
            order: r.before.order,
          },
        },
      );
    }
    console.log(`rolled back ${saved.changes.length} menus from ${ROLLBACK}`);
    await mongoose.disconnect();
    return;
  }

  const brand = await db
    .collection("brands")
    .findOne({ name: /plank\s*hardware/i });
  if (!brand) throw new Error("Plank Hardware brand not found");

  const parents = {};
  for (const slug of Object.keys(TARGET)) {
    const p = await menus.findOne({ brand: brand._id, slug, parent: null });
    if (!p) throw new Error(`main category not found: ${slug}`);
    parents[slug] = p;
  }

  const all = await menus
    .find({ brand: brand._id, parent: { $ne: null } })
    .toArray();
  const childrenOf = (id) => all.filter((m) => String(m.parent) === String(id));

  /**
   * A child is claimed by (current parent, current group, slug). The two
   * kitchen-hardware rows and the finish rows that legitimately appear twice
   * are only separable by their group, so the pool is keyed on it.
   */
  const pool = new Map();
  const key = (parentId, group, slug) => `${parentId}|${group}|${slug}`;
  for (const m of all) {
    const k = key(String(m.parent), m.group || "", m.slug);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(m);
  }
  const take = (parentId, group, slug) => {
    const bucket = pool.get(key(parentId, group, slug));
    return bucket && bucket.length ? bucket.shift() : null;
  };

  const khId = String(parents["all-cabinet-hardware"]._id);
  const sbfId = String(parents["shop-by-finish"]._id);

  const changes = [];
  const unresolved = [];

  for (const [parentSlug, groups] of Object.entries(TARGET)) {
    const parentId = String(parents[parentSlug]._id);
    let order = 0;
    for (const [group, kids] of groups) {
      for (const [slug, label] of kids) {
        // Where the row lives now: its own parent+group, or — for the eight
        // rows being moved — under Knobs & Handles in a misplaced group.
        let doc = take(parentId, group, slug);
        if (!doc && parentSlug === "shop-by-finish" && MISPLACED.has(group)) {
          doc = take(khId, group, slug);
        }
        if (!doc) {
          unresolved.push(`${parentSlug} › ${group} › ${slug}`);
          continue;
        }
        const before = {
          parent: doc.parent ? String(doc.parent) : null,
          group: doc.group || "",
          name: doc.name,
          order: doc.order == null ? 0 : doc.order,
        };
        const after = { parent: parentId, group, name: label, order };
        order += 1;
        if (
          before.parent === after.parent &&
          before.group === after.group &&
          before.name === after.name &&
          before.order === after.order
        ) {
          continue;
        }
        changes.push({ _id: String(doc._id), slug, before, after });
      }
    }
  }

  // Anything left under either main that the live nav has no place for.
  const leftovers = [];
  for (const [k, bucket] of pool) {
    const [parentId] = k.split("|");
    if (parentId !== khId && parentId !== sbfId) continue;
    for (const m of bucket) {
      leftovers.push(`${m.name} [${m.slug}] group="${m.group || ""}"`);
    }
  }

  console.log(
    `Knobs & Handles children: ${childrenOf(khId).length} -> 35 target`,
  );
  console.log(
    `By Finish children      : ${childrenOf(sbfId).length} -> 11 target\n`,
  );

  for (const c of changes) {
    const bits = [];
    if (c.before.parent !== c.after.parent)
      bits.push(
        `parent ${c.before.parent === khId ? "Knobs & Handles" : c.before.parent} -> ${c.after.parent === sbfId ? "By Finish" : c.after.parent}`,
      );
    if (c.before.group !== c.after.group)
      bits.push(`group "${c.before.group}" -> "${c.after.group}"`);
    if (c.before.name !== c.after.name)
      bits.push(`name "${c.before.name}" -> "${c.after.name}"`);
    if (c.before.order !== c.after.order)
      bits.push(`order ${c.before.order} -> ${c.after.order}`);
    console.log(`  ${c.slug.padEnd(34)} ${bits.join(", ")}`);
  }

  if (unresolved.length) {
    console.log(`\nMISSING (no menu doc to satisfy the live nav):`);
    for (const u of unresolved) console.log(`  ${u}`);
  }
  if (leftovers.length) {
    console.log(`\nLEFTOVER (in DB, not in the live nav — left untouched):`);
    for (const l of leftovers) console.log(`  ${l}`);
  }

  console.log(`\n${changes.length} menus to update`);

  if (!APPLY) {
    console.log("dry run — pass --apply to write");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(
    process.cwd(),
    `rollback-plank-finish-groups-${stamp}.json`,
  );
  fs.writeFileSync(file, JSON.stringify({ changes }, null, 2));

  for (const c of changes) {
    await menus.updateOne(
      { _id: new mongoose.Types.ObjectId(c._id) },
      {
        $set: {
          parent: new mongoose.Types.ObjectId(c.after.parent),
          group: c.after.group,
          name: c.after.name,
          order: c.after.order,
        },
      },
    );
  }
  console.log(`applied ${changes.length} updates; rollback -> ${file}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
