/**
 * Make Tile Mountain products sell the way tilemountain.co.uk sells them.
 *
 * Their PDP offers "How many do I need? / Calculate Area" on products sold by
 * the square metre, and nothing but a quantity box on products sold by the
 * piece — trims, tools, borders, corner tiles, thermostats. Ours was offering
 * the area calculator on all of them, because the storefront infers "sold by
 * area" from the category and every Tile Mountain product is filed under
 * tiles or flooring.
 *
 * The shop states which it is. `product_price_type` is 1 for a product priced
 * per square metre, 3 for a mosaic priced per sheet and 2 for one priced per
 * piece; the first two carry their calculator and the third does not, on all
 * twelve pages checked against the live site. `soldPerUnit` is the
 * storefront's existing switch for "this is a unit, not a floor area" (it is
 * what keeps a pergola out of the decking calculator), so the flag maps
 * straight onto it and no component has to learn about this brand.
 *
 * `calculated_sqm_price` is only a per-m² rate on type 1. On a per-sheet or
 * per-piece product it repeats the unit price, so it is not copied there —
 * a sheet's true m² rate comes from its coverage instead.
 *
 * Nothing is removed. Existing specs stay; this adds the unit fields and the
 * box/tile coverage the calculator needs to round to whole packs.
 *
 * Env:
 *   DRY_RUN=1  report only
 *   LIMIT=n    only the first n capture records
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const DATA =
  process.env.TM_DATA ||
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/a167de67-d47a-4f6e-aa8a-c11dee9e30bc/scratchpad";
const CAPTURE = path.join(DATA, "tm-pdp-v2.jsonl");
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;

/**
 * First number in a value. Their coverage reads "2.2 m2", so stripping every
 * non-digit would glue the unit's own 2 onto the figure and make it 2.22.
 */
const num = (v) => {
  const m = String(v == null ? "" : v).match(/-?\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

function readCapture() {
  const out = new Map();
  for (const line of fs.readFileSync(CAPTURE, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec.product || rec.error) continue;
    out.set(rec.url.replace(/\/$/, ""), rec);
  }
  return out;
}

async function main() {
  const conn = await connectMongo();
  const brand = await conn.db.collection("brands").findOne({ name: /^tile mountain$/i });
  if (!brand) throw new Error("Tile Mountain brand not found");
  const sec = await mongoose
    .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 })
    .asPromise();
  const P = sec.db.collection("products");

  const capture = readCapture();
  console.log("brand    : " + brand.name + "  (" + brand.dataCluster + ")");
  console.log("capture  : " + capture.size + " products" + (DRY_RUN ? "   (DRY RUN)" : ""));

  const docs = await P.find({ brand: brand._id })
    .project({
      _id: 1, name: 1, price: 1, soldPerUnit: 1,
      "specs.sourceUrl": 1, "specs.unit": 1, "specs.boxQuantity": 1,
    })
    .toArray();
  console.log("in db    : " + docs.length + " products");
  console.log("");

  let matched = 0, unmatched = 0, changed = 0;
  const counts = { sqm: 0, sheet: 0, pieces: 0 };
  const ops = [];
  const examples = { sqm: [], sheet: [], pieces: [] };

  for (const d of docs) {
    const url = String(d.specs?.sourceUrl || "").replace(/\/$/, "");
    const rec = url && capture.get(url);
    if (!rec) { unmatched += 1; continue; }
    matched += 1;
    const p = rec.product;

    /*
     * 1 = per square metre, 3 = per sheet, 2 = per piece. Only the last one
     * sells without their area calculator.
     */
    const type = String(p.product_price_type || "");
    const kind = type === "1" ? "sqm" : type === "3" ? "sheet" : "pieces";
    const areaSold = kind !== "pieces";
    const unitWord = kind === "sqm" ? "per m²" : kind === "sheet" ? "per sheet" : "per piece";
    counts[kind] += 1;

    const set = {
      soldPerUnit: !areaSold,
      "specs.unit": unitWord,
      "specs.priceType": type,
      "specs.unitOfMeasure": kind,
      /* What the basket actually charges for one of whatever it sells. */
      "specs.unitPrice": Number(p.precise_price?.final_price) || null,
    };

    /* Units of the thing sold that cover one square metre. */
    const perM2 = Number(p.qty_per_sqm);
    const hasPerM2 = Number.isFinite(perM2) && perM2 > 0;

    /*
     * What one of these is ordered as. A pack product counts packs and
     * cannot be bought in part of one; everything else counts pieces, which
     * their calculator labels "Tiles" whether they are tiles or mosaic
     * sheets.
     */
    if (kind === "sqm") {
      const sqm = num(p.calculated_sqm_price);
      if (sqm) set["specs.pricePerM2"] = sqm;
      const box = num(p.box_coverage);
      set["specs.orderUnit"] = box ? "Pack" : "Tiles";
      set["specs.minFullPack"] = Boolean(box);
      if (box) {
        set["specs.sqmPerBox"] = box;
      } else if (hasPerM2 && perM2 < 1) {
        // Below 1 it counts packs per m², which is the pack's own coverage.
        set["specs.sqmPerBox"] = Math.round((1 / perM2) * 100) / 100;
      }
      if (hasPerM2 && perM2 >= 1) {
        set["specs.tilesPerSqm"] = Math.round(perM2 * 1000) / 1000;
        // Loose tiles still ship in boxes; their coverage is what the
        // calculator rounds an order up to.
        const boxQty = num(d.specs?.boxQuantity);
        if (!set["specs.sqmPerBox"] && boxQty) {
          set["specs.sqmPerBox"] = Math.round((boxQty / perM2) * 100) / 100;
        }
      }
    } else if (kind === "sheet") {
      // Priced per sheet, so the sheet is the pack and its coverage is what
      // turns an area into a number of sheets.
      set["specs.orderUnit"] = "Tiles";
      set["specs.minFullPack"] = false;
      if (hasPerM2) {
        /*
         * A mosaic's headline is its sheet price, both here and on their
         * cards, so the per-m² rate goes under its own key — writing it to
         * `pricePerM2` would make every card quote £211 for an £18.99 sheet.
         */
        const unit = Number(p.precise_price && p.precise_price.final_price);
        if (Number.isFinite(unit) && unit > 0) {
          set["specs.sheetPricePerM2"] = Math.round(unit * perM2 * 100) / 100;
        }
        set["specs.sheetsPerSqm"] = Math.round(perM2 * 1000) / 1000;
        set["specs.sqmPerBox"] = Math.round((1 / perM2) * 10000) / 10000;
      }
    }

    if (examples[kind].length < 2) {
      examples[kind].push(d.name.slice(0, 44).padEnd(46) + "£" + d.price + " " + unitWord);
    }

    const already =
      Boolean(d.soldPerUnit) === Boolean(set.soldPerUnit) &&
      String(d.specs?.unit || "") === set["specs.unit"];
    if (!already) changed += 1;
    ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: set } } });
  }

  console.log("matched to capture : " + matched);
  console.log("  per m²           : " + counts.sqm + "   (keeps the area calculator, as they do)");
  console.log("  per sheet        : " + counts.sheet + "   (keeps the area calculator, as they do)");
  console.log("  per piece        : " + counts.pieces + "   (quantity box only, as they do)");
  console.log("no capture match   : " + unmatched);
  console.log("records to change  : " + changed);
  console.log("");
  for (const k of ["sqm", "sheet", "pieces"]) {
    for (const e of examples[k]) console.log("  " + k.padEnd(7) + e);
  }
  console.log("");

  if (!DRY_RUN && ops.length) {
    for (let i = 0; i < ops.length; i += 500) {
      await P.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
    console.log("written : " + ops.length + " products");
  } else {
    console.log("dry run : nothing written");
  }

  await mongoose.disconnect();
  await sec.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
