/**
 * Rewrite the `linx.*` product metafields for one brand, straight to Shopify.
 *
 * The products already exist in Shopify with their images, variants and
 * description — only the metafields are wrong or missing:
 *
 *   - they were first written with no definition in place, so the Storefront
 *     API reads them back inconsistently
 *   - `attributes`, `product_sections`, `technical_drawings`, `features`,
 *     `tier_prices` and `rrp_inc_vat` were never written at all
 *
 * Writing them again now that the definitions exist lands each value in the
 * defined state immediately, instead of waiting on Shopify's backfill. This is
 * deliberately NOT a full product sync: no media reconcile, no variant rebuild,
 * so it costs minutes rather than hours and cannot disturb the gallery.
 *
 * Env:
 *   BRAND=name   brand to backfill (default "Pooky")
 *   LIMIT=n      only the first n products
 *   DRY_RUN=1    report what would be written, write nothing
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const BRAND = process.env.BRAND || "Pooky";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const DRY_RUN = process.env.DRY_RUN === "1";
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";

/** metafieldsSet accepts 25 metafields per call. */
const MAX_PER_CALL = 25;

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

async function admin(token, query, variables, attempt = 0) {
  const res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  // Cost-based throttling — back off rather than drop the batch.
  if (j.errors && attempt < 5) {
    await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    return admin(token, query, variables, attempt + 1);
  }
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

const gidOf = (id) =>
  String(id).startsWith("gid://") ? String(id) : `gid://shopify/Product/${id}`;

const hasContent = (v) =>
  v != null &&
  !(typeof v === "string" && !v.trim()) &&
  !(Array.isArray(v) && !v.length) &&
  !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);

/**
 * The same shape `buildLinxMetafields` produces, plus the six keys it has
 * never written. Empty values are skipped: this is a backfill, and writing
 * thousands of empty strings would burn the rate limit for nothing.
 */
function metafieldsFor(p) {
  const out = [];
  const text = (key, v, type = "single_line_text_field") => {
    if (hasContent(v)) out.push({ key, type, value: String(v) });
  };
  const json = (key, v) => {
    if (hasContent(v)) out.push({ key, type: "json", value: JSON.stringify(v) });
  };

  text("tagline", p.tagline);
  json("specs", p.specs);
  if (p.showSpecs != null) {
    out.push({ key: "show_specs", type: "boolean", value: String(!!p.showSpecs) });
  }
  text("schematic_image", p.schematicImage);
  text("sub_category", p.subCategory);
  text("installation_guide", p.installationGuide, "multi_line_text_field");
  text("insulating_set_price", p.insulatingSetPrice);
  json("flashing_finder", p.flashingFinder);
  json("finishes", p.finishes);
  json("flashings", p.flashings);

  // Never synced before today.
  json("attributes", p.attributes);
  json("product_sections", p.productSections);
  json("technical_drawings", p.technicalDrawings);
  json("features", p.features);
  json("tier_prices", p.tierPrices);
  text("rrp_inc_vat", p.rrpIncVat);

  // Configurator axes (Pooky). Mongo spells the last one wallFittings; the
  // metafield key is snake_case like every other key in the namespace.
  json("bases", p.bases);
  json("shades", p.shades);
  json("pendants", p.pendants);
  json("wall_fittings", p.wallFittings);

  json("efficiency", p.efficiency);
  json("dimension_rows", p.dimensionRows);
  json("review_summary", p.reviewSummary);
  json("size_options", p.sizeOptions);
  json("manuals", p.manuals);

  return out;
}

async function main() {
  const token = await adminToken();
  const { db } = await connectMongo();

  const brand = await db.collection("brands").findOne({ name: BRAND });
  if (!brand) throw new Error("brand not found: " + BRAND);

  // Project to just the metafield sources. Pooky products average 43 KB, so
  // fetching whole documents pulls ~156 MB across the wire for fields this
  // script never reads.
  const PROJECTION = {
    shopifyProductId: 1,
    tagline: 1,
    specs: 1,
    showSpecs: 1,
    schematicImage: 1,
    subCategory: 1,
    installationGuide: 1,
    insulatingSetPrice: 1,
    flashingFinder: 1,
    finishes: 1,
    flashings: 1,
    attributes: 1,
    productSections: 1,
    technicalDrawings: 1,
    features: 1,
    tierPrices: 1,
    rrpIncVat: 1,
    bases: 1,
    shades: 1,
    pendants: 1,
    wallFittings: 1,
    efficiency: 1,
    dimensionRows: 1,
    reviewSummary: 1,
    sizeOptions: 1,
    manuals: 1,
  };

  let cursor = db
    .collection("products")
    .find({ brand: brand._id, shopifyProductId: { $nin: [null, ""] } })
    .project(PROJECTION);
  if (LIMIT !== Infinity) cursor = cursor.limit(LIMIT);
  const products = await cursor.toArray();

  console.log(BRAND + ": " + products.length + " linked products");
  if (DRY_RUN) console.log("mode: DRY RUN\n");

  // Flatten to one queue of {ownerId, key, type, value}, then pack into calls.
  const queue = [];
  const perProduct = [];
  for (const p of products) {
    const mfs = metafieldsFor(p);
    perProduct.push(mfs.length);
    for (const m of mfs) {
      queue.push({
        ownerId: gidOf(p.shopifyProductId),
        namespace: "linx",
        key: m.key,
        type: m.type,
        value: m.value,
      });
    }
  }

  const keyCounts = new Map();
  for (const q of queue) keyCounts.set(q.key, (keyCounts.get(q.key) || 0) + 1);
  console.log("metafields to write: " + queue.length);
  for (const [k, c] of [...keyCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log("  " + k.padEnd(24) + c);
  }
  const avg = perProduct.length
    ? (perProduct.reduce((a, b) => a + b, 0) / perProduct.length).toFixed(1)
    : 0;
  console.log("  (avg " + avg + " per product)\n");

  if (DRY_RUN) {
    console.log("[dry] " + Math.ceil(queue.length / MAX_PER_CALL) + " API calls would be made");
    process.exit(0);
  }

  let written = 0;
  let failed = 0;
  const started = Date.now();

  for (let i = 0; i < queue.length; i += MAX_PER_CALL) {
    const slice = queue.slice(i, i + MAX_PER_CALL);
    try {
      const d = await admin(
        token,
        `mutation($mf: [MetafieldsSetInput!]!) {
           metafieldsSet(metafields: $mf) {
             metafields { key }
             userErrors { field message }
           }
         }`,
        { mf: slice },
      );
      const errs = d.metafieldsSet.userErrors || [];
      if (errs.length) {
        failed += errs.length;
        if (failed <= 5) {
          console.log("  errors: " + errs.map((e) => e.message).slice(0, 2).join("; ").slice(0, 160));
        }
      }
      written += (d.metafieldsSet.metafields || []).length;
    } catch (e) {
      failed += slice.length;
      if (failed <= 50) console.log("  call failed: " + String(e.message).slice(0, 140));
    }

    const done = i + slice.length;
    if (done % 500 < MAX_PER_CALL || done >= queue.length) {
      const rate = done / ((Date.now() - started) / 1000);
      const left = Math.round((queue.length - done) / Math.max(rate, 0.01) / 60);
      console.log("  " + done + "/" + queue.length + "  written " + written +
        "  failed " + failed + "  ~" + left + "m left");
    }
  }

  console.log("\ndone — wrote " + written + " metafields, " + failed + " failed");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
