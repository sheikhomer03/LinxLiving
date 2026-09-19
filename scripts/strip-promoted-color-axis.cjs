/**
 * Drop the appearance axis from `shopifyOptions` once it lives in colorOptions.
 *
 * `axes-to-color-options.cjs` copies a finish axis into `colorOptions` but
 * leaves `shopifyOptions` alone, so the PDP offers the same choice twice — a
 * row of swatches and a picker control beside it. This removes the promoted
 * axis so the swatches are the only place that choice is made.
 *
 * `variants` are NOT touched. The rows keep their option values and their
 * Shopify ids, which is what checkout resolves against; `ProductSection`
 * works out which option position the colour sits at by matching the swatch
 * names against the variant rows, so the axis entry is not needed to pick the
 * right variant.
 *
 * Only an axis whose values are exactly the promoted colours is removed, and
 * only on products of the named brand that already carry those colours. Any
 * other axis on the product — Size, Orientation — is left in place.
 *
 *   BRAND=toasty [APPLY=1] node scripts/strip-promoted-color-axis.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const dns = require("dns");
const { MongoClient } = require("mongodb");

const SRV = (process.env.MONGODB_DNS_SERVERS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (SRV.length) dns.setServers(SRV);

const APPLY = process.env.APPLY === "1";
const SLUG = process.env.BRAND || "";
if (!SLUG) throw new Error("set BRAND=<slug>");

const norm = (s) => String(s || "").trim().toLowerCase();

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await c.connect();
  const db = c.db("test");
  const brand = await db.collection("brands").findOne({ slug: SLUG });
  if (!brand) throw new Error("brand not found: " + SLUG);
  const col = db.collection("products");

  // Scoped to this brand's promoted products and nothing else.
  const docs = await col
    .find({ brand: brand._id, "colorOptions.0": { $exists: true }, "shopifyOptions.0": { $exists: true } })
    .project({ name: 1, shopifyOptions: 1, colorOptions: 1 })
    .toArray();
  if (!docs.length) throw new Error("no promoted products for " + SLUG + " — aborting");

  let stripped = 0, emptied = 0, kept = 0, noMatch = 0;
  const ops = [];

  for (const d of docs) {
    const colours = new Set((d.colorOptions || []).map((x) => norm(x.name)));
    const before = d.shopifyOptions || [];
    // The axis to drop is the one whose values ARE the swatches.
    const after = before.filter((o) => {
      const vals = (o.values || []).map(norm).filter(Boolean);
      const isTheColourAxis =
        vals.length > 0 && vals.length === colours.size && vals.every((v) => colours.has(v));
      return !isTheColourAxis;
    });
    if (after.length === before.length) { noMatch += 1; continue; }
    stripped += 1;
    if (!after.length) emptied += 1; else kept += 1;
    ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { shopifyOptions: after } } } });
  }

  console.log(`${APPLY ? "APPLY" : "DRY"} · ${SLUG} · ${docs.length} promoted products`);
  console.log(`  axis removed            : ${stripped}`);
  console.log(`    leaving no axes at all: ${emptied}  (picker disappears)`);
  console.log(`    leaving other axes    : ${kept}  (e.g. Size stays)`);
  console.log(`  no matching axis found  : ${noMatch}`);

  if (APPLY && ops.length) {
    let mod = 0;
    for (let i = 0; i < ops.length; i += 200) {
      mod += (await col.bulkWrite(ops.slice(i, i + 200), { ordered: false })).modifiedCount;
    }
    console.log(`  written                 : ${mod}`);
  } else if (!APPLY) console.log("  dry run — nothing written");
  await c.close();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
