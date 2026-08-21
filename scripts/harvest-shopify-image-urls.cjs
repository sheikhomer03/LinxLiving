/**
 * Fill in the Shopify CDN URLs the push could not know yet.
 *
 * Shopify processes an upload asynchronously: `productCreate` returns the
 * MediaImage id straight away but `image.url` is null until the file has been
 * fetched and resized, which is seconds to minutes later. The push therefore
 * records the id and leaves the URL blank, and this pass reads the URLs back.
 *
 * Splitting it out is what keeps it cheap. One `nodes` query covers fifty
 * products at once, so the whole catalogue is a few hundred requests rather
 * than a poll per product — and because it matches on media id, it can be run
 * again at any time to pick up whatever was still processing last time.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/harvest-shopify-image-urls.cjs
 *
 *   BATCH=50   product ids per query
 *   LOOP=3     repeat the sweep N times, for media still processing
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const BATCH = Math.max(1, Math.min(Number(process.env.BATCH) || 50, 100));
const LOOP = Math.max(1, Number(process.env.LOOP) || 1);

process.env.SHOPIFY_MAX_CONCURRENCY = process.env.SHOPIFY_MAX_CONCURRENCY || "3";
process.env.SHOPIFY_MIN_GAP_MS = process.env.SHOPIFY_MIN_GAP_MS || "0";

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();

  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { Product } = require("../src/models/Product.ts");
  const { harvestMediaUrls } = require("../src/lib/shopify/sync-media.ts");

  await connectMongo(process.env.MONGODB_URI);

  for (let pass = 1; pass <= LOOP; pass++) {
    // A product needs harvesting when any gallery entry, or any variant image,
    // has a media id but no URL to go with it.
    const filter = {
      shopifyProductId: { $nin: [null, ""] },
      $or: [
        { shopifyImages: { $elemMatch: { mediaId: { $ne: "" }, shopifyUrl: "" } } },
        {
          variants: {
            $elemMatch: { shopifyMediaId: { $ne: "" }, shopifyImageUrl: "" },
          },
        },
      ],
    };

    const total = await Product.countDocuments(filter);
    console.log(`pass ${pass}/${LOOP}: ${total} product(s) with URLs outstanding`);
    if (!total) break;

    const cursor = Product.find(filter)
      .select("shopifyProductId shopifyImages variants.shopifyMediaId variants.shopifyImageUrl")
      .sort({ _id: 1 })
      .cursor();

    let batch = [];
    let filled = 0;
    let seen = 0;

    async function drain() {
      if (!batch.length) return;
      const rows = batch;
      batch = [];

      const widest = rows.reduce(
        (max, r) => Math.max(max, (r.shopifyImages || []).length),
        0,
      );
      const byProduct = await harvestMediaUrls(
        rows.map((r) => r.shopifyProductId),
        widest,
      );
      const ops = [];

      for (const row of rows) {
        const urls = byProduct.get(row.shopifyProductId);
        if (!urls?.size) continue;

        const set = {};
        (row.shopifyImages || []).forEach((image, i) => {
          const url = urls.get(image.mediaId);
          if (url && url !== image.shopifyUrl) {
            set[`shopifyImages.${i}.shopifyUrl`] = url;
            filled += 1;
          }
        });
        (row.variants || []).forEach((variant, i) => {
          const url = urls.get(variant.shopifyMediaId);
          if (url && url !== variant.shopifyImageUrl) {
            set[`variants.${i}.shopifyImageUrl`] = url;
            filled += 1;
          }
        });

        if (Object.keys(set).length) {
          ops.push({
            updateOne: {
              filter: { _id: row._id },
              update: { $set: set },
              timestamps: false,
            },
          });
        }
      }

      if (ops.length) await Product.bulkWrite(ops, { ordered: false });
      seen += rows.length;
      process.stdout.write(`\r  ${seen}/${total} products · ${filled} URLs recorded`);
    }

    for await (const product of cursor) {
      batch.push(product);
      if (batch.length >= BATCH) await drain();
    }
    await drain();
    await cursor.close();
    console.log("");
  }

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
