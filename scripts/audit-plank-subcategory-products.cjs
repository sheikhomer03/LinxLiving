/**
 * Compare the products stored against each Plank sub-category with the live
 * collection on plankhardware.com.
 *
 * Products carry no supplier handle, so rows are matched on a normalised
 * product name. Counts come from /collections/<slug>/products.json, paged.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-plank-subcategory-products.cjs
 *   REPORT=path.json   where to write the machine-readable report
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://plankhardware.com";
const GAP = Number(process.env.REQUEST_GAP_MS || 250);
const REPORT = process.env.REPORT || path.join(__dirname, "_tmp-plank-subcat-products.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LinxPlankProductAudit/1.0";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) =>
  String(s || "").toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();

async function fetchJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) {
        await delay(1000 * (i + 1));
        continue;
      }
      if (!r.ok) return null;
      return await r.json();
    } catch {
      await delay(700 * (i + 1));
    }
  }
  return null;
}

/** Every product in a collection, following pages until short/empty. */
async function liveProducts(slug) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const j = await fetchJson(`${BASE}/collections/${slug}/products.json?limit=250&page=${page}`);
    if (j === null && page === 1) return null; // collection missing
    const batch = (j && j.products) || [];
    out.push(...batch);
    if (batch.length < 250) break;
    await delay(GAP);
  }
  return out;
}

(async () => {
  await connectMongo();
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ name: /^plank hardware$/i });

  const menus = await db.collection("menus").find({ brand: brand._id }).toArray();
  const byId = new Map(menus.map((m) => [String(m._id), m]));
  const kids = menus.filter((m) => m.parent);

  const products = await db
    .collection("products")
    .find({ brand: brand._id })
    .project({ name: 1, category: 1, subCategory: 1 })
    .toArray();

  const dbBySub = new Map();
  for (const p of products) {
    const s = String(p.subCategory || "").trim();
    if (!s) continue;
    if (!dbBySub.has(s)) dbBySub.set(s, []);
    dbBySub.get(s).push(p);
  }

  // One request per distinct collection, even when two menus share the slug.
  const slugs = [...new Set(kids.map((k) => k.slug))].sort();
  console.log(`auditing ${slugs.length} distinct sub-category collections…\n`);

  const rows = [];
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const live = await liveProducts(slug);
    const dbRows = dbBySub.get(slug) || [];
    const liveNames = new Set((live || []).map((p) => norm(p.title)));
    const dbNames = new Set(dbRows.map((p) => norm(p.name)));

    const missing = [...liveNames].filter((n) => !dbNames.has(n));
    const extra = [...dbNames].filter((n) => !liveNames.has(n));

    const owners = kids.filter((k) => k.slug === slug)
      .map((k) => `${byId.get(String(k.parent))?.name} › ${k.group || "-"}`);

    rows.push({
      slug,
      name: kids.find((k) => k.slug === slug)?.name || "",
      owners,
      live: live === null ? null : live.length,
      db: dbRows.length,
      missing: missing.length,
      extra: extra.length,
      missingSample: missing.slice(0, 4),
      extraSample: extra.slice(0, 4),
    });

    process.stdout.write(
      `${String(i + 1).padStart(3)}/${slugs.length}  ${slug.padEnd(34)} live ${String(live === null ? "404" : live.length).padStart(4)}   db ${String(dbRows.length).padStart(4)}\n`,
    );
    await delay(GAP);
  }

  fs.writeFileSync(REPORT, JSON.stringify({ rows }, null, 2));
  console.log(`\nwrote ${REPORT}`);

  const gone = rows.filter((r) => r.live === null);
  const match = rows.filter((r) => r.live !== null && r.live === r.db && !r.missing && !r.extra);
  const diff = rows.filter((r) => r.live !== null && (r.live !== r.db || r.missing || r.extra));
  console.log(`\nexact match: ${match.length}   differ: ${diff.length}   collection 404: ${gone.length}`);

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
