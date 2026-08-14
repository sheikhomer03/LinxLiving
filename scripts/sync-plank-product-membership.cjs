/**
 * Give every Plank Hardware product the same sub-category membership it has
 * on plankhardware.com.
 *
 * `products.subCategory` holds one slug, so each product could sit in exactly
 * one sub-category while the live catalogue puts it in many — a knob is in
 * Knobs and Satin Brass and Kitchen and its design collection at once. That is
 * why 69 of 98 sub-categories read as empty. This fills `subCategories[]`
 * (added alongside, not replacing, `subCategory`) from the live site.
 *
 * Membership is resolved per sub-category kind:
 *   collection  /collections/x                → products.json, paged
 *   self        link back to the main         → products.json of that collection
 *   tag         /collections/x/2-finish-black → products.json of x filtered on
 *                                               the slugified Shopify tag
 *   filtered    /collections/x?filter.p.m…    → Shopify Section Rendering API,
 *                                               the only way to read a
 *                                               metafield-filtered result set
 *   product     /products/handle              → that one product
 *
 * Products are joined to the live catalogue on normalised name (verified 488
 * of 488) and stamped with `sourceHandle` so later runs can join on the handle.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-plank-product-membership.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-plank-product-membership.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-plank-product-membership.cjs --rollback <file.json>
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://plankhardware.com";
const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;
const GAP = Number(process.env.REQUEST_GAP_MS || 250);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LinxPlankMembership/1.0";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) =>
  String(s || "").toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();
const tagSlug = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function get(url, json, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA } });
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) { await delay(1000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return json ? await r.json() : await r.text();
    } catch {
      await delay(700 * (i + 1));
    }
  }
  return null;
}

const collCache = new Map();
async function collectionProducts(slug) {
  if (collCache.has(slug)) return collCache.get(slug);
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const j = await get(`${BASE}/collections/${slug}/products.json?limit=250&page=${page}`, true);
    if (j === null && page === 1) { collCache.set(slug, null); return null; }
    const batch = (j && j.products) || [];
    out.push(...batch);
    if (batch.length < 250) break;
    await delay(GAP);
  }
  collCache.set(slug, out);
  return out;
}

const sectionCache = new Map();
async function sectionId(collection) {
  if (sectionCache.has(collection)) return sectionCache.get(collection);
  const html = await get(`${BASE}/collections/${collection}`, false);
  const id = html ? (html.match(/data-section-id="([^"]*product-grid[^"]*)"/) || [])[1] || null : null;
  sectionCache.set(collection, id);
  return id;
}

/** Handles the live site shows for one sub-category row. */
async function liveHandles(menu) {
  const url = String(menu.url || "").trim();

  if (!url) {
    const list = await collectionProducts(menu.slug);
    return list === null ? null : list.map((p) => p.handle);
  }

  const product = url.match(/^\/products\/([^/?#]+)/);
  if (product) return [product[1]];

  const m = url.match(/^\/collections\/([^/?#]+)(\/([^?#]+))?(\?(.*))?$/);
  if (!m) return null;
  const [, base, , tag, , query] = m;

  if (tag) {
    const list = await collectionProducts(base);
    if (list === null) return null;
    const want = tagSlug(tag);
    return list.filter((p) => (p.tags || []).some((t) => tagSlug(t) === want)).map((p) => p.handle);
  }

  const filters = query
    ? [...new URLSearchParams(query)].filter(
        ([k, v]) => k.startsWith("filter.") && v && !k.startsWith("filter.v.price"),
      )
    : [];

  if (!filters.length) {
    const list = await collectionProducts(base);
    return list === null ? null : list.map((p) => p.handle);
  }

  // Metafield/taxonomy filters are invisible to products.json — ask the theme
  // to render the grid for exactly this URL and read the handles back. The
  // grid is paginated, so follow pages until one adds nothing new.
  const sid = await sectionId(base);
  if (!sid) return null;
  const qs = filters.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const found = new Set();
  for (let page = 1; page <= 20; page++) {
    const j = await get(
      `${BASE}/collections/${base}?${qs}&page=${page}&sections=${encodeURIComponent(sid)}`,
      true,
    );
    if (!j) break;
    const html = Object.values(j)[0] || "";
    const before = found.size;
    for (const m of html.matchAll(/\/products\/([a-z0-9-]+)/g)) found.add(m[1]);
    if (found.size === before) break;
    await delay(GAP);
  }
  return [...found];
}

(async () => {
  await connectMongo();
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  if (ROLLBACK) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    let n = 0;
    for (const p of data.products || []) {
      await productsCol.updateOne(
        { _id: new mongoose.Types.ObjectId(p._id) },
        { $set: { subCategories: p.subCategories || [], sourceHandle: p.sourceHandle || "" } },
      );
      n += 1;
    }
    console.log(`rolled back ${n} products`);
    await mongoose.disconnect();
    return;
  }

  const brand = await db.collection("brands").findOne({ name: /^plank hardware$/i });
  if (!brand) throw new Error("Plank Hardware brand not found");

  // Live catalogue, for the name -> handle join.
  const liveByName = new Map();
  for (let page = 1; page <= 20; page++) {
    const j = await get(`${BASE}/products.json?limit=250&page=${page}`, true);
    const batch = (j && j.products) || [];
    for (const p of batch) liveByName.set(norm(p.title), p.handle);
    if (batch.length < 250) break;
    await delay(GAP);
  }
  console.log(`live catalogue: ${liveByName.size} products`);

  const products = await productsCol
    .find({ brand: brand._id })
    .project({ name: 1, subCategory: 1, subCategories: 1, sourceHandle: 1 })
    .toArray();

  const byHandle = new Map();
  let unmatched = 0;
  for (const p of products) {
    const handle = liveByName.get(norm(p.name));
    if (!handle) { unmatched += 1; continue; }
    byHandle.set(handle, p);
  }
  console.log(`db products: ${products.length}   joined to a live handle: ${byHandle.size}   unmatched: ${unmatched}`);

  const menus = await db.collection("menus").find({ brand: brand._id }).toArray();
  const kids = menus.filter((m) => m.parent);
  // One resolve per distinct (slug, url); the same sub-category can appear
  // under two parents and must not be fetched twice.
  const targets = new Map();
  for (const k of kids) {
    const key = `${k.slug}::${k.url || ""}`;
    if (!targets.has(key)) targets.set(key, k);
  }
  console.log(`sub-categories to resolve: ${targets.size}\n`);

  const membership = new Map(); // product _id -> Set(slug)
  const perSub = [];
  let i = 0;
  for (const menu of targets.values()) {
    const handles = await liveHandles(menu);
    i += 1;
    if (handles === null) {
      perSub.push({ slug: menu.slug, live: null, matched: 0 });
      console.log(`${String(i).padStart(3)}/${targets.size}  ${menu.slug.padEnd(44)} UNRESOLVED`);
      await delay(GAP);
      continue;
    }
    let matched = 0;
    for (const h of handles) {
      const p = byHandle.get(h);
      if (!p) continue;
      matched += 1;
      const id = String(p._id);
      if (!membership.has(id)) membership.set(id, new Set());
      membership.get(id).add(menu.slug);
    }
    perSub.push({ slug: menu.slug, live: handles.length, matched });
    console.log(
      `${String(i).padStart(3)}/${targets.size}  ${menu.slug.padEnd(44)} live ${String(handles.length).padStart(4)}  matched ${String(matched).padStart(4)}`,
    );
    await delay(GAP);
  }

  const updates = [];
  for (const p of products) {
    const id = String(p._id);
    const want = [...(membership.get(id) || new Set())].sort();
    const have = [...(p.subCategories || [])].sort();
    const handle = liveByName.get(norm(p.name)) || "";
    const sameList = want.length === have.length && want.every((s, n) => s === have[n]);
    if (sameList && String(p.sourceHandle || "") === handle) continue;
    updates.push({ p, want, handle });
  }

  const sizes = updates.map((u) => u.want.length);
  const total = sizes.reduce((a, b) => a + b, 0);
  console.log(`\nproducts to update: ${updates.length}`);
  console.log(`membership rows to write: ${total}`);
  console.log(`per product — min ${Math.min(...sizes)}  max ${Math.max(...sizes)}  avg ${(total / (sizes.length || 1)).toFixed(1)}`);
  const orphan = updates.filter((u) => !u.want.length);
  console.log(`products in no sub-category at all: ${orphan.length}`);
  for (const o of orphan.slice(0, 10)) console.log(`   ? ${o.p.name}`);

  const unresolved = perSub.filter((s) => s.live === null);
  console.log(`\nsub-categories that could not be resolved: ${unresolved.length}`);
  for (const u of unresolved) console.log(`   ! ${u.slug}`);
  const empty = perSub.filter((s) => s.live === 0);
  console.log(`sub-categories the live site shows as empty: ${empty.length}`);
  for (const e of empty) console.log(`   - ${e.slug}`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const rollback = {
    products: updates.map((u) => ({
      _id: String(u.p._id),
      subCategories: u.p.subCategories || [],
      sourceHandle: u.p.sourceHandle || "",
    })),
  };

  const now = new Date();
  const ops = updates.map((u) => ({
    updateOne: {
      filter: { _id: u.p._id },
      update: { $set: { subCategories: u.want, sourceHandle: u.handle, updatedAt: now } },
    },
  }));
  for (let n = 0; n < ops.length; n += 200) {
    await productsCol.bulkWrite(ops.slice(n, n + 200), { ordered: false });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-plank-product-membership-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
  console.log(`\napplied: ${updates.length} products, ${total} membership rows\nrollback: ${file}`);

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
