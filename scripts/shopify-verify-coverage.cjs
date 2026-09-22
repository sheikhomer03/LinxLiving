/**
 * Prove, per product, whether what Mongo holds also exists in Shopify.
 *
 * This is the gate before trimming anything. Trimming deletes a field from the
 * Mongo document on the assumption Shopify can serve it instead — so every
 * field has to be checked, not assumed, and a field with no Shopify home at
 * all has to be named rather than silently dropped.
 *
 * Reports three groups:
 *   COVERED    present in Mongo and present in Shopify -> safe to trim
 *   MISSING    present in Mongo, absent in Shopify     -> NOT safe
 *   UNMAPPED   nothing in the sync writes it anywhere  -> NOT safe, ever
 *
 * Env:
 *   BRAND=name   brand to verify (default "Pooky")
 *   LIMIT=n      only the first n products (default: all)
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
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
const BATCH = 50;

/** Mongo field -> where it should be in Shopify. */
const MAPPED = [
  ["description", "native:descriptionHtml"],
  ["images", "native:images"],
  ["variants", "native:variants"],
  ["specs", "mf:specs"],
  ["attributes", "mf:attributes"],
  ["productSections", "mf:product_sections"],
  ["technicalDrawings", "mf:technical_drawings"],
  ["features", "mf:features"],
  ["tierPrices", "mf:tier_prices"],
  ["rrpIncVat", "mf:rrp_inc_vat"],
  ["tagline", "mf:tagline"],
  ["schematicImage", "mf:schematic_image"],
  ["installationGuide", "mf:installation_guide"],
  ["flashingFinder", "mf:flashing_finder"],
  ["finishes", "mf:finishes"],
  ["flashings", "mf:flashings"],
  ["bases", "mf:bases"],
  ["shades", "mf:shades"],
  ["pendants", "mf:pendants"],
  ["wallFittings", "mf:wall_fittings"],
  ["efficiency", "mf:efficiency"],
  ["dimensionRows", "mf:dimension_rows"],
  ["reviewSummary", "mf:review_summary"],
  ["sizeOptions", "mf:size_options"],
  ["manuals", "mf:manuals"],
];

/**
 * Heavy fields nothing in the sync writes to Shopify. If a product has one of
 * these, trimming it destroys the data outright — there is nowhere to read it
 * back from.
 */
const UNMAPPED_CANDIDATES = [
  "colorOptions", "swatchGroups", "downloads",
  "filesDocumentation", "brochures", "installerGuides",
  "addonGroups", "nestedOptions", "optionElements", "optionInfo",
  "infoDropdowns", "doTheJobRight", "usage", "suitability", "delivery",
  "pergolaSizeRows", "coverage",
  "materialAndCare", "maintenance", "finishGuide", "typeOptions",
  "badges", "promoBanner", "featureEntries", "packingEntries",
  "shopifyOptions", "videos", "externalVideos", "caseStudies",
  "generalSpecification", "drawingEntries", "warrantyFiles",
  "responsibilityAndCompliance", "productRange",
];

const MF_KEYS = MAPPED.filter(([, t]) => t.startsWith("mf:")).map(([, t]) => t.slice(3));
const IDENT = MF_KEYS.map((k) => `{namespace: "linx", key: "${k}"}`).join(", ");

const has = (v) =>
  v != null &&
  !(typeof v === "string" && !v.trim()) &&
  !(Array.isArray(v) && !v.length) &&
  !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) &&
  !(typeof v === "number" && Number.isNaN(v));

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

async function admin(token, query, variables, attempt = 0) {
  const res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors && attempt < 5) {
    await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    return admin(token, query, variables, attempt + 1);
  }
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

const gidOf = (id) =>
  String(id).startsWith("gid://") ? String(id) : `gid://shopify/Product/${id}`;

async function main() {
  const token = await adminToken();
  const { db } = await connectMongo();

  const brand = await db.collection("brands").findOne({ name: BRAND });
  if (!brand) throw new Error("brand not found: " + BRAND);

  // Only the fields this script actually compares. Without a projection a
  // brand like Pooky pulls ~156 MB of product documents across the wire to
  // read a couple of dozen keys.
  const PROJECTION = { shopifyProductId: 1 };
  for (const [field] of MAPPED) PROJECTION[field] = 1;
  for (const field of UNMAPPED_CANDIDATES) PROJECTION[field] = 1;

  const total = await db
    .collection("products")
    .countDocuments({ brand: brand._id, shopifyProductId: { $nin: [null, ""] } });

  console.log(
    BRAND + ": verifying " + (LIMIT === Infinity ? total : Math.min(LIMIT, total)) +
      " products\n",
  );

  // inMongo[field] = count of products holding it
  // inShopify[field] = count of those that also have it in Shopify
  const inMongo = new Map();
  const inShopify = new Map();
  const unmappedHits = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

  let notFound = 0;
  let draft = 0;
  let checked = 0;
  let batchErrors = 0;

  /**
   * Paged by _id rather than held open as one cursor.
   *
   * A single cursor over a whole brand stays open for as long as the Shopify
   * round trips take, and Atlas expires an idle cursor after ten minutes —
   * which killed an earlier run mid-verification. Each page is its own short
   * query, so nothing is left open while Shopify is being called.
   */
  const target = LIMIT === Infinity ? total : Math.min(LIMIT, total);
  let lastId = null;
  let remaining = target;

  while (remaining > 0) {
    const q = { brand: brand._id, shopifyProductId: { $nin: [null, ""] } };
    if (lastId) q._id = { $gt: lastId };
    const slice = await db
      .collection("products")
      .find(q)
      .project(PROJECTION)
      .sort({ _id: 1 })
      .limit(Math.min(BATCH, remaining))
      .toArray();
    if (!slice.length) break;
    lastId = slice[slice.length - 1]._id;
    remaining -= slice.length;

    let byGid = new Map();
    try {
      const d = await admin(
        token,
        `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product {
            id status
            descriptionHtml
            images(first: 100) { nodes { url } }
            variants(first: 100) { nodes { id } }
            metafields(first: 50, namespace: "linx") { nodes { key value } }
        } } }`,
        { ids: slice.map((p) => gidOf(p.shopifyProductId)) },
      );
      for (const n of d.nodes || []) if (n && n.id) byGid.set(n.id, n);
    } catch (e) {
      batchErrors += 1;
      console.log("  batch error: " + String(e.message).slice(0, 120));
    }

    for (const p of slice) {
      checked += 1;
      const sp = byGid.get(gidOf(p.shopifyProductId));
      if (!sp) { notFound += 1; continue; }
      if (sp.status === "DRAFT") draft += 1;

      const mfs = new Map();
      for (const m of (sp.metafields && sp.metafields.nodes) || []) {
        if (m && m.key) mfs.set(m.key, m.value);
      }

      for (const [field, target] of MAPPED) {
        if (!has(p[field])) continue;
        bump(inMongo, field);
        let ok = false;
        if (target === "native:descriptionHtml") ok = has(sp.descriptionHtml);
        else if (target === "native:images") ok = (sp.images.nodes || []).length > 0;
        else if (target === "native:variants") ok = (sp.variants.nodes || []).length > 0;
        else ok = has(mfs.get(target.slice(3)));
        if (ok) bump(inShopify, field);
      }

      for (const f of UNMAPPED_CANDIDATES) {
        if (has(p[f])) bump(unmappedHits, f);
      }
    }

    if (checked % 500 < BATCH || remaining <= 0) {
      console.log("  " + checked + "/" + target + " checked");
    }
  }

  console.log("\n" + "=".repeat(68));
  console.log("COVERAGE — " + BRAND + "  (" + checked + " products, " +
    notFound + " not in Shopify, " + draft + " DRAFT)");
  console.log("=".repeat(68));

  const safe = [];
  const unsafe = [];
  console.log("\n  field".padEnd(28) + "inMongo".padStart(9) + "inShopify".padStart(11) + "  verdict");
  console.log("  " + "-".repeat(62));
  for (const [field] of MAPPED) {
    const m = inMongo.get(field) || 0;
    if (!m) continue;
    const s = inShopify.get(field) || 0;
    const full = s === m;
    (full ? safe : unsafe).push(field);
    console.log(
      "  " + field.padEnd(26) + String(m).padStart(9) + String(s).padStart(11) +
      "  " + (full ? "SAFE" : "NOT SAFE (" + (m - s) + " missing)"),
    );
  }

  if (unmappedHits.size) {
    console.log("\n  UNMAPPED — in Mongo, nothing syncs these to Shopify:");
    for (const [f, c] of [...unmappedHits.entries()].sort((a, b) => b[1] - a[1])) {
      console.log("    " + f.padEnd(28) + c + " products");
    }
  }

  /**
   * A verification that checked nothing must never read as a pass.
   *
   * An earlier version of this script reported "safe to trim" after every
   * Shopify batch had errored: with no data, no field failed, so the verdict
   * came out clean. Silence is not evidence — anything that stopped a product
   * from being compared invalidates the whole run.
   */
  const blockers = [];
  if (batchErrors) blockers.push(batchErrors + " Shopify batch(es) failed");
  if (notFound) blockers.push(notFound + " product(s) not found in Shopify");
  if (!inMongo.size) blockers.push("no fields were compared at all");
  if (unsafe.length) blockers.push(unsafe.length + " mapped field(s) incomplete");
  if (unmappedHits.size) blockers.push(unmappedHits.size + " field(s) have no Shopify home");

  console.log("");
  if (blockers.length) {
    console.log("  VERDICT: DO NOT TRIM");
    for (const b of blockers) console.log("    - " + b);
  } else {
    console.log("  VERDICT: every populated field is present in Shopify for all " +
      checked + " products — trimming those fields is safe");
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
