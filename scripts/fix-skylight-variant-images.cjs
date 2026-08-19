/**
 * Put the window back on the skylight checkout line.
 *
 * Cambridge Skylights sell one product per size and let the customer state the
 * roof pitch and tick upgrades. Those pickers each carry a picture — a
 * black-and-white pictogram of a roof for the pitch, a bottle of coating for
 * the upgrade — and when the pitch x upgrade combinations were materialised as
 * Shopify variants, the picker's picture came with them as the variant image.
 *
 * Shopify draws a checkout line's thumbnail from the variant, so a customer
 * buying a £143 roof window is shown a line-art icon, or a bottle. On the
 * white checkout background the icon reads as no image at all, which is what
 * it was reported as.
 *
 * The pitch is not a visual variant of the window — every combination is the
 * same window — so each variant is pointed at the product's own lead
 * photograph, which Shopify already holds.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-skylight-variant-images.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-skylight-variant-images.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-skylight-variant-images.cjs --rollback <file.json>
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

const BRAND_SLUG = "cambridge-skylights";

const PRODUCT_MEDIA = `
  query SkylightMedia($ids: [ID!]!) {
    nodes(ids: $ids) {
      id
      ... on Product {
        title
        featuredMedia { ... on MediaImage { id image { url } } }
        variants(first: 100) {
          nodes { id title media(first: 1) { nodes { ... on MediaImage { id } } } }
        }
      }
    }
  }
`;

const ATTACH = `
  mutation AttachVariantMedia($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    for (const p of data.products || []) {
      const pairs = p.variants.filter((v) => v.mediaId);
      if (pairs.length) {
        await shopifyAdminRequest(ATTACH, {
          productId: p.shopifyProductId,
          variants: pairs.map((v) => ({ id: v.shopifyVariantId, mediaId: v.mediaId })),
        });
      }
      await db
        .collection("products")
        .updateOne(
          { _id: new mongoose.Types.ObjectId(p._id) },
          { $set: { variants: p.mongoVariants } },
        );
    }
    console.log(`restored ${data.products.length} product(s)`);
    await mongoose.disconnect();
    unregister();
    return;
  }

  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error(`brand ${BRAND_SLUG} not found`);

  const products = await db
    .collection("products")
    .find({
      brand: brand._id,
      shopifyProductId: { $nin: [null, ""] },
      $expr: { $gt: [{ $size: { $ifNull: ["$variants", []] } }, 1] },
    })
    .project({ name: 1, shopifyProductId: 1, variants: 1 })
    .toArray();

  console.log(`${BRAND_SLUG}: ${products.length} multi-variant product(s)\n`);

  const rollback = [];
  let repointed = 0;
  let alreadyRight = 0;
  let noFeatured = 0;

  for (let i = 0; i < products.length; i += 20) {
    const chunk = products.slice(i, i + 20);
    const data = await shopifyAdminRequest(PRODUCT_MEDIA, {
      ids: chunk.map((p) => p.shopifyProductId),
    });
    const byId = new Map(
      (data.nodes || []).filter(Boolean).map((n) => [n.id, n]),
    );

    for (const product of chunk) {
      const node = byId.get(product.shopifyProductId);
      const featuredId = node?.featuredMedia?.id;
      const featuredUrl = node?.featuredMedia?.image?.url;
      if (!featuredId || !featuredUrl) {
        noFeatured += 1;
        console.log(`  SKIP ${product.name} — no featured image on Shopify`);
        continue;
      }

      // Only the variants still carrying a picker's picture need moving.
      const wrong = (node.variants?.nodes || []).filter(
        (v) => v.media?.nodes?.[0]?.id !== featuredId,
      );
      if (!wrong.length) {
        alreadyRight += 1;
        continue;
      }

      console.log(
        `  ${String(wrong.length).padStart(2)} variant(s)  ${product.name}`,
      );

      rollback.push({
        _id: String(product._id),
        shopifyProductId: product.shopifyProductId,
        variants: wrong.map((v) => ({
          shopifyVariantId: v.id,
          mediaId: v.media?.nodes?.[0]?.id || null,
        })),
        mongoVariants: product.variants,
      });
      repointed += wrong.length;

      if (!APPLY) continue;

      const result = await shopifyAdminRequest(ATTACH, {
        productId: product.shopifyProductId,
        variants: wrong.map((v) => ({ id: v.id, mediaId: featuredId })),
      });
      const errors = result.productVariantsBulkUpdate?.userErrors ?? [];
      if (errors.length) {
        console.log(`     ! ${errors.map((e) => e.message).join("; ")}`);
        continue;
      }

      // Keep Mongo's record of the variant image in step with Shopify. The
      // Cloudinary `imageUrl` is left alone: it records where the picker's
      // picture came from, and nothing displays it now.
      const wrongIds = new Set(wrong.map((v) => v.id));
      const variants = (product.variants || []).map((v) =>
        wrongIds.has(String(v.shopifyVariantId))
          ? { ...v, shopifyImageUrl: featuredUrl, shopifyMediaId: featuredId }
          : v,
      );
      await db
        .collection("products")
        .updateOne({ _id: product._id }, { $set: { variants } });
    }
  }

  console.log(
    `\nvariants repointed at the product photo : ${repointed}` +
      `\nproducts already correct                : ${alreadyRight}` +
      `\nproducts with no featured image         : ${noFeatured}`,
  );

  if (APPLY && rollback.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(process.cwd(), `rollback-skylight-variant-images-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({ products: rollback }, null, 2));
    console.log(`rollback -> ${file}`);
  } else if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write");
  }

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
