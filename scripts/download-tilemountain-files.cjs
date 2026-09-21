/**
 * Download the datasheets Tile Mountain links, and serve them ourselves.
 *
 * Their guides come from `tilemountain.co.uk/pdf/<name>.pdf` and are shared
 * across a whole range rather than being per product, so the 254 products
 * that carry one point at a short list of files. Hotlinking would leave the
 * storefront depending on a competitor's site staying up and keeping the
 * path stable, so each file is fetched once into
 * `public/product-files/tilemountain/` and `downloads[].url` is repointed at
 * our copy. `sourceUrl` is left as it was, so a later re-scrape can still
 * tell an unchanged document from a replaced one.
 *
 * Env:
 *   DRY_RUN=1  list what would be fetched
 *   FORCE=1    re-download files already on disk
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE = process.env.FORCE === "1";
const OUT_DIR = path.join(__dirname, "..", "public", "product-files", "tilemountain");
const PUBLIC_PREFIX = "/product-files/tilemountain/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Their own filename, minus anything a filesystem would object to. */
function fileNameFor(url) {
  const raw = decodeURIComponent(String(url).split("?")[0].split("/").pop() || "");
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe.toLowerCase().endsWith(".pdf") ? safe : safe + ".pdf";
}

/**
 * Where a link actually resolves.
 *
 * Their datasheet anchors are root-relative, so they read as www URLs, but
 * the uploaded attachments are served from the media host under /media —
 * www answers 404 for every one of them. Both spellings are tried, nearest
 * first.
 */
function candidates(url) {
  const p = new URL(url).pathname;
  return [url, "https://m2.tilemountain.co.uk/media" + p, "https://m2.tilemountain.co.uk" + p];
}

async function fetchOne(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "application/pdf,*/*",
      referer: "https://www.tilemountain.co.uk/",
    },
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res;
}

async function download(url, dest, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      let res = null;
      let last = null;
      for (const candidate of candidates(url)) {
        try {
          res = await fetchOne(candidate);
          break;
        } catch (e) {
          last = e;
          res = null;
        }
      }
      if (!res) throw last || new Error("unreachable");
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 512) throw new Error("suspiciously small (" + buf.length + " bytes)");
      fs.writeFileSync(dest, buf);
      return buf.length;
    } catch (e) {
      if (i === tries) throw e;
      await sleep(1200 * i);
    }
  }
  return 0;
}

async function main() {
  const conn = await connectMongo();
  const brand = await conn.db.collection("brands").findOne({ name: /^tile mountain$/i });
  if (!brand) throw new Error("Tile Mountain brand not found");
  const sec = await mongoose
    .createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 45000 })
    .asPromise();
  const P = sec.db.collection("products");

  const docs = await P.find({ brand: brand._id, "downloads.0": { $exists: true } })
    .project({ _id: 1, downloads: 1 })
    .toArray();

  /* One fetch per distinct file, however many products link it. */
  const wanted = new Map();
  for (const d of docs) {
    for (const f of d.downloads || []) {
      const src = String(f.sourceUrl || f.url || "").trim();
      if (!/^https?:\/\/(www\.)?tilemountain\.co\.uk\//i.test(src)) continue;
      if (!wanted.has(src)) wanted.set(src, fileNameFor(src));
    }
  }

  console.log("products with a datasheet : " + docs.length);
  console.log("distinct files            : " + wanted.size + (DRY_RUN ? "   (DRY RUN)" : ""));
  console.log("");

  if (!DRY_RUN) fs.mkdirSync(OUT_DIR, { recursive: true });

  const localFor = new Map();
  let fetched = 0, skipped = 0, failed = 0, bytes = 0;
  for (const [src, name] of wanted) {
    const dest = path.join(OUT_DIR, name);
    localFor.set(src, PUBLIC_PREFIX + name);
    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 512) {
      skipped += 1;
      continue;
    }
    if (DRY_RUN) {
      console.log("  would fetch  " + name);
      continue;
    }
    try {
      const n = await download(src, dest);
      bytes += n;
      fetched += 1;
      console.log("  " + String(Math.round(n / 1024)).padStart(6) + " KB  " + name);
    } catch (e) {
      failed += 1;
      localFor.delete(src);
      console.log("  FAILED        " + name + "   (" + e.message + ")");
    }
  }

  console.log("");
  console.log("downloaded : " + fetched + "   already held: " + skipped + "   failed: " + failed);
  console.log("bytes      : " + Math.round(bytes / 1024) + " KB");

  /* Repoint only the products whose file is now on disk. */
  const ops = [];
  for (const d of docs) {
    let changed = false;
    const next = (d.downloads || []).map((f) => {
      const src = String(f.sourceUrl || f.url || "").trim();
      const local = localFor.get(src);
      if (!local || f.url === local) return f;
      changed = true;
      return { ...f, url: local, sourceUrl: src };
    });
    if (changed) ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { downloads: next } } } });
  }

  if (!DRY_RUN && ops.length) {
    for (let i = 0; i < ops.length; i += 500) {
      await P.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
  }
  console.log("products repointed at our copy : " + (DRY_RUN ? 0 : ops.length));

  if (failed) console.log("\nINCOMPLETE — " + failed + " file(s) could not be fetched; those products still hotlink.");

  await mongoose.disconnect();
  await sec.close();
  process.exit(0);
}

main().catch((e) => { console.error("FAILED: " + e.message); process.exit(1); });
