/**
 * Remove one or more brands from the primary cluster, wholesale.
 *
 * Deletes, for the named brands only: their products, their menu rows
 * (categories + subcategories) and the brand records themselves. On Shopify
 * the products are ARCHIVED rather than deleted, so the store side stays
 * recoverable. Shopify collections are handled separately by
 * `delete-brand-collections.cjs`, which protects any collection a surviving
 * brand still points at.
 *
 * Generalised from the Britmet/Sterlingbuild removal: the brand list is the
 * only thing that differed, and hardcoding it made the next removal a
 * copy-paste of code whose guards matter.
 *
 * Every document is written to backups/ before anything is removed.
 *
 * Usage: BRANDS="Plank Hardware" node scripts/remove-brands.cjs [--apply]
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });

const dns = require("dns");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const SRV = (process.env.MONGODB_DNS_SERVERS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (SRV.length) dns.setServers(SRV);

const APPLY = process.argv.includes("--apply");
const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || "").trim();
/** Exact brand names, semicolon-separated, matched case-insensitively. */
const BRANDS = (process.env.BRANDS || "")
  .split(";")
  .map((x) => x.trim())
  .filter(Boolean);
if (!BRANDS.length) throw new Error('set BRANDS="Name" (semicolon-separated for several)');
/** Matched by lowercased exact name in JS — no regex to escape. */
const WANTED = new Set(BRANDS.map((n) => n.toLowerCase()));
const CHUNK = 25;

async function adminToken() {
  const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID || "",
      client_secret: process.env.SHOPIFY_CLIENT_SECRET || "",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`token failed (${res.status})`);
  return json.access_token;
}

const ARCHIVE = `mutation Archive($input: ProductInput!) {
  productUpdate(input: $input) { product { id status } userErrors { field message } }
}`;

async function archive(token, id) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await fetch(`https://${DOMAIN}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: ARCHIVE, variables: { input: { id, status: "ARCHIVED" } } }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    const json = await res.json();
    if (json.errors?.some((e) => e?.extensions?.code === "THROTTLED")) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    if (json.errors) return { ok: false, error: JSON.stringify(json.errors).slice(0, 200) };
    const ue = json.data?.productUpdate?.userErrors || [];
    if (ue.length) return { ok: false, error: ue.map((e) => e.message).join("; ") };
    return { ok: true };
  }
  return { ok: false, error: "throttled after 5 attempts" };
}

(async () => {
  if (!DOMAIN) throw new Error("SHOPIFY_STORE_DOMAIN missing");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("test");

  const brands = (await db.collection("brands").find({}).toArray()).filter((b) =>
    WANTED.has(String(b.name || "").trim().toLowerCase()),
  );
  if (brands.length !== BRANDS.length) {
    throw new Error(`expected ${BRANDS.length} brand(s), found ${brands.length} — aborting`);
  }
  const ids = brands.map((b) => b._id);

  const products = await db.collection("products").find({ brand: { $in: ids } }).toArray();
  const menus = await db.collection("menus").find({ brand: { $in: ids } }).toArray();

  // Fail closed: a scope that collapsed to nothing is a bug, not a clean run.
  if (!products.length) throw new Error("no products matched — aborting");

  // Guard against ever widening past these two brands.
  const stray = products.filter((p) => !ids.some((i) => String(i) === String(p.brand)));
  if (stray.length) throw new Error(`${stray.length} products outside the two brands — aborting`);

  const totalBefore = await db.collection("products").countDocuments({});
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} · brands ${brands.map((b) => b.name).join(", ")}`);
  console.log(`products ${products.length} · menus ${menus.length} · brands ${brands.length}`);
  console.log(`products collection before: ${totalBefore}`);

  if (!APPLY) {
    console.log("dry run — nothing written");
    await client.close();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const slug = BRANDS.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const file = path.join(dir, `${slug}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ brands, menus, products }, null, 1));
  console.log(`backup written: ${file} (${(fs.statSync(file).size / 1048576).toFixed(2)} MB)`);

  const token = await adminToken();
  let archived = 0;
  const failures = [];
  const withShopify = products.filter((p) => p.shopifyProductId);
  for (let i = 0; i < withShopify.length; i += CHUNK) {
    const slice = withShopify.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map((p) => archive(token, p.shopifyProductId)));
    results.forEach((r, k) => {
      if (r.ok) archived += 1;
      else failures.push({ id: slice[k].shopifyProductId, error: r.error });
    });
    process.stdout.write(`\r  archiving ${Math.min(i + CHUNK, withShopify.length)}/${withShopify.length} · ok ${archived} · failed ${failures.length}`);
  }
  console.log(`\nshopify archived ${archived}/${withShopify.length}`);
  if (failures.length) {
    console.log("failures (first 5):", JSON.stringify(failures.slice(0, 5)));
    throw new Error(`${failures.length} products failed to archive — database left untouched`);
  }

  const delProducts = await db.collection("products").deleteMany({ brand: { $in: ids } });
  const delMenus = await db.collection("menus").deleteMany({ brand: { $in: ids } });
  const delBrands = await db.collection("brands").deleteMany({ _id: { $in: ids } });
  console.log(`deleted · products ${delProducts.deletedCount} · menus ${delMenus.deletedCount} · brands ${delBrands.deletedCount}`);

  const totalAfter = await db.collection("products").countDocuments({});
  console.log(`products collection after: ${totalAfter} (expected ${totalBefore - products.length})`);
  if (totalAfter !== totalBefore - products.length) throw new Error("count mismatch — other data may have been affected");

  await client.close();
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
