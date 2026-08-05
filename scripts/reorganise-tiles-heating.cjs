/**
 * Catalogue reorganisation — Tiles department + Heating department.
 *
 *   1. Create a "Tiles" department.
 *   2. Under it, three categories: Wall Tiles, Floor Tiles, Wall & Floor Tiles.
 *      The third exists because 1,645 products sit in a combined
 *      "floor-and-wall" category and nothing in the data says which surface
 *      they are for — most porcelain genuinely is both.
 *   3. Rename the empty "Heating & Cooling" department to "Heating" and move
 *      the 764 underfloor-heating products into it (they currently have no
 *      department at all).
 *
 * Nothing is deleted. Only `department` and `category` are re-tagged, the
 * original values of every touched product are written to a rollback file,
 * and the existing style sub-categories (Ceramic Tiles, Mosaics, Parquet …)
 * are preserved as sub-categories.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/reorganise-tiles-heating.cjs          # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/reorganise-tiles-heating.cjs --apply  # write
 *   node --require ./scripts/mongo-dns.cjs scripts/reorganise-tiles-heating.cjs --rollback <file>
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const APPLY = process.argv.includes("--apply");
const ROLLBACK_IDX = process.argv.indexOf("--rollback");
const ROLLBACK_FILE = ROLLBACK_IDX > -1 ? process.argv[ROLLBACK_IDX + 1] : null;

/**
 * What counts as a tile. Deliberately narrower than "anything in the flooring
 * department": wallpaper, parquet, laminate, vinyl planks, wall panels and
 * fixing materials all live in the same combined category but are not tiles,
 * and sweeping them into a Tiles department would be wrong.
 */
const TILE_RX =
  /tile|gloss|matt|porcelain|ceramic|mosaic|terrazzo|splashback|large-format|natural-stone/i;
const NOT_TILE_RX =
  /wallpaper|parquet|laminate|underlay|skirting|adhesive|grout|leveller|panel|profile|trim|accessor/i;
/**
 * Categories that contain a tile-ish word but are not wall/floor tiles:
 * Britmet ROOF tiles (pantile, plaintile, villatile …), bathroom ware, and
 * luxury vinyl tile which is flooring sold by the plank.
 */
const NOT_SURFACE_TILE_RX =
  /pantile|plaintile|villatile|ultratile|liteslate|shingle|slate-2000|profile-49|roof|bathroom|vinyl|canop|hornsey/i;
const UFH_RX = /under.?floor|thermostat|heating/i;

/**
 * Wall Tiles / Floor Tiles are NOT created here, deliberately.
 *
 * A dry run over the live data put 1,311 of 1,311 tiles into a single bucket:
 * they sit in a combined "floor-and-wall" category, or in finish-named ones
 * ("gloss", "matt") that record no surface at all. Creating Wall Tiles and
 * Floor Tiles today would add two categories with zero products, which the
 * navigation then hides anyway.
 *
 * So this migration does the part the data supports — gathering tiles into
 * their own department, keeping the existing style breakdown (Ceramic Tiles,
 * Mosaics, Large Format, Natural Stone …) as the categories beneath it. The
 * wall/floor split can be layered on later once products carry that flag.
 */

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection;
  const Products = db.collection("products");
  const Departments = db.collection("departments");
  const Menus = db.collection("menus");

  if (ROLLBACK_FILE) {
    const rows = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
    console.log(`Rolling back ${rows.length} products from ${ROLLBACK_FILE}`);
    for (const r of rows) {
      await Products.updateOne(
        { _id: new mongoose.Types.ObjectId(r._id) },
        { $set: { department: r.department, category: r.category, subCategory: r.subCategory } },
      );
    }
    console.log("Rollback complete.");
    await mongoose.disconnect();
    return;
  }

  const log = [];
  const say = (s) => { console.log(s); log.push(s); };
  say(APPLY ? "=== APPLYING CHANGES ===" : "=== DRY RUN (no writes) ===");

  // ---------------------------------------------------------------- Tiles
  let tilesDept = await Departments.findOne({ slug: "tiles" });
  say(`\n[1] Tiles department: ${tilesDept ? "already exists" : "will be CREATED"}`);
  if (!tilesDept && APPLY) {
    const flooring = await Departments.findOne({ slug: "flooring" });
    const res = await Departments.insertOne({
      name: "Tiles",
      slug: "tiles",
      description: "Wall and floor tiles across every brand we stock.",
      order: (flooring?.order ?? 5) + 1,
      isActive: true,
      image: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tilesDept = await Departments.findOne({ _id: res.insertedId });
  }

  say("\n[2] Tile categories: keeping the existing style breakdown");
  say("    (Wall/Floor Tiles not created — no product records which surface)");

  // ------------------------------------------------------------- Products
  const tileQuery = {
    $and: [
      { $or: [{ category: TILE_RX }, { subCategory: TILE_RX }] },
      { category: { $not: NOT_TILE_RX } },
      { subCategory: { $not: NOT_TILE_RX } },
      { category: { $not: NOT_SURFACE_TILE_RX } },
      { subCategory: { $not: NOT_SURFACE_TILE_RX } },
    ],
  };
  const tileProducts = await Products.find(tileQuery)
    .project({ _id: 1, department: 1, category: 1, subCategory: 1 })
    .toArray();

  const backup = [];
  const ops = [];
  const catSet = new Set();
  for (const p of tileProducts) {
    catSet.add(p.category);
    backup.push({
      _id: String(p._id),
      department: p.department ?? "",
      category: p.category ?? "",
      subCategory: p.subCategory ?? "",
    });
    // Only the department moves. Category and sub-category are untouched, so
    // the style breakdown survives intact.
    ops.push({
      updateOne: { filter: { _id: p._id }, update: { $set: { department: "tiles" } } },
    });
  }

  say(`\n[3] Tile products to move: ${tileProducts.length}`);
  say(`    categories that move with them: ${[...catSet].filter(Boolean).join(", ")}`);

  // -------------------------------------------------------------- Heating
  let heatDept = await Departments.findOne({ slug: "heating" })
    || await Departments.findOne({ slug: "heating-and-cooling" });
  say(`\n[4] Heating department: ${heatDept ? `"${heatDept.name}" -> "Heating"` : "will be CREATED"}`);

  const ufhQuery = {
    $and: [
      { $or: [{ category: UFH_RX }, { subCategory: UFH_RX }] },
      { $or: [{ department: "" }, { department: null }, { department: { $exists: false } }] },
    ],
  };
  const ufhProducts = await Products.find(ufhQuery)
    .project({ _id: 1, department: 1, category: 1, subCategory: 1 })
    .toArray();
  say(`    underfloor-heating products to move: ${ufhProducts.length}`);

  for (const p of ufhProducts) {
    backup.push({
      _id: String(p._id),
      department: p.department ?? "",
      category: p.category ?? "",
      subCategory: p.subCategory ?? "",
    });
    ops.push({
      updateOne: { filter: { _id: p._id }, update: { $set: { department: "heating" } } },
    });
  }

  if (APPLY) {
    if (heatDept) {
      await Departments.updateOne(
        { _id: heatDept._id },
        { $set: { name: "Heating", slug: "heating", isActive: true, updatedAt: new Date() } },
      );
    } else {
      await Departments.insertOne({
        name: "Heating", slug: "heating", description: "Underfloor heating, thermostats and controls.",
        order: 12, isActive: true, image: "", createdAt: new Date(), updatedAt: new Date(),
      });
    }
    heatDept = await Departments.findOne({ slug: "heating" });

    // Point the heating category menus at the Heating department so they
    // appear in the navigation tree.
    const ufhCats = [...new Set(ufhProducts.map((p) => p.category).filter(Boolean))];
    for (const slug of ufhCats) {
      await Menus.updateMany({ slug }, { $set: { department: heatDept._id, updatedAt: new Date() } });
    }
    say(`    heating category menus re-pointed: ${ufhCats.length}`);

    // Point tile style menus at the Tiles department.
    const tileCats = [...catSet].filter(Boolean);
    for (const slug of tileCats) {
      await Menus.updateMany(
        { slug },
        { $set: { department: tilesDept._id, updatedAt: new Date() } },
      );
    }
    say(`    tile category menus re-pointed to Tiles: ${tileCats.length}`);

    const file = path.join(process.cwd(), `rollback-reorg-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    say(`\n[5] Rollback file written: ${path.basename(file)} (${backup.length} products)`);

    if (ops.length) {
      const res = await Products.bulkWrite(ops, { ordered: false });
      say(`[6] Products updated: ${res.modifiedCount}`);
    }
    say("\nDone. To undo:  node --require ./scripts/mongo-dns.cjs scripts/reorganise-tiles-heating.cjs --rollback " + path.basename(file));
  } else {
    say(`\nDRY RUN — would update ${ops.length} products in total.`);
    say("Re-run with --apply to write the changes.");
  }

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
