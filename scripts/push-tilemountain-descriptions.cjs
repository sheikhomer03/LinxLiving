/**
 * Push Tile Mountain's corrected descriptions and features to Shopify.
 *
 * The original sync sent what the first scrape had: the opening paragraph of
 * each description and, on many products, no key features. Re-reading their
 * own data payload recovered the rest, so Shopify is now behind our database
 * on 700-odd products.
 *
 * Deliberately narrow, in the same spirit as push-brand-titles: each mutation
 * carries `id` plus `descriptionHtml`, and the features metafield only where
 * there are features. Nothing else on the Shopify product — price, images,
 * status, options, tags — is named, so nothing else can be disturbed.
 *
 * Only products whose Shopify description actually differs are written, so a
 * second run is a no-op and an interrupted one resumes for free.
 *
 * Env:
 *   APPLY=1     commit (default is a dry run)
 *   BRAND=name  brand to push (default "Tile Mountain")
 *   LIMIT=n     only the first n products
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.env.APPLY === "1";
const BRAND_NAME = process.env.BRAND || "Tile Mountain";
const LIMIT = Number(process.env.LIMIT) || Infinity;
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

const READ = `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id descriptionHtml } } }`;
const WRITE = `
  mutation($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id }
      userErrors { field message }
    }
  }`;

/**
 * Compare the words, not the markup.
 *
 * Shopify re-serialises whatever HTML it is given, so a description that
 * round-trips comes back with different tags and a slightly different length
 * while saying exactly the same thing. Comparing the raw HTML therefore marks
 * every product as behind and would rewrite the whole catalogue for nothing.
 */
const normalise = (s) =>
  String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[\s ]+/g, " ")
    .trim();

async function main() {
  if (!DOMAIN) throw new Error("SHOPIFY_STORE_DOMAIN is not set");
  token = await adminToken();

  const conn = await connectMongo();
  const brand = await conn.db.collection("brands").findOne({ name: new RegExp("^" + BRAND_NAME + "$", "i") });
  if (!brand) throw new Error("brand not found: " + BRAND_NAME);
  const db =
    brand.dataCluster === "secondary"
      ? (await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 }).asPromise())
      : null;
  const P = (db ? db.db : conn.db).collection("products");

  const docs = await P.find({ brand: brand._id, shopifyProductId: { $nin: ["", null] } })
    .project({ _id: 1, name: 1, description: 1, features: 1, shopifyProductId: 1 })
    .limit(LIMIT === Infinity ? 0 : LIMIT)
    .toArray();

  console.log("brand    : " + brand.name + "  (" + brand.dataCluster + ")");
  console.log("in shopify: " + docs.length + (APPLY ? "" : "   (DRY RUN — pass APPLY=1 to commit)"));
  console.log("");

  const gid = (id) => (String(id).startsWith("gid://") ? String(id) : `gid://shopify/Product/${id}`);

  /* Read current descriptions back in pages, so only real drift is written. */
  const stale = [];
  const started = Date.now();
  for (let i = 0; i < docs.length; i += 50) {
    const batch = docs.slice(i, i + 50);
    const data = await admin(READ, { ids: batch.map((d) => gid(d.shopifyProductId)) });
    const live = new Map(
      (data.nodes || []).filter(Boolean).map((n) => [String(n.id), String(n.descriptionHtml || "")]),
    );
    for (const d of batch) {
      const ours = String(d.description || "");
      const theirs = live.get(gid(d.shopifyProductId));
      if (theirs == null) continue;
      if (normalise(ours) !== normalise(theirs)) stale.push({ d, was: theirs });
    }
    if ((i + 50) % 500 === 0 || i + 50 >= docs.length) {
      const done = Math.min(i + 50, docs.length);
      const left = Math.round(((Date.now() - started) / done) * (docs.length - done) / 60000);
      console.log("  read " + done + "/" + docs.length + "   behind: " + stale.length + "   ~" + left + "m left");
    }
  }

  console.log("");
  console.log("products whose Shopify copy is behind : " + stale.length);
  for (const s of stale.slice(0, 3)) {
    console.log(
      "   " + s.d.name.slice(0, 46).padEnd(48) +
      "shopify " + normalise(s.was).length + " chars -> ours " + normalise(s.d.description).length,
    );
  }
  console.log("");

  if (!APPLY) {
    console.log("dry run : nothing written");
  } else {
    /* Journal what Shopify held, so the store side is reversible. */
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rollback = path.join(__dirname, "..", `rollback-${brand.slug || "brand"}-descriptions-${stamp}.json`);
    fs.writeFileSync(
      rollback,
      JSON.stringify(stale.map((s) => ({ id: gid(s.d.shopifyProductId), descriptionHtml: s.was })), null, 1),
    );
    console.log("rollback journal: " + rollback);

    let ok = 0, failed = 0;
    for (let i = 0; i < stale.length; i++) {
      const { d } = stale[i];
      const input = { id: gid(d.shopifyProductId), descriptionHtml: String(d.description || "") };
      if ((d.features || []).length) {
        input.metafields = [
          {
            namespace: "linx",
            key: "features",
            type: "json",
            value: JSON.stringify(d.features),
          },
        ];
      }
      try {
        const out = await admin(WRITE, { input });
        const errs = out?.productUpdate?.userErrors || [];
        if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
        ok += 1;
      } catch (e) {
        failed += 1;
        console.log("  FAIL " + d.name.slice(0, 44) + " -> " + e.message.slice(0, 120));
      }
      if ((i + 1) % 100 === 0) console.log("  " + (i + 1) + "/" + stale.length + "  ok " + ok + "  failed " + failed);
    }
    console.log("");
    console.log("updated : " + ok + "   failed: " + failed);
    if (failed) console.log("INCOMPLETE — " + failed + " product(s) still hold the old copy.");
  }

  await mongoose.disconnect();
  if (db) await db.close();
  process.exit(0);
}

main().catch((e) => { console.error("FAILED: " + e.message); process.exit(1); });
