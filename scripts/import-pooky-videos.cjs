/**
 * Attach Pooky's Vimeo product videos to our products.
 *
 * Pooky hosts these on Vimeo rather than shipping files, so there is nothing
 * to mirror into public/ — the PDP plays the same embed their own site does.
 * What we store is the id, the preview still Shopify serves for it, and the
 * position the video held in Pooky's gallery.
 *
 * The gallery takes one flat list of srcs with videos inline, so each video is
 * also spliced into `images` at its source position using the bare
 * `vimeo:<id>` form the codebase already uses for YouTube.
 *
 * Input: scripts/pooky-media-scan.json, from scripts/scan-pooky-media.cjs.
 * Shopify's /products.json omits video entirely, so that scan is the only
 * place this data comes from.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-pooky-videos.cjs
 *   node --require ./scripts/mongo-dns.cjs scripts/import-pooky-videos.cjs --apply
 *   node --require ./scripts/mongo-dns.cjs scripts/import-pooky-videos.cjs --rollback <file.json>
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const APPLY = process.argv.includes("--apply");
const ROLLBACK =
  process.argv.indexOf("--rollback") > -1
    ? process.argv[process.argv.indexOf("--rollback") + 1]
    : null;

const SCAN = path.join(__dirname, "pooky-media-scan.json");
const BRAND_SLUG = "pooky";

/** `vimeo:<id>` / `youtube:<id>` — the form isGalleryVideoUrl already knows. */
function srcFor(media) {
  const host = String(media.host || "").toLowerCase();
  const id = String(media.external_id || "").trim();
  if (!id) return "";
  if (host === "vimeo") return `vimeo:${id}`;
  if (host === "youtube") return `youtube:${id}`;
  return "";
}

async function main() {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const products = db.collection("products");

  if (ROLLBACK) {
    const plan = JSON.parse(fs.readFileSync(ROLLBACK, "utf8"));
    for (const row of plan.previous || []) {
      await products.updateOne(
        { _id: new mongoose.Types.ObjectId(row.id) },
        {
          $set: {
            images: row.images,
            externalVideos: row.externalVideos,
            updatedAt: new Date(),
          },
        },
      );
    }
    console.log(`Restored ${(plan.previous || []).length} product(s)`);
    await mongoose.disconnect();
    return;
  }

  if (!fs.existsSync(SCAN)) {
    throw new Error(`Missing ${SCAN} — run scripts/scan-pooky-media.cjs first`);
  }
  const scan = JSON.parse(fs.readFileSync(SCAN, "utf8"));
  const withVideo = scan.productsWithVideo || [];
  console.log(
    `${withVideo.length} product(s) with video in the scan ` +
      `(scanned ${scan.productsSampled})\n`,
  );

  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error(`Brand "${BRAND_SLUG}" not found`);

  const rollback = { previous: [] };
  let updated = 0;
  let unmatched = 0;
  let videoCount = 0;
  let skipped = 0;

  for (const entry of withVideo) {
    const doc = await products.findOne(
      { brand: brand._id, "specs.pookyHandle": entry.handle },
      { projection: { name: 1, images: 1, externalVideos: 1 } },
    );
    if (!doc) {
      unmatched++;
      console.log(`  NO MATCH  ${entry.handle}`);
      continue;
    }

    const videos = [];
    for (const m of entry.media || []) {
      const src = srcFor(m);
      if (!src) continue;
      videos.push({
        host: String(m.host || "").toLowerCase(),
        externalId: String(m.external_id || ""),
        src,
        posterUrl: String(m.preview_image?.src || ""),
        position: Number.isFinite(Number(m.position)) ? Number(m.position) : null,
        alt: String(m.alt || ""),
      });
    }
    if (!videos.length) {
      skipped++;
      continue;
    }

    // Stills stay in their existing order; each video is inserted at the
    // 1-based position Pooky gave it, clamped to the end of the list.
    const stills = (doc.images || []).filter((s) => !/^(vimeo|youtube):/i.test(s));
    const images = [...stills];
    for (const v of [...videos].sort((a, b) => (a.position || 0) - (b.position || 0))) {
      const at = v.position != null ? Math.min(v.position - 1, images.length) : images.length;
      images.splice(Math.max(0, at), 0, v.src);
    }

    rollback.previous.push({
      id: String(doc._id),
      images: doc.images || [],
      externalVideos: doc.externalVideos || [],
    });

    if (APPLY) {
      await products.updateOne(
        { _id: doc._id },
        { $set: { images, externalVideos: videos, updatedAt: new Date() } },
      );
    }
    updated++;
    videoCount += videos.length;
    if (updated <= 10 || APPLY === false) {
      console.log(
        `  ${APPLY ? "UPDATE" : "WOULD UPDATE"}  ${doc.name.slice(0, 58).padEnd(58)} ` +
          `${videos.length} video(s)  [${videos.map((v) => v.src).join(", ")}]`,
      );
    }
  }

  console.log(
    `\n${APPLY ? "Applied" : "Dry run"}: ${updated} product(s), ${videoCount} video(s). ` +
      `${unmatched} unmatched, ${skipped} with no usable id.`,
  );

  if (APPLY && rollback.previous.length) {
    const file = path.join(
      __dirname,
      "..",
      `rollback-pooky-videos-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(rollback, null, 2));
    console.log(`Rollback written to ${path.basename(file)}`);
  }
  if (!APPLY) console.log("Re-run with --apply to write.");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
