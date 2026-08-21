/**
 * Mirror the Plank Hardware navbar exactly: one menu row per entry the site
 * shows, in the group it shows it under, with the site's own label.
 *
 * Supersedes sync-plank-nav.cjs, which folded every filtered view onto the
 * collection it filters. That deleted three groups outright — Lighting's
 * "By Finish", Light Switches' "Other" and Taps' "By Finish" contain no plain
 * collection links at all, only tag paths, filter queries and product links.
 *
 * Each entry becomes a row keyed by (parent, group, slug):
 *   /collections/x                        → slug "x",            url ""
 *   /collections/x/2-finish-black         → slug "x-black",      url the href
 *   /collections/x?filter…=Fused+Spur     → slug "x-fused-spur", url the href
 *   /products/handle                      → slug "handle",       url the href
 *   a link back to the panel's own main   → slug "<main>-all",   url the href
 * An empty `url` means "derive the link from the slug", which is how every
 * ordinary category already behaves, so existing rows are left alone.
 *
 * Writes name, group, order, url and parent. Slugs of existing rows, images,
 * brands, departments, isActive and every product are untouched. Rows the
 * navbar no longer lists are reported, never deleted.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-plank-nav-exact.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-plank-nav-exact.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-plank-nav-exact.cjs --rollback <file.json>
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
/** Delete rows the navbar no longer lists. Off by default; full docs are kept in the rollback. */
const PRUNE = process.argv.includes("--prune");
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

/**
 * Classify one navbar entry. `slug` here is only the base — a filter does not
 * by itself change which collection an entry points at, so the final slug is
 * decided per group once every sibling is known (see disambiguate()).
 */
function describeEntry(rawHref, label, mainSlug) {
  const href = String(rawHref || "").replace(/^https:\/\/plankhardware\.com/, "").trim();
  if (!href.startsWith("/")) return null;

  const product = href.match(/^\/products\/([^/?#]+)/i);
  if (product)
    return { base: slugify(product[1]), href, kind: "product", modified: true };

  const collection = href.match(/^\/collections\/([^/?#]+)(\/[^?#]+)?/i);
  if (!collection) return null;
  const base = slugify(collection[1]);
  if (!base) return null;

  const modified = Boolean(collection[2]) || href.includes("?");
  if (base === mainSlug && !modified)
    return { base: `${base}-all`, href, kind: "self", modified: true };

  return { base, href, kind: modified ? "filtered" : "collection", modified };
}

/**
 * Settle slugs within one group. A collection listed once keeps its own slug
 * even when the link carries a filter. Where several entries in a group point
 * at the same collection — the site lists "All Plug Sockets", "Single",
 * "Cooker" and "Shaver Sockets" all on /collections/plug-sockets — the first
 * unfiltered one keeps the plain slug and the rest are disambiguated by label.
 * Any row whose slug is no longer the bare collection carries an explicit url,
 * otherwise its link would not resolve.
 */
function disambiguate(children) {
  const buckets = new Map();
  for (const c of children) {
    const key = `${c.group}::${c.base}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  }
  for (const bucket of buckets.values()) {
    let plainTaken = false;
    for (const c of bucket) {
      if (!c.modified && !plainTaken) {
        c.slug = c.base;
        plainTaken = true;
      } else if (bucket.length === 1) {
        c.slug = c.base;
      } else {
        c.slug = `${c.base}-${slugify(c.label)}`;
      }
    }
  }
  for (const c of children) c.url = c.slug === c.base && !c.modified ? "" : c.href;
  return children;
}

/**
 * Panels come in two layouts:
 *   A  <div class="mega-menu__item">        heading = <a class="… mega-menu__link--top">
 *   B  <details class="menu-sidebar__item"> heading = <h6>
 */
function parseNav(html) {
  const lcHtml = html.toLowerCase();
  const siblings = new Set(
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
    const taken = new Set();

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
        const entry = describeEntry(m[1], label, mainSlug);
        if (!entry) continue;
        if (siblings.has(entry.base)) continue; // "New In" / "Sale"
        if (/(^|-)sale(-|$)/.test(entry.base)) continue;

        // Only a repeat of the same label AND target is a real duplicate — the
        // site lists one collection under several labels within a group.
        const key = `${group}::${entry.base}::${entry.href}::${label}`;
        if (taken.has(key)) continue;
        taken.add(key);

        children.push({ ...entry, label, group, order: children.length });
      }
    }
    mains.push({
      order: k,
      slug: mainSlug,
      name: labelM ? cleanText(labelM[1]) : mainSlug.replace(/-/g, " "),
      children: disambiguate(children),
    });
  }
  return mains;
}

async function runRollback(db, file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let restored = 0;
  for (const m of data.menus || []) {
    const set = {};
    for (const f of ["name", "group", "order", "url"]) if (m[f] !== undefined) set[f] = m[f];
    if (!Object.keys(set).length) continue;
    await db.collection("menus").updateOne(
      { _id: new mongoose.Types.ObjectId(m._id) },
      { $set: set },
    );
    restored += 1;
  }
  let removed = 0;
  for (const id of data.inserted || []) {
    const r = await db.collection("menus").deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    removed += r.deletedCount;
  }
  let revived = 0;
  for (const doc of data.pruned || []) {
    const raw = { ...doc, _id: new mongoose.Types.ObjectId(doc._id) };
    for (const f of ["parent", "brand", "department"])
      if (raw[f]) raw[f] = new mongoose.Types.ObjectId(raw[f]);
    for (const f of ["createdAt", "updatedAt"]) if (raw[f]) raw[f] = new Date(raw[f]);
    await db.collection("menus").insertOne(raw);
    revived += 1;
  }
  console.log(
    `rolled back: ${restored} restored, ${removed} inserted rows removed, ${revived} pruned rows revived`,
  );
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

  // The navbar keys an entry by parent + group + target.
  const rowKey = (parentId, group, slug) => `${String(parentId)}::${group}::${slug}`;
  const byKey = new Map();
  for (const m of menus) {
    if (!m.parent) continue;
    byKey.set(rowKey(m.parent, String(m.group || ""), m.slug), m);
  }

  const updates = [];
  const inserts = [];
  const matched = new Set();

  for (const main of mains) {
    const parentDoc = topBySlug.get(main.slug);
    matched.add(String(parentDoc._id));

    const mainSet = {};
    if (parentDoc.name !== main.name) mainSet.name = main.name;
    if (String(parentDoc.group || "")) mainSet.group = "";
    if (Object.keys(mainSet).length)
      updates.push({ doc: parentDoc, set: mainSet, where: "(main)" });

    for (const child of main.children) {
      const existing = byKey.get(rowKey(parentDoc._id, child.group, child.slug));
      if (existing) {
        matched.add(String(existing._id));
        const set = {};
        if (existing.name !== child.label) set.name = child.label;
        if (existing.order !== child.order) set.order = child.order;
        if (String(existing.url || "") !== child.url) set.url = child.url;
        if (Object.keys(set).length) updates.push({ doc: existing, set, where: main.name });
        continue;
      }
      inserts.push({ ...child, parentDoc, where: main.name });
    }
  }

  const extras = menus.filter((m) => !matched.has(String(m._id)));

  const kinds = {};
  for (const i of inserts) kinds[i.kind] = (kinds[i.kind] || 0) + 1;

  console.log(`navbar mains: ${mains.length}   navbar entries: ${mains.reduce((a, m) => a + m.children.length, 0)}`);
  console.log(`menus in DB: ${menus.length}`);

  console.log(`\ninsert: ${inserts.length}   ${JSON.stringify(kinds)}`);
  for (const i of inserts)
    console.log(
      `   + [${i.kind.padEnd(10)}] ${i.where} › ${i.group} › "${i.label}"\n` +
        `        slug ${i.slug}${i.url ? `\n        url  ${i.url}` : ""}`,
    );

  console.log(`\nupdate: ${updates.length}`);
  for (const u of updates) {
    const bits = Object.entries(u.set).map(([f, v]) => `${f} "${u.doc[f] ?? ""}" -> "${v}"`);
    console.log(`   ${u.doc.slug.padEnd(36)} [${u.where}]  ${bits.join("   ")}`);
  }

  console.log(
    `\nin DB but not in the navbar: ${extras.length}${PRUNE ? " (will be DELETED)" : " (left alone; pass --prune to delete)"}`,
  );
  for (const e of extras)
    console.log(`   ! ${e.slug} ("${e.name}") under ${byId.get(String(e.parent))?.name || "(top)"} › ${e.group || "-"}`);

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
    pruned: PRUNE ? extras.map((e) => JSON.parse(JSON.stringify(e))) : [],
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
      url: i.url,
      order: i.order,
      isActive: true,
      image: "",
      level: "subcategory",
      createdAt: now,
      updatedAt: now,
    });
    rollback.inserted.push(String(r.insertedId));
  }

  let pruned = 0;
  if (PRUNE) {
    for (const e of extras) {
      const r = await menusCol.deleteOne({ _id: e._id });
      pruned += r.deletedCount;
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-sync-plank-nav-exact-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
  console.log(
    `\napplied: ${updates.length} updated, ${inserts.length} inserted, ${pruned} pruned\nrollback: ${file}`,
  );

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
