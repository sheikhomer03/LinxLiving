/**
 * Fill in `shopifyImages[].shopifyUrl` after a bulk push.
 *
 * Shopify accepts an image upload and returns its MediaImage id immediately,
 * but processes the file afterwards — the CDN URL does not exist yet at the
 * moment of upload, so a bulk push records the id with an empty `shopifyUrl`.
 *
 * That empty string is not cosmetic. `withShopifyOptionImages` maps every
 * gallery entry to its Shopify copy and drops any without one, because the
 * storefront must serve images from Shopify's CDN rather than hotlink the
 * source. With no URL recorded, every image is filtered out and the product
 * renders with an empty gallery.
 *
 * This reads the ids back, asks Shopify what they resolved to, and records the
 * answer. It is safe to re-run: a pair that already has a URL is left alone,
 * and a media id Shopify no longer knows is reported rather than blanked.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/backfill-shopify-image-urls.cjs
 *
 *   BRAND="Floors4Trade"  only that brand (default: every product with a gap)
 *   DRY=1                 report what would change, write nothing
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const DRY = process.env.DRY === "1";
const BRAND = String(process.env.BRAND || "").trim();
const BATCH = 200;

async function getToken(domain, clientId, clientSecret) {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`token failed: ${JSON.stringify(json).slice(0, 200)}`);
  return json.access_token;
}

async function main() {
  const domain = String(process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const version = process.env.SHOPIFY_API_VERSION || "2025-07";
  const token =
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
    (await getToken(domain, process.env.SHOPIFY_CLIENT_ID, process.env.SHOPIFY_CLIENT_SECRET));

  const { db } = await connectMongo();
  const products = db.collection("products");

  const filter = { "shopifyImages.0": { $exists: true } };
  if (BRAND) {
    const brand = await db.collection("brands").findOne({ name: BRAND });
    if (!brand) throw new Error(`Brand "${BRAND}" not found`);
    filter.$or = [{ brand: brand._id }, { brands: brand._id }];
  }

  const docs = await products
    .find(filter)
    .project({ name: 1, images: 1, shopifyImages: 1 })
    .toArray();

  // Every media id still missing a URL, across every product.
  const wanted = new Set();
  for (const d of docs) {
    for (const p of d.shopifyImages || []) {
      if (!String(p?.shopifyUrl || "").trim() && String(p?.mediaId || "").startsWith("gid://")) {
        wanted.add(p.mediaId);
      }
    }
  }
  console.log(`${docs.length} product(s), ${wanted.size} media id(s) with no URL`);
  if (!wanted.size) return process.exit(0);

  const urlById = new Map();
  const ids = [...wanted];
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({
        query: `query ($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on MediaImage { id image { url } preview { image { url } } }
          }
        }`,
        variables: { ids: slice },
      }),
    });
    const json = await res.json();
    if (json.errors) {
      console.error(JSON.stringify(json.errors).slice(0, 300));
      throw new Error("GraphQL error");
    }
    for (const n of json?.data?.nodes || []) {
      const url = n?.image?.url || n?.preview?.image?.url || "";
      if (n?.id && url) urlById.set(n.id, url);
    }
    console.log(`  resolved ${urlById.size}/${ids.length}`);
    // Shopify's media pipeline is asynchronous; a file still processing simply
    // has no URL yet and is left for the next run rather than blanked.
    await new Promise((r) => setTimeout(r, 250));
  }

  let touched = 0, filled = 0, stillPending = 0;
  for (const d of docs) {
    const pairs = (d.shopifyImages || []).map((p) => ({ ...p }));
    let changed = false;
    for (const p of pairs) {
      if (String(p?.shopifyUrl || "").trim()) continue;
      const url = urlById.get(p?.mediaId);
      if (url) { p.shopifyUrl = url; filled += 1; changed = true; }
      else stillPending += 1;
    }
    if (!changed) continue;

    // The gallery itself follows the mirror: Shopify's copy where we have one,
    // the original kept only where we do not, so nothing silently disappears.
    const bySource = new Map(pairs.filter((p) => p.shopifyUrl).map((p) => [p.sourceUrl, p.shopifyUrl]));
    const images = (d.images || []).map((u) => bySource.get(u) || u);

    if (!DRY) {
      await products.updateOne(
        { _id: d._id },
        { $set: { shopifyImages: pairs, images, updatedAt: new Date() } },
      );
    }
    touched += 1;
  }

  console.log(
    `${DRY ? "[dry] " : ""}products updated ${touched}, urls filled ${filled}, still processing ${stillPending}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
