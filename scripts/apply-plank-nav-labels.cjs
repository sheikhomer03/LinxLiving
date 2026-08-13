/**
 * Give every Plank Hardware menu the group heading and display name the live
 * navbar uses.
 *
 * The importer named each child by de-slugging its handle ("aged brass
 * hardware"), and had nowhere to record the sidebar headings the site groups
 * them under. This reads both off plankhardware.com.
 *
 * Only `name` and `group` are written. Parents, slugs, orders, images,
 * brands, departments and every product are left untouched — a child whose
 * parent disagrees with the navbar is reported, not moved (run
 * scripts/reparent-plank-menus.cjs for that).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/apply-plank-nav-labels.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/apply-plank-nav-labels.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/apply-plank-nav-labels.cjs --rollback <file.json>
 *
 *   --names-only / --groups-only   write just one of the two fields
 *   CACHED=1                       reuse the cached homepage
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://plankhardware.com";
const APPLY = process.argv.includes("--apply");
const NAMES_ONLY = process.argv.includes("--names-only");
const GROUPS_ONLY = process.argv.includes("--groups-only");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;
const CACHE = path.join(__dirname, "_tmp-plank-home-live.html");

/**
 * Eight finish collections are linked from both "Knobs & Handles" (its
 * "By Finish" column) and the dedicated "By Finish" main. The dedicated hub
 * owns them, so their group has to come from that panel too — a child always
 * takes its group from the panel of the parent it actually sits under.
 */
const OWNER_PRIORITY = ["shop-by-finish"];

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
 * Panels come in two layouts:
 *   A  <div class="mega-menu__item">     heading is <a class="… mega-menu__link--top">
 *   B  <details class="menu-sidebar__item">  heading is <h6>
 * Both wrap their entries in a <ul> of links carrying reversed-link__text.
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

    for (let g = 0; g < starts.length; g++) {
      const seg = block.slice(starts[g], g + 1 < starts.length ? starts[g + 1] : block.length);
      const titleM =
        seg.match(/<a[^>]*class="[^"]*mega-menu__link--top[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
        seg.match(/<h6[^>]*>([\s\S]*?)<\/h6>/i);
      const group = titleM ? cleanText(titleM[1]) : "";

      for (const m of seg.matchAll(
        /href=["']\/collections\/([^"'?#]+)[^"']*["']((?:(?!<\/a>)[\s\S])*?)reversed-link__text[^>]*>([\s\S]*?)</gi,
      )) {
        const cs = slugify(m[1]);
        if (!cs || cs === mainSlug || excluded.has(cs) || seen.has(cs)) continue;
        if (/(^|-)sale(-|$)/.test(cs)) continue;
        seen.add(cs);
        children.push({ slug: cs, label: cleanText(m[3]), group });
      }
    }

    mains.push({
      order: k,
      slug: mainSlug,
      name: labelM ? cleanText(labelM[1]) : mainSlug.replace(/-/g, " "),
      children,
    });
  }
  return mains;
}

async function runRollback(db, file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let n = 0;
  for (const m of data.menus || []) {
    const set = {};
    if (m.name !== undefined) set.name = m.name;
    if (m.group !== undefined) set.group = m.group;
    if (!Object.keys(set).length) continue;
    await db.collection("menus").updateOne(
      { _id: new mongoose.Types.ObjectId(m._id) },
      { $set: set },
    );
    n += 1;
  }
  console.log(`rolled back ${n} menus`);
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
  const bySlug = new Map(menus.map((m) => [m.slug, m]));
  const byId = new Map(menus.map((m) => [String(m._id), m]));

  // A collection linked from several panels takes the one that owns it.
  const linkedFrom = new Map();
  for (const main of mains)
    for (const c of main.children) {
      if (!linkedFrom.has(c.slug)) linkedFrom.set(c.slug, []);
      linkedFrom.get(c.slug).push({ main, child: c });
    }

  const updates = [];
  const missing = [];
  const misparented = [];
  const noHeading = [];

  // Main categories: name only, never a group.
  for (const main of mains) {
    const doc = bySlug.get(main.slug);
    if (!doc) { missing.push(main.slug); continue; }
    const set = {};
    if (!GROUPS_ONLY && doc.name !== main.name) set.name = main.name;
    if (!NAMES_ONLY && String(doc.group || "")) set.group = "";
    if (Object.keys(set).length)
      updates.push({ doc, set, where: "(main)", label: main.name });
  }

  for (const [slug, links] of linkedFrom) {
    const chosen =
      links.length === 1
        ? links[0]
        : links.find((l) => OWNER_PRIORITY.includes(l.main.slug)) || null;
    if (!chosen) continue;

    const doc = bySlug.get(slug);
    if (!doc) { missing.push(slug); continue; }

    // Group only means anything under the parent it was read from.
    const parentDoc = bySlug.get(chosen.main.slug);
    if (String(doc.parent || "") !== String(parentDoc._id)) {
      misparented.push({
        slug,
        actual: byId.get(String(doc.parent))?.name || "(none)",
        expected: chosen.main.name,
      });
      continue;
    }
    if (!chosen.child.group) noHeading.push(slug);

    const set = {};
    if (!GROUPS_ONLY && doc.name !== chosen.child.label) set.name = chosen.child.label;
    if (!NAMES_ONLY && String(doc.group || "") !== chosen.child.group)
      set.group = chosen.child.group;
    if (Object.keys(set).length)
      updates.push({ doc, set, where: chosen.main.name, label: chosen.child.label });
  }

  console.log(`navbar mains: ${mains.length}   menus in DB: ${menus.length}`);
  console.log(`\nchanges: ${updates.length}`);
  for (const u of updates) {
    const bits = [];
    if (u.set.name !== undefined) bits.push(`name "${u.doc.name}" -> "${u.set.name}"`);
    if (u.set.group !== undefined)
      bits.push(`group "${u.doc.group || ""}" -> "${u.set.group}"`);
    console.log(`   ${u.doc.slug.padEnd(34)} [${u.where}]  ${bits.join("   ")}`);
  }

  if (misparented.length) {
    console.log(`\nparent disagrees with navbar, skipped: ${misparented.length}`);
    for (const m of misparented)
      console.log(`   ! ${m.slug}: under "${m.actual}", navbar says "${m.expected}"`);
  }
  if (noHeading.length)
    console.log(`\nnavbar column had no heading (group left empty): ${noHeading.join(", ")}`);
  if (missing.length)
    console.log(`\nin navbar but not in DB: ${missing.join(", ")}`);

  const untouched = menus.filter((m) => !updates.some((u) => String(u.doc._id) === String(m._id)));
  console.log(`\nalready correct, untouched: ${untouched.length}`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const rollback = {
    menus: updates.map((u) => ({
      _id: String(u.doc._id),
      ...(u.set.name !== undefined ? { name: u.doc.name } : {}),
      ...(u.set.group !== undefined ? { group: u.doc.group || "" } : {}),
    })),
  };

  const now = new Date();
  for (const u of updates)
    await menusCol.updateOne({ _id: u.doc._id }, { $set: { ...u.set, updatedAt: now } });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-plank-nav-labels-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
  console.log(`\napplied: ${updates.length} menus updated\nrollback: ${file}`);

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
