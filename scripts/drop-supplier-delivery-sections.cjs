/**
 * Remove the suppliers' own "Delivery & Returns" panels from productSections.
 *
 * The storefront never shows them. `OWN_PANEL_HEADINGS` in
 * src/lib/productSections.ts drops any heading matching this same pattern —
 * "a supplier's delivery and returns terms are theirs, not ours" — and the
 * PDP renders a panel generated from our own shipping rules instead. So this
 * content is stored, indexed and paid for, and never rendered.
 *
 * On Tap Warehouse it is the single largest thing in the database: ~15 KB of
 * the supplier's markup per product, ~70 MB across the brand, which is what
 * pushed the secondary cluster towards its 512 MB ceiling mid-import.
 *
 * Nothing else in `productSections` is touched — only entries whose heading
 * matches, using the storefront's own regex so the two can never disagree.
 *
 * The removal runs as an aggregation-pipeline update, so the documents never
 * leave the server; streaming 70 MB of markup here to rewrite it was far too
 * slow to finish. Rollback is the capture itself: `<site>-pdp.jsonl` still
 * holds every section as scraped, and re-running the importer restores them.
 *
 * Env:
 *   APPLY=1      delete (default is a dry run)
 *   BRAND=slug   one brand only (default: every brand on the cluster)
 */
const path = require("path");
const fs = require("fs");
for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p, quiet: true });
}
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");
const { BSON } = require("mongodb");

const APPLY = process.env.APPLY === "1";
const BRAND = process.env.BRAND || "";
const OUT_DIR =
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/a167de67-d47a-4f6e-aa8a-c11dee9e30bc/scratchpad";

/** The storefront's own test, copied verbatim from productSections.ts. */
const DELIVERY = /^delivery(\s*(&|and)\s*returns?)?$/i;

const mb = (n) => (n / 1048576).toFixed(1);
const size = (v) => { try { return BSON.calculateObjectSize({ v }); } catch { return 0; } };

(async () => {
  const { db: pri } = await connectMongo();
  const q = { dataCluster: "secondary" };
  if (BRAND) q.slug = BRAND;
  const brands = await pri.collection("brands").find(q).toArray();
  if (!brands.length) throw new Error("no matching brands");

  const sec = await mongoose
    .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 })
    .asPromise();
  const P = sec.db.collection("products");

  console.log("brands : " + brands.map((b) => b.name).join(", "));
  console.log("mode   : " + (APPLY ? "APPLY" : "DRY RUN"));
  console.log("");

  let totalFreed = 0, totalProducts = 0;
  for (const b of brands) {
    /* Measure server-side: $bsonSize of just the sections being removed. */
    const [before] = await P.aggregate(
      [
        { $match: { brand: b._id, "productSections.0": { $exists: true } } },
        {
          $project: {
            doomed: {
              $filter: {
                input: "$productSections",
                as: "s",
                cond: {
                  $regexMatch: {
                    input: { $trim: { input: { $ifNull: ["$$s.heading", ""] } } },
                    regex: "^delivery( *(&|and) *returns?)?$",
                    options: "i",
                  },
                },
              },
            },
            total: { $size: "$productSections" },
          },
        },
        { $match: { "doomed.0": { $exists: true } } },
        {
          $group: {
            _id: null,
            products: { $sum: 1 },
            sections: { $sum: { $size: "$doomed" } },
            // $bsonSize wants a document, so wrap the array in one.
            bytes: { $sum: { $bsonSize: { v: "$doomed" } } },
            others: { $sum: { $subtract: ["$total", { $size: "$doomed" }] } },
          },
        },
      ],
      { allowDiskUse: true },
    ).toArray();

    const m = before || { products: 0, sections: 0, bytes: 0, others: 0 };
    totalFreed += m.bytes;
    totalProducts += m.products;
    console.log(
      b.name.padEnd(16) + m.products + " products   " + m.sections + " sections   " +
      mb(m.bytes) + " MB   (" + m.others + " other sections untouched)",
    );

    if (APPLY && m.products) {
      const res = await P.updateMany(
        { brand: b._id, "productSections.0": { $exists: true } },
        [
          {
            $set: {
              productSections: {
                $filter: {
                  input: "$productSections",
                  as: "s",
                  cond: {
                    $not: [
                      {
                        $regexMatch: {
                          input: { $trim: { input: { $ifNull: ["$$s.heading", ""] } } },
                          regex: "^delivery( *(&|and) *returns?)?$",
                          options: "i",
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      );
      console.log("                 modified " + res.modifiedCount);
    }
  }

  console.log("");
  console.log("products changed : " + totalProducts);
  console.log("space freed      : " + mb(totalFreed) + " MB");
  if (APPLY) {
    console.log("rollback         : re-run the importer from <site>-pdp.jsonl");
    const st = await sec.db.command({ dbStats: 1 });
    console.log("cluster now      : " + mb(st.dataSize + st.indexSize) + " MB of 512");
    console.log("  (WiredTiger reuses freed space for new writes; the figure");
    console.log("   falls as the import refills it rather than immediately.)");
  } else {
    console.log("dry run : nothing deleted");
  }

  await mongoose.disconnect();
  await sec.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED: " + e.message); process.exit(1); });
