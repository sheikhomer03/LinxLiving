/**
 * Repair The Under Floor Heating's product PDFs and move them to a shared,
 * de-duplicated folder.
 *
 * Background: scripts/enrich-ufhs-products.cjs saved a *per-product copy* of
 * every PDF into public/the-under-floor-heating/downloads/<handle>/. One
 * 10.3 MB brochure is linked from all 762 products, so 293 completed products
 * already cost 3.4 GB — and the run stopped before the other 469, leaving
 * their `downloads` / `manuals` / `installationMaintenanceGuides` /
 * `brochures` rows pointing at files that were never written (712 dead links).
 *
 * This script keeps one copy of each distinct document in
 *   public/the-under-floor-heating/downloads/_files/<name>.pdf
 * and repoints every product at it. 617 files (3.4 GB) collapse to ~232
 * distinct (~330 MB), and the ~195 documents that were never fetched are
 * pulled from the supplier.
 *
 * Phases (run in order):
 *   PHASE=plan    node --require ./scripts/mongo-dns.cjs scripts/fix-ufhs-pdfs.cjs
 *   PHASE=scrape  ...   downloads what is missing into _files/
 *   PHASE=apply   ...   rewrites the DB, then prunes the old per-product dirs
 *
 * Flags: DRY_RUN=1, LIMIT=n, CONCURRENCY=n (default 2), REQUEST_GAP_MS
 * (default 250), KEEP_OLD=1 (apply: leave the old folders on disk).
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://www.theunderfloorheatingstore.com";
const BRAND = "6a722de4958ec684cd75f123";
const PUBLIC_DIR = path.join(__dirname, "..", "public", "the-under-floor-heating");
const DOWNLOADS_DIR = path.join(PUBLIC_DIR, "downloads");
const SHARED_DIR = path.join(DOWNLOADS_DIR, "_files");
const SHARED_URL = "/the-under-floor-heating/downloads/_files";
const PLAN_FILE = path.join(__dirname, "_tmp-ufhs-pdf-plan.json");

const PHASE = (process.env.PHASE || "plan").toLowerCase();
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const REQUEST_GAP_MS = Math.max(0, Number(process.env.REQUEST_GAP_MS || 250));
const MAX_RETRIES = Math.max(1, Number(process.env.MAX_RETRIES || 5));
const KEEP_OLD = process.env.KEEP_OLD === "1";

/** Fields whose rows carry a `url` the storefront renders. */
const DOC_FIELDS = ["downloads", "manuals", "installationMaintenanceGuides", "brochures"];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const mb = (n) => (n / 1024 / 1024).toFixed(1) + " MB";
const isPdfUrl = (u) => /\.pdf(\?|$)/i.test(String(u || ""));
const isLocal = (u) => String(u || "").startsWith("/the-under-floor-heating/");

/** Identical to enrich-ufhs-products.cjs, so derived filenames match the DB. */
function slugify(text) {
  return String(text || "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function absUrl(src) {
  if (!src) return "";
  if (/^https?:/i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  return `${BASE}${src.startsWith("/") ? "" : "/"}${src}`;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ").trim();
}

function extractManualLinks(html) {
  const out = [], seen = new Set();
  const pats = [
    /<a[^>]*class="[^"]*pdp_manual_link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    /<a[^>]*href="([^"]+)"[^>]*class="[^"]*pdp_manual_link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
  ];
  for (const re of pats) {
    for (const m of String(html || "").matchAll(re)) {
      const href = absUrl(m[1]).split("?")[0];
      if (!href || seen.has(href)) continue;
      seen.add(href);
      out.push({ href, name: decodeEntities(m[2]) || path.basename(href) });
    }
  }
  return out;
}

function extractPdfLinks(html) {
  const out = [], seen = new Set();
  for (const m of String(html || "").matchAll(
    /<a[^>]+href=["']([^"']+\.pdf[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = absUrl(m[1]).split("?")[0];
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const name = String(m[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      || path.basename(href);
    out.push({ href, name });
  }
  for (const m of String(html || "").matchAll(/https?:\/\/[^"'\\\s>]+\.pdf/gi)) {
    const href = m[0].split("?")[0];
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, name: path.basename(href) });
  }
  return out;
}

/** The filename enrich-ufhs-products.cjs would have written for a link. */
function derivedFileName(link) {
  const clean = absUrl(link.href).split("?")[0];
  const ext = path.extname(clean).toLowerCase() || ".pdf";
  const base = slugify(path.parse(link.name || path.basename(clean)).name) || "file";
  return `${base}${ext}`;
}

async function fetchWithRetry(url, init = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxUfhsPdfRepair/1.0",
          Accept: "*/*",
          ...(init.headers || {}),
        },
      });
      if (res.status === 429 || res.status === 503) {
        const ra = Number(res.headers.get("retry-after") || 0);
        await delay((ra > 0 ? ra * 1000 : 1500 * attempt * attempt) + Math.floor(Math.random() * 400));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) await delay(600 * attempt);
    }
  }
  throw lastErr;
}

/** Walk every PDF already on disk, hashing content. */
function inventoryDisk() {
  const byPath = new Map(); // "<folder>/<file>" -> {hash,size}
  const byHash = new Map(); // hash -> {size, names:Map<name,count>, paths:[]}
  if (!fs.existsSync(DOWNLOADS_DIR)) return { byPath, byHash };
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.pdf$/i.test(e.name)) continue;
      const buf = fs.readFileSync(p);
      const h = sha1(buf);
      const rel = path.relative(DOWNLOADS_DIR, p).replace(/\\/g, "/");
      byPath.set(rel, { hash: h, size: buf.length });
      if (!byHash.has(h)) byHash.set(h, { size: buf.length, names: new Map(), paths: [] });
      const rec = byHash.get(h);
      rec.names.set(e.name, (rec.names.get(e.name) || 0) + 1);
      rec.paths.push(rel);
    }
  })(DOWNLOADS_DIR);
  return { byPath, byHash };
}

/**
 * One filename per distinct document.
 *
 * Five basenames legitimately cover two different documents (different
 * revisions of the same datasheet), so the loser of a name contest keeps its
 * name plus a short content hash rather than silently overwriting.
 */
function assignCanonicalNames(byHash) {
  const canonical = new Map(); // hash -> filename
  const taken = new Map(); // filename -> hash
  const entries = [...byHash.entries()].sort((a, b) => b[1].paths.length - a[1].paths.length);
  for (const [hash, rec] of entries) {
    const preferred = [...rec.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    let name = preferred;
    if (taken.has(name) && taken.get(name) !== hash) {
      const ext = path.extname(preferred);
      name = `${path.basename(preferred, ext)}-${hash.slice(0, 8)}${ext}`;
    }
    taken.set(name, hash);
    canonical.set(hash, name);
  }
  return canonical;
}

async function loadProducts() {
  const docs = await mongoose.connection.db.collection("products")
    .find({ brand: new mongoose.Types.ObjectId(BRAND) }).toArray();
  return LIMIT > 0 ? docs.slice(0, LIMIT) : docs;
}

/** Every local PDF url a product references, with where it came from. */
function productRefs(doc) {
  const refs = [];
  for (const field of DOC_FIELDS) {
    const list = doc[field];
    if (!Array.isArray(list)) continue;
    list.forEach((row, i) => {
      const url = String(row?.url || "").trim();
      if (url && isLocal(url) && isPdfUrl(url)) refs.push({ field, index: i, url });
      for (const [ci, c] of (row?.children || []).entries()) {
        const cu = String(c?.url || "").trim();
        if (cu && isLocal(cu) && isPdfUrl(cu)) {
          refs.push({ field, index: i, childIndex: ci, url: cu });
        }
      }
    });
  }
  return refs;
}

const relFromUrl = (u) => u.replace("/the-under-floor-heating/downloads/", "").split("?")[0];

// ---------------------------------------------------------------- plan ----
async function phasePlan() {
  const { byPath, byHash } = inventoryDisk();
  const nameToHashes = new Map();
  for (const [h, rec] of byHash) {
    for (const n of rec.names.keys()) {
      if (!nameToHashes.has(n)) nameToHashes.set(n, new Set());
      nameToHashes.get(n).add(h);
    }
  }

  const docs = await loadProducts();
  const resolved = []; // {productId, handle, url, hash, how}
  const missing = new Map(); // handle -> Set(fileName)
  const noHandle = [];
  let refCount = 0;

  for (const d of docs) {
    const handle = String(d.specs?.ufhsHandle || "").trim();
    for (const ref of productRefs(d)) {
      refCount++;
      const rel = relFromUrl(ref.url);
      const fileName = rel.split("/").pop();
      const onDisk = byPath.get(rel);
      if (onDisk) {
        resolved.push({ productId: String(d._id), url: ref.url, hash: onDisk.hash, how: "on-disk" });
        continue;
      }
      const candidates = nameToHashes.get(fileName);
      if (candidates && candidates.size === 1) {
        resolved.push({ productId: String(d._id), url: ref.url, hash: [...candidates][0], how: "same-name" });
        continue;
      }
      if (!handle) { noHandle.push({ productId: String(d._id), url: ref.url }); continue; }
      if (!missing.has(handle)) missing.set(handle, new Set());
      missing.get(handle).add(fileName);
    }
  }

  const totalBytes = [...byPath.values()].reduce((a, v) => a + v.size, 0);
  const uniqueBytes = [...byHash.values()].reduce((a, v) => a + v.size, 0);
  const needCount = [...missing.values()].reduce((a, s) => a + s.size, 0);

  console.log("products                  :", docs.length);
  console.log("local pdf references      :", refCount);
  console.log("  resolved from disk      :", resolved.filter((r) => r.how === "on-disk").length);
  console.log("  resolved by same name   :", resolved.filter((r) => r.how === "same-name").length);
  console.log("  need scraping           :", needCount, `(across ${missing.size} products)`);
  console.log("  unresolvable (no handle):", noHandle.length);
  console.log("");
  console.log("pdf files on disk         :", byPath.size, "=", mb(totalBytes));
  console.log("distinct documents        :", byHash.size, "=", mb(uniqueBytes));

  fs.writeFileSync(PLAN_FILE, JSON.stringify({
    generatedFor: docs.length,
    needByHandle: Object.fromEntries([...missing].map(([k, v]) => [k, [...v]])),
    noHandle,
  }, null, 2));
  console.log("\nplan written to", path.relative(process.cwd(), PLAN_FILE));
}

// -------------------------------------------------------------- scrape ----
async function phaseScrape() {
  if (!fs.existsSync(PLAN_FILE)) throw new Error("Run PHASE=plan first");
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));
  const handles = Object.entries(plan.needByHandle);
  if (!DRY_RUN) fs.mkdirSync(SHARED_DIR, { recursive: true });

  const staging = path.join(__dirname, "_tmp-ufhs-fetched");
  if (!DRY_RUN) fs.mkdirSync(staging, { recursive: true });

  let done = 0, got = 0, failed = 0;
  const notFound = [];
  const fetched = {}; // fileName -> staged path

  async function work(queue) {
    while (queue.length) {
      const [handle, names] = queue.shift();
      done++;
      const want = new Set(names.filter((n) => !fetched[n]));
      if (!want.size) continue;
      try {
        const res = await fetchWithRetry(`${BASE}/products/${handle}`);
        const html = await res.text();
        const manualLinks = extractManualLinks(html);
        const manualHrefs = new Set(manualLinks.map((f) => f.href));
        const links = [
          ...manualLinks,
          ...extractPdfLinks(html).filter((f) => !manualHrefs.has(f.href)),
        ].slice(0, 20);

        for (const link of links) {
          const fileName = derivedFileName(link);
          if (!want.has(fileName) || fetched[fileName]) continue;
          try {
            const fr = await fetchWithRetry(absUrl(link.href));
            const buf = Buffer.from(await fr.arrayBuffer());
            const dest = path.join(staging, fileName);
            if (!DRY_RUN) fs.writeFileSync(dest, buf);
            fetched[fileName] = dest;
            got++;
          } catch (e) {
            failed++;
            console.log(`  download fail ${fileName}: ${e.message}`);
          }
          await delay(REQUEST_GAP_MS);
        }
        for (const n of want) if (!fetched[n]) notFound.push({ handle, fileName: n });
      } catch (e) {
        failed++;
        console.log(`  page fail ${handle}: ${e.message}`);
      }
      if (done % 25 === 0) console.log(`  [${done}/${handles.length}] fetched=${got} failed=${failed}`);
      await delay(REQUEST_GAP_MS);
    }
  }

  const queue = handles.slice();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => work(queue)));

  console.log("\nproducts visited :", done);
  console.log("files fetched    :", got);
  console.log("failures         :", failed);
  console.log("still not found  :", notFound.length);
  fs.writeFileSync(path.join(__dirname, "_tmp-ufhs-notfound.json"), JSON.stringify(notFound, null, 2));
  console.log("staged in", path.relative(process.cwd(), staging));
}

// --------------------------------------------------------------- apply ----
async function phaseApply() {
  const staging = path.join(__dirname, "_tmp-ufhs-fetched");
  // Fold freshly-fetched files into the inventory by copying them in first.
  const { byPath, byHash } = inventoryDisk();
  const stagedByName = new Map();
  if (fs.existsSync(staging)) {
    for (const f of fs.readdirSync(staging)) {
      if (!/\.pdf$/i.test(f)) continue;
      const buf = fs.readFileSync(path.join(staging, f));
      const h = sha1(buf);
      stagedByName.set(f, { hash: h, buf });
      if (!byHash.has(h)) byHash.set(h, { size: buf.length, names: new Map(), paths: [] });
      const rec = byHash.get(h);
      rec.names.set(f, (rec.names.get(f) || 0) + 1);
    }
  }
  const canonical = assignCanonicalNames(byHash);

  const nameToHashes = new Map();
  for (const [h, rec] of byHash) {
    for (const n of rec.names.keys()) {
      if (!nameToHashes.has(n)) nameToHashes.set(n, new Set());
      nameToHashes.get(n).add(h);
    }
  }

  // 1. Materialise the shared folder.
  if (!DRY_RUN) fs.mkdirSync(SHARED_DIR, { recursive: true });
  let written = 0, bytes = 0;
  for (const [hash, rec] of byHash) {
    const name = canonical.get(hash);
    const dest = path.join(SHARED_DIR, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size === rec.size) continue;
    const src = rec.paths[0]
      ? path.join(DOWNLOADS_DIR, rec.paths[0])
      : null;
    const buf = src && fs.existsSync(src)
      ? fs.readFileSync(src)
      : [...stagedByName.values()].find((s) => s.hash === hash)?.buf;
    if (!buf) { console.log("  no source for", name); continue; }
    if (!DRY_RUN) fs.writeFileSync(dest, buf);
    written++; bytes += buf.length;
  }
  console.log("shared files written:", written, "=", mb(bytes));

  // 2. Repoint the database.
  const col = mongoose.connection.db.collection("products");
  const docs = await loadProducts();
  const rollback = [];
  let productsChanged = 0, urlsChanged = 0, unresolved = 0;

  for (const d of docs) {
    const before = {};
    const $set = {};
    let touched = false;

    for (const field of DOC_FIELDS) {
      const list = d[field];
      if (!Array.isArray(list) || !list.length) continue;
      let fieldTouched = false;
      const next = list.map((row) => {
        const remap = (u) => {
          const url = String(u || "").trim();
          if (!url || !isLocal(url) || !isPdfUrl(url)) return url;
          const rel = relFromUrl(url);
          if (rel.startsWith("_files/")) return url; // already migrated
          const fileName = rel.split("/").pop();
          const onDisk = byPath.get(rel);
          let hash = onDisk?.hash;
          if (!hash) {
            const staged = stagedByName.get(fileName);
            if (staged) hash = staged.hash;
          }
          if (!hash) {
            const cands = nameToHashes.get(fileName);
            if (cands && cands.size === 1) hash = [...cands][0];
          }
          if (!hash) { unresolved++; return url; }
          const target = `${SHARED_URL}/${canonical.get(hash)}`;
          if (target !== url) { fieldTouched = true; urlsChanged++; }
          return target;
        };
        const out = { ...row };
        if (row?.url !== undefined) out.url = remap(row.url);
        if (Array.isArray(row?.children)) {
          out.children = row.children.map((c) => ({ ...c, url: remap(c?.url) }));
        }
        return out;
      });
      if (fieldTouched) { before[field] = list; $set[field] = next; touched = true; }
    }

    if (!touched) continue;
    productsChanged++;
    rollback.push({ _id: String(d._id), before });
    if (!DRY_RUN) await col.updateOne({ _id: d._id }, { $set });
  }

  console.log("products updated    :", productsChanged);
  console.log("urls repointed      :", urlsChanged);
  console.log("urls left unresolved:", unresolved);

  if (!DRY_RUN && rollback.length) {
    const file = path.join(__dirname, "..",
      `rollback-ufhs-pdfs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
    console.log("rollback written to", path.basename(file));
  }

  // 3. Drop the old per-product folders.
  if (!DRY_RUN && !KEEP_OLD) {
    let removed = 0;
    for (const e of fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "_files") continue;
      fs.rmSync(path.join(DOWNLOADS_DIR, e.name), { recursive: true, force: true });
      removed++;
    }
    console.log("old product folders removed:", removed);
  }
}

(async () => {
  await connectMongo();
  console.log(`PHASE=${PHASE}${DRY_RUN ? " (dry run)" : ""}\n`);
  if (PHASE === "plan") await phasePlan();
  else if (PHASE === "scrape") await phaseScrape();
  else if (PHASE === "apply") await phaseApply();
  else throw new Error(`unknown PHASE ${PHASE}`);
  await mongoose.disconnect();
})().catch((e) => { console.error("ERR", e.stack); process.exit(1); });
