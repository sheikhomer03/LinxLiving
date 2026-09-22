/**
 * Re-upload product images Shopify failed to fetch.
 *
 * Pulling 6,883 Tap Warehouse products through their image host in an hour
 * made it start answering 502s, and Shopify recorded the media as FAILED —
 * "Server error while reading file (Unsuccessful HTTP response code: 502)".
 * The products are fine and the source files are fine; the download just did
 * not happen, so nothing pairs and the PDPs render imageless.
 *
 * For each affected product this deletes the FAILED media and sends the same
 * sources again, at a gentler pace than the original run so the supplier's
 * CDN keeps up. Only media in a FAILED state is ever deleted — a READY image
 * is left alone, so this can be re-run safely.
 *
 * Pair the results afterwards with backfill-shopify-images.cjs.
 *
 * Env:
 *   BRAND=slug     brand to repair (default "tap-warehouse")
 *   APPLY=1        do it (default is a dry run)
 *   CONCURRENCY=n  products at once (default 3 — be kind to their server)
 *   LIMIT=n        only the first n products
 */
const path = require("path");
const fs = require("fs");
for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p, quiet: true });
}
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BRAND_SLUG = process.env.BRAND || "tap-warehouse";
const APPLY = process.env.APPLY === "1";
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 3, 8));
const LIMIT = Number(process.env.LIMIT) || Infinity;
const MAX_IMAGES = Number(process.env.MAX_IMAGES) || 12;
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";

let token = null;

async function adminToken() {
  const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
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
    const res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const j = await res.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
    return j.data;
  } catch (e) {
    if (attempt >= 5) throw e;
    await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    return admin(query, variables, attempt + 1);
  }
}

/** Same rule the sync uses: a URL that is actually an image file. */
function usableImage(u) {
  const file = String(u || "").split("?")[0].split("/").pop();
  return /\.(jpe?g|png|webp|gif|avif)$/i.test(file);
}

const MEDIA = `query($id: ID!) {
  product(id: $id) { media(first: 50) { nodes { ... on MediaImage { id status } } } }
}`;
const DELETE = `mutation($productId: ID!, $mediaIds: [ID!]!) {
  productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
    deletedMediaIds
    mediaUserErrors { field message }
  }
}`;
const ADD = `mutation($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    mediaUserErrors { field message }
  }
}`;

async function repair(doc) {
  const images = (doc.images || []).filter(Boolean).filter(usableImage).slice(0, MAX_IMAGES);
  if (!images.length) return { skipped: "no usable source image" };

  const data = await admin(MEDIA, { id: doc.shopifyProductId });
  const nodes = (((data.product || {}).media || {}).nodes || []).filter(Boolean);
  const failed = nodes.filter((n) => String(n.status) === "FAILED");
  const ready = nodes.filter((n) => String(n.status) === "READY");
  if (ready.length) return { skipped: "already has " + ready.length + " ready" };
  if (!failed.length && nodes.length) return { skipped: "media still processing" };

  if (!APPLY) return { dry: true, remove: failed.length, upload: images.length };

  if (failed.length) {
    const out = await admin(DELETE, {
      productId: doc.shopifyProductId,
      mediaIds: failed.map((n) => n.id),
    });
    const errs = (out.productDeleteMedia && out.productDeleteMedia.mediaUserErrors) || [];
    if (errs.length) throw new Error(errs.map((e) => e.message).join("; ").slice(0, 160));
  }

  const out = await admin(ADD, {
    productId: doc.shopifyProductId,
    media: images.map((url) => ({
      originalSource: url,
      mediaContentType: "IMAGE",
      alt: String(doc.name || "").slice(0, 120),
    })),
  });
  const errs = (out.productCreateMedia && out.productCreateMedia.mediaUserErrors) || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; ").slice(0, 160));
  return { removed: failed.length, uploaded: images.length };
}

(async () => {
  token = await adminToken();
  const { db: pri } = await connectMongo();
  const brand = await pri.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("brand not found: " + BRAND_SLUG);
  const sec =
    brand.dataCluster === "secondary"
      ? await mongoose
          .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 })
          .asPromise()
      : null;
  const P = (sec ? sec.db : pri).collection("products");

  const filter = {
    brand: brand._id,
    shopifyProductId: { $nin: ["", null] },
    /*
     * Two shapes of the same failure.
     *
     * Tap Warehouse pushed with no pairs recorded at all, so an empty or
     * absent array was the whole signal. Toasty pushed with the pairs written
     * up front — media id present, url blank because Shopify had not finished
     * processing — and those products never matched, so a brand with 586
     * FAILED images reported nothing to retry. A pair still carrying a blank
     * url after processing has settled is the same broken state.
     */
    $or: [
      { shopifyImages: { $size: 0 } },
      { shopifyImages: { $exists: false } },
      { shopifyImages: { $elemMatch: { shopifyUrl: { $in: [null, ""] } } } },
    ],
  };
  const docs = await P.find(filter)
    .project({ _id: 1, name: 1, images: 1, shopifyProductId: 1 })
    .limit(LIMIT === Infinity ? 0 : LIMIT)
    .toArray();

  console.log("brand   : " + brand.name);
  console.log("to retry: " + docs.length + (APPLY ? "" : "   (DRY RUN — pass APPLY=1)"));
  console.log("");

  let i = 0, ok = 0, skipped = 0, failedCount = 0, uploaded = 0;
  const started = Date.now();
  const worker = async () => {
    while (i < docs.length) {
      const doc = docs[i++];
      const n = i;
      try {
        const r = await repair(doc);
        if (r.skipped) skipped += 1;
        else if (r.dry) { ok += 1; uploaded += r.upload; }
        else { ok += 1; uploaded += r.uploaded; }
      } catch (e) {
        failedCount += 1;
        if (failedCount <= 8) {
          console.log("  FAIL " + String(doc.name).slice(0, 40) + " -> " + String(e.message).slice(0, 110));
        }
      }
      if (n % 100 === 0 || n === docs.length) {
        const rate = n / ((Date.now() - started) / 60000);
        console.log(
          "  " + n + "/" + docs.length + "  repaired " + ok + "  skipped " + skipped +
          "  failed " + failedCount + "  ~" + Math.round((docs.length - n) / Math.max(rate, 0.01)) + "m left",
        );
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log("");
  console.log("repaired : " + ok + "   images sent: " + uploaded);
  console.log("skipped  : " + skipped);
  console.log("failed   : " + failedCount);
  if (APPLY) console.log("\nnow run: BRAND=" + BRAND_SLUG + " node scripts/backfill-shopify-images.cjs");

  await mongoose.disconnect();
  if (sec) await sec.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED: " + e.message); process.exit(1); });
