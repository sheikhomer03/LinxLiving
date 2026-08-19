/**
 * Put the catalogue's videos on Shopify.
 *
 * The image sync skipped them on purpose — an MP4 offered as image media fails
 * the whole mutation — so until now the shop held no video at all. There are
 * two populations and they cost very different amounts:
 *
 *   external   YouTube / Vimeo references, stored as `youtube:<id>` markers in
 *              `images[]` or in `externalVideos[]`. Attached by reference; no
 *              file moves. Hundreds of products, seconds of work.
 *   hosted     Cloudinary MP4s in `images[]`. Shopify will not fetch these, so
 *              each is downloaded and pushed through a staged upload. Tens of
 *              products, ~10MB apiece.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-product-videos-to-shopify.cjs
 *
 *   MODE=external   only the reference-attached videos (default: both)
 *   MODE=hosted     only the file uploads
 *   DRY=1           report what would be sent, call nothing
 *   LIMIT=20        stop after N products
 *   CONCURRENCY=4   products in flight (external mode only)
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const MODE = String(process.env.MODE || "both").toLowerCase();
const DRY = process.env.DRY === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 4);

process.env.SHOPIFY_MAX_CONCURRENCY =
  process.env.SHOPIFY_MAX_CONCURRENCY || String(CONCURRENCY * 2);
process.env.SHOPIFY_MIN_GAP_MS = process.env.SHOPIFY_MIN_GAP_MS || "0";
// A ten-megabyte upload takes far longer than an ordinary mutation.
process.env.SHOPIFY_REQUEST_TIMEOUT_MS =
  process.env.SHOPIFY_REQUEST_TIMEOUT_MS || "180000";

const FAIL_LOG = path.join(__dirname, ".shopify-video-failures.jsonl");

async function main() {
  const { register } = require("tsx/cjs/api");
  const unregister = register();

  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { Product } = require("../src/models/Product.ts");
  const {
    syncExternalVideos,
    uploadHostedVideo,
    toExternalVideoUrl,
    isHostedVideoUrl,
  } = require("../src/lib/shopify/sync-video.ts");
  const { shopifyAdminHealthcheck } = require("../src/lib/shopify/admin.ts");

  await connectMongo(process.env.MONGODB_URI);
  const health = await shopifyAdminHealthcheck();
  if (!health.ok) throw new Error(`Shopify unreachable: ${health.error}`);
  console.log(`shop: ${health.shop}\n`);

  const logFailure = (product, sourceUrl, error) => {
    fs.appendFileSync(
      FAIL_LOG,
      JSON.stringify({
        _id: String(product._id),
        name: product.name,
        sourceUrl,
        error: String(error).slice(0, 300),
      }) + "\n",
    );
  };

  /** Every video reference a product carries, split by how Shopify takes it. */
  const videosOf = (p) => {
    const fromImages = (p.images || []).map((s) => String(s || "").trim());
    const fromExternal = (p.externalVideos || []).map((v) => String(v?.src || "").trim());
    const all = [...fromImages, ...fromExternal].filter(Boolean);
    return {
      external: [...new Set(all.filter((s) => toExternalVideoUrl(s)))],
      hosted: [...new Set(all.filter((s) => isHostedVideoUrl(s)))],
    };
  };

  // ------------------------------------------------------------- external
  if (MODE === "both" || MODE === "external") {
    const filter = {
      shopifyProductId: { $nin: [null, ""] },
      $or: [
        { images: { $regex: "youtube|vimeo", $options: "i" } },
        { "externalVideos.0": { $exists: true } },
      ],
    };
    const total = await Product.countDocuments(filter);
    const target = Math.min(total, LIMIT);
    console.log(`=== EXTERNAL VIDEO === ${total} product(s), doing ${target}\n`);

    let done = 0, attached = 0, failed = 0, skipped = 0;
    const cursor = Product.find(filter).sort({ _id: 1 }).limit(target).cursor();
    const inFlight = new Set();

    const handle = async (p) => {
      const { external } = videosOf(p);
      if (!external.length) { skipped += 1; return; }
      if (DRY) {
        console.log(`  would attach ${external.length} to ${String(p.name).slice(0, 44)}`);
        return;
      }
      try {
        const result = await syncExternalVideos(
          p.shopifyProductId,
          external,
          (p.shopifyVideos || []).filter((v) => v.kind === "external"),
        );
        const hosted = (p.shopifyVideos || []).filter((v) => v.kind === "video");
        await Product.updateOne(
          { _id: p._id },
          { $set: { shopifyVideos: [...hosted, ...result.links] } },
          { timestamps: false },
        );
        attached += result.added;
      } catch (error) {
        failed += 1;
        logFailure(p, external.join(","), error.message);
        console.error(`  ✗ ${String(p.name).slice(0, 44)} — ${String(error.message).slice(0, 90)}`);
      }
    };

    for await (const p of cursor) {
      const task = handle(p).finally(() => inFlight.delete(task));
      inFlight.add(task);
      if (inFlight.size >= CONCURRENCY) await Promise.race(inFlight);
      done += 1;
      if (done % 25 === 0) {
        await Promise.all(inFlight);
        console.log(`  ${done}/${target}  attached ${attached}  failed ${failed}`);
      }
    }
    await Promise.all(inFlight);
    await cursor.close();
    console.log(
      `\nexternal: ${done} products, ${attached} videos attached, ${failed} failed, ${skipped} had none\n`,
    );
  }

  // --------------------------------------------------------------- hosted
  if (MODE === "both" || MODE === "hosted") {
    const filter = {
      shopifyProductId: { $nin: [null, ""] },
      images: { $regex: "/video/upload/|\\.mp4|\\.webm|\\.mov", $options: "i" },
    };
    const products = await Product.find(filter).sort({ _id: 1 }).limit(LIMIT);
    const files = products.reduce((n, p) => n + videosOf(p).hosted.length, 0);
    console.log(`=== HOSTED VIDEO === ${products.length} product(s), ${files} file(s)\n`);

    let uploaded = 0, failed = 0, already = 0;

    for (const p of products) {
      const { hosted } = videosOf(p);
      if (!hosted.length) continue;

      const links = [...(p.shopifyVideos || [])];
      const have = new Set(links.filter((v) => v.kind === "video").map((v) => v.sourceUrl));

      for (const url of hosted) {
        if (have.has(url)) { already += 1; continue; }
        if (DRY) {
          console.log(`  would upload ${url.split("/").pop().slice(0, 46)} for ${String(p.name).slice(0, 34)}`);
          continue;
        }
        const started = Date.now();
        try {
          const link = await uploadHostedVideo(p.shopifyProductId, url);
          if (link) {
            links.push(link);
            uploaded += 1;
            console.log(
              `  ok ${String(p.name).slice(0, 34).padEnd(36)} ${url.split("/").pop().slice(0, 34)}  ${Math.round((Date.now() - started) / 1000)}s`,
            );
          }
        } catch (error) {
          failed += 1;
          logFailure(p, url, error.message);
          console.error(`  ✗ ${String(p.name).slice(0, 34)} — ${String(error.message).slice(0, 90)}`);
        }
      }

      if (!DRY) {
        await Product.updateOne(
          { _id: p._id },
          { $set: { shopifyVideos: links } },
          { timestamps: false },
        );
      }
    }
    console.log(
      `\nhosted: ${uploaded} uploaded, ${already} already present, ${failed} failed\n`,
    );
  }

  if (fs.existsSync(FAIL_LOG) && fs.statSync(FAIL_LOG).size) {
    console.log(`failures logged to ${FAIL_LOG}`);
  }

  await mongoose.disconnect();
  unregister();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
