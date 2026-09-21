/**
 * Mirror the images a product has beyond its main gallery onto Shopify.
 *
 * Two sets were captured after the original sync and so were never uploaded:
 *
 *   technicalDrawings  the extra gallery tile the shop injects client-side.
 *                      This is the "sixth image" a product shows on Drench
 *                      and showed five of here.
 *   variants[].images  each finish is photographed separately, so choosing
 *                      one is meant to change the gallery.
 *
 * Both are stored as supplier URLs, and the storefront deliberately renders
 * only `cdn.shopify.com` (see `shopifyOnly` in ProductSection) — an
 * unmirrored image is not shown at all rather than hotlinked. So they have to
 * reach Shopify before the PDP can use them.
 *
 * Pairing is by the supplier's 40-character content hash, which survives into
 * the Shopify CDN filename. The original backfill paired by array position,
 * which is right for one upload of a whole gallery and wrong here: this
 * appends to media that already exists.
 *
 * Resumable: a product is selected only until it has been stamped.
 *
 * Env:
 *   BRAND=slug   brand to mirror (default "drench")
 *   LIMIT=n      only the first n products
 *   DRY_RUN=1    report what would upload, upload nothing
 *   ONLY=<id>    a single Mongo product _id, for a pilot run
 *   ONLY_UNPAIRED=1  upload only for variants with no mirrored image at all
 *   RECOLLECT=1  read pairings back again for products whose variants still
 *                have a supplier image with no mirrored counterpart
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
/** Upload only for variants that have no mirrored picture at all. */
const ONLY_UNPAIRED = process.env.ONLY_UNPAIRED === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const DRY_RUN = process.env.DRY_RUN === "1";
const ONLY = process.env.ONLY || "";
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
/** Shopify allows 250 media per product; leave room for what is already there. */
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD) || 40;

let token = null;

async function adminToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  }
  const res = await fetch("https://" + DOMAIN + "/admin/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("token exchange failed");
  return j.access_token;
}

async function admin(query, variables, attempt = 0) {
  try {
    const res = await fetch(
      "https://" + DOMAIN + "/admin/api/" + VERSION + "/graphql.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables }),
      },
    );
    const j = await res.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 240));
    return j.data;
  } catch (e) {
    if (attempt >= 5) throw e;
    await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    return admin(query, variables, attempt + 1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The supplier's content hash, which both sides of the pairing carry.
 *
 * Drench names every asset `<40 hex>_<slug>.<ext>` and Shopify keeps that
 * filename when it fetches the file, so the hash identifies the same image on
 * either host without depending on upload order.
 */
function hashOf(url) {
  const m = String(url || "").match(/([0-9a-f]{40})/i);
  return m ? m[1].toLowerCase() : "";
}

const MEDIA_Q =
  "query($id: ID!) { product(id: $id) { media(first: 250) { nodes {" +
  " ... on MediaImage { id status image { url } } } } } }";

async function readMedia(productId) {
  const d = await admin(MEDIA_Q, { id: productId });
  const nodes = ((d.product && d.product.media && d.product.media.nodes) || [])
    .filter((n) => n && n.id);
  return nodes;
}

async function mirrorProduct(doc) {
  if (!doc.shopifyProductId) return { skipped: "not in shopify" };

  const drawings = ONLY_UNPAIRED ? [] : (doc.technicalDrawings || []).filter(Boolean);
  const variantImgs = [];
  for (const v of doc.variants || []) {
    /*
     * ONLY_UNPAIRED narrows the job to variants showing no picture at all.
     * A variant with several photographs may have mirrored only some of
     * them; that is a thinner gallery, not a missing swatch, and sending
     * hundreds of images for it is a much larger job than closing the
     * handful of variants that currently show nothing of their own.
     */
    if (ONLY_UNPAIRED && (v.shopifyImages || []).length) continue;
    for (const u of v.images || []) if (u) variantImgs.push(u);
  }
  if (!drawings.length && !variantImgs.length) return { skipped: "nothing extra" };

  /*
   * What Shopify already holds, by content hash.
   *
   * Variant pairings count as much as the gallery. Reading only
   * `shopifyImages` meant an image mirrored onto a variant still looked
   * missing, so every run re-sent the same first MAX_UPLOAD images and the
   * work set never shrank — the images beyond that window were never
   * reached, and the ones inside it were uploaded again each time.
   */
  const existing = new Map();
  const remember = (p) => {
    const h = hashOf(p && (p.sourceUrl || p.shopifyUrl));
    if (h && !existing.has(h)) existing.set(h, p);
  };
  for (const p of doc.shopifyImages || []) remember(p);
  for (const v of doc.variants || []) {
    for (const p of v.shopifyImages || []) remember(p);
  }

  const wanted = [];
  const seen = new Set();
  for (const u of [...drawings, ...variantImgs]) {
    const h = hashOf(u);
    if (!h || seen.has(h) || existing.has(h)) continue;
    seen.add(h);
    wanted.push({ url: u, hash: h });
  }

  if (DRY_RUN) {
    return { dry: true, toUpload: wanted.length, drawings: drawings.length, variantImgs: variantImgs.length };
  }
  if (!wanted.length) return { alreadyDone: true, drawings, variantImgs };

  const batch = wanted.slice(0, MAX_UPLOAD);
  const d = await admin(
    "mutation Add($productId: ID!, $media: [CreateMediaInput!]!) {" +
      "  productCreateMedia(productId: $productId, media: $media) {" +
      "    mediaUserErrors { field message }" +
      "  }" +
      "}",
    {
      productId: doc.shopifyProductId,
      media: batch.map((w) => ({
        originalSource: w.url,
        mediaContentType: "IMAGE",
        alt: String(doc.name || "").slice(0, 120),
      })),
    },
  );
  const errs = (d.productCreateMedia && d.productCreateMedia.mediaUserErrors) || [];
  if (errs.length) {
    throw new Error(errs.map((e) => e.message).join("; ").slice(0, 200));
  }

  /*
   * Upload and move on.
   *
   * Shopify fetches each file asynchronously, so the URL is not on the
   * mutation's response. Waiting for it here cost up to 40 seconds a
   * product — 15 hours for this catalogue — to learn something a single
   * query can later read for forty products at once. The collect phase
   * does that instead.
   */
  return { uploaded: batch.length, pending: wanted.length - batch.length };
}

/**
 * Read back what Shopify made of the uploads, forty products per query, and
 * write the pairing onto the product and its variants.
 */
async function collectBatch(P, docs) {
  const ids = docs.map((d) => d.shopifyProductId);
  const d = await admin(
    "query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id media(first: 250) {" +
      " nodes { ... on MediaImage { id image { url } } } } } } }",
    { ids },
  );
  const byProduct = new Map();
  for (const n of (d.nodes || []).filter(Boolean)) {
    const map = new Map();
    for (const m of ((n.media && n.media.nodes) || [])) {
      if (!m || !m.image || !m.image.url) continue;
      const h = hashOf(m.image.url);
      if (h && !map.has(h)) map.set(h, { shopifyUrl: m.image.url, mediaId: m.id });
    }
    byProduct.set(n.id, map);
  }

  const ops = [];
  let drawings = 0, variantPairs = 0, waiting = 0;

  for (const doc of docs) {
    const byHash = byProduct.get(doc.shopifyProductId);
    if (!byHash || !byHash.size) { waiting += 1; continue; }

    const pairs = [...(doc.shopifyImages || [])];
    for (const u of doc.technicalDrawings || []) {
      const h = hashOf(u);
      const hit = h && byHash.get(h);
      if (!hit || pairs.some((x) => hashOf(x.shopifyUrl) === h)) continue;
      pairs.push({ sourceUrl: u, shopifyUrl: hit.shopifyUrl, mediaId: hit.mediaId, position: pairs.length });
      drawings += 1;
    }

    const set = { shopifyImages: pairs, extraImagesSyncedAt: new Date() };
    (doc.variants || []).forEach((v, i) => {
      const imgs = [];
      (v.images || []).forEach((u, n) => {
        const hit = byHash.get(hashOf(u));
        if (!hit) return;
        imgs.push({ sourceUrl: u, shopifyUrl: hit.shopifyUrl, mediaId: hit.mediaId, position: n });
      });
      if (imgs.length) {
        set["variants." + i + ".shopifyImages"] = imgs;
        variantPairs += imgs.length;
      }
    });

    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
  }

  if (ops.length) await P.bulkWrite(ops, { ordered: false });
  return { written: ops.length, drawings, variantPairs, waiting };
}

async function main() {
  token = await adminToken();
  const { db: primary } = await connectMongo();
  const brand = await primary.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("brand not found: " + BRAND_SLUG);

  let db = primary;
  let secConn = null;
  if (brand.dataCluster === "secondary") {
    secConn = await mongoose
      .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 30000 })
      .asPromise();
    db = secConn.db;
  }
  const P = db.collection("products");

  const filter = ONLY
    ? { _id: new mongoose.Types.ObjectId(ONLY) }
    : {
        brand: brand._id,
        shopifyProductId: { $nin: [null, ""] },
        extraImagesUploadedAt: { $exists: false },
        extraImagesSyncedAt: { $exists: false },
        $or: [
          { "technicalDrawings.0": { $exists: true } },
          { "variants.0.images.0": { $exists: true } },
        ],
      };

  const total = await P.countDocuments(filter);
  console.log("brand   : " + brand.name + "  (" + (secConn ? "secondary" : "primary") + ")");
  console.log("to do   : " + total + (DRY_RUN ? "   (DRY RUN)" : ""));
  console.log("");

  let done = 0, ok = 0, skipped = 0, failed = 0, uploaded = 0, drawingsAdded = 0;
  const started = Date.now();
  const target = Math.min(total, LIMIT === Infinity ? total : LIMIT);
  /*
   * Ids first, then fetch one at a time.
   *
   * Holding a cursor open across the Shopify calls let it idle past the
   * server's timeout and the run died with CursorNotFound at 750 products.
   * The id list is small and settles the work set before any slow call.
   */
  const ids = (
    await P.find(filter)
      .project({ _id: 1 })
      .limit(LIMIT === Infinity ? 0 : LIMIT)
      .toArray()
  ).map((d) => d._id);

  for (const _id of ids) {
    const doc = await P.findOne({ _id });
    if (!doc) continue;
    done += 1;
    try {
      const r = await mirrorProduct(doc);
      if (r.skipped) {
        skipped += 1;
        await P.updateOne({ _id: doc._id }, { $set: { extraImagesSyncedAt: new Date() } });
        continue;
      }
      if (r.dry) {
        ok += 1;
        if (ok <= 5) {
          console.log("  [dry] " + String(doc.name).slice(0, 42).padEnd(44) +
            "upload " + r.toUpload + "  (drawings " + r.drawings + ", variant imgs " + r.variantImgs + ")");
        }
        continue;
      }

      // Uploaded, not yet paired — the collect phase reads the URLs back.
      await P.updateOne(
        { _id: doc._id },
        { $set: { extraImagesUploadedAt: new Date() }, $unset: { extraImagesError: "" } },
      );

      ok += 1;
      uploaded += r.uploaded || 0;
      if (ok <= 3) {
        console.log("  " + String(doc.name).slice(0, 42).padEnd(44) +
          "uploaded " + (r.uploaded || 0));
      }
    } catch (e) {
      failed += 1;
      const msg = String(e.message || e).slice(0, 170);
      await P.updateOne({ _id: doc._id }, { $set: { extraImagesError: msg } });
      if (failed <= 8) console.log("  FAIL " + String(doc.name).slice(0, 38) + " -> " + msg);
    }

    if (done % 25 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      const left = Math.round((target - done) / Math.max(rate, 0.001) / 60);
      console.log("  " + done + "/" + target + "  ok " + ok + "  uploaded " + uploaded +
        "  skipped " + skipped + "  failed " + failed + "  ~" + left + "m left");
    }
  }

  console.log("");
  console.log("upload phase done — uploaded " + uploaded + " images across " + ok + " products");
  console.log("");

  /*
   * Collect: read the CDN URLs back, forty products to a query.
   *
   * Shopify needs a moment to fetch each file, so anything still processing
   * is left unstamped and picked up the next time this runs.
   */
  if (!DRY_RUN) {
    /*
     * Normally the stamp is what makes the collect phase resumable.
     * RECOLLECT=1 ignores it and goes by the thing that actually matters —
     * a variant that has a supplier image but no mirrored one — so products
     * whose pairing came up short can be read back again.
     */
    const pending = process.env.RECOLLECT === "1"
      ? {
          brand: brand._id,
          extraImagesUploadedAt: { $exists: true },
          variants: {
            $elemMatch: {
              "images.0": { $exists: true },
              // Never mirrored at all, or mirrored to an empty list.
              "shopifyImages.0": { $exists: false },
            },
          },
        }
      : {
          brand: brand._id,
          extraImagesUploadedAt: { $exists: true },
          extraImagesSyncedAt: { $exists: false },
        };
    const toCollect = await P.countDocuments(pending);
    console.log("collect phase   : " + toCollect + " products");
    let batch = [], collected = 0, stillWaiting = 0, drew = 0, vpairs = 0;
    const run = async () => {
      if (!batch.length) return;
      const r = await collectBatch(P, batch);
      collected += r.written; stillWaiting += r.waiting;
      drew += r.drawings; vpairs += r.variantPairs;
      batch = [];
      console.log("  collected " + collected + "  waiting " + stillWaiting +
        "  drawings " + drew + "  variant pairs " + vpairs);
    };
    /*
     * Ids first, then read forty documents at a time.
     *
     * Holding one cursor open across the Shopify round trips let it idle
     * past the server's timeout, and the phase died with CursorNotFound
     * partway through — the same failure the variant sync hit. The id list
     * settles the work set before any slow call.
     */
    const pendingIds = (
      await P.find(pending).project({ _id: 1 }).toArray()
    ).map((d) => d._id);
    for (let i = 0; i < pendingIds.length; i += 40) {
      batch = await P.find({ _id: { $in: pendingIds.slice(i, i + 40) } }).toArray();
      await run();
    }
    drawingsAdded = drew;
    console.log("");
    console.log("collected       : " + collected);
    console.log("still processing: " + stillWaiting + "  (re-run to finish)");
  }

  console.log("");
  console.log("products done   : " + ok);
  console.log("images uploaded : " + uploaded);
  console.log("drawings added  : " + drawingsAdded);
  console.log("skipped         : " + skipped);
  console.log("failed          : " + failed);
  if (secConn) await secConn.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
