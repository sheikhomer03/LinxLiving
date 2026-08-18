/**
 * Mirror the Cloudinary assets that are not product gallery images into
 * Shopify's Files library.
 *
 * The gallery sync covered `images[]` and variant images. It left everything
 * else on Cloudinary: the alternate product shots (`hoverImage`,
 * `lightModeImage`, `darkModeImage`), the images referenced from inside Shopify
 * metafields, and the Pooky configurator's component sets — which alone account
 * for over a hundred thousand array entries.
 *
 * They go to Files rather than product media on purpose. Product media is the
 * customer-facing gallery; putting a hover shot or a lamp-shade component in it
 * would show thousands of fragments in the PDP carousel. Files hosts the bytes
 * without attaching them to anything.
 *
 * Shopify fetches each URL itself — `fileCreate` takes an external source — so
 * the twenty-six gigabytes travel Cloudinary → Shopify and never through this
 * machine. What crosses the wire here is the API call.
 *
 * The mapping lives in its own `assetMirrors` collection, keyed by source URL.
 * A shade image used by four hundred products is one row and one upload, which
 * neither a per-product field nor a re-run would manage.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/mirror-cloudinary-assets-to-shopify.cjs
 *
 *   DRY=1          count the work, upload nothing
 *   LIMIT=500      stop after N assets
 *   BATCH=25       assets per fileCreate call
 *   CONCURRENCY=4  batches in flight
 *   HARVEST=1      skip uploading; only read back URLs for what is already sent
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const DRY = process.env.DRY === "1";
const HARVEST_ONLY = process.env.HARVEST === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const BATCH = Math.max(1, Math.min(Number(process.env.BATCH) || 25, 50));
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 4);

process.env.SHOPIFY_MAX_CONCURRENCY =
  process.env.SHOPIFY_MAX_CONCURRENCY || String(CONCURRENCY * 2);
process.env.SHOPIFY_MIN_GAP_MS = process.env.SHOPIFY_MIN_GAP_MS || "0";

/**
 * Fields carrying Cloudinary assets outside the product gallery. PDFs are not
 * included: those are mirrored to disk by mirror-pdfs-to-local.cjs, because
 * documents are served from the site, not from the shop.
 */
const FIELDS = [
  "lightModeImage",
  "hoverImage",
  "darkModeImage",
  "schematicImage",
  "bases.images",
  "shades.images",
  "wallFittings.images",
  "pendants.images",
  "sizeOptions.imageUrl",
  "colorOptions.imageUrl",
  "typeOptions.imageUrl",
  "suitability.image",
  "usage.image",
  "swatchGroups.swatches.swatchImage",
  "flashingFinder.imageUrl",
  "flashings.imageUrl",
  "finishes.imageUrl",
  "nestedOptions.choices.imageUrl",
  "optionElements.choices.imageUrl",
];

const isPdf = (u) => /\.pdf(\?|$)/i.test(u);

const contentTypeFor = (u) =>
  /\.svg(\?|$)/i.test(u) ? "IMAGE" : "IMAGE";

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { shopifyAdminRequest, shopifyCostStatus } = require("../src/lib/shopify/admin.ts");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const mirrors = db.collection("assetMirrors");
  await mirrors.createIndex({ sourceUrl: 1 }, { unique: true });
  await mirrors.createIndex({ shopifyUrl: 1 });

  // ------------------------------------------------------------- harvest
  const harvest = async () => {
    const pending = await mirrors
      .find({ shopifyFileId: { $nin: [null, ""] }, shopifyUrl: "" })
      .toArray();
    if (!pending.length) {
      console.log("nothing awaiting a URL");
      return;
    }
    console.log(`reading back URLs for ${pending.length} file(s)`);
    let filled = 0;
    for (let i = 0; i < pending.length; i += 100) {
      const chunk = pending.slice(i, i + 100);
      const d = await shopifyAdminRequest(
        `query($ids: [ID!]!) {
          nodes(ids: $ids) {
            id
            ... on MediaImage { fileStatus image { url } }
            ... on GenericFile { fileStatus url }
          }
        }`,
        { ids: chunk.map((c) => c.shopifyFileId) },
      );
      const ops = [];
      for (const n of d.nodes || []) {
        if (!n?.id) continue;
        const url = n.image?.url || n.url || "";
        if (!url) continue;
        ops.push({
          updateOne: {
            filter: { shopifyFileId: n.id },
            update: { $set: { shopifyUrl: url, status: n.fileStatus || "READY" } },
          },
        });
      }
      if (ops.length) {
        await mirrors.bulkWrite(ops, { ordered: false });
        filled += ops.length;
      }
      process.stdout.write(`\r  ${Math.min(i + 100, pending.length)}/${pending.length} · ${filled} URLs recorded`);
    }
    console.log("");
  };

  if (HARVEST_ONLY) {
    await harvest();
    await mongoose.disconnect();
    unregister();
    return;
  }

  // ----------------------------------------------------------- collect work
  const CACHE = path.join(__dirname, ".asset-worklist.json");

  // The collection phase reads a hundred and forty thousand array entries out
  // of Mongo, and a socket drop part-way through discards all of it. Caching
  // the result makes a resumed run start where the uploading starts.
  let cached = null;
  if (fs.existsSync(CACHE) && process.env.RECOLLECT !== "1") {
    try {
      cached = JSON.parse(fs.readFileSync(CACHE, "utf8"));
      console.log(`reusing cached work-list: ${cached.length} assets (RECOLLECT=1 to rebuild)`);
    } catch {
      cached = null;
    }
  }

  console.log("collecting distinct assets…");
  const products = db.collection("products");

  let wantedList = cached;
  const gallery = new Set();
  if (!wantedList) {
    for await (const r of products.aggregate(
      [{ $unwind: "$images" }, { $match: { images: /cloudinary/i } }, { $group: { _id: "$images" } }],
      { allowDiskUse: true },
    )) {
      gallery.add(r._id);
    }
  }

  const wanted = new Set();
  for (const field of wantedList ? [] : FIELDS) {
    for await (const r of products.aggregate(
      [
        { $project: { v: `$${field}` } },
        { $unwind: "$v" },
        { $unwind: "$v" },
        { $match: { v: { $type: "string", $regex: "cloudinary", $options: "i" } } },
        { $group: { _id: "$v" } },
      ],
      { allowDiskUse: true },
    )) {
      const url = r._id;
      if (gallery.has(url) || isPdf(url)) continue;
      wanted.add(url);
    }
    process.stdout.write(`\r  ${wanted.size} distinct so far (${field})            `);
  }
  console.log("");

  if (!wantedList) {
    wantedList = [...wanted];
    fs.writeFileSync(CACHE, JSON.stringify(wantedList));
    console.log(`work-list cached to ${CACHE}`);
  }

  const already = new Set(
    (await mirrors.distinct("sourceUrl", { shopifyFileId: { $nin: [null, ""] } })).map(String),
  );
  const todo = wantedList.filter((u) => !already.has(u)).slice(0, LIMIT);

  console.log(
    `\n${wantedList.length} distinct assets · ${already.size} already mirrored · ${todo.length} to upload\n`,
  );

  if (DRY) {
    console.log("DRY=1 — nothing sent");
    await mongoose.disconnect();
    unregister();
    return;
  }
  if (!todo.length) {
    await harvest();
    await mongoose.disconnect();
    unregister();
    return;
  }

  // --------------------------------------------------------------- upload
  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));

  let done = 0, created = 0, failed = 0;
  const startedAt = Date.now();
  const inFlight = new Set();

  const send = async (batch) => {
    try {
      const d = await shopifyAdminRequest(
        `mutation($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { id fileStatus ... on MediaImage { image { url } } }
            userErrors { field message }
          }
        }`,
        {
          files: batch.map((u) => ({
            originalSource: u,
            contentType: contentTypeFor(u),
            alt: "",
          })),
        },
      );

      const errs = d.fileCreate.userErrors || [];
      const files = d.fileCreate.files || [];

      // Files come back in the order sent, which is the only way to know which
      // upload is which — Shopify's filename is its own.
      const ops = [];
      batch.forEach((sourceUrl, i) => {
        const node = files[i];
        if (!node?.id) return;
        ops.push({
          updateOne: {
            filter: { sourceUrl },
            update: {
              $set: {
                sourceUrl,
                shopifyFileId: node.id,
                shopifyUrl: node.image?.url || "",
                status: node.fileStatus || "",
                mirroredAt: new Date(),
              },
            },
            upsert: true,
          },
        });
      });
      if (ops.length) await mirrors.bulkWrite(ops, { ordered: false });
      created += ops.length;
      if (errs.length) {
        failed += batch.length - ops.length;
        console.error(`  batch errors: ${errs.map((e) => e.message).slice(0, 2).join("; ").slice(0, 140)}`);
      }
    } catch (error) {
      failed += batch.length;
      console.error(`  ✗ batch failed — ${String(error.message).slice(0, 120)}`);
    }
  };

  for (const batch of batches) {
    const task = send(batch).finally(() => inFlight.delete(task));
    inFlight.add(task);
    if (inFlight.size >= CONCURRENCY) await Promise.race(inFlight);
    done += 1;
    if (done % 20 === 0) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = (done * BATCH) / elapsed;
      const left = todo.length - done * BATCH;
      console.log(
        `  ${Math.min(done * BATCH, todo.length)}/${todo.length}  ` +
          `${rate.toFixed(0)}/s  eta ${Math.round(left / Math.max(rate, 1) / 60)}m  ` +
          `created ${created}  failed ${failed}  points ${Math.round(shopifyCostStatus().available)}`,
      );
    }
  }
  await Promise.all(inFlight);

  console.log(`\nuploaded ${created}, failed ${failed}, in ${Math.round((Date.now() - startedAt) / 60000)}m`);
  console.log("\nreading back CDN URLs (Shopify is still fetching some of these)…");
  await harvest();

  const total = await mirrors.countDocuments({});
  const withUrl = await mirrors.countDocuments({ shopifyUrl: { $nin: [null, ""] } });
  console.log(`\nassetMirrors: ${total} rows, ${withUrl} with a Shopify URL`);
  console.log("re-run with HARVEST=1 later to pick up the rest.");

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
