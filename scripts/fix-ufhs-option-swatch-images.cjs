/**
 * Serve every product option image from Shopify.
 *
 * Two groups need moving, for different reasons.
 *
 * The Under Floor Heating swatches never entered the pipeline at all. Globo
 * records a swatch under an `asset_name` with the file extension stripped, the
 * scrape pasted that straight after `/cdn/shop/files/`, and Shopify's CDN only
 * serves the full filename — so the URL 404d. `uploadRemoteImage` swallows a failed upload and
 * returns its input, which left the broken supplier link stored as the image
 * and gave the PDP a dead <img> for every drain cover and installation kit.
 *
 * The extension is asked for rather than assumed: each candidate is probed and
 * the first that answers with an image wins, the same rule the scrape itself
 * now applies (see enrich-ufhs-products.cjs). That keeps this correct if a
 * future swatch is a .png.
 *
 * The bytes go to Shopify Files, not Cloudinary — the storefront serves images
 * from the shop, so the URL stored on the choice has to be the Shopify one.
 * `fileCreate` takes an external source, so Shopify fetches each image from the
 * supplier itself and nothing travels through this machine. They go to Files
 * rather than product media for the reason mirror-cloudinary-assets-to-shopify
 * gives: product media is the customer-facing gallery, and a drain cover swatch
 * does not belong in the PDP carousel.
 *
 * The rest were mirrored to Shopify long ago by
 * mirror-cloudinary-assets-to-shopify, which records the copy in `assetMirrors`
 * but leaves the product pointing at Cloudinary — so the bytes are in the shop
 * and the page fetches them from somewhere else. Those need no upload, only the
 * URL swapped for the one already recorded.
 *
 * One upload per distinct image, not per entry — a shared drain cover backs a
 * choice on thirty products, and uploading it once per product would be thirty
 * copies of the same file. The mapping is recorded in `assetMirrors` alongside
 * every other mirrored asset, keyed by the URL that was stored before this ran,
 * so a second run is a no-op.
 *
 * Re-run this after any scrape: enrich-ufhs-products.cjs uploads option images
 * to Cloudinary, the same way the gallery scrape does, and this is the step
 * that moves them on to the shop — the option-image equivalent of the gallery's
 * own Shopify sync.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-ufhs-option-swatch-images.cjs
 *
 *   DRY=1                    report the work, upload and write nothing
 *   ROLLBACK=<file.json>     restore the URLs recorded by a previous run
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const DRY = process.env.DRY === "1";
const ROLLBACK_FILE = process.env.ROLLBACK || "";
const SUPPLIER = /theunderfloorheatingstore\.com/i;
/** Already where it belongs — a Shopify-hosted image is left alone. */
const ON_SHOPIFY = /cdn\.shopify\.com|cdn\.shopifycdn\.net/i;
const EXTENSIONS = [".jpg", ".png", ".jpeg", ".webp", ".gif"];
const BATCH = 20;

/**
 * Where an option image can sit. Each entry is the array holding the choices
 * and the key on a choice that carries the image, so one walker covers the
 * option builder, the nested options, the coverage picker and the tool list.
 */
const IMAGE_PATHS = [
  { field: "optionElements", list: "choices" },
  { field: "nestedOptions", list: "choices" },
  { field: "coverage", list: "values", single: true },
  { field: "doTheJobRight", list: "items", single: true },
];

/** Every choice object under `product` that carries an image URL. */
function* imageChoices(product) {
  for (const { field, list, single } of IMAGE_PATHS) {
    const groups = single
      ? product[field]
        ? [product[field]]
        : []
      : product[field] || [];
    for (const [g, group] of groups.entries()) {
      for (const [c, choice] of (group?.[list] || []).entries()) {
        if (choice && typeof choice.imageUrl === "string") {
          yield { field, list, single, g, c, choice };
        }
      }
    }
  }
}

/** The Mongo path for one choice's image, for a targeted $set. */
const imagePathFor = ({ field, list, single, g, c }) =>
  single
    ? `${field}.${list}.${c}.imageUrl`
    : `${field}.${g}.${list}.${c}.imageUrl`;

/** Any option image not yet served by the shop. */
const SELECTOR = {
  $or: IMAGE_PATHS.flatMap(({ field, list }) => [
    { [`${field}.${list}.imageUrl`]: SUPPLIER },
    { [`${field}.${list}.imageUrl`]: /res\.cloudinary\.com/i },
  ]),
};

/** True for a URL this script should move to Shopify. */
const needsMoving = (url) =>
  typeof url === "string" &&
  /^https?:/i.test(url) &&
  !ON_SHOPIFY.test(url) &&
  (SUPPLIER.test(url) || /res\.cloudinary\.com/i.test(url));

const resolved = new Map();

/** The filename the CDN actually serves, when the stored one has no extension. */
async function resolveExtension(url) {
  if (/\.[a-z0-9]{3,4}$/i.test(url)) return url;
  if (resolved.has(url)) return resolved.get(url);
  let found = "";
  for (const ext of EXTENSIONS) {
    try {
      const res = await fetch(`${url}${ext}`, { method: "HEAD" });
      if (res.ok && /^image\//i.test(res.headers.get("content-type") || "")) {
        found = `${url}${ext}`;
        break;
      }
    } catch {
      /* try the next extension */
    }
  }
  resolved.set(url, found);
  return found;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  const mongoose = require("mongoose");
  const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const products = db.collection("products");
  const mirrors = db.collection("assetMirrors");
  await mirrors.createIndex({ sourceUrl: 1 }, { unique: true });

  const finish = async () => {
    await mongoose.disconnect();
    unregister();
  };

  // ------------------------------------------------------------- rollback
  if (ROLLBACK_FILE) {
    const rows = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
    const ops = rows.map((r) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(r._id) },
        update: { $set: r.previous },
      },
    }));
    if (ops.length) await products.bulkWrite(ops);
    console.log(`Restored option images on ${ops.length} product(s).`);
    return finish();
  }

  // -------------------------------------------------------- collect the work
  const targets = await products.find(SELECTOR).toArray();
  const distinct = new Set();
  let entries = 0;
  for (const p of targets) {
    for (const hit of imageChoices(p)) {
      if (!needsMoving(hit.choice.imageUrl)) continue;
      distinct.add(hit.choice.imageUrl);
      entries++;
    }
  }
  console.log(
    `${targets.length} product(s) · ${entries} choice entries · ${distinct.size} distinct images`,
  );

  // An earlier run may already hold some of these.
  const known = new Map();
  for (const row of await mirrors
    .find({ sourceUrl: { $in: [...distinct] } })
    .toArray()) {
    if (row.shopifyFileId) known.set(row.sourceUrl, row);
  }

  const todo = [];
  for (const url of distinct) {
    if (known.has(url)) continue;
    const real = await resolveExtension(url);
    if (!real) {
      console.log(`  ✗ no working filename: ${url.split("/").pop()}`);
      continue;
    }
    todo.push({ stored: url, source: real });
  }

  console.log(
    `${known.size} already in Shopify · ${todo.length} to upload` +
      (DRY ? "  (DRY=1)" : ""),
  );

  if (DRY) {
    for (const t of todo.slice(0, 10)) {
      console.log(`  [dry] ${t.stored.split("/").pop()} → ${t.source.split("/").pop()}`);
    }
    if (todo.length > 10) console.log(`  [dry] …and ${todo.length - 10} more`);
    console.log("\nDRY=1 — nothing uploaded, nothing written.");
    return finish();
  }

  // ------------------------------------------------------ upload to Shopify
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const d = await shopifyAdminRequest(
      `mutation($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { id fileStatus ... on MediaImage { image { url } } }
          userErrors { field message }
        }
      }`,
      {
        files: batch.map((t) => ({
          originalSource: t.source,
          contentType: "IMAGE",
          alt: "",
        })),
      },
    );
    const errs = d.fileCreate.userErrors || [];
    // Files come back in the order sent, which is the only way to know which
    // upload is which — Shopify's filename is its own.
    const files = d.fileCreate.files || [];
    const ops = [];
    batch.forEach((t, j) => {
      const node = files[j];
      if (!node?.id) return;
      ops.push({
        updateOne: {
          filter: { sourceUrl: t.stored },
          update: {
            $set: {
              sourceUrl: t.stored,
              originalSource: t.source,
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
    console.log(
      `  uploaded ${Math.min(i + BATCH, todo.length)}/${todo.length}` +
        (errs.length ? ` · errors: ${errs.map((e) => e.message).join("; ").slice(0, 140)}` : ""),
    );
  }

  // ------------------------------------------------------ read back the URLs
  // Shopify is still fetching the bytes when fileCreate returns, so the CDN URL
  // usually is not on the reply. Poll until every file has one — the rewrite
  // below is worthless without it.
  for (let attempt = 1; attempt <= 12; attempt++) {
    const pending = await mirrors
      .find({
        sourceUrl: { $in: [...distinct] },
        shopifyFileId: { $nin: [null, ""] },
        $or: [{ shopifyUrl: "" }, { shopifyUrl: null }],
      })
      .toArray();
    if (!pending.length) break;
    console.log(`  waiting on ${pending.length} CDN URL(s) (attempt ${attempt})`);
    const d = await shopifyAdminRequest(
      `query($ids: [ID!]!) {
        nodes(ids: $ids) {
          id
          ... on MediaImage { fileStatus image { url } }
          ... on GenericFile { fileStatus url }
        }
      }`,
      { ids: pending.map((p) => p.shopifyFileId) },
    );
    const ops = [];
    for (const n of d.nodes || []) {
      const url = n?.image?.url || n?.url || "";
      if (!n?.id || !url) continue;
      ops.push({
        updateOne: {
          filter: { shopifyFileId: n.id },
          update: { $set: { shopifyUrl: url, status: n.fileStatus || "READY" } },
        },
      });
    }
    if (ops.length) await mirrors.bulkWrite(ops, { ordered: false });
    if (ops.length < pending.length) await delay(3000);
  }

  // ------------------------------------------- point the products at Shopify
  const hosted = new Map();
  for (const row of await mirrors
    .find({ sourceUrl: { $in: [...distinct] }, shopifyUrl: { $nin: [null, ""] } })
    .toArray()) {
    hosted.set(row.sourceUrl, row.shopifyUrl);
  }
  console.log(`\n${hosted.size}/${distinct.size} image(s) now hosted by Shopify`);

  const rollback = [];
  const ops = [];
  for (const p of targets) {
    const $set = {};
    const previous = {};
    for (const hit of imageChoices(p)) {
      const current = hit.choice.imageUrl;
      const next = hosted.get(current);
      if (!next || next === current) continue;
      const dotted = imagePathFor(hit);
      $set[dotted] = next;
      previous[dotted] = current;
    }
    if (!Object.keys($set).length) continue;
    rollback.push({ _id: String(p._id), previous });
    ops.push({ updateOne: { filter: { _id: p._id }, update: { $set } } });
  }

  if (!ops.length) {
    console.log("Nothing to rewrite.");
    return finish();
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(
    __dirname,
    "..",
    `rollback-ufhs-option-swatches-${stamp}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(rollback, null, 1));

  await products.bulkWrite(ops);
  const rewritten = rollback.reduce(
    (n, r) => n + Object.keys(r.previous).length,
    0,
  );
  console.log(`Rewrote ${rewritten} choice image(s) across ${ops.length} product(s).`);
  console.log(`Rollback: ${path.basename(file)}`);

  const left = distinct.size - hosted.size;
  if (left > 0) {
    console.log(`Still supplier-hosted (no Shopify URL yet): ${left} — re-run to finish.`);
  }

  return finish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
