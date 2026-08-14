/**
 * Rebuild the Plank Hardware menu tree from the live navbar.
 *
 * The importer inserted all 60 Plank menus with `parent: null` — a precedence
 * bug (`await x.findOne(…)?._id` awaits `undefined`) meant every child menu
 * was written as a main category. This reads the six navbar mains off
 * plankhardware.com and gives each child menu its real parent.
 *
 * Only `parent` and `order` are written on existing rows, plus inserts for
 * collections the navbar lists that have no menu row yet. Names, slugs,
 * images, brands, departments and every product are left untouched.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/reparent-plank-menus.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/reparent-plank-menus.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/reparent-plank-menus.cjs --rollback <file.json>
 *
 *   --no-create   reparent only; do not insert missing navbar collections
 *   CACHED=1      reuse scripts/_tmp-plank-home-live.html instead of refetching
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://plankhardware.com";
const APPLY = process.argv.includes("--apply");
const CREATE = !process.argv.includes("--no-create");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;
const CACHE = path.join(__dirname, "_tmp-plank-home-live.html");

/**
 * Eight finish collections hang off both "Knobs & Handles" (inside its
 * "By Finish" sidebar group) and the dedicated "By Finish" main. A menu row
 * holds one parent, so the dedicated hub wins. Mains listed here take
 * ownership of any collection two mains share; an unlisted clash is reported
 * and skipped rather than guessed.
 */
const OWNER_PRIORITY = ["shop-by-finish"];

const slugify = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const cleanText = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function loadHomepage() {
  if (process.env.CACHED === "1" && fs.existsSync(CACHE)) {
    return fs.readFileSync(CACHE, "utf8");
  }
  const r = await fetch(`${BASE}/`, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LinxPlankNav/1.0",
      accept: "text/html",
    },
  });
  if (!r.ok) throw new Error(`homepage fetch failed: ${r.status}`);
  const html = await r.text();
  fs.writeFileSync(CACHE, html);
  return html;
}

/**
 * The six navbar mains are the only `<summary data-link="…">` elements on the
 * page. Each owns everything up to the next one (the last runs to `</nav>`);
 * the sidebar `<h6>` groupings inside a panel are presentation only, so every
 * collection in the panel is flattened to a direct child of the main.
 *
 * The navbar also carries two top-level items with no dropdown ("New In" and
 * "Sale"), rendered as a plain `<a class="menu__item">`. They sit after the
 * last mega panel, so the run-to-`</nav>` boundary would otherwise adopt them
 * as By Finish children. They are siblings of the six mains, not children —
 * collect them first and exclude them everywhere.
 */
function topLevelNoDropdownSlugs(html) {
  const rx =
    /<a\s+href="(?:https:\/\/plankhardware\.com)?\/collections\/([^"?#]+)[^"]*"\s+class="menu__item/gi;
  return new Set([...html.matchAll(rx)].map((m) => slugify(m[1])));
}

function parseNav(html) {
  const excluded = topLevelNoDropdownSlugs(html);
  const lc = html.toLowerCase();
  const marker = "summary data-link=";
  const offsets = [];
  for (let i = 0; ; ) {
    const s = lc.indexOf(marker, i);
    if (s < 0) break;
    offsets.push(s);
    i = s + marker.length;
  }
  if (!offsets.length) throw new Error("no navbar mains found — page markup changed");

  const navEnd = html.indexOf("</nav>", offsets[offsets.length - 1]);
  const mains = [];

  for (let k = 0; k < offsets.length; k++) {
    const block = html.slice(
      offsets[k],
      k + 1 < offsets.length ? offsets[k + 1] : navEnd,
    );

    const hrefM = block.match(/data-link="([^"]*\/collections\/([^"?]+))"/i);
    if (!hrefM) continue;
    const slug = slugify(hrefM[2]);

    const labelM =
      block.match(/menu__item-text[^>]*>([\s\S]*?)<svg/i) ||
      block.match(/reversed-link__text[^>]*>([\s\S]*?)</i);

    const children = [];
    const seen = new Set();
    const add = (raw, label) => {
      const cs = slugify(raw);
      if (!cs || cs === slug || seen.has(cs)) return;
      if (/(^|-)sale(-|$)/.test(cs)) return;
      if (excluded.has(cs)) return;
      seen.add(cs);
      children.push({ slug: cs, label: cleanText(label) });
    };
    // Labelled links first so children keep the navbar's own wording. The
    // label must fall inside the link's own <a>…</a>, or a card with no label
    // would borrow the next card's.
    for (const m of block.matchAll(
      /href=["']\/collections\/([^"'?#]+)[^"']*["']((?:(?!<\/a>)[\s\S])*?)reversed-link__text[^>]*>([\s\S]*?)</gi,
    ))
      add(m[1], m[3]);
    for (const m of block.matchAll(/href=["']\/collections\/([^"'?#]+)[^"']*["']/gi))
      add(m[1], "");

    mains.push({
      order: k,
      name: labelM ? cleanText(labelM[1]) : slug.replace(/-/g, " "),
      slug,
      children,
    });
  }
  return mains;
}

async function runRollback(db, file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let restored = 0;
  for (const m of data.menus || []) {
    const set = { parent: m.parent ? new mongoose.Types.ObjectId(m.parent) : null };
    if (m.order !== undefined) set.order = m.order;
    await db
      .collection("menus")
      .updateOne({ _id: new mongoose.Types.ObjectId(m._id) }, { $set: set });
    restored += 1;
  }
  let removed = 0;
  for (const id of data.inserted || []) {
    const r = await db
      .collection("menus")
      .deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    removed += r.deletedCount;
  }
  console.log(`rolled back: ${restored} menus restored, ${removed} inserted menus removed`);
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
  console.log(`navbar mains: ${mains.length}`);

  const menus = await menusCol.find({ brand: brand._id }).toArray();
  const bySlug = new Map(menus.map((m) => [m.slug, m]));
  const mainSlugs = new Set(mains.map((m) => m.slug));

  const missingMains = mains.filter((m) => !bySlug.has(m.slug));
  if (missingMains.length) {
    throw new Error(
      `navbar main(s) missing from DB: ${missingMains.map((m) => m.slug).join(", ")}`,
    );
  }

  // child slug -> mains that link it
  const owners = new Map();
  for (const m of mains)
    for (const c of m.children) {
      if (!owners.has(c.slug)) owners.set(c.slug, []);
      owners.get(c.slug).push(m);
    }

  const resolve = (slug) => {
    const list = owners.get(slug) || [];
    if (list.length <= 1) return list[0] || null;
    for (const p of OWNER_PRIORITY) {
      const hit = list.find((m) => m.slug === p);
      if (hit) return hit;
    }
    return null; // ambiguous and unhandled — reported, left alone
  };

  const updates = [];
  const inserts = [];
  const ambiguous = [];
  const orphans = [];

  for (const [slug, list] of owners) {
    const parent = resolve(slug);
    if (!parent) {
      ambiguous.push({ slug, mains: list.map((m) => m.slug) });
      continue;
    }
    const parentDoc = bySlug.get(parent.slug);
    const order = parent.children.findIndex((c) => c.slug === slug);
    const existing = bySlug.get(slug);

    if (existing) {
      if (
        String(existing.parent || "") === String(parentDoc._id) &&
        existing.order === order
      )
        continue;
      updates.push({ doc: existing, parentDoc, order, parentName: parent.name });
    } else if (CREATE) {
      const label = (parent.children.find((c) => c.slug === slug) || {}).label;
      inserts.push({
        slug,
        name: label || slug.replace(/-/g, " "),
        parentDoc,
        order,
        parentName: parent.name,
      });
    }
  }

  // DB children the navbar no longer lists anywhere.
  for (const m of menus) {
    if (mainSlugs.has(m.slug) || owners.has(m.slug)) continue;
    orphans.push(m.slug);
  }

  console.log(`\nreparent / reorder: ${updates.length}`);
  for (const u of updates)
    console.log(`   ${u.doc.slug}  ->  ${u.parentName}  (order ${u.order})`);

  console.log(`\ninsert: ${inserts.length}`);
  for (const i of inserts)
    console.log(`   + ${i.slug}  "${i.name}"  ->  ${i.parentName}  (order ${i.order})`);

  console.log(`\nambiguous, left alone: ${ambiguous.length}`);
  for (const a of ambiguous) console.log(`   ? ${a.slug}: ${a.mains.join(", ")}`);

  console.log(`\nin DB but not in navbar, left alone: ${orphans.length}`);
  for (const o of orphans) console.log(`   ! ${o}`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rollback = {
    menus: updates.map((u) => ({
      _id: String(u.doc._id),
      parent: u.doc.parent ? String(u.doc.parent) : null,
      order: u.doc.order,
    })),
    inserted: [],
  };

  const now = new Date();
  for (const u of updates) {
    await menusCol.updateOne(
      { _id: u.doc._id },
      { $set: { parent: u.parentDoc._id, order: u.order, updatedAt: now } },
    );
  }
  for (const i of inserts) {
    const r = await menusCol.insertOne({
      name: i.name,
      slug: i.slug,
      parent: i.parentDoc._id,
      brand: brand._id,
      subBrands: [],
      department: null,
      order: i.order,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    });
    rollback.inserted.push(String(r.insertedId));
  }

  const file = path.join(
    process.cwd(),
    `rollback-reparent-plank-menus-${stamp}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
  console.log(
    `\napplied: ${updates.length} reparented, ${inserts.length} inserted\nrollback: ${file}`,
  );

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
