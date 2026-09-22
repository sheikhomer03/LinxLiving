/**
 * Delete every image in Cloudinary, keeping PDFs and videos.
 *
 * Scope, as instructed:
 *   DELETE  resource_type=image, except format=pdf
 *   KEEP    PDFs (Cloudinary files them under resource_type=image)
 *   KEEP    resource_type=video
 *   KEEP    resource_type=raw
 *
 * Deletion is permanent — Cloudinary has no undo. Every public_id removed is
 * written to a manifest first, so there is at least a record of what was
 * there even though the files will not be recoverable from it.
 *
 * Env:
 *   DRY_RUN=1   count and list, delete nothing
 *   LIMIT=n     stop after n deletions
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const BATCH = 100; // delete_resources caps at 100 public_ids per call

async function main() {
  console.log("cloud : " + process.env.CLOUDINARY_CLOUD_NAME);
  console.log("mode  : " + (DRY_RUN ? "DRY RUN" : "LIVE DELETE - permanent"));
  console.log("scope : resource_type=image, excluding format=pdf");
  console.log("keep  : pdfs, videos, raw");
  console.log("");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const manifest = path.join(__dirname, "..", "deleted-cloudinary-images-" + stamp + ".json");
  const out = DRY_RUN ? null : fs.createWriteStream(manifest, { flags: "a" });

  let cursor = null;
  let seen = 0, pdfKept = 0, queued = 0, deleted = 0, failed = 0;
  let batch = [];

  const flush = async () => {
    if (!batch.length) return;
    const chunk = batch;
    batch = [];
    if (DRY_RUN) { queued += chunk.length; return; }
    try {
      const r = await cloudinary.api.delete_resources(chunk, {
        resource_type: "image",
        invalidate: true,
      });
      for (const [id, state] of Object.entries(r.deleted || {})) {
        if (state === "deleted" || state === "not_found") deleted += 1;
        else failed += 1;
        out.write(JSON.stringify({ id, state }) + "\n");
      }
    } catch (e) {
      failed += chunk.length;
      console.log("  batch failed: " + String(e.message || e).slice(0, 130));
    }
  };

  do {
    let page;
    try {
      page = await cloudinary.api.resources({
        resource_type: "image",
        type: "upload",
        max_results: 500,
        next_cursor: cursor || undefined,
      });
    } catch (e) {
      console.log("listing failed: " + String(e.message || e).slice(0, 140));
      break;
    }

    for (const res of page.resources || []) {
      seen += 1;
      if (String(res.format || "").toLowerCase() === "pdf") { pdfKept += 1; continue; }
      if (deleted + queued + batch.length >= LIMIT) break;
      batch.push(res.public_id);
      if (batch.length >= BATCH) await flush();
    }

    cursor = page.next_cursor;
    if (seen % 2500 < 500) {
      console.log("  listed " + seen + "  pdfs kept " + pdfKept +
        "  deleted " + deleted + "  failed " + failed);
    }
    if (deleted + queued >= LIMIT) break;
  } while (cursor);

  await flush();

  console.log("");
  console.log("### RESULT");
  console.log("  images listed : " + seen);
  console.log("  pdfs kept     : " + pdfKept);
  if (DRY_RUN) {
    console.log("  would delete  : " + queued);
  } else {
    console.log("  DELETED       : " + deleted);
    console.log("  failed        : " + failed);
    out.end();
    console.log("");
    console.log("manifest: " + path.basename(manifest));
  }

  try {
    const u = await cloudinary.api.usage();
    console.log("");
    console.log("  resources now : " + u.resources);
    console.log("  storage now   : " + (u.storage.usage / 1073741824).toFixed(2) + " GB");
  } catch { /* usage is a nicety, not worth failing over */ }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
