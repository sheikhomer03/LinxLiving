/**
 * Pair a variant's images against the gallery the product already has.
 *
 * The mirror uploads anything Shopify is missing and then reads the pairing
 * back. But where a variant's photograph is ALREADY in the product's gallery
 * — the common case for a finish whose lead image is also the product's —
 * there is nothing to upload, so the mirror stamped the product done and
 * moved on without ever writing `variants[].shopifyImages`. The storefront
 * renders only mirrored URLs, so those variants fell back to the main
 * gallery instead of showing their own picture.
 *
 * No Shopify calls: the pairing is a local join on the supplier's content
 * hash, which survives into the Shopify CDN filename.
 *
 * Env:
 *   BRAND=slug  brand to pair (default "drench")
 *   DRY_RUN=1   report only
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BRAND_SLUG = process.env.BRAND || "drench";
const DRY_RUN = process.env.DRY_RUN === "1";

/** The supplier's 40-character content hash, wherever it appears in a URL. */
const hashOf = (u) => {
  const m = String(u || "").match(/([0-9a-f]{40})/i);
  return m ? m[1].toLowerCase() : "";
};

async function main() {
  const conn = await connectMongo();
  const brand = await conn.db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("brand not found: " + BRAND_SLUG);
  const sec =
    brand.dataCluster === "secondary"
      ? await mongoose
          .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 })
          .asPromise()
      : null;
  const P = (sec ? sec.db : conn.db).collection("products");

  /* Only products that still have a variant image with no mirrored pair. */
  const ids = (
    await P.aggregate(
      [
        { $match: { brand: brand._id, "variants.0": { $exists: true } } },
        {
          $project: {
            gap: {
              $size: {
                $filter: {
                  input: "$variants",
                  as: "v",
                  cond: {
                    $and: [
                      { $gt: [{ $size: { $ifNull: ["$$v.images", []] } }, 0] },
                      { $eq: [{ $size: { $ifNull: ["$$v.shopifyImages", []] } }, 0] },
                    ],
                  },
                },
              },
            },
          },
        },
        { $match: { gap: { $gt: 0 } } },
      ],
      { allowDiskUse: true },
    ).toArray()
  ).map((d) => d._id);

  console.log("brand   : " + brand.name);
  console.log("products with an unpaired variant image : " + ids.length + (DRY_RUN ? "   (DRY RUN)" : ""));
  console.log("");

  let paired = 0, pairsWritten = 0, stillShort = 0;
  const ops = [];
  for (let i = 0; i < ids.length; i += 200) {
    const docs = await P.find({ _id: { $in: ids.slice(i, i + 200) } })
      .project({ name: 1, shopifyImages: 1, variants: 1 })
      .toArray();
    for (const doc of docs) {
      const byHash = new Map();
      for (const p of doc.shopifyImages || []) {
        const h = hashOf(p.sourceUrl) || hashOf(p.shopifyUrl);
        if (h && !byHash.has(h)) byHash.set(h, p);
      }
      const set = {};
      let short = false;
      (doc.variants || []).forEach((v, idx) => {
        if ((v.shopifyImages || []).length) return;
        const imgs = [];
        (v.images || []).forEach((u, n) => {
          const hit = byHash.get(hashOf(u));
          if (!hit) return;
          imgs.push({
            sourceUrl: u,
            shopifyUrl: hit.shopifyUrl,
            mediaId: hit.mediaId || "",
            position: n,
          });
        });
        if (imgs.length) {
          set["variants." + idx + ".shopifyImages"] = imgs;
          pairsWritten += imgs.length;
        } else if ((v.images || []).length) {
          short = true;
        }
      });
      if (Object.keys(set).length) {
        paired += 1;
        ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
      }
      if (short) stillShort += 1;
    }
  }

  if (!DRY_RUN && ops.length) {
    for (let i = 0; i < ops.length; i += 500) {
      await P.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
  }

  console.log("products paired from the gallery : " + paired);
  console.log("variant images paired            : " + pairsWritten);
  console.log("products still short             : " + stillShort + "   (image genuinely not in Shopify)");
  if (DRY_RUN) console.log("\ndry run : nothing written");

  await mongoose.disconnect();
  if (sec) await sec.close();
  process.exit(0);
}

main().catch((e) => { console.error("FAILED: " + e.message); process.exit(1); });
