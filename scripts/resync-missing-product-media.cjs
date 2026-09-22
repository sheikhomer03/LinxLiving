/**
 * Upload the images Shopify never received, for products already synced.
 *
 * 1,395 products hold images with no `shopifyImages` pair — 7,315 entries in
 * all. Most are Drench, where the original sync capped media at 12 per
 * product; the rest are older syncs that stopped short for their own reasons.
 * Those images exist only on the source host, so the storefront falls back off
 * Shopify's CDN for them.
 *
 * This adds the missing media to the EXISTING Shopify product (it does not
 * create products), then records the new pairs. Products with no
 * shopifyProductId are skipped — they need creating first, which is a
 * different job.
 *
 * Shopify fetches each URL itself and processes asynchronously, so the pairing
 * pass runs separately once the files are ready: re-run with PAIR_ONLY=1.
 *
 * Env:
 *   DRY_RUN=1    report only
 *   BRAND=name   limit to one brand
 *   LIMIT=n      cap products processed
 *   PAIR_ONLY=1  skip uploading; only re-read media and rebuild pairs
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const PAIR_ONLY = process.env.PAIR_ONLY === "1";
const BRAND = process.env.BRAND || "";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const D = process.env.SHOPIFY_STORE_DOMAIN;
const V = process.env.SHOPIFY_API_VERSION || "2025-07";
const PAGE = 40;

let token = null;
const bare = (u) => String(u || "").split("?")[0];
const gidOf = (id) =>
  String(id).startsWith("gid://") ? String(id) : `gid://shopify/Product/${id}`;

async function adminToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const r = await fetch(`https://${D}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("token exchange failed");
  return j.access_token;
}

async function admin(query, variables, attempt = 0) {
  try {
    const r = await fetch(`https://${D}/admin/api/${V}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(45000),
    });
    const j = await r.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 180));
    return j.data;
  } catch (e) {
    if (attempt >= 5) throw e;
    await new Promise((res) => setTimeout(res, 1500 * Math.pow(2, attempt)));
    return admin(query, variables, attempt + 1);
  }
}

/** A URL Shopify will accept: a real image file, not a directory. */
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/i;
const usable = (u) => IMAGE_EXT.test(bare(u).split("/").pop() || "");

const MEDIA_Q = `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product {
  id media(first: 100) { nodes { ... on MediaImage { id image { url } } } } } } }`;

async function main() {
  token = await adminToken();
  const { db } = await connectMongo();
  const P = db.collection("products");

  const filter = { "images.0": { $exists: true }, shopifyProductId: { $nin: [null, ""] } };
  if (BRAND) {
    const b = await db.collection("brands").findOne({ name: BRAND });
    if (!b) throw new Error("brand not found: " + BRAND);
    filter.brand = b._id;
  }

  console.log(PAIR_ONLY ? "mode: PAIR ONLY (no uploads)" : "mode: upload missing media + pair");
  if (DRY_RUN) console.log("DRY RUN - nothing will be written");
  console.log("");

  let scanned = 0, needing = 0, uploaded = 0, paired = 0, failed = 0, skipped = 0;
  let lastId = null;

  while (needing < LIMIT) {
    const q = Object.assign({}, filter);
    if (lastId) q._id = { $gt: lastId };
    const page = await P.find(q)
      .project({ images: 1, shopifyImages: 1, shopifyProductId: 1, name: 1 })
      .sort({ _id: 1 })
      .limit(PAGE)
      .toArray();
    if (!page.length) break;

    // Which of these actually have unpaired images?
    const work = [];
    for (const p of page) {
      lastId = p._id;
      scanned += 1;
      const imgs = (p.images || []).filter(Boolean).filter(usable);
      const have = new Set(
        (p.shopifyImages || []).filter((s) => s && s.shopifyUrl).map((s) => bare(s.sourceUrl)),
      );
      const missing = imgs.filter((u) => !have.has(bare(u)));
      if (missing.length) work.push({ p, missing });
    }
    if (!work.length) continue;
    needing += work.length;

    if (!PAIR_ONLY) {
      for (const { p, missing } of work) {
        if (DRY_RUN) {
          if (uploaded < 5) {
            console.log("  [dry] " + String(p.name).slice(0, 44) +
              "  +" + missing.length + " images");
          }
          uploaded += missing.length;
          continue;
        }
        try {
          const d = await admin(
            `mutation Add($productId: ID!, $media: [CreateMediaInput!]!) {
               productCreateMedia(productId: $productId, media: $media) {
                 media { ... on MediaImage { id } }
                 mediaUserErrors { field message }
               }
             }`,
            {
              productId: gidOf(p.shopifyProductId),
              media: missing.map((url) => ({
                originalSource: url,
                mediaContentType: "IMAGE",
                alt: String(p.name || "").slice(0, 120),
              })),
            },
          );
          const errs = d.productCreateMedia.mediaUserErrors || [];
          if (errs.length) {
            failed += 1;
            if (failed <= 8) {
              console.log("  FAIL " + String(p.name).slice(0, 40) + " -> " +
                errs.map((e) => e.message).join("; ").slice(0, 110));
            }
          } else {
            uploaded += (d.productCreateMedia.media || []).length;
          }
        } catch (e) {
          failed += 1;
          if (failed <= 8) console.log("  ERROR " + String(e.message).slice(0, 110));
        }
      }
    }

    // Re-read media and rebuild the pairing for this page.
    if (!DRY_RUN) {
      try {
        const d = await admin(MEDIA_Q, { ids: work.map((w) => gidOf(w.p.shopifyProductId)) });
        const byGid = new Map((d.nodes || []).filter(Boolean).map((n) => [n.id, n]));
        const ops = [];
        for (const { p } of work) {
          const sp = byGid.get(gidOf(p.shopifyProductId));
          const media = ((sp && sp.media && sp.media.nodes) || []).filter(
            (mm) => mm && mm.id && mm.image && mm.image.url,
          );
          if (!media.length) { skipped += 1; continue; }
          const sources = (p.images || []).filter(Boolean).filter(usable);
          const pairs = media.map((mm, i) => ({
            sourceUrl: sources[i] || "",
            shopifyUrl: mm.image.url,
            mediaId: mm.id,
            position: i,
          }));
          ops.push({
            updateOne: { filter: { _id: p._id }, update: { $set: { shopifyImages: pairs } } },
          });
          paired += 1;
        }
        if (ops.length) await P.bulkWrite(ops, { ordered: false });
      } catch (e) {
        console.log("  pairing batch failed: " + String(e.message).slice(0, 110));
      }
    }

    if (needing % 200 < PAGE) {
      console.log("  scanned " + scanned + "  needing " + needing +
        "  uploaded " + uploaded + "  paired " + paired + "  failed " + failed);
    }
  }

  console.log("");
  console.log((DRY_RUN ? "[dry] " : "") + "scanned " + scanned +
    ", products needing media " + needing +
    ", images uploaded " + uploaded +
    ", products re-paired " + paired +
    ", failed " + failed +
    ", no media yet " + skipped);
  if (!PAIR_ONLY && !DRY_RUN) {
    console.log("");
    console.log("Shopify processes media asynchronously. Re-run with PAIR_ONLY=1");
    console.log("in a few minutes to pair anything not ready yet.");
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
