/**
 * Find every product whose artwork is too small to render sharply.
 *
 * The PDP gallery renders around 1000px wide on a retina screen, so anything
 * whose longest side is under ~900px is being upscaled and reads as blurry.
 * The images themselves are the problem, not the rendering: the pipeline is
 * supplier → Cloudinary → Shopify, and a small original stays small at every
 * hop, so the fix has to start at whichever supplier fed it.
 *
 * Dimensions come from the Cloudinary Search API in one sweep rather than a
 * HEAD per URL — there are six figures' worth of assets and only one of them
 * knows the pixel size without downloading the file.
 *
 * Writes scripts/low-res-image-audit.json.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-low-res-images.cjs
 *   MIN_EDGE=900   longest side below this counts as low resolution
 *   REFRESH=1      re-list Cloudinary instead of reusing the cached dimensions
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MIN_EDGE = Number(process.env.MIN_EDGE || 900);
const REFRESH = process.env.REFRESH === "1";
const CACHE = path.join(__dirname, "_tmp-cloudinary-dimensions.json");
const OUT = path.join(__dirname, "low-res-image-audit.json");

/** public_id → "WxH", cached because the sweep costs a few hundred API calls. */
async function loadDimensions() {
  if (!REFRESH && fs.existsSync(CACHE)) {
    const cached = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    console.log(`Reusing ${Object.keys(cached).length} cached dimension(s)`);
    return cached;
  }
  const dims = {};
  let cursor;
  let page = 0;
  do {
    const res = await cloudinary.search
      .expression("resource_type:image AND folder:linx-living/products/*")
      .max_results(500)
      .next_cursor(cursor)
      .execute();
    for (const r of res.resources || []) dims[r.public_id] = `${r.width}x${r.height}`;
    cursor = res.next_cursor;
    if (++page % 20 === 0) console.log(`  listed ${Object.keys(dims).length} asset(s)`);
  } while (cursor);
  fs.writeFileSync(CACHE, `${JSON.stringify(dims)}\n`);
  console.log(`Listed ${Object.keys(dims).length} Cloudinary asset(s)`);
  return dims;
}

/** A Cloudinary delivery URL's public id is everything after the version. */
function publicIdOf(url) {
  const m = /res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:[^/]+\/)*?v\d+\/(.+)$/.exec(
    String(url || ""),
  );
  if (!m) return "";
  return m[1].replace(/\.[a-z0-9]+$/i, "");
}

async function main() {
  const dims = await loadDimensions();

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brands = new Map(
    (await db.collection("brands").find({}).project({ slug: 1, name: 1 }).toArray()).map(
      (b) => [String(b._id), b.slug || b.name],
    ),
  );

  const products = await db
    .collection("products")
    .find({}, { projection: { name: 1, brand: 1, images: 1, shopifyImages: 1, specs: 1 } })
    .toArray();
  console.log(`Checking ${products.length} product(s) against ${MIN_EDGE}px\n`);

  const rows = [];
  let unknown = 0;
  const byBrand = {};

  for (const p of products) {
    const urls = [...new Set(p.images || [])].filter((u) => /^https?:/i.test(u));
    if (!urls.length) continue;
    const sized = [];
    for (const u of urls) {
      const id = publicIdOf(u);
      const wh = id && dims[id];
      if (!wh) {
        unknown++;
        continue;
      }
      const [w, h] = wh.split("x").map(Number);
      sized.push({ url: u, w, h, edge: Math.max(w, h) });
    }
    if (!sized.length) continue;
    const low = sized.filter((s) => s.edge < MIN_EDGE);
    if (!low.length) continue;
    const brand = brands.get(String(p.brand)) || "(no brand)";
    byBrand[brand] = (byBrand[brand] || 0) + 1;
    rows.push({
      id: String(p._id),
      name: p.name,
      brand,
      images: sized.length,
      lowResImages: low.length,
      smallest: `${Math.min(...low.map((s) => s.w))}x${Math.min(...low.map((s) => s.h))}`,
      urls: low.map((s) => ({ url: s.url, size: `${s.w}x${s.h}` })),
    });
  }

  rows.sort((a, b) => b.lowResImages - a.lowResImages);
  fs.writeFileSync(
    OUT,
    `${JSON.stringify(
      { minEdge: MIN_EDGE, products: products.length, affected: rows.length, byBrand, rows },
      null,
      2,
    )}\n`,
  );

  console.log(`${rows.length} product(s) carry at least one image under ${MIN_EDGE}px`);
  if (unknown) console.log(`${unknown} image URL(s) had no Cloudinary record (skipped)`);
  console.log("\nBy brand:");
  for (const [b, n] of Object.entries(byBrand).sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(5)}  ${b}`);
  console.log(`\nWritten to scripts/${path.basename(OUT)}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
