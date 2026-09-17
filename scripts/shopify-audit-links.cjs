/**
 * Audit every stored `shopifyProductId` against the live shop.
 *
 * The catalogue carries GIDs from a previous store, so a product can look
 * synced in Mongo while pointing at nothing — the storefront then asks Shopify
 * for a product that does not exist and silently gets back no price, no stock
 * and no metafields.
 *
 * Read-only by default. CLEAR=1 unsets the dead GIDs so the next sync creates
 * the product properly instead of trying to update a ghost.
 *
 * Env:
 *   CLEAR=1     unset shopifyProductId/shopifyVariantId on dead links
 *   BRAND=name  limit the audit to one brand
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const CLEAR = process.env.CLEAR === "1";
const BRAND = process.env.BRAND || "";
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
const BATCH = 200;

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
  // Cost-based throttling: back off and retry rather than lose the batch.
  if (j.errors && attempt < 5) {
    await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
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

  const filter = { shopifyProductId: { $nin: [null, ""] } };
  if (BRAND) {
    const b = await db.collection("brands").findOne({ name: BRAND });
    if (!b) throw new Error("brand not found: " + BRAND);
    filter.brand = b._id;
  }

  const rows = await db
    .collection("products")
    .find(filter)
    .project({ _id: 1, name: 1, brand: 1, shopifyProductId: 1 })
    .toArray();

  const brands = await db.collection("brands").find({}).project({ name: 1 }).toArray();
  const nameById = new Map(brands.map((b) => [String(b._id), b.name]));

  console.log("auditing " + rows.length + " linked products against " + DOMAIN + "\n");

  const dead = [];
  let checked = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const ids = slice.map((r) => gidOf(r.shopifyProductId));
    let alive = new Set();
    try {
      const d = await admin(
        token,
        `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id } } }`,
        { ids },
      );
      for (const n of d.nodes || []) if (n && n.id) alive.add(n.id);
    } catch (e) {
      console.log("  batch failed, treating as unknown: " + String(e.message).slice(0, 120));
      checked += slice.length;
      continue;
    }
    for (const r of slice) {
      if (!alive.has(gidOf(r.shopifyProductId))) dead.push(r);
    }
    checked += slice.length;
    if (checked % 2000 === 0 || checked === rows.length) {
      console.log("  " + checked + "/" + rows.length + " checked, " + dead.length + " dead so far");
    }
  }

  console.log("\nlive  : " + (rows.length - dead.length));
  console.log("dead  : " + dead.length);

  if (dead.length) {
    const byBrand = new Map();
    for (const d of dead) {
      const n = nameById.get(String(d.brand)) || "(none)";
      byBrand.set(n, (byBrand.get(n) || 0) + 1);
    }
    console.log("\ndead links by brand:");
    for (const [n, c] of [...byBrand.entries()].sort((a, b) => b[1] - a[1])) {
      console.log("  " + String(n).padEnd(26) + c);
    }
  }

  if (CLEAR && dead.length) {
    const ids = dead.map((d) => d._id);
    let cleared = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const r = await db.collection("products").updateMany(
        { _id: { $in: ids.slice(i, i + 500) } },
        {
          $set: {
            shopifyProductId: null,
            shopifyVariantId: null,
            shopifySyncError: "stale link cleared by audit",
          },
        },
      );
      cleared += r.modifiedCount;
    }
    console.log("\ncleared " + cleared + " stale links — a re-sync will recreate them");
  } else if (dead.length) {
    console.log("\nrun with CLEAR=1 to unset these so a re-sync recreates them");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
