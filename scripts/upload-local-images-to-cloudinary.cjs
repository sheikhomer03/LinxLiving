/**
 * Upload every locally-hosted image referenced by the database to Cloudinary,
 * then rewrite the DB reference to the Cloudinary URL.
 *
 * Why: menu/brand/type-tile records point at paths like `/fakro-products/XDP_01.jpg`,
 * which resolve to files in `public/`. Those files were never committed, so the
 * paths 404 in production while working fine locally. Moving them to Cloudinary
 * removes the dependency on repo-hosted assets entirely.
 *
 * Usage:
 *   node scripts/upload-local-images-to-cloudinary.cjs --dry     # report only
 *   node scripts/upload-local-images-to-cloudinary.cjs           # upload + rewrite
 *
 * Options:
 *   --dry                 scan and report, upload nothing, write nothing
 *   --collections=a,b     limit to these collections (default: all below)
 *   --folder=<prefix>     Cloudinary folder prefix (default: linx-living/local-assets)
 *   --upload-dir=<dir>    also upload every image under public/<dir> (recursive),
 *                         even when no document references it yet. Seeds the
 *                         manifest so migration scripts can hardcode Cloudinary
 *                         URLs instead of local paths.
 *   --only-dir            with --upload-dir, skip the database entirely
 *
 * Safe to re-run: uploads are keyed by a deterministic public_id and skipped if
 * already present, and rewritten documents no longer match the local-path filter.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const MANIFEST = path.join(__dirname, "cloudinary-asset-manifest.json");

const DRY = process.argv.includes("--dry");
const FOLDER =
  (process.argv.find((a) => a.startsWith("--folder=")) || "").split("=")[1] ||
  "linx-living/local-assets";
const ONLY = (process.argv.find((a) => a.startsWith("--collections=")) || "")
  .split("=")[1];
const UPLOAD_DIR = (process.argv.find((a) => a.startsWith("--upload-dir=")) || "")
  .split("=")[1];
const ONLY_DIR = process.argv.includes("--only-dir");

/** Collections whose documents may embed local image paths. */
const COLLECTIONS = ONLY
  ? ONLY.split(",").map((s) => s.trim()).filter(Boolean)
  : ["menus", "brands", "departments", "collections", "products"];

/** A DB value we should migrate: root-relative path to an image file. */
const LOCAL_IMAGE = /^\/[^\s?#]+\.(jpe?g|png|webp|avif|gif|svg)$/i;

for (const key of [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
]) {
  if (!process.env[key]) throw new Error(`Missing ${key} in .env`);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/** Cloudinary public_id for a local path, stable across runs. */
function publicIdFor(localPath) {
  const withoutExt = localPath.replace(/\.[^./]+$/, "");
  const cleaned = withoutExt
    .replace(/^\//, "")
    .split("/")
    .map((seg) =>
      decodeURIComponent(seg)
        .replace(/[^a-zA-Z0-9\-_]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean)
    .join("/");
  return `${FOLDER}/${cleaned}`;
}

/** Absolute file for a root-relative public path, or null when absent. */
function resolveLocalFile(localPath) {
  const rel = decodeURIComponent(localPath).replace(/^\//, "");
  const abs = path.join(PUBLIC_DIR, rel);
  // Refuse to walk outside public/.
  if (!abs.startsWith(PUBLIC_DIR)) return null;
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
}

/**
 * Walk a document and collect every dotted path holding a local image value.
 * Handles nested objects and arrays (products.images, variants[].imageUrl, ...).
 */
function collectLocalPaths(node, trail = [], out = []) {
  if (typeof node === "string") {
    if (LOCAL_IMAGE.test(node)) out.push({ field: trail.join("."), value: node });
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectLocalPaths(item, [...trail, i], out));
    return out;
  }
  if (node && typeof node === "object" && !(node instanceof Date)) {
    if (node._bsontype) return out; // ObjectId, Decimal128, ...
    for (const [key, value] of Object.entries(node)) {
      if (key === "_id") continue;
      collectLocalPaths(value, [...trail, key], out);
    }
  }
  return out;
}

const manifest = fs.existsSync(MANIFEST)
  ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
  : {};

/** Upload once per distinct local path; reuse the URL everywhere it appears. */
async function uploadOnce(localPath, absFile) {
  if (manifest[localPath]) return manifest[localPath];

  const public_id = publicIdFor(localPath);
  const res = await cloudinary.uploader.upload(absFile, {
    public_id,
    overwrite: false,
    unique_filename: false,
    use_filename: false,
    resource_type: "image",
  });

  manifest[localPath] = res.secure_url;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  return res.secure_url;
}

/** Every image file under a public/ subdirectory, as root-relative paths. */
function walkPublicDir(relDir) {
  const base = path.join(PUBLIC_DIR, relDir.replace(/^\/+|^public[\\/]/, ""));
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (/\.(jpe?g|png|webp|avif|gif|svg)$/i.test(entry.name)) {
        out.push("/" + path.relative(PUBLIC_DIR, abs).split(path.sep).join("/"));
      }
    }
  };
  if (!fs.existsSync(base)) throw new Error(`No such directory: ${base}`);
  walk(base);
  return out.sort();
}

(async () => {
  console.log(DRY ? "DRY RUN — nothing will be uploaded or written\n" : "LIVE RUN\n");
  console.log(`Cloudinary cloud : ${process.env.CLOUDINARY_CLOUD_NAME}`);
  console.log(`Target folder    : ${FOLDER}`);
  if (UPLOAD_DIR) console.log(`Upload dir       : public/${UPLOAD_DIR}`);
  if (!ONLY_DIR) console.log(`Collections      : ${COLLECTIONS.join(", ")}`);
  console.log("");

  if (UPLOAD_DIR) {
    const files = walkPublicDir(UPLOAD_DIR);
    console.log(`Seeding manifest from ${files.length} files under public/${UPLOAD_DIR}`);
    for (const localPath of files) {
      if (manifest[localPath]) {
        console.log(`  cached ${localPath}`);
        continue;
      }
      if (DRY) {
        console.log(`  would upload ${localPath} -> ${publicIdFor(localPath)}`);
        continue;
      }
      const url = await uploadOnce(localPath, path.join(PUBLIC_DIR, localPath.slice(1)));
      console.log(`  uploaded ${localPath}\n    -> ${url}`);
    }
    console.log("");
    if (ONLY_DIR) {
      console.log(`Manifest: ${path.relative(ROOT, MANIFEST)}`);
      process.exit(0);
    }
  }

  await connectMongo();
  const db = require("mongoose").connection.db;

  const missing = new Set();
  const seenFiles = new Set();
  let docsTouched = 0;
  let refsRewritten = 0;

  for (const name of COLLECTIONS) {
    const exists = await db.listCollections({ name }).hasNext();
    if (!exists) {
      console.warn(`skip ${name} — collection not found`);
      continue;
    }

    const cursor = db.collection(name).find({});
    let scanned = 0;
    let hits = 0;

    for await (const doc of cursor) {
      scanned++;
      const found = collectLocalPaths(doc);
      if (!found.length) continue;

      const $set = {};
      for (const { field, value } of found) {
        const absFile = resolveLocalFile(value);
        if (!absFile) {
          missing.add(value);
          continue;
        }
        seenFiles.add(value);

        if (DRY) {
          console.log(`${name}/${doc._id} ${field}\n  ${value}  ->  ${publicIdFor(value)}`);
          refsRewritten++;
          continue;
        }

        const url = await uploadOnce(value, absFile);
        $set[field] = url;
        console.log(`${name}/${doc._id} ${field}\n  ${value}\n  -> ${url}`);
        refsRewritten++;
      }

      if (!DRY && Object.keys($set).length) {
        $set.updatedAt = new Date();
        await db.collection(name).updateOne({ _id: doc._id }, { $set });
        docsTouched++;
      }
      hits++;
    }

    console.log(`\n-- ${name}: scanned ${scanned}, ${hits} with local images\n`);
  }

  console.log("=".repeat(60));
  console.log(`Distinct files   : ${seenFiles.size}`);
  console.log(`References       : ${refsRewritten} ${DRY ? "would be" : ""} rewritten`);
  if (!DRY) console.log(`Documents        : ${docsTouched} updated`);
  if (missing.size) {
    console.log(`\nMissing from public/ (left untouched — no file to upload):`);
    for (const m of [...missing].sort()) console.log(`  ${m}`);
  }
  if (!DRY) console.log(`\nManifest: ${path.relative(ROOT, MANIFEST)}`);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
