/**
 * Upload the homepage project films (and their posters) to Cloudinary.
 *
 * Vercel has no Git LFS support: `public/home/**` is LFS-tracked, so the build
 * checks out 130-byte pointer files and the deployed site serves those instead
 * of the mp4s. The films played locally and were black on live. Cloudinary is
 * already this project's media host, so the films move there and the entries in
 * src/components/home/*Films.ts reference absolute Cloudinary URLs.
 *
 * Usage:
 *   node scripts/upload-real-projects-videos-to-cloudinary.cjs           # dry run
 *   APPLY=1 node scripts/upload-real-projects-videos-to-cloudinary.cjs   # upload
 *
 * Options:
 *   CONCURRENCY=3   parallel uploads (video uploads are large; keep this low)
 *   OUT=path        where to write the local-path -> Cloudinary-URL manifest
 *   ONLY=a.mp4,b.jpg  limit the run to these files (basename or web path)
 *   OVERWRITE=1     replace what is already there, and rewrite the URLs in
 *                   src/components/home/*Films* to the new version
 *
 * Idempotent: a public_id that already exists is reused rather than re-uploaded,
 * so a partial run can simply be repeated. OVERWRITE=1 is the exception — it is
 * for a film whose *content* changed, such as one de-branded by
 * scripts/replace-film-wordmark.cjs. Overwriting mints a new version segment,
 * so the URLs held in the film lists are rewritten to match rather than left
 * pointing at a version the CDN may still be serving from cache.
 */
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const APPLY = process.env.APPLY === "1";
const OVERWRITE = process.env.OVERWRITE === "1";
const ONLY = (process.env.ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const OUT =
  process.env.OUT || path.join(__dirname, "real-projects-cloudinary.json");

const ROOT = path.join(__dirname, "..");
const FILM_SOURCES = [
  "src/components/home/RealProjects.tsx",
  "src/components/home/realProjectsFilms.ts",
  "src/components/home/fakroFilms.ts",
  "src/components/home/britmetFilms.ts",
  "src/components/home/nokenFilms.ts",
  "src/components/home/pookyFilms.ts",
];

/**
 * Every /home/real-projects asset referenced as a src or poster.
 *
 * Two shapes count. A local path is one this script has not moved yet; a
 * Cloudinary URL is one it has, and that still needs finding — a film whose
 * content changes has to be re-uploaded under the same public_id, and after
 * the first run every entry in the film lists is a URL, not a path.
 */
function referencedPaths() {
  const found = new Set();
  const local = /"?(?:src|poster)"?:\s*"(\/home\/real-projects\/[^"]+)"/g;
  const hosted = /https:\/\/res\.cloudinary\.com\/[^"'\s]*?(\/home\/real-projects\/[^"'\s]+)/g;
  for (const rel of FILM_SOURCES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const re of [local, hosted]) {
      let m;
      while ((m = re.exec(text))) found.add(m[1]);
    }
  }
  return [...found].sort();
}

/** linx-living/home/real-projects/<name-without-extension>. */
function publicIdFor(webPath) {
  const withoutLeadingSlash = webPath.replace(/^\//, "");
  return `linx-living/${withoutLeadingSlash}`.replace(/\.[^./]+$/, "");
}

const isVideo = (p) => /\.(mp4|webm|mov|m4v)$/i.test(p);

async function alreadyThere(publicId, resourceType) {
  try {
    const res = await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
    });
    return res.secure_url || null;
  } catch {
    return null;
  }
}

async function uploadOne(webPath) {
  const localPath = path.join(ROOT, "public", webPath.replace(/^\//, ""));
  const resourceType = isVideo(webPath) ? "video" : "image";
  const publicId = publicIdFor(webPath);

  if (!fs.existsSync(localPath)) {
    return { webPath, error: "missing on disk" };
  }
  // An LFS pointer is a small text file where the media should be — uploading
  // one would put the pointer on the CDN and look like success.
  const head = fs.readFileSync(localPath).subarray(0, 40).toString("utf8");
  if (head.startsWith("version https://git-lfs")) {
    return { webPath, error: "LFS pointer, not the real file (run git lfs pull)" };
  }

  const bytes = fs.statSync(localPath).size;
  const existing = await alreadyThere(publicId, resourceType);
  if (existing && !OVERWRITE) return { webPath, url: existing, bytes, skipped: true };
  if (!APPLY) return { webPath, url: null, bytes, planned: true };

  /*
   * Verify against the API rather than trusting the upload response.
   *
   * `upload_large` returned no error and no `secure_url` for eighteen of the
   * twenty-seven films — the run reported success and only nine were really
   * there. A URL in the response is not proof the asset landed, so each upload
   * is followed by a resource lookup and retried if that comes back empty.
   */
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await cloudinary.uploader.upload_large(localPath, {
        public_id: publicId,
        resource_type: resourceType,
        overwrite: OVERWRITE,
        // Purge the CDN copy too: without this the old cut keeps being served
        // from cache under the URLs already in the film lists.
        invalidate: OVERWRITE,
        chunk_size: 6 * 1024 * 1024,
        // The default 60s is well short of what a 74MB film needs.
        timeout: 20 * 60 * 1000,
      });
      const confirmed = (await alreadyThere(publicId, resourceType)) || null;
      // On an overwrite the upload response carries the new version; the
      // lookup is only there to prove the asset is really present.
      const url = (OVERWRITE ? res?.secure_url : confirmed) || confirmed || null;
      if (url && confirmed) return { webPath, url, bytes, attempt };
      lastError = confirmed
        ? "upload returned no url"
        : "not present after upload";
    } catch (e) {
      lastError = e.message || String(e);
    }
  }
  return { webPath, error: `${lastError} (3 attempts)`, bytes };
}

/** Rewrite a film list's URL for one asset to the version just uploaded. */
function rewriteSources(webPath, url) {
  const name = path.basename(webPath);
  const re = new RegExp(
    `https://res\\.cloudinary\\.com/[^"'\\s]*?/${name.replace(/\./g, "\\.")}`,
    "g",
  );
  const touched = [];
  for (const rel of [...FILM_SOURCES, path.relative(ROOT, OUT)]) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const next = text.replace(re, url);
    if (next !== text) {
      fs.writeFileSync(file, next);
      touched.push(rel);
    }
  }
  return touched;
}

async function main() {
  let paths = referencedPaths();
  if (ONLY.length) {
    paths = paths.filter((p) => ONLY.includes(p) || ONLY.includes(path.basename(p)));
    const missing = ONLY.filter(
      (o) => !paths.some((p) => p === o || path.basename(p) === o),
    );
    if (missing.length) {
      console.error(`ONLY names nothing referenced: ${missing.join(", ")}`);
      process.exit(1);
    }
  }
  const videos = paths.filter(isVideo);
  const posters = paths.filter((p) => !isVideo(p));
  console.log(
    `${paths.length} referenced files — ${videos.length} videos, ${posters.length} posters`,
  );
  console.log(APPLY ? "APPLY=1 — uploading\n" : "dry run (set APPLY=1 to upload)\n");

  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
    while (cursor < paths.length) {
      const webPath = paths[cursor++];
      const out = await uploadOne(webPath).catch((e) => ({
        webPath,
        error: e.message,
      }));
      results.push(out);
      const mb = out.bytes ? (out.bytes / 1048576).toFixed(1) + "MB" : "";
      const state = out.error
        ? `ERROR ${out.error}`
        : out.skipped
          ? "already on Cloudinary"
          : out.planned
            ? "would upload"
            : "uploaded";
      console.log(
        `[${results.length}/${paths.length}] ${state} ${mb} ${webPath}`,
      );
    }
  });
  await Promise.all(workers);

  const failed = results.filter((r) => r.error);
  const manifest = ONLY.length && fs.existsSync(OUT)
    ? JSON.parse(fs.readFileSync(OUT, "utf8"))
    : {};
  for (const r of results) if (r.url) manifest[r.webPath] = r.url;

  if (OVERWRITE && APPLY) {
    let n = 0;
    for (const r of results) {
      if (!r.url || r.skipped || r.planned) continue;
      n += rewriteSources(r.webPath, r.url).length ? 1 : 0;
    }
    console.log(`\nrewrote URLs for ${n} asset(s) in the film lists`);
  }
  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));

  const totalMb =
    results.reduce((sum, r) => sum + (r.bytes || 0), 0) / 1048576;
  console.log(
    `\n${Object.keys(manifest).length} on Cloudinary, ${failed.length} failed, ${totalMb.toFixed(0)}MB total`,
  );
  if (failed.length) failed.forEach((f) => console.log("  FAILED", f.webPath, f.error));
  console.log(`manifest: ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
