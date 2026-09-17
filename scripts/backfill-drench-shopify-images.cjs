/**
 * Record the Shopify CDN URLs for Drench images.
 *
 * Every other brand reaches Shopify through `syncFullProductToShopify`, whose
 * media reconcile (`sync-media.ts`) builds a `{sourceUrl, shopifyUrl, mediaId,
 * position}` pair per image and writes it back as `shopifyImages`
 * (`sync-product-full.ts:283`). Drench was created by `shopify-sync-drench.cjs`,
 * which passed `media: [{originalSource}]` to `productCreate` and never read the
 * created nodes back — so Shopify holds the files, but Mongo never learned the
 * URLs it returned.
 *
 * This reads each synced Drench product's media from Shopify and records the
 * pairing. It deliberately does NOT overwrite `images`: the schema keeps the
 * source URL as the master and `productImage.ts` reads the pair to serve from
 * cdn.shopify.com, which is the convention every other brand follows.
 *
 * Env:
 *   DRY_RUN=1  report, write nothing
 *   LIMIT=n    only the first n products
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const BRAND_SLUG = "drench";
const D = process.env.SHOPIFY_STORE_DOMAIN;
const V = process.env.SHOPIFY_API_VERSION || "2025-07";
const BATCH = 40;

let token = null;

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
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
    return j.data;
  } catch (e) {
    if (attempt >= 5) throw e;
    await new Promise((res) => setTimeout(res, 1500 * Math.pow(2, attempt)));
    return admin(query, variables, attempt + 1);
  }
}

const gidOf = (id) =>
  String(id).startsWith("gid://") ? String(id) : `gid://shopify/Product/${id}`;

async function main() {
  token = await adminToken();
  const { db } = await connectMongo();

  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("brand not found: " + BRAND_SLUG);

  const filter = {
    brand: brand._id,
    shopifyProductId: { $nin: [null, ""] },
  };
  const total = await db.collection("products").countDocuments(filter);
  const target = LIMIT === Infinity ? total : Math.min(LIMIT, total);
  console.log("Drench products in Shopify : " + total);
  console.log("processing                 : " + target + (DRY_RUN ? "  (DRY RUN)" : ""));
  console.log("");

  let done = 0, written = 0, noMedia = 0, failed = 0, pairsTotal = 0;
  let lastId = null;

  while (done < target) {
    const q = Object.assign({}, filter);
    if (lastId) q._id = { $gt: lastId };
    const page = await db.collection("products")
      .find(q)
      .project({ shopifyProductId: 1, images: 1 })
      .sort({ _id: 1 })
      .limit(Math.min(BATCH, target - done))
      .toArray();
    if (!page.length) break;

    let nodes = [];
    try {
      const d = await admin(
        `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product {
           id
           media(first: 50) { nodes { ... on MediaImage { id image { url } } } }
         } } }`,
        { ids: page.map((p) => gidOf(p.shopifyProductId)) },
      );
      nodes = (d.nodes || []).filter(Boolean);
    } catch (e) {
      failed += page.length;
      done += page.length;
      lastId = page[page.length - 1]._id;
      console.log("  batch failed: " + String(e.message).slice(0, 120));
      continue;
    }

    const byGid = new Map(nodes.map((n) => [n.id, n]));
    const ops = [];

    for (const p of page) {
      lastId = p._id;
      done += 1;
      const sp = byGid.get(gidOf(p.shopifyProductId));
      const media = ((sp && sp.media && sp.media.nodes) || []).filter(
        (m) => m && m.id && m.image && m.image.url,
      );
      if (!media.length) { noMedia += 1; continue; }

      // Media came back in the order it was created, which was the order of
      // `images`, so index i pairs with images[i]. Where Shopify holds more
      // media than Mongo has sources (or fewer), pair only what lines up and
      // leave the source blank rather than invent one.
      const sources = Array.isArray(p.images) ? p.images : [];
      const pairs = media.map((m, i) => ({
        sourceUrl: sources[i] || "",
        shopifyUrl: m.image.url,
        mediaId: m.id,
        position: i,
      }));
      pairsTotal += pairs.length;

      if (!DRY_RUN) {
        ops.push({
          updateOne: {
            filter: { _id: p._id },
            update: { $set: { shopifyImages: pairs } },
          },
        });
      }
      written += 1;
    }

    if (ops.length) await db.collection("products").bulkWrite(ops, { ordered: false });

    if (done % 400 < BATCH || done >= target) {
      console.log("  " + done + "/" + target + "  paired " + written +
        "  no-media " + noMedia + "  failed " + failed);
    }
  }

  console.log("");
  console.log((DRY_RUN ? "[dry] " : "") + "products paired: " + written +
    ", image pairs: " + pairsTotal +
    ", without media: " + noMedia + ", failed: " + failed);
  if (!DRY_RUN && written) {
    const sample = await db.collection("products").findOne(
      { brand: brand._id, "shopifyImages.0": { $exists: true } },
      { projection: { name: 1, "shopifyImages": { $slice: 1 } } },
    );
    if (sample) {
      const s = sample.shopifyImages[0];
      console.log("");
      console.log("sample pair:");
      console.log("  sourceUrl : " + String(s.sourceUrl).slice(0, 78));
      console.log("  shopifyUrl: " + String(s.shopifyUrl).slice(0, 78));
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
