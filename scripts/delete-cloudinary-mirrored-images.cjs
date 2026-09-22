/**
 * Delete Cloudinary images that are confirmed present on Shopify's CDN.
 *
 * Safe set: a Cloudinary URL that appears as `sourceUrl` in a `shopifyImages`
 * pair whose `shopifyUrl` points at cdn.shopify.com. That is proof the file was
 * mirrored and the storefront resolves it to Shopify.
 *
 * Deliberately NOT deleted:
 *   - PDFs. Cloudinary files them under resource_type=image, and the Otto
 *     Tiles installation guides live there.
 *   - Videos and raw files.
 *   - Any Cloudinary image with no Shopify pair — those still render from
 *     Cloudinary via `preferredImageUrl`'s fallback.
 *   - Cloudinary assets not referenced by any product, whose role (option
 *     swatches, variant images) has not been established.
 *
 * Deletion is permanent. DRY_RUN=1 first.
 *
 * Env:
 *   DRY_RUN=1   list what would go, delete nothing
 *   LIMIT=n     cap the number deleted
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const BATCH = 100; // Cloudinary delete_resources caps at 100 per call

const bare = (u) => String(u || "").split("?")[0];
const isCloud = (u) => /res\.cloudinary\.com/i.test(String(u || ""));
const isShop = (u) => /cdn\.shopify\.com/i.test(String(u || ""));

/**
 * Cloudinary public_id from a delivery URL.
 * .../upload/v1234567890/folder/name.jpg  ->  folder/name
 */
function publicIdOf(url) {
  const m = bare(url).match(/\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(.+)$/);
  if (!m) return null;
  return m[1].replace(/\.[a-z0-9]+$/i, "");
}

const isPdf = (url) => /\.pdf$/i.test(bare(url));

async function main() {
  const { db } = await connectMongo();
  const P = db.collection("products");

  console.log(DRY_RUN ? "MODE: DRY RUN - nothing will be deleted" : "MODE: LIVE DELETE");
  console.log("");

  // Walk every product, collecting cloudinary sources that ARE mirrored.
  const safe = new Set();
  let unpaired = 0, pdfs = 0, scanned = 0;
  let lastId = null;

  for (;;) {
    const q = {};
    if (lastId) q._id = { $gt: lastId };
    const page = await P.find(q)
      .project({ images: 1, shopifyImages: 1 })
      .sort({ _id: 1 })
      .limit(500)
      .toArray();
    if (!page.length) break;

    for (const p of page) {
      lastId = p._id;
      scanned += 1;
      const paired = new Set();
      for (const s of p.shopifyImages || []) {
        if (s && s.sourceUrl && s.shopifyUrl && isShop(s.shopifyUrl)) {
          paired.add(bare(s.sourceUrl));
        }
      }
      for (const u of p.images || []) {
        if (!isCloud(u)) continue;
        if (isPdf(u)) { pdfs += 1; continue; }
        if (!paired.has(bare(u))) { unpaired += 1; continue; }
        const id = publicIdOf(u);
        if (id) safe.add(id);
      }
    }
    if (scanned % 5000 < 500) console.log("  scanned " + scanned + ", safe so far " + safe.size);
  }

  console.log("");
  console.log("### WHAT WOULD BE DELETED");
  console.log("  products scanned            : " + scanned);
  console.log("  cloudinary images MIRRORED  : " + safe.size + "   <- delete these");
  console.log("");
  console.log("### WHAT IS KEPT");
  console.log("  unpaired (no shopify copy)  : " + unpaired);
  console.log("  pdfs skipped                : " + pdfs);
  console.log("  videos / raw                : untouched (not queried)");
  console.log("  unreferenced cloudinary     : untouched (role unverified)");
  console.log("");

  const ids = [...safe].slice(0, LIMIT === Infinity ? undefined : LIMIT);
  if (!ids.length) { console.log("nothing to do"); process.exit(0); }

  if (DRY_RUN) {
    console.log("[dry] sample of public_ids that would be deleted:");
    for (const id of ids.slice(0, 5)) console.log("    " + id);
    console.log("");
    console.log("[dry] " + ids.length + " images, " + Math.ceil(ids.length / BATCH) + " api calls");
    process.exit(0);
  }

  // Record what we delete, so the list survives even though the files do not.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(__dirname, "..", "deleted-cloudinary-" + stamp + ".json");
  fs.writeFileSync(file, JSON.stringify({ deletedAt: stamp, publicIds: ids }, null, 1));
  console.log("manifest written: " + path.basename(file));
  console.log("");

  let done = 0, ok = 0, failed = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    try {
      const r = await cloudinary.api.delete_resources(chunk, {
        resource_type: "image",
        invalidate: true,
      });
      for (const v of Object.values(r.deleted || {})) {
        if (v === "deleted") ok += 1; else failed += 1;
      }
    } catch (e) {
      failed += chunk.length;
      console.log("  batch failed: " + String(e.message || e).slice(0, 120));
    }
    done += chunk.length;
    if (done % 2000 < BATCH || done >= ids.length) {
      console.log("  " + done + "/" + ids.length + "  deleted " + ok + "  failed " + failed);
    }
  }

  console.log("");
  console.log("done - deleted " + ok + ", failed " + failed);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
