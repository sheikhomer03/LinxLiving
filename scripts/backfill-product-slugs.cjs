/**
 * Give every product a unique slug — the `/products/<slug>` storefront address.
 *
 * Reads every product in both catalogues (MONGODB_URI and MONGODB_URL2),
 * works out a slug for each one that has none, checks the whole set is
 * unique across both, and writes a report. Nothing is written unless
 * `--write` is passed.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/backfill-product-slugs.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/backfill-product-slugs.cjs --write
 *
 * --write sets `slug` only where it is missing (an existing slug is never
 * changed), then creates the unique index `slug_unique` in each database.
 * Re-runnable: run it again after an import to fill the gaps.
 *
 * The rules are src/lib/productSlug.ts's — keep the two in step:
 *   1. base: the name, lowercased, accents dropped, & → and, × → x, anything
 *      else → "-", cut to ≤ 150 characters at a "-".
 *   2. A name no other product shares → base.
 *   3. A shared name → base-<supplier SKU>.
 *   4. Still clashing (same SKU, or none) → -2, -3, … in creation order; the
 *      oldest keeps the un-numbered form.
 *   5. Never 24 hex characters, so a slug is never mistaken for an id.
 *
 * Report: slug-report/<date>/ — slugs.csv (every product), same-name-same-sku.csv
 * (probable double imports, for a person to look at), summary.json.
 */
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { applyDns } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p, quiet: true });
}

const WRITE = process.argv.includes("--write");
const BATCH = 1000;
const MAX_BASE = 150;
const MAX_SKU = 30;
const INDEX_NAME = "slug_unique";
const OUT_DIR = path.join(
  __dirname,
  "..",
  "slug-report",
  new Date().toISOString().slice(0, 10),
);

/* ---------------- rules (mirror of src/lib/productSlug.ts) ---------------- */

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slugifyText = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/×/g, "x")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function cutAtWord(slug, max) {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const lastBreak = cut.lastIndexOf("-");
  return (lastBreak >= max * 0.6 ? cut.slice(0, lastBreak) : cut).replace(
    /-+$/g,
    "",
  );
}

const slugBase = (name) => cutAtWord(slugifyText(name), MAX_BASE) || "product";

const slugSku = (p) =>
  cutAtWord(
    slugifyText(
      [p.supplierSku, p.sourceSku, p.manufacturerSku, p.productCode, p.linxSku].find(
        (v) => String(v ?? "").trim(),
      ),
    ),
    MAX_SKU,
  );

function* candidates(base, sku, withSku) {
  const stem = sku ? `${base}-${sku}` : base;
  const seen = new Set();
  const ok = (s) => !seen.has(s) && !OBJECT_ID.test(s) && seen.add(s);
  if (!withSku && ok(base)) yield base;
  if (ok(stem)) yield stem;
  for (let n = 2; ; n++) {
    const numbered = `${stem}-${n}`;
    if (ok(numbered)) yield numbered;
  }
}

/* --------------------------------- helpers -------------------------------- */

const csv = (rows) =>
  rows
    .map((r) =>
      r
        .map((v) => {
          const s = String(v ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n") + "\n";

async function openClusters() {
  applyDns();
  const out = [];
  for (const [key, uri] of [
    ["primary", process.env.MONGODB_URI],
    ["secondary", process.env.MONGODB_URL2],
  ]) {
    if (!uri) {
      if (key === "primary") throw new Error("MONGODB_URI is not set");
      console.log("secondary: MONGODB_URL2 not set — primary only");
      continue;
    }
    const conn = await mongoose
      .createConnection(uri, { serverSelectionTimeoutMS: 30000 })
      .asPromise();
    out.push({ key, conn, col: conn.db.collection("products") });
  }
  return out;
}

async function readAll(clusters) {
  const rows = [];
  for (const { key, col } of clusters) {
    const docs = await col
      .find(
        {},
        {
          projection: {
            name: 1,
            slug: 1,
            supplierSku: 1,
            sourceSku: 1,
            manufacturerSku: 1,
            productCode: 1,
            linxSku: 1,
          },
        },
      )
      .toArray();
    for (const d of docs) {
      rows.push({
        cluster: key,
        _id: d._id,
        id: String(d._id),
        name: String(d.name ?? ""),
        existing: typeof d.slug === "string" ? d.slug.trim() : "",
        base: slugBase(d.name),
        sku: slugSku(d),
      });
    }
    console.log(`${key}: ${docs.length} products`);
  }
  // Creation order — an ObjectId's hex sorts by its timestamp first.
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

/** Decide every product's slug. Returns problems that must stop a write. */
function plan(rows) {
  const problems = [];
  const taken = new Map(); // slug → row

  // Slugs already stored are kept exactly as they are — except malformed
  // ones (e.g. "a-84-passivhaus-1.0", "lift--slide" from a scrape that
  // predates this script). Nothing has ever linked to those, so they are
  // replaced under the rules rather than carried forward.
  for (const r of rows) {
    if (!r.existing) continue;
    if (!SLUG_SHAPE.test(r.existing) || OBJECT_ID.test(r.existing)) {
      r.replaces = r.existing;
      continue;
    }
    const other = taken.get(r.existing);
    if (other) {
      problems.push(
        `existing slug "${r.existing}" held by both ${other.cluster} ${other.id} and ${r.cluster} ${r.id}`,
      );
      continue;
    }
    taken.set(r.existing, r);
    r.slug = r.existing;
    r.rule = "kept";
  }

  const perBase = new Map();
  for (const r of rows) perBase.set(r.base, (perBase.get(r.base) || 0) + 1);

  const assign = (r, withSku) => {
    let n = 0;
    for (const c of candidates(r.base, r.sku, withSku)) {
      if (++n > 100000) throw new Error(`no free slug for ${r.id}`);
      if (taken.has(c)) continue;
      taken.set(c, r);
      r.slug = c;
      r.rule =
        c === r.base
          ? "name"
          : r.sku && c === `${r.base}-${r.sku}`
            ? "name+sku"
            : "numbered";
      return;
    }
  };

  // Names nobody else has first, so a numbered duplicate never takes a
  // slug that is some other product's plain name.
  for (const r of rows) if (!r.slug && perBase.get(r.base) === 1) assign(r, false);
  for (const r of rows) if (!r.slug) assign(r, true);

  return problems;
}

/** Every product has a slug, every slug is well-formed and unique. */
function verify(rows) {
  const errors = [];
  const seen = new Map();
  for (const r of rows) {
    if (!r.slug) {
      errors.push(`no slug: ${r.cluster} ${r.id}`);
      continue;
    }
    if (!SLUG_SHAPE.test(r.slug)) errors.push(`bad shape "${r.slug}" (${r.id})`);
    if (OBJECT_ID.test(r.slug)) errors.push(`id-like "${r.slug}" (${r.id})`);
    const other = seen.get(r.slug);
    if (other) errors.push(`duplicate "${r.slug}": ${other} and ${r.id}`);
    else seen.set(r.slug, r.id);
  }
  return errors;
}

function writeReport(rows, summary) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "slugs.csv"),
    csv([
      ["cluster", "id", "name", "slug", "rule", "sku", "replaces"],
      ...rows.map((r) => [
        r.cluster,
        r.id,
        r.name,
        r.slug,
        r.rule,
        r.sku,
        r.replaces || "",
      ]),
    ]),
  );

  // Same name and same SKU: almost certainly one product imported twice.
  const groups = new Map();
  for (const r of rows) {
    if (!r.sku) continue;
    const k = `${r.base}|${r.sku}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const dupes = [...groups.values()].filter((g) => g.length > 1);
  fs.writeFileSync(
    path.join(OUT_DIR, "same-name-same-sku.csv"),
    csv([
      ["group", "cluster", "id", "name", "sku", "slug"],
      ...dupes.flatMap((g, i) =>
        g.map((r) => [i + 1, r.cluster, r.id, r.name, r.sku, r.slug]),
      ),
    ]),
  );
  summary.sameNameSameSku = {
    groups: dupes.length,
    products: dupes.reduce((n, g) => n + g.length, 0),
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
}

async function write(clusters, rows) {
  for (const { key, col } of clusters) {
    const todo = rows.filter((r) => r.cluster === key && r.rule !== "kept");
    let modified = 0;
    for (let i = 0; i < todo.length; i += BATCH) {
      const ops = todo.slice(i, i + BATCH).map((r) => ({
        updateOne: {
          // Only where still missing (or still the malformed value being
          // replaced): never overwrite a slug set meanwhile.
          filter: {
            _id: r._id,
            slug: r.replaces ? r.replaces : { $in: [null, ""] },
          },
          update: { $set: { slug: r.slug } },
        },
      }));
      const res = await col.bulkWrite(ops, { ordered: false });
      modified += res.modifiedCount;
      process.stdout.write(`\r${key}: ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
    }
    console.log(`\n${key}: ${modified} slugs written`);
  }
}

async function createIndexes(clusters) {
  for (const { key, col } of clusters) {
    await col.createIndex(
      { slug: 1 },
      {
        name: INDEX_NAME,
        unique: true,
        partialFilterExpression: { slug: { $type: "string" } },
      },
    );
    console.log(`${key}: index ${INDEX_NAME} ready`);
  }
}

async function main() {
  const started = Date.now();
  const clusters = await openClusters();
  try {
    const rows = await readAll(clusters);
    const problems = plan(rows);
    const errors = verify(rows);

    const count = (f) => rows.filter(f).length;
    const summary = {
      mode: WRITE ? "write" : "dry-run",
      at: new Date().toISOString(),
      products: rows.length,
      byCluster: Object.fromEntries(
        clusters.map(({ key }) => [key, count((r) => r.cluster === key)]),
      ),
      kept: count((r) => r.rule === "kept"),
      replacedMalformed: rows
        .filter((r) => r.replaces)
        .map((r) => `${r.replaces} → ${r.slug}`),
      toWrite: count((r) => r.rule && r.rule !== "kept"),
      byRule: {
        name: count((r) => r.rule === "name"),
        nameAndSku: count((r) => r.rule === "name+sku"),
        numbered: count((r) => r.rule === "numbered"),
      },
      longestSlug: Math.max(...rows.map((r) => (r.slug || "").length)),
      problems,
      verifyErrors: errors.slice(0, 50),
      verifyErrorCount: errors.length,
    };
    writeReport(rows, summary);

    console.log(JSON.stringify({ ...summary, verifyErrors: undefined }, null, 2));
    console.log(`report: ${OUT_DIR}`);

    if (problems.length || errors.length) {
      console.error("NOT SAFE TO WRITE — see problems / verifyErrors above.");
      process.exitCode = 1;
      return;
    }
    if (!WRITE) {
      console.log("Dry run: nothing written. Re-run with --write to apply.");
      return;
    }

    await write(clusters, rows);

    // Read back what is stored now and check it again before the index.
    const after = await readAll(clusters);
    for (const r of after) r.slug = r.existing;
    const afterErrors = verify(after);
    if (afterErrors.length) {
      console.error("After write:", afterErrors.slice(0, 20));
      process.exitCode = 1;
      return;
    }
    console.log(`after write: ${after.length} products, all with a unique slug`);
    await createIndexes(clusters);
  } finally {
    await Promise.all(clusters.map(({ conn }) => conn.close()));
    console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
