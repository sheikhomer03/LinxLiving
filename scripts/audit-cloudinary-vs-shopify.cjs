/**
 * Where does Cloudinary content live, and does Shopify have a copy?
 *
 * The catalogue sync mirrored product galleries and variant images. It did not
 * touch anything else that happens to be hosted on Cloudinary — brand covers,
 * menu tiles, option swatches, schematics — and it deliberately skipped video,
 * because Shopify rejects an MP4 offered as image media.
 *
 * Which fields those are is discovered rather than assumed: a sample of each
 * collection is walked to find every path holding a Cloudinary URL, and the
 * paths that turn up are then counted exactly with aggregations. Deep-walking
 * all eighteen thousand products in JS took half an hour and produced nothing
 * until it finished, which is no way to answer a question.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-cloudinary-vs-shopify.cjs
 *   DISCOVER=1500  documents per collection to sample for field discovery
 *   VERIFY=120     products to confirm against Shopify (0 skips)
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const DISCOVER = Number(process.env.DISCOVER ?? 1500);
const VERIFY = Number(process.env.VERIFY ?? 120);

const CLOUDINARY = /res\.cloudinary\.com|cloudinary\.com/i;
const VIDEO = /\/video\/upload\/|\.(mp4|webm|mov|m4v|avi)(\?|$)/i;
const EXTERNAL_VIDEO = /^youtube:|^vimeo:|youtube\.com|youtu\.be|vimeo\.com/i;

const say = (s = "") => process.stdout.write(`${s}\n`);

/** Every string in a document, with the path holding it (array index → []). */
function walk(node, out, trail = "") {
  if (node == null) return out;
  if (typeof node === "string") {
    if (node.trim()) out.push({ path: trail || "(root)", value: node.trim() });
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out, `${trail}[]`);
    return out;
  }
  if (typeof node === "object" && !node._bsontype) {
    for (const [k, v] of Object.entries(node)) walk(v, out, trail ? `${trail}.${k}` : k);
  }
  return out;
}

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const NAMES = ["products", "brands", "menus", "collections", "departments", "suppliers"];

  say("=== WHERE CLOUDINARY CONTENT LIVES (sampled discovery) ===");
  const foundPaths = new Map(); // "collection.path" -> {kind, seen}

  for (const name of NAMES) {
    if (!(await db.listCollections({ name }).hasNext())) continue;
    const total = await db.collection(name).estimatedDocumentCount();
    const docs = await db
      .collection(name)
      .aggregate([{ $sample: { size: Math.min(DISCOVER, total || 1) } }], { allowDiskUse: true })
      .toArray();

    let hits = 0;
    for (const doc of docs) {
      for (const { path: p, value } of walk(doc, [])) {
        let kind = null;
        if (CLOUDINARY.test(value)) kind = VIDEO.test(value) ? "cloudinary-video" : "cloudinary-image";
        else if (EXTERNAL_VIDEO.test(value)) kind = "external-video";
        if (!kind) continue;
        hits += 1;
        const key = `${name}|${p}|${kind}`;
        foundPaths.set(key, (foundPaths.get(key) || 0) + 1);
      }
    }
    say(`  ${name.padEnd(13)} sampled ${String(docs.length).padStart(5)} of ${String(total).padStart(6)} · ${hits} asset strings`);
  }

  // Exact counts for every discovered path.
  say("\n=== EXACT COUNTS PER FIELD ===");
  const rows = [];
  for (const key of foundPaths.keys()) {
    const [name, p, kind] = key.split("|");
    const field = p.replace(/\[\]/g, "");            // Mongo dot-path ignores indexes
    const rx = kind === "external-video" ? EXTERNAL_VIDEO.source : "cloudinary";
    const match = { [field]: { $regex: rx, $options: "i" } };
    if (kind === "cloudinary-image") match[field].$not = VIDEO;
    if (kind === "cloudinary-video") match[field] = { $regex: "/video/upload/|\\.mp4|\\.webm|\\.mov", $options: "i" };
    let docs = 0;
    try {
      docs = await db.collection(name).countDocuments(match);
    } catch {
      docs = -1;
    }
    rows.push({ name, field, kind, docs });
  }
  rows.sort((a, b) => b.docs - a.docs);
  for (const r of rows) {
    say(`  ${String(r.docs).padStart(6)} docs  ${r.kind.padEnd(17)} ${r.name}.${r.field}`);
  }

  // -------------------------------------------------- product-side coverage
  say("\n=== PRODUCT GALLERY + VARIANT COVERAGE (exact, whole catalogue) ===");
  const products = db.collection("products");

  const [cov] = await products
    .aggregate(
      [
        {
          $project: {
            gallery: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$images", []] },
                  cond: {
                    $and: [
                      { $regexMatch: { input: "$$this", regex: /^https?:\/\//i } },
                      { $not: { $regexMatch: { input: "$$this", regex: VIDEO } } },
                    ],
                  },
                },
              },
            },
            paired: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$shopifyImages", []] },
                  cond: { $ne: ["$$this.mediaId", ""] },
                },
              },
            },
            galleryVideos: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$images", []] },
                  cond: { $regexMatch: { input: "$$this", regex: VIDEO } },
                },
              },
            },
            variantImgs: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$variants", []] },
                  cond: {
                    $regexMatch: {
                      input: { $ifNull: ["$$this.imageUrl", ""] },
                      regex: /^https?:\/\//i,
                    },
                  },
                },
              },
            },
            variantPaired: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$variants", []] },
                  cond: { $ne: [{ $ifNull: ["$$this.shopifyMediaId", ""] }, ""] },
                },
              },
            },
            externalRefs: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$images", []] },
                  cond: { $regexMatch: { input: "$$this", regex: EXTERNAL_VIDEO } },
                },
              },
            },
            videoHosted: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$shopifyVideos", []] },
                  cond: { $eq: ["$$this.kind", "video"] },
                },
              },
            },
            videoExternal: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$shopifyVideos", []] },
                  cond: { $eq: ["$$this.kind", "external"] },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            gallery: { $sum: "$gallery" },
            paired: { $sum: "$paired" },
            galleryVideos: { $sum: "$galleryVideos" },
            variantImgs: { $sum: "$variantImgs" },
            variantPaired: { $sum: "$variantPaired" },
            productsShort: { $sum: { $cond: [{ $gt: ["$gallery", "$paired"] }, 1, 0] } },
            externalRefs: { $sum: "$externalRefs" },
            videoHosted: { $sum: "$videoHosted" },
            videoExternal: { $sum: "$videoExternal" },
          },
        },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(2)}%` : "n/a");
  say(`  gallery stills      ${cov.paired}/${cov.gallery} mirrored (${pct(cov.paired, cov.gallery)})`);
  say(`  products short      ${cov.productsShort}`);
  say(`  variant images      ${cov.variantPaired}/${cov.variantImgs} mirrored (${pct(cov.variantPaired, cov.variantImgs)})`);
  say(`  hosted video files   ${cov.videoHosted}/${cov.galleryVideos} mirrored (${pct(cov.videoHosted, cov.galleryVideos)})`);
  say(`  external video refs  ${cov.videoExternal} attached, from ${cov.externalRefs} references in images[]`);

  // ------------------------------------------------------ brands and menus
  say("\n=== BRAND + MENU COVERS ===");
  for (const name of ["brands", "menus", "collections"]) {
    if (!(await db.listCollections({ name }).hasNext())) continue;
    const withImg = await db.collection(name).countDocuments({ image: { $regex: "cloudinary", $options: "i" } });
    const linked = await db.collection(name).countDocuments({
      image: { $regex: "cloudinary", $options: "i" },
      shopifyCollectionId: { $nin: [null, ""] },
    });
    say(`  ${name.padEnd(12)} ${withImg} Cloudinary covers · ${linked} on a Shopify collection`);
  }

  // ------------------------------------------------------- shopify sampling
  if (VERIFY > 0) {
    say(`\n=== SHOPIFY SPOT CHECK (${VERIFY} products) ===`);
    const sample = await products
      .aggregate([
        { $match: { "shopifyImages.0": { $exists: true }, shopifyProductId: { $nin: [null, ""] } } },
        { $sample: { size: VERIFY } },
        { $project: { shopifyProductId: 1, shopifyImages: 1 } },
      ])
      .toArray();

    let expected = 0, present = 0, short = 0;
    for (let i = 0; i < sample.length; i += 25) {
      const chunk = sample.slice(i, i + 25);
      const d = await shopifyAdminRequest(
        `query($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Product { id media(first: 250) { nodes { id status } } } }
        }`,
        { ids: chunk.map((c) => c.shopifyProductId) },
      );
      const live = new Map(
        (d.nodes || []).filter(Boolean).map((n) => [n.id, new Set((n.media?.nodes || []).map((m) => m.id))]),
      );
      for (const p of chunk) {
        const ids = (p.shopifyImages || []).filter((x) => x.mediaId).map((x) => x.mediaId);
        const have = live.get(p.shopifyProductId);
        if (!have) continue;
        const hit = ids.filter((id) => have.has(id)).length;
        expected += ids.length;
        present += hit;
        if (hit < ids.length) short += 1;
      }
      say(`   checked ${Math.min(i + 25, sample.length)}/${sample.length}`);
    }
    say(`  recorded media still present on Shopify: ${present}/${expected} (${pct(present, expected)})`);
    say(`  products missing at least one         : ${short}/${sample.length}`);
  }

  // ---------------------------------------------------------------- video
  say("\n=== VIDEO ON SHOPIFY ===");
  try {
    const f = await shopifyAdminRequest(
      `query { files(first: 5, query: "media_type:VIDEO") { nodes { __typename ... on Video { id } } } }`,
    );
    say(`  video files on the shop: ${f.files.nodes.length ? `${f.files.nodes.length}+ found` : "none"}`);
  } catch (e) {
    say(`  could not query files: ${String(e.message).slice(0, 80)}`);
  }

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
