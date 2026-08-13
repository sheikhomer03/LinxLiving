/**
 * Make the Plank Hardware menu tree match the live navbar exactly.
 *
 * Supersedes reparent-plank-menus.cjs + apply-plank-nav-labels.cjs: those key
 * on slug alone, which cannot express a collection the navbar lists under two
 * different mains (the eight finishes appear under both "Knobs & Handles" and
 * "By Finish"). This keys on (parent slug, child slug), so a cross-listed
 * collection gets one row per parent, each with that panel's own label.
 *
 * What counts as a navbar entry:
 *   - href under /collections/…            → the first path segment is the slug
 *   - the filter query string is dropped   → "?filter.p.m…=Fused+Spur" collapses
 *                                            onto the collection it filters
 *   - a link back to the panel's own main   ("Shop All") is not a child
 *   - /products/… links (the Taps panel)   are not menus at all
 *
 * Writes name, group, order and parent only. Slugs, images, brands,
 * departments, isActive and every product are untouched. Rows in the DB that
 * the navbar no longer lists are reported, never deleted.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-plank-nav.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-plank-nav.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-plank-nav.cjs --rollback <file.json>
 *
 *   CACHED=1   reuse the cached homepage instead of refetching
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
const CACHE = path.join(__dirname, "_tmp-plank-home-live.html");

const slugify = (s) =>
  String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const cleanText = (s) =>
  String(s || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function loadHomepage() {
  if (process.env.CACHED === "1" && fs.existsSync(CACHE)) return fs.readFileSync(CACHE, "utf8");
  const r = await fetch(`${BASE}/`, {
    headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LinxPlankNav/1.0" },
  });
  if (!r.ok) throw new Error(`homepage fetch failed: ${r.status}`);
  const html = await r.text();
  fs.writeFileSync(CACHE, html);
  return html;
}

/** "/collections/hooks/2-finish-aged-brass?x=y" → "hooks" */
function collectionSlug(href) {
  const clean = String(href || "").replace(/^https:\/\/plankhardware\.com/, "");
  const m = clean.match(/^\/collections\/([^/?#]+)/i);
  return m ? slugify(m[1]) : "";
}

/**
 * Panels come in two layouts:
 *   A  <div class="mega-menu__item">        heading = <a class="… mega-menu__link--top">
 *   B  <details class="menu-sidebar__item"> heading = <h6>
 */
function parseNav(html) {
  const lcHtml = html.toLowerCase();
  const excluded = new Set(
    [...html.matchAll(
      /<a\s+href="(?:https:\/\/plankhardware\.com)?\/collections\/([^"?#]+)[^"]*"\s+class="menu__item/gi,
    )].map((m) => slugify(m[1])),
  );

  const marker = "summary data-link=";
  const offs = [];
  for (let i = 0; ; ) {
    const s = lcHtml.indexOf(marker, i);
    if (s < 0) break;
    offs.push(s);
    i = s + marker.length;
  }
  if (!offs.length) throw new Error("no navbar mains found — page markup changed");
  const navEnd = html.indexOf("</nav>", offs[offs.length - 1]);
  const groupStart = /<div class="mega-menu__item">|<details\s+class="menu-sidebar__item"/gi;

  const mains = [];
  for (let k = 0; k < offs.length; k++) {
    const block = html.slice(offs[k], k + 1 < offs.length ? offs[k + 1] : navEnd);
    const hrefM = block.match(/data-link="([^"]*\/collections\/([^"?]+))"/i);
    if (!hrefM) continue;
    const mainSlug = slugify(hrefM[2]);
    const labelM =
      block.match(/menu__item-text[^>]*>([\s\S]*?)<svg/i) ||
      block.match(/reversed-link__text[^>]*>([\s\S]*?)</i);

    const starts = [...block.matchAll(groupStart)].map((m) => m.index);
    const children = [];
    const seen = new Set();
    const collapsed = [];

    for (let g = 0; g < starts.length; g++) {
      const seg = block.slice(starts[g], g + 1 < starts.length ? starts[g + 1] : block.length);
      const titleM =
        seg.match(/<a[^>]*class="[^"]*mega-menu__link--top[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
        seg.match(/<h6[^>]*>([\s\S]*?)<\/h6>/i);
      const group = titleM ? cleanText(titleM[1]) : "";

      for (const m of seg.matchAll(
        /<a\s+href="([^"]+)"((?:(?!<\/a>)[\s\S])*?)reversed-link__text[^>]*>([\s\S]*?)</gi,
      )) {
        const label = cleanText(m[3]);
        const cs = collectionSlug(m[1]);
        if (!cs) continue; // /products/… links (Taps) are not menus
        if (cs === mainSlug) continue; // "Shop All" points back at the panel
        if (excluded.has(cs)) continue; // "New In" / "Sale" are top-level siblings
        if (/(^|-)sale(-|$)/.test(cs)) continue;
        if (seen.has(cs)) {
          collapsed.push({ slug: cs, label, group });
          continue; // a filtered view of a collection already listed
        }
        seen.add(cs);
        children.push({ slug: cs, label, group, order: children.length });
      }
    }
    mains.push({
      order: k,
      slug: mainSlug,
      name: labelM ? cleanText(labelM[1]) : mainSlug.replace(/-/g, " "),
      children,
      collapsed,
    });
  }
  return mains;
}

async function runRollback(db, file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let restored = 0;
  for (const m of data.menus || []) {
    const set = {};
    for (const f of ["name", "group", "order"]) if (m[f] !== undefined) set[f] = m[f];
    if (m.parent !== undefined)
      set.parent = m.parent ? new mongoose.Types.ObjectId(m.parent) : null;
    if (!Object.keys(set).length) continue;
    await db.collection("menus").updateOne(
      { _id: new mongoose.Types.ObjectId(m._id) },
      { $set: set },
    );
    restored += 1;
  }
  let removed = 0;
  for (const id of data.inserted || []) {
    const r = await db
      .collection("menus")
      .deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    removed += r.deletedCount;
  }
  console.log(`rolled back: ${restored} restored, ${removed} inserted rows removed`);
}

(async () => {
  await connectMongo();
  const db = mongoose.connection.db;
  const menusCol = db.collection("menus");

  if (ROLLBACK) {
    await runRollback(db, ROLLBACK);
    await mongoose.disconnect();
    return;
  }

  const brand = await db.collection("brands").findOne({ name: /^plank hardware$/i });
  if (!brand) throw new Error("Plank Hardware brand not found");

  const mains = parseNav(await loadHomepage());
  const menus = await menusCol.find({ brand: brand._id }).toArray();
  const byId = new Map(menus.map((m) => [String(m._id), m]));
  const topBySlug = new Map(menus.filter((m) => !m.parent).map((m) => [m.slug, m]));

  for (const main of mains)
    if (!topBySlug.has(main.slug)) throw new Error(`navbar main missing from DB: ${main.slug}`);

  // Existing children keyed by parent+slug, which is what the navbar keys on.
  const childKey = (parentId, slug) => `${String(parentId)}::${slug}`;
  const childByKey = new Map();
  for (const m of menus) {
    if (!m.parent) continue;
    childByKey.set(childKey(m.parent, m.slug), m);
  }

  const updates = [];
  const inserts = [];
  const matchedIds = new Set();

  for (const main of mains) {
    const parentDoc = topBySlug.get(main.slug);
    matchedIds.add(String(parentDoc._id));

    if (parentDoc.name !== main.name || String(parentDoc.group || "")) {
      updates.push({
        doc: parentDoc,
        set: {
          ...(parentDoc.name !== main.name ? { name: main.name } : {}),
          ...(String(parentDoc.group || "") ? { group: "" } : {}),
        },
        where: "(main)",
      });
    }

    for (const child of main.children) {
      const existing = childByKey.get(childKey(parentDoc._id, child.slug));
      if (existing) {
        matchedIds.add(String(existing._id));
        const set = {};
        if (existing.name !== child.label) set.name = child.label;
        if (String(existing.group || "") !== child.group) set.group = child.group;
        if (existing.order !== child.order) set.order = child.order;
        if (Object.keys(set).length) updates.push({ doc: existing, set, where: main.name });
        continue;
      }
      // A row with this slug may exist under a different parent — the navbar
      // lists it in both places, so this parent needs its own copy.
      const elsewhere = menus.find((m) => m.slug === child.slug && m.parent);
      inserts.push({
        ...child,
        parentDoc,
        where: main.name,
        alsoUnder: elsewhere ? byId.get(String(elsewhere.parent))?.name || "?" : null,
      });
    }
  }

  const extras = menus.filter((m) => !matchedIds.has(String(m._id)));

  console.log(`navbar mains: ${mains.length}   menus in DB: ${menus.length}`);

  console.log(`\ninsert: ${inserts.length}`);
  for (const i of inserts)
    console.log(
      `   + ${i.slug.padEnd(34)} "${i.label}"  ->  ${i.where} › ${i.group}` +
        (i.alsoUnder ? `   (also under ${i.alsoUnder})` : "   (new collection)"),
    );

  console.log(`\nupdate: ${updates.length}`);
  for (const u of updates) {
    const bits = Object.entries(u.set).map(
      ([f, v]) => `${f} "${u.doc[f] ?? ""}" -> "${v}"`,
    );
    console.log(`   ${u.doc.slug.padEnd(34)} [${u.where}]  ${bits.join("   ")}`);
  }

  const collapsed = mains.flatMap((m) =>
    m.collapsed.map((c) => `${m.name} › ${c.group} › "${c.label}" → ${c.slug}`),
  );
  console.log(`\nfiltered views folded onto their collection: ${collapsed.length}`);
  for (const c of collapsed) console.log(`   ~ ${c}`);

  console.log(`\nin DB but not in the navbar, left alone: ${extras.length}`);
  for (const e of extras)
    console.log(`   ! ${e.slug} ("${e.name}") under ${byId.get(String(e.parent))?.name || "(top)"}`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const rollback = {
    menus: updates.map((u) => ({
      _id: String(u.doc._id),
      ...Object.fromEntries(Object.keys(u.set).map((f) => [f, u.doc[f] ?? ""])),
    })),
    inserted: [],
  };

  const now = new Date();
  for (const u of updates)
    await menusCol.updateOne({ _id: u.doc._id }, { $set: { ...u.set, updatedAt: now } });

  for (const i of inserts) {
    const r = await menusCol.insertOne({
      name: i.label,
      slug: i.slug,
      parent: i.parentDoc._id,
      brand: brand._id,
      subBrands: [],
      department: null,
      group: i.group,
      order: i.order,
      isActive: true,
      image: "",
      level: "subcategory",
      createdAt: now,
      updatedAt: now,
    });
    rollback.inserted.push(String(r.insertedId));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-sync-plank-nav-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
  console.log(
    `\napplied: ${updates.length} updated, ${inserts.length} inserted\nrollback: ${file}`,
  );

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
