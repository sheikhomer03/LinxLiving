/**
 * Create the Drench catalogue in Shopify, product by product.
 *
 * The other brands reached Shopify through the admin dual-write; Drench was
 * imported straight into Mongo with the raw driver, so nothing was ever
 * pushed. This walks the brand and creates each product with its media,
 * variant pricing and `linx.*` metafields, then records the returned GIDs back
 * on the Mongo document.
 *
 * Resumable: a product that already carries a shopifyProductId is skipped, so
 * an interrupted run picks up where it stopped rather than duplicating.
 *
 * Env:
 *   LIMIT=n      only the first n unsynced products
 *   DRY_RUN=1    build the payloads and report, create nothing
 *   MAX_IMAGES=n images per product (default 12)
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const BRAND_NAME = "Drench";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const DRY_RUN = process.env.DRY_RUN === "1";
const MAX_IMAGES = Number(process.env.MAX_IMAGES) || 12;
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
  if (!(Number(p.price) > 0)) return "DRAFT";
  return clean(p.category) ? "ACTIVE" : "DRAFT";
}

async function createProduct(p) {
  const images = (p.images || []).filter(Boolean).slice(0, MAX_IMAGES);
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

async function main() {
  token = await adminToken();
  const { db } = await connectMongo();

  const brand = await db.collection("brands").findOne({ name: BRAND_NAME });
  if (!brand) throw new Error("brand not found: " + BRAND_NAME);

  const filter = {
    brand: brand._id,
    $or: [
      { shopifyProductId: null },
      { shopifyProductId: "" },
      { shopifyProductId: { $exists: false } },
    ],
  };
  const PROJECTION = {
    name: 1, description: 1, price: 1, images: 1, category: 1, subCategory: 1,
    specs: 1, attributes: 1, productSections: 1, technicalDrawings: 1,
    features: 1, tierPrices: 1, rrpIncVat: 1, supplierSku: 1, stock: 1,
  };

  const total = await db.collection("products").countDocuments(filter);
  const target = LIMIT === Infinity ? total : Math.min(LIMIT, total);
  console.log(BRAND_NAME + ": " + total + " products not yet in Shopify");
  console.log("creating: " + target + (DRY_RUN ? "  (DRY RUN)" : "") + "\n");
  if (!target) { console.log("nothing to do"); process.exit(0); }

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

    for (const p of page) {
      lastId = p._id;
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
  }

  console.log("\ndone — created " + created + ", failed " + failed);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
