/**
 * Record the Shopify CDN copy of every menu cover image.
 *
 * The department and category tiles on the homepage and the mega-menu draw
 * `menu.image`, which is a Cloudinary URL. Shopify already holds the same file:
 * each menu syncs as a collection and the cover goes with it. So there is
 * nothing to upload — only the resulting URL to read back and store, which is
 * what lets the site serve those tiles from Shopify like everything else.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/mirror-menu-covers-from-shopify.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/mirror-menu-covers-from-shopify.cjs --apply
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.argv.includes("--apply");

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  for (const name of ["menus", "brands"]) {
    const col = db.collection(name);
    const rows = await col
      .find({
        image: { $nin: [null, ""] },
        shopifyCollectionId: { $nin: [null, ""] },
      })
      .project({ name: 1, image: 1, shopifyCollectionId: 1, shopifyImageUrl: 1 })
      .toArray();

    console.log(`\n${name}: ${rows.length} with a cover and a Shopify collection`);
    let found = 0;
    let missing = 0;
    const ops = [];

    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      const d = await shopifyAdminRequest(
        `query($ids: [ID!]!) {
          nodes(ids: $ids) { id ... on Collection { image { url } } }
        }`,
        { ids: chunk.map((c) => c.shopifyCollectionId) },
      );
      const byId = new Map(
        (d.nodes || []).filter(Boolean).map((n) => [n.id, n.image?.url || ""]),
      );

      for (const row of chunk) {
        const url = byId.get(row.shopifyCollectionId) || "";
        if (!url) {
          missing += 1;
          continue;
        }
        found += 1;
        if (row.shopifyImageUrl === url) continue;
        ops.push({
          updateOne: {
            filter: { _id: row._id },
            update: { $set: { shopifyImageUrl: url } },
          },
        });
      }
      process.stdout.write(`\r  read ${Math.min(i + 50, rows.length)}/${rows.length}   `);
    }
    console.log("");
    console.log(`  Shopify holds a cover for ${found}, missing on ${missing}`);
    console.log(`  rows to update: ${ops.length}`);

    if (APPLY && ops.length) {
      await col.bulkWrite(ops, { ordered: false });
      console.log(`  written`);
    }
  }

  if (!APPLY) console.log("\nDRY RUN — add --apply to write shopifyImageUrl");

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
