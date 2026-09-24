/**
 * Create one brand's catalogue in Shopify, product by product.
 *
 * A generalisation of the Drench-only script this replaces. Two things
 * changed and both matter now that the catalogue spans two clusters:
 *
 *  - the brand is chosen with BRAND=<name>, not hard-coded;
 *  - products are read from whichever cluster holds the brand. Brands live
 *    in the primary and carry `dataCluster`; the old script always read
 *    products from the primary, which since the Drench migration finds
 *    nothing at all.
 *
 * Resumable: a product that already carries a shopifyProductId is skipped,
 * so an interrupted run resumes rather than duplicating.
 *
 * Env:
 *   BRAND=name   brand to push (default "Tile Mountain")
 *   LIMIT=n      only the first n unsynced products
 *   DRY_RUN=1    build the payloads and report, create nothing
 *   MAX_IMAGES=n images per product (default 50 — Shopify's own cap is 250;
 *              95 Walls and Floors products had 13-16 real images and the
 *              old default of 12 silently truncated them, needing a
 *              follow-up productCreateMedia pass to add the rest back)
 *   CONCURRENCY=n products created at once (default 6)
 *   RETRY_FAILED=1 only revisit products stamped with a sync error
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BRAND_NAME = process.env.BRAND || "Tile Mountain";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const DRY_RUN = process.env.DRY_RUN === "1";
const MAX_IMAGES = Number(process.env.MAX_IMAGES) || 50;
/*
 * Products are created in parallel because the bottleneck is the round trip,
 * not Shopify's rate limit: a create is two calls of a few points each, and
 * the store restores 100 points a second against a 2,000 bucket. One at a
 * time measured 2.4 products a minute — two days for this catalogue.
 */
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 6, 12));
const RETRY_FAILED = process.env.RETRY_FAILED === "1";
const FORCE_DRAFT = process.env.FORCE_DRAFT === "1";

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
const PAGE = 100;

let token = null;

async function adminToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  }
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

/**
 * One Admin call, with backoff.
 *
 * Retries cover both Shopify's cost-based throttling and the DNS blips this
 * machine throws on long runs — an ENOTFOUND mid-catalogue should cost one
 * product a retry, not abandon the remaining thousands.
 */
async function admin(query, variables, attempt = 0) {
  try {
    const res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
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

const clean = (s) => String(s || "").trim();
const hasContent = (v) =>
  v != null &&
  !(typeof v === "string" && !v.trim()) &&
  !(Array.isArray(v) && !v.length) &&
  !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);

function metafieldsFor(p) {
  const out = [];
  const json = (key, v) => {
    if (hasContent(v)) out.push({ namespace: "linx", key, type: "json", value: JSON.stringify(v) });
  };
  const text = (key, v, type = "single_line_text_field") => {
    if (hasContent(v)) out.push({ namespace: "linx", key, type, value: String(v) });
  };
  json("specs", p.specs);
  json("attributes", p.attributes);
  json("product_sections", p.productSections);
  json("technical_drawings", p.technicalDrawings);
  json("features", p.features);
  json("tier_prices", p.tierPrices);
  text("rrp_inc_vat", p.rrpIncVat);
  text("sub_category", p.subCategory);
  return out;
}

/** ACTIVE only when it is actually sellable, matching the existing rule. */
function statusFor(p) {
  // Opt-in only — every other invocation of this script keeps the existing
  // rule below. Used for a brand's first push, so nothing is purchasable
  // until it has been reviewed.
  if (FORCE_DRAFT) return "DRAFT";
  if (!(Number(p.price) > 0)) return "DRAFT";
  return clean(p.category) ? "ACTIVE" : "DRAFT";
}

/**
 * A URL Shopify will actually accept as product media.
 *
 * The capture picked up a handful of malformed entries whose whole filename
 * is "products" (a bare path plus resize query, no file). Shopify rejects
 * the entire product for those — "the specified directory name is reserved
 * and cannot be used" — which is what failed 45 Tap Warehouse products and
 * reads nothing like an image problem. TIFF is dropped for the same reason:
 * it is not a format Shopify serves.
 */
function usableImage(u) {
  const file = String(u || "").split("?")[0].split("/").pop();
  return /\.(jpe?g|png|webp|gif|avif)$/i.test(file);
}

async function createProduct(p) {
  const images = (p.images || []).filter(Boolean).filter(usableImage).slice(0, MAX_IMAGES);
  const media = images.map((url) => ({
    originalSource: url,
    mediaContentType: "IMAGE",
    alt: clean(p.name).slice(0, 120),
  }));

  const input = {
    title: clean(p.name) || "Untitled",
    descriptionHtml: String(p.description || ""),
    vendor: BRAND_NAME,
    productType: clean(p.category) || "",
    status: statusFor(p),
    tags: [BRAND_NAME, clean(p.category), clean(p.subCategory)].filter(Boolean),
    metafields: metafieldsFor(p),
    /*
     * Left unset, Shopify derives the handle from `title` alone — two
     * genuinely different products sharing an identical scraped title
     * (e.g. two size variants of the same range, "Country Farmhouse
     * Black Slate Tiles" 30x30 and 60x40) then collide on the SAME
     * handle, and the second one fails outright ("Handle has already
     * been taken"). `sourceHandle` is the supplier site's own URL slug —
     * guaranteed unique per product by construction — so using it
     * whenever present rules out this whole class of collision.
     */
    ...(p.sourceHandle ? { handle: String(p.sourceHandle) } : {}),
  };


  const d = await admin(
    `mutation Create($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
       productCreate(product: $product, media: $media) {
         product { id variants(first: 1) { nodes { id } } }
         userErrors { field message }
       }
     }`,
    { product: input, media },
  );

  const errs = d.productCreate.userErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; ").slice(0, 200));

  const product = d.productCreate.product;
  const variantId = product.variants.nodes[0] && product.variants.nodes[0].id;

  // productCreate makes a default variant with no price; set it separately.
  if (variantId && Number(p.price) > 0) {
    await admin(
      `mutation SetVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
         productVariantsBulkUpdate(productId: $productId, variants: $variants) {
           userErrors { field message }
         }
       }`,
      {
        productId: product.id,
        variants: [{
          id: variantId,
          price: String(Number(p.price).toFixed(2)),
          ...(p.supplierSku ? { inventoryItem: { sku: String(p.supplierSku) } } : {}),
        }],
      },
    );
  }

  return { productId: product.id, variantId };
}

/**
 * The database holding this brand's products.
 *
 * Brands are always in the primary — that is the routing registry — but
 * their products follow `dataCluster`.
 */
async function openBrandCluster() {
  const { db: primary } = await connectMongo();
  const brand = await primary.collection("brands").findOne({ name: BRAND_NAME });
  if (!brand) throw new Error("brand not found: " + BRAND_NAME);

  if (brand.dataCluster !== "secondary") {
    return { brand, db: primary, cluster: "primary", close: async () => {} };
  }

  const uri2 = process.env.MONGODB_URL2;
  if (!uri2) throw new Error(BRAND_NAME + " is on the secondary, but MONGODB_URL2 is not set");
  const conn = await mongoose
    .createConnection(uri2, { serverSelectionTimeoutMS: 30000 })
    .asPromise();
  return { brand, db: conn.db, cluster: "secondary", close: () => conn.close() };
}

async function main() {
  token = await adminToken();
  const { brand, db, cluster, close } = await openBrandCluster();
  console.log("brand   : " + BRAND_NAME + "  (cluster: " + cluster + ")");

  const filter = {
    brand: brand._id,
    $or: [
      { shopifyProductId: null },
      { shopifyProductId: "" },
      { shopifyProductId: { $exists: false } },
    ],
  };
  if (RETRY_FAILED) filter.shopifySyncError = { $nin: [null, ""] };
  const PROJECTION = {
    name: 1, description: 1, price: 1, images: 1, category: 1, subCategory: 1,
    specs: 1, attributes: 1, productSections: 1, technicalDrawings: 1,
    features: 1, tierPrices: 1, rrpIncVat: 1, supplierSku: 1, stock: 1,
    sourceHandle: 1,
  };

  const total = await db.collection("products").countDocuments(filter);
  const target = LIMIT === Infinity ? total : Math.min(LIMIT, total);
  console.log(BRAND_NAME + ": " + total + " products not yet in Shopify");
  console.log("creating: " + target + (DRY_RUN ? "  (DRY RUN)" : "") + "\n");
  if (!target) { console.log("nothing to do"); await close(); process.exit(0); }

  let created = 0, failed = 0, done = 0;
  const started = Date.now();
  let lastId = null;

  while (done < target) {
    const q = Object.assign({}, filter);
    if (lastId) q._id = { $gt: lastId };
    const page = await db.collection("products").find(q)
      .project(PROJECTION).sort({ _id: 1 })
      .limit(Math.min(PAGE, target - done)).toArray();
    if (!page.length) break;

    lastId = page[page.length - 1]._id;
    let cursor = 0;
    const worker = async () => {
      while (cursor < page.length) {
      const p = page[cursor++];
      done += 1;
      if (DRY_RUN) {
        created += 1;
        if (created <= 3) {
          console.log("  [dry] " + clean(p.name).slice(0, 56) +
            "  GBP " + p.price + "  imgs=" + (p.images || []).length +
            "  mf=" + metafieldsFor(p).length + "  " + statusFor(p));
        }
        continue;
      }
      try {
        const ids = await createProduct(p);
        await db.collection("products").updateOne(
          { _id: p._id },
          { $set: {
              shopifyProductId: ids.productId,
              shopifyVariantId: ids.variantId || null,
              shopifySyncError: null,
              shopifySyncedAt: new Date(),
          } },
        );
        created += 1;
      } catch (e) {
        failed += 1;
        const msg = String(e.message || e).slice(0, 180);
        await db.collection("products").updateOne(
          { _id: p._id }, { $set: { shopifySyncError: msg } },
        );
        if (failed <= 10) console.log("  FAIL " + clean(p.name).slice(0, 40) + " -> " + msg);
      }

      if (done % 50 === 0 || done >= target) {
        const rate = done / ((Date.now() - started) / 1000);
        const left = Math.round((target - done) / Math.max(rate, 0.001) / 60);
        console.log("  " + done + "/" + target + "  created " + created +
          "  failed " + failed + "  ~" + left + "m left");
      }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  console.log("\ndone — created " + created + ", failed " + failed);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
