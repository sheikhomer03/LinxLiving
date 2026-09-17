/**
 * Re-encode the staged photography in /public as WebP.
 *
 * `next.config.ts` sets `images.unoptimized` (Vercel's optimizer returns 402
 * on this plan), so whatever is on disk is exactly what the browser downloads
 * — no resizing, no format negotiation. The homepage and department banners
 * were rendered out as PNG, which is a lossless format doing its best with a
 * photograph: 1536x1024 interiors at 2.2-2.8 MB each. The catalogue stock
 * shots were worse, full camera originals up to 5152x7728 and 8.6 MB, painted
 * into a banner no wider than about 1500 CSS px.
 *
 * One product page pulled 4.65 MB of those. At q82 the same pictures are
 * 100-250 KB and there is nothing to see between them at display size.
 *
 * Originals are left where they are. Nothing references them once the .webp
 * siblings are in place, so they can be deleted whenever someone is confident
 * in the conversion; keeping them costs only repository size.
 *
 *   node scripts/optimize-static-images.cjs [--force]
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

/** Long edge beyond which a source is downscaled before encoding. */
const MAX_EDGE = 2000;
const QUALITY = 82;

const TARGETS = [
  "public/home/hero/wood-flooring.png",
  "public/home/hero/heating-flooring.png",
  "public/home/hero/kitchen-tiles.png",
  "public/home/hero/heated-bathroom.png",
  "public/home/hero/bathroom-tiles.png",
  "public/home/hero/track-order.png",
  "public/images/tiles1.jpg",
  "public/images/tiles2.jpg",
  "public/images/tiles3.jpg",
  "public/images/tiles4.jpg",
  "public/images/tiles5.jpg",
  "public/images/tiles6.jpg",
  "public/images/trade-account-hero.png",
];

const force = process.argv.includes("--force");

(async () => {
  let before = 0;
  let after = 0;

  for (const rel of TARGETS) {
    const src = path.join(process.cwd(), rel);
    if (!fs.existsSync(src)) {
      console.log(`skip (missing)   ${rel}`);
      continue;
    }
    const out = src.replace(/\.(png|jpe?g)$/i, ".webp");
    const srcBytes = fs.statSync(src).size;
    before += srcBytes;

    if (fs.existsSync(out) && !force) {
      after += fs.statSync(out).size;
      console.log(`skip (exists)    ${path.relative(process.cwd(), out)}`);
      continue;
    }

    const meta = await sharp(src).metadata();
    const longEdge = Math.max(meta.width || 0, meta.height || 0);
    let pipeline = sharp(src);
    if (longEdge > MAX_EDGE) {
      pipeline = pipeline.resize({
        width: meta.width >= meta.height ? MAX_EDGE : undefined,
        height: meta.height > meta.width ? MAX_EDGE : undefined,
        withoutEnlargement: true,
      });
    }
    const buf = await pipeline.webp({ quality: QUALITY }).toBuffer();
    fs.writeFileSync(out, buf);
    after += buf.length;

    const dims = await sharp(buf).metadata();
    console.log(
      `${(srcBytes / 1048576).toFixed(2)} MB -> ${(buf.length / 1024)
        .toFixed(0)
        .padStart(4)} KB  ${meta.width}x${meta.height} -> ${dims.width}x${dims.height}  ${rel}`,
    );
  }

  console.log(
    `\ntotal ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(
      2,
    )} MB  (${Math.round((1 - after / before) * 100)}% smaller)`,
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
