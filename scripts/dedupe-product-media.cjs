/**
 * Remove duplicate copies of the same image from a Shopify product.
 *
 * The extra-images mirror used to judge "already uploaded" from the product
 * gallery alone, so an image mirrored onto a VARIANT still looked missing and
 * was sent again on every run. On two products that piled up: 215 media for
 * 55 pictures, 224 for 64. Besides the clutter it pushed one product into
 * Shopify's 250-media ceiling, which then blocked the images that really were
 * missing.
 *
 * Safety is the whole point of this script, so it is deliberately narrow:
 *
 *  - Duplicates are identified by the supplier's 40-character content hash,
 *    which survives into the Shopify CDN filename. Two media with the same
 *    hash are the same file, byte for byte.
 *  - Exactly one copy of every hash survives. A hash with a single copy is
 *    never touched, and media carrying no hash is never touched at all —
 *    if it cannot be proven a duplicate, it stays.
 *  - The survivor is whichever copy the database already points at, so no
 *    stored pairing is left dangling. Where several copies are referenced,
 *    the others are repointed onto the survivor before anything is deleted.
 *  - Deletion runs only with APPLY=1, and only for the ids given in ONLY.
 *
 * Env:
 *   ONLY=id[,id]  Mongo product _ids to clean (required)
 *   BRAND=slug    brand the products belong to (default "drench")
 *   APPLY=1       actually delete (default is a dry run)
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const ONLY = String(process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const BRAND_SLUG = process.env.BRAND || "drench";
const APPLY = process.env.APPLY === "1";
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";

let token = null;

async function adminToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
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

const hashOf = (u) => {
  const m = String(u || "").match(/([0-9a-f]{40})/i);
  return m ? m[1].toLowerCase() : "";
};

const MEDIA = `
  query($id: ID!) {
    product(id: $id) {
      id
      media(first: 250) {
        nodes { ... on MediaImage { id image { url } } }
      }
    }
  }`;

const DELETE = `
  mutation($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors { field message }
    }
  }`;

async function main() {
  if (!ONLY.length) throw new Error("ONLY=<product id> is required");
  token = await adminToken();

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

  console.log("brand : " + brand.name + (APPLY ? "" : "   (DRY RUN — pass APPLY=1 to delete)"));

  for (const id of ONLY) {
    const doc = await P.findOne({ _id: new mongoose.Types.ObjectId(id) });
    if (!doc) { console.log("\n" + id + ": not found"); continue; }

    const data = await admin(MEDIA, { id: doc.shopifyProductId });
    const nodes = ((data.product && data.product.media && data.product.media.nodes) || []).filter(Boolean);

    /* Every media id the database currently points at, gallery and variants. */
    const referenced = new Set();
    for (const p of doc.shopifyImages || []) if (p && p.mediaId) referenced.add(String(p.mediaId));
    for (const v of doc.variants || []) {
      for (const p of v.shopifyImages || []) if (p && p.mediaId) referenced.add(String(p.mediaId));
    }

    const byHash = new Map();
    let unhashed = 0;
    for (const n of nodes) {
      const h = hashOf(n.image && n.image.url);
      if (!h) { unhashed += 1; continue; }
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(n);
    }

    const doomed = [];
    /** old media id -> the copy that survives, so pairings can follow. */
    const remap = new Map();
    for (const [, copies] of byHash) {
      if (copies.length < 2) continue;
      // Prefer a copy the database already points at; else the first.
      const keeper = copies.find((c) => referenced.has(String(c.id))) || copies[0];
      for (const c of copies) {
        if (String(c.id) === String(keeper.id)) continue;
        doomed.push(c);
        remap.set(String(c.id), keeper);
      }
    }

    console.log("\n" + String(doc.name).slice(0, 56));
    console.log("  media in shopify : " + nodes.length);
    console.log("  distinct images  : " + byHash.size + (unhashed ? "   (+" + unhashed + " with no hash — never touched)" : ""));
    console.log("  duplicates to go : " + doomed.length);
    console.log("  survivors        : " + byHash.size + "   (one per image, guaranteed)");

    /* Fail closed: never let the arithmetic leave an image with no copy. */
    if (nodes.length - unhashed - doomed.length !== byHash.size) {
      console.log("  ABORT — the counts do not add up; nothing deleted for this product.");
      continue;
    }
    if (!doomed.length) continue;

    if (!APPLY) continue;

    /*
     * Repoint first, delete second. If the run dies in between, the database
     * points at media that still exists; the other order would leave it
     * pointing at media that does not.
     */
    const fix = (arr) =>
      (arr || []).map((p) => {
        const hit = p && p.mediaId && remap.get(String(p.mediaId));
        if (!hit) return p;
        return { ...p, mediaId: hit.id, shopifyUrl: (hit.image && hit.image.url) || p.shopifyUrl };
      });
    const set = { shopifyImages: fix(doc.shopifyImages) };
    (doc.variants || []).forEach((v, i) => {
      if ((v.shopifyImages || []).length) set["variants." + i + ".shopifyImages"] = fix(v.shopifyImages);
    });
    await P.updateOne({ _id: doc._id }, { $set: set });
    console.log("  pairings repointed onto survivors");

    let deleted = 0;
    for (let i = 0; i < doomed.length; i += 25) {
      const ids = doomed.slice(i, i + 25).map((d) => d.id);
      const out = await admin(DELETE, { productId: doc.shopifyProductId, mediaIds: ids });
      const errs = (out.productDeleteMedia && out.productDeleteMedia.mediaUserErrors) || [];
      if (errs.length) {
        console.log("  errors: " + errs.map((e) => e.message).join("; ").slice(0, 160));
        break;
      }
      deleted += ((out.productDeleteMedia && out.productDeleteMedia.deletedMediaIds) || []).length;
    }
    console.log("  deleted          : " + deleted + " / " + doomed.length);

    const after = await admin(MEDIA, { id: doc.shopifyProductId });
    const left = (((after.product || {}).media || {}).nodes || []).filter(Boolean);
    const leftHashes = new Set(left.map((n) => hashOf(n.image && n.image.url)).filter(Boolean));
    console.log("  media now        : " + left.length + "   distinct " + leftHashes.size);
    if (leftHashes.size < byHash.size) {
      console.log("  WARNING — an image lost every copy. Expected " + byHash.size + " distinct.");
    }
  }

  await mongoose.disconnect();
  if (sec) await sec.close();
  process.exit(0);
}

main().catch((e) => { console.error("FAILED: " + e.message); process.exit(1); });
