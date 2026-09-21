/**
 * Promote a brand's appearance axis into `colorOptions`, with its pictures.
 *
 * The supplier presents finishes as a row of photographed swatches. Our
 * variant picker can do that too, but only for an axis it recognises as an
 * appearance axis, and `colorOptions` is the field the swatch components and
 * the product cards already read — so a finish lands better there.
 *
 * Which axes qualify is deliberately narrow. An axis named Finish/Colour is
 * taken as-is; an axis still carrying the scrape's "Select an option"
 * placeholder qualifies only when EVERY one of its values reads as a finish.
 * The rest of the placeholder axes are sizes ("1635 x 540mm") and valve
 * shapes ("Straight", "Angled"), and dressing those as colour swatches is the
 * exact bug the picker's own guard was added to stop.
 *
 * Additive: `variants` and `shopifyOptions` are untouched, so the variant that
 * checkout resolves is unchanged and this can be undone by clearing the field.
 * A product that already has `colorOptions` is left alone.
 *
 *   BRAND=toasty [APPLY=1] node scripts/axes-to-color-options.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const dns = require("dns");
const { MongoClient } = require("mongodb");

const SRV = (process.env.MONGODB_DNS_SERVERS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (SRV.length) dns.setServers(SRV);

const APPLY = process.env.APPLY === "1";
const SLUG = process.env.BRAND || "";
if (!SLUG) throw new Error("set BRAND=<slug>");

const NAMED_APPEARANCE = /^(finish|colour|color|shade|texture)$/i;
const PLACEHOLDER = /^\s*select an option/i;
const COLOURISH =
  /(white|black|chrome|brass|bronze|nickel|anthracite|grey|gray|copper|gold|silver|matt|gloss|brushed|polished|satin|pewter|graphite|sand|cream|mocha|heban|quartz)/i;

/** The axis to promote, or null when none of them is an appearance axis. */
function appearanceAxis(options) {
  for (const o of options || []) {
    const name = String(o?.name || "").trim();
    const values = (o?.values || []).map((v) => String(v || "").trim()).filter(Boolean);
    if (values.length < 2) continue;
    if (NAMED_APPEARANCE.test(name)) return { axis: o, name, values, why: "named" };
    if (PLACEHOLDER.test(name) && values.every((v) => COLOURISH.test(v))) {
      return { axis: o, name, values, why: "placeholder-but-all-finishes" };
    }
  }
  return null;
}

const optAt = (v, pos) =>
  String((pos === 1 ? v.option1 : pos === 2 ? v.option2 : v.option3) || "").trim();

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await c.connect();
  const db = c.db("test");
  const brand = await db.collection("brands").findOne({ slug: SLUG });
  if (!brand) throw new Error("brand not found: " + SLUG);
  const col = db.collection("products");

  const docs = await col
    .find({ brand: brand._id, "shopifyOptions.0": { $exists: true } })
    .project({ name: 1, shopifyOptions: 1, variants: 1, colorOptions: 1 })
    .toArray();
  if (!docs.length) throw new Error("no products with shopifyOptions — aborting");

  let named = 0, promoted = 0, skippedHas = 0, noAxis = 0, noPictures = 0, valuesTotal = 0, withPic = 0;
  const ops = [];

  for (const d of docs) {
    if ((d.colorOptions || []).length) { skippedHas += 1; continue; }
    const hit = appearanceAxis(d.shopifyOptions);
    if (!hit) { noAxis += 1; continue; }
    if (hit.why === "named") named += 1;

    const position = Number(hit.axis.position) || 1;
    const rows = hit.values.map((value, i) => {
      const v = (d.variants || []).find(
        (x) => optAt(x, position).toLowerCase() === value.toLowerCase(),
      );
      const pic = String((v && v.shopifyImageUrl) || "");
      if (pic) withPic += 1;
      valuesTotal += 1;
      return {
        name: value,
        // Photographed finishes, not flat colours — the picture is the swatch.
        swatchType: "image",
        colorValue: "",
        swatchImage: pic,
        imageUrl: pic,
        sap: (v && v.sku) || "",
        sortOrder: i,
      };
    });

    // A swatch row with no picture is worse than none: it renders as a blank
    // chip the shopper cannot tell apart from its neighbours.
    if (!rows.some((r) => r.swatchImage)) { noPictures += 1; continue; }

    promoted += 1;
    ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { colorOptions: rows } } } });
  }

  console.log(`${APPLY ? "APPLY" : "DRY"} · ${SLUG} · ${docs.length} products with options`);
  console.log(`  promoted            : ${promoted}  (named Finish/Colour: ${named}, placeholder-all-finishes: ${promoted - named})`);
  console.log(`  swatch values       : ${valuesTotal}  (with a picture: ${withPic})`);
  console.log(`  skipped, has colours: ${skippedHas}`);
  console.log(`  skipped, no appearance axis: ${noAxis}`);
  console.log(`  skipped, no pictures at all: ${noPictures}`);

  if (APPLY && ops.length) {
    let mod = 0;
    for (let i = 0; i < ops.length; i += 200) {
      mod += (await col.bulkWrite(ops.slice(i, i + 200), { ordered: false })).modifiedCount;
    }
    console.log(`  written             : ${mod}`);
  } else if (!APPLY) {
    console.log("  dry run — nothing written");
  }
  await c.close();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
