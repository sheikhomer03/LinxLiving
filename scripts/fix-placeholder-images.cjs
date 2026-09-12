/**
 * Drop the supplier's "Awaiting Image" card from the products carrying it.
 *
 * mbdecor publishes https://mbdecor.co.uk/wp-content/uploads/Awaiting-Image.jpg
 * against products it has no photograph for, and the scrape copied that file
 * per product — same bytes, six different Cloudinary names. Downstream nothing
 * can tell it from real artwork, so the Extruda fencing parts each list a grey
 * "AWAITING IMAGE" card where a photo should be, and list the same one.
 *
 * The fix is to make the data say what is true: these products have no
 * photograph. Emptying the gallery hands them to the rule that already governs
 * this — `SHOW_ONLY_PRODUCTS_WITH_IMAGES` in src/lib/pricedOnly.ts — which
 * keeps a product without artwork out of the listings, search, mega menus and
 * facet counts, exactly as it does for RAK's several hundred unphotographed
 * codes. Nothing is deleted: the rows stay in the database and stay editable in
 * the admin area, and giving one a real image puts it back on the storefront by
 * itself.
 *
 * An image is removed on its bytes, not its URL — the URL is named after the
 * product and gives nothing away. Each stored image is fetched and hashed at
 * apply time, so a gallery that has since gained a genuine photo keeps it.
 *
 * Unlike fix-likewise-images.cjs this is allowed to empty a gallery: a gallery
 * holding nothing but the placeholder is the case it exists to clear.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-placeholder-images.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-placeholder-images.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-placeholder-images.cjs --rollback <file.json>
 *
 *   --shopify        also delete the mirrored placeholder from the Shopify
 *                    gallery. Off by default: reconcileProductMedia returns
 *                    early rather than strip a node back to nothing, so the
 *                    copy on Shopify outlives the Mongo one and has to be
 *                    asked for.
 *   BRAND=mb-decor   which audit report to read
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const crypto = require("crypto");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const SHOPIFY = process.argv.includes("--shopify");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;
const BRAND = process.env.BRAND || "mb-decor";
const REPORT = path.join(__dirname, `placeholder-image-audit-${BRAND}.json`);

const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

/** Hash a stored image; null when it cannot be read — unreadable is not a match. */
async function hashOf(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return md5(Buffer.from(await r.arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * Delete the mirrored placeholder from Shopify.
 *
 * Loaded through tsx only when asked for, so a Mongo-only run needs neither the
 * TypeScript loader nor Shopify credentials.
 */
async function deleteShopifyMedia(rows) {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  try {
    const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
    let deleted = 0;
    for (const row of rows) {
      if (!row.shopifyProductId || !row.mediaIds.length) continue;
      const data = await shopifyAdminRequest(
        `
        mutation DeleteProductMedia($productId: ID!, $mediaIds: [ID!]!) {
          productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
            userErrors { field message }
          }
        }
      `,
        { productId: row.shopifyProductId, mediaIds: row.mediaIds },
      );
      const errs = data.productDeleteMedia?.userErrors || [];
      if (errs.length) {
        console.log(`   ! ${row.name}: ${errs.map((e) => e.message).join("; ")}`);
        continue;
      }
      deleted += row.mediaIds.length;
      console.log(`   deleted ${row.mediaIds.length} media from ${row.name}`);
    }
    return deleted;
  } finally {
    unregister();
  }
}

(async () => {
  await connectMongo();
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    let n = 0;
    for (const p of data.products || []) {
      await productsCol.updateOne(
        { _id: new mongoose.Types.ObjectId(p._id) },
        { $set: { images: p.images, shopifyImages: p.shopifyImages } },
      );
      n += 1;
    }
    console.log(`rolled back ${n} products`);
    await mongoose.disconnect();
    return;
  }

  if (!fs.existsSync(REPORT)) {
    throw new Error(
      `no audit report at ${REPORT} — run audit-placeholder-images.cjs first`,
    );
  }
  const { placeholderMd5, affected } = JSON.parse(fs.readFileSync(REPORT, "utf8"));
  if (!placeholderMd5) throw new Error("report carries no placeholderMd5");
  console.log(`placeholder md5 ${placeholderMd5}`);
  console.log(`${affected.length} product(s) in the ${BRAND} report\n`);

  const ids = affected.map((a) => new mongoose.Types.ObjectId(a.id));
  const docs = await productsCol
    .find({ _id: { $in: ids } })
    .project({ name: 1, images: 1, shopifyImages: 1, shopifyProductId: 1, variants: 1 })
    .toArray();

  const updates = [];
  const unchanged = [];

  for (const doc of docs) {
    const keep = [];
    const drop = [];
    for (const url of doc.images || []) {
      ((await hashOf(url)) === placeholderMd5 ? drop : keep).push(url);
    }
    if (!drop.length) {
      unchanged.push(doc);
      continue;
    }

    const dropped = new Set(drop);
    const links = doc.shopifyImages || [];

    updates.push({
      doc,
      keep,
      drop,
      links: links.filter((l) => !dropped.has(l?.sourceUrl)),
      mediaIds: links
        .filter((l) => dropped.has(l?.sourceUrl))
        .map((l) => l?.mediaId)
        .filter(Boolean),
      // Variant artwork is a separate field, and would go on rendering the card
      // on the PDP's swatch row even with the gallery emptied.
      variants: (doc.variants || []).filter((v) => dropped.has(v?.imageUrl)),
    });
  }

  console.log(`to clear      : ${updates.length}`);
  console.log(`already clean : ${unchanged.length}`);
  console.log(
    `left with no image (hidden from listings): ${updates.filter((u) => !u.keep.length).length}\n`,
  );

  for (const u of updates) {
    console.log(
      `   ${u.doc.name.slice(0, 52).padEnd(54)} ${(u.doc.images || []).length} -> ${u.keep.length} image(s)` +
        `${u.mediaIds.length ? `, ${u.mediaIds.length} shopify media` : ""}` +
        `${u.variants.length ? `, ${u.variants.length} variant image(s)` : ""}`,
    );
  }
  for (const d of unchanged) console.log(`   [clean] ${d.name.slice(0, 60)}`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const rollback = {
    brand: BRAND,
    placeholderMd5,
    products: updates.map((u) => ({
      _id: String(u.doc._id),
      name: u.doc.name,
      images: u.doc.images || [],
      shopifyImages: u.doc.shopifyImages || [],
    })),
  };

  const now = new Date();
  const ops = updates.map((u) => ({
    updateOne: {
      filter: { _id: u.doc._id },
      update: { $set: { images: u.keep, shopifyImages: u.links, updatedAt: now } },
    },
  }));
  for (let i = 0; i < ops.length; i += 200) {
    await productsCol.bulkWrite(ops.slice(i, i + 200), { ordered: false });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-placeholder-images-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(rollback, null, 2)}\n`);
  console.log(
    `\napplied: ${updates.length} products, ` +
      `${updates.reduce((a, u) => a + u.drop.length, 0)} placeholder image(s) removed`,
  );
  console.log(`rollback: ${file}`);

  if (SHOPIFY) {
    console.log("\ndeleting the mirrored placeholder from Shopify…");
    const n = await deleteShopifyMedia(
      updates.map((u) => ({
        name: u.doc.name,
        shopifyProductId: u.doc.shopifyProductId,
        mediaIds: u.mediaIds,
      })),
    );
    console.log(`deleted ${n} Shopify media node(s)`);
  } else if (updates.some((u) => u.mediaIds.length)) {
    console.log("\nthe copy on Shopify is untouched — re-run with --shopify to delete it.");
  }

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {
    /* already down */
  }
  process.exit(1);
});
