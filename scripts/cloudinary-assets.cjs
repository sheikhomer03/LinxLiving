/**
 * Cloudinary URLs for assets that used to be served from `public/`.
 *
 * Background: menu/tile records once stored root-relative paths like
 * `/fakro-products/XDP_01.jpg`. Those resolve against `public/`, which is not
 * committed, so they 404 in production while working locally. Everything under
 * `public/fakro-products` now lives on Cloudinary; `cloudinary-asset-manifest.json`
 * maps the old local path to its Cloudinary URL.
 *
 * Migration scripts should call `assetUrl("/fakro-products/X.jpg")` rather than
 * writing a local path into the database.
 */
const fs = require("fs");
const path = require("path");

const MANIFEST_PATH = path.join(__dirname, "cloudinary-asset-manifest.json");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const FOLDER = "linx-living/local-assets";

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return {};
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

let manifest = loadManifest();

/**
 * Cloudinary URL for a formerly-local path.
 * Throws rather than silently returning a path that would 404 in production.
 */
function assetUrl(localPath) {
  const url = manifest[localPath];
  if (!url) {
    throw new Error(
      `No Cloudinary URL for "${localPath}". Upload it first:\n` +
        `  node scripts/upload-local-images-to-cloudinary.cjs --upload-dir=${localPath
          .replace(/^\//, "")
          .split("/")[0]} --only-dir`,
    );
  }
  return url;
}

/** True when the asset has a known Cloudinary URL. */
function hasAsset(localPath) {
  return Boolean(manifest[localPath]);
}

/**
 * Upload a file under public/ on demand and remember it.
 * For scripts that generate images at run time (e.g. baked tiles), where a
 * static manifest entry cannot exist yet.
 */
async function uploadPublicFile(localPath, { overwrite = true } = {}) {
  if (!overwrite && manifest[localPath]) return manifest[localPath];

  const { v2: cloudinary } = require("cloudinary");
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  const abs = path.join(PUBLIC_DIR, localPath.replace(/^\//, ""));
  if (!fs.existsSync(abs)) throw new Error(`Missing file: ${abs}`);

  const public_id =
    `${FOLDER}/` +
    localPath
      .replace(/\.[^./]+$/, "")
      .replace(/^\//, "")
      .split("/")
      .map((s) => s.replace(/[^a-zA-Z0-9\-_]+/g, "-").replace(/^-+|-+$/g, ""))
      .filter(Boolean)
      .join("/");

  const res = await cloudinary.uploader.upload(abs, {
    public_id,
    overwrite,
    invalidate: overwrite,
    unique_filename: false,
    use_filename: false,
    resource_type: "image",
  });

  manifest = { ...loadManifest(), [localPath]: res.secure_url };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  return res.secure_url;
}

module.exports = { assetUrl, hasAsset, uploadPublicFile, MANIFEST_PATH };
