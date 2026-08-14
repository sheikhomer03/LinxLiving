/**
 * Live product count for every Plank sub-category, in every group of every
 * main category, compared with what the DB holds.
 *
 * Sub-categories are not all plain collections, so counting differs by kind:
 *   collection  /collections/x                → products.json, paged
 *   self        link back to the main         → products.json of that collection
 *   tag         /collections/x/2-finish-black → products.json of x, filtered on
 *                                               the slugified Shopify tag
 *                                               ("2. Finish>Black")
 *   filtered    /collections/x?filter.p.m…    → Shopify's own facet counts,
 *                                               read off the collection page;
 *                                               products.json cannot filter
 *   product     /products/handle              → exactly 1
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-plank-nav-products.cjs
 *   REPORT=path.json
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://plankhardware.com";
const GAP = Number(process.env.REQUEST_GAP_MS || 250);
const REPORT = process.env.REPORT || path.join(__dirname, "_tmp-plank-nav-products.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LinxPlankNavAudit/1.0";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
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

const productCache = new Map();
async function collectionProducts(slug) {
  if (productCache.has(slug)) return productCache.get(slug);
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const j = await get(`${BASE}/collections/${slug}/products.json?limit=250&page=${page}`, true);
    if (j === null && page === 1) { productCache.set(slug, null); return null; }
    const batch = (j && j.products) || [];
    out.push(...batch);
    if (batch.length < 250) break;
    await delay(GAP);
  }
  productCache.set(slug, out);
  return out;
}

/** name+value -> count, from the facet checkboxes Shopify renders. */
const facetCache = new Map();
async function facets(slug) {
  if (facetCache.has(slug)) return facetCache.get(slug);
  const html = await get(`${BASE}/collections/${slug}`, false);
  const map = new Map();
  if (html) {
    const rx = /<input\s+name="(filter\.[^"]+)"\s+value="([^"]*)"[^>]*>([\s\S]*?)<\/li>/g;
    for (const m of html.matchAll(rx)) {
      const text = m[3].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const n = text.match(/(\d+)\s*$/);
      if (!n) continue;
      // Facet values carry raw gids and stray percent signs; index both forms.
      let decoded = m[2];
      try {
        decoded = decodeURIComponent(m[2]);
      } catch {
        /* value is not percent-encoded — use it verbatim */
      }
      map.set(`${m[1]}::${decoded}`, Number(n[1]));
      map.set(`${m[1]}::${m[2]}`, Number(n[1]));
    }
  }
  facetCache.set(slug, map);
  return map;
}

/** How many products the live site shows for one sub-category row. */
async function liveCount(menu) {
  const url = String(menu.url || "").trim();
  if (!url) {
    const list = await collectionProducts(menu.slug);
    return { kind: "collection", live: list === null ? null : list.length };
  }
  const product = url.match(/^\/products\/([^/?#]+)/);
  if (product) return { kind: "product", live: 1 };

  const m = url.match(/^\/collections\/([^/?#]+)(\/([^?#]+))?(\?(.*))?$/);
  if (!m) return { kind: "unknown", live: null };
  const base = m[1];
  const tag = m[3];
  const query = m[5];

  if (tag) {
    const list = await collectionProducts(base);
    if (list === null) return { kind: "tag", live: null };
    const want = tagSlug(tag);
    return {
      kind: "tag",
      live: list.filter((p) => (p.tags || []).some((t) => tagSlug(t) === want)).length,
    };
  }

  if (query) {
    const params = [...new URLSearchParams(query)].filter(
      ([k, v]) => k.startsWith("filter.") && v && !k.startsWith("filter.v.price"),
    );
    if (!params.length) {
      const list = await collectionProducts(base);
      return { kind: "self", live: list === null ? null : list.length };
    }
    const map = await facets(base);
    let live = null;
    const missed = [];
    for (const [k, v] of params) {
      const hit = map.get(`${k}::${v}`);
      if (hit === undefined) missed.push(`${k}=${v}`);
      else live = live === null ? hit : Math.min(live, hit);
    }
    return { kind: "filtered", live, missed };
  }

  const list = await collectionProducts(base);
  return { kind: "self", live: list === null ? null : list.length };
}

(async () => {
  await connectMongo();
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ name: /^plank hardware$/i });

  const menus = await db.collection("menus").find({ brand: brand._id }).toArray();
  const byId = new Map(menus.map((m) => [String(m._id), m]));
  const tops = menus.filter((m) => !m.parent).sort((a, b) => a.order - b.order);
  const kids = menus.filter((m) => m.parent);

  const products = await db
    .collection("products")
    .find({ brand: brand._id })
    .project({ name: 1, subCategory: 1 })
    .toArray();
  const dbBySub = new Map();
  for (const p of products) {
    const s = String(p.subCategory || "").trim();
    if (s) dbBySub.set(s, (dbBySub.get(s) || 0) + 1);
  }

  const rows = [];
  let done = 0;
  for (const t of tops) {
    const mine = kids
      .filter((k) => String(k.parent) === String(t._id))
      .sort((a, b) => a.order - b.order);
    for (const c of mine) {
      const res = await liveCount(c);
      rows.push({
        main: t.name,
        group: c.group || "",
        name: c.name,
        slug: c.slug,
        url: c.url || "",
        kind: res.kind,
        live: res.live,
        db: dbBySub.get(c.slug) || 0,
        missed: res.missed || [],
      });
      done += 1;
      process.stdout.write(
        `${String(done).padStart(3)}/${kids.length}  ${t.name} › ${c.group} › ${c.name}`.padEnd(78) +
          `  ${res.kind.padEnd(10)} live ${String(res.live === null ? "?" : res.live).padStart(4)}\n`,
      );
      await delay(GAP);
    }
  }

  fs.writeFileSync(REPORT, JSON.stringify({ rows }, null, 2));
  console.log(`\nwrote ${REPORT}`);

  const byKind = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  console.log(`\nsub-categories: ${rows.length}  ${JSON.stringify(byKind)}`);
  console.log(`live count unavailable: ${rows.filter((r) => r.live === null).length}`);
  console.log(`empty in DB: ${rows.filter((r) => r.db === 0).length}`);
  console.log(`live shows zero products: ${rows.filter((r) => r.live === 0).length}`);
  const broken = rows.filter((r) => r.missed && r.missed.length);
  console.log(`filter values the site itself does not offer: ${broken.length}`);
  for (const b of broken) console.log(`   ! ${b.main} › ${b.group} › ${b.name}  ${b.missed.join(", ")}`);

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
