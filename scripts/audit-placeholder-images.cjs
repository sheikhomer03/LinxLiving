/**
 * Find every product whose artwork is the supplier's "Awaiting Image" card.
 *
 * The Extruda fencing parts all render the same picture because all four
 * Cloudinary uploads hold identical bytes: mbdecor publishes a placeholder
 * when it has no photograph, and the scrape copied it per product. The URLs
 * differ, so nothing downstream can tell these apart from real artwork —
 * only the bytes give it away.
 *
 * Cloudinary records each asset's size, so the placeholder can be found
 * without downloading the catalogue: list the brand's assets, take the ones
 * whose byte count matches, and confirm by hash.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-placeholder-images.cjs
 *   BRAND=mb-decor    brand folder to scan (default mb-decor)
 *   REFRESH=1         re-list Cloudinary rather than reusing the cache
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const fs = require("fs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BRAND = process.env.BRAND || "mb-decor";
const REFRESH = process.env.REFRESH === "1";
const CACHE = path.join(__dirname, `_tmp-cloudinary-${BRAND}-assets.json`);
const OUT = path.join(__dirname, `placeholder-image-audit-${BRAND}.json`);

/** One product known to carry it, used to learn the placeholder's fingerprint. */
const SEED =
  "https://res.cloudinary.com/diibcfikb/image/upload/v1786041385/" +
  "linx-living/products/mb-decor/extruda-fence-grey-aluminium-fence-post-2-48m-1.jpg";

const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

async function listAssets() {
  if (!REFRESH && fs.existsSync(CACHE)) {
    const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    console.log(`Reusing ${c.length} cached asset record(s)`);
    return c;
  }
  const out = [];
  let cursor;
  do {
    const res = await cloudinary.search
      .expression(`resource_type:image AND folder:linx-living/products/${BRAND}*`)
      .with_field("context")
      .max_results(500)
      .next_cursor(cursor)
      .execute();
    for (const r of res.resources || [])
      out.push({ public_id: r.public_id, bytes: r.bytes, width: r.width, height: r.height, url: r.secure_url });
    cursor = res.next_cursor;
    console.log(`  listed ${out.length}`);
  } while (cursor);
  fs.writeFileSync(CACHE, `${JSON.stringify(out)}\n`);
  return out;
}

async function main() {
  const seed = Buffer.from(await (await fetch(SEED)).arrayBuffer());
  const seedHash = md5(seed);
  console.log(`Placeholder: ${seed.length} bytes, md5 ${seedHash.slice(0, 16)}\n`);

  const assets = await listAssets();
  console.log(`${assets.length} asset(s) under linx-living/products/${BRAND}`);

  // Byte count is a cheap filter; the hash is what actually decides.
  const candidates = assets.filter((a) => a.bytes === seed.length);
  console.log(`${candidates.length} share its exact byte count — confirming by hash…`);

  const confirmed = [];
  for (const c of candidates) {
    try {
      const b = Buffer.from(await (await fetch(c.url)).arrayBuffer());
      if (md5(b) === seedHash) confirmed.push(c);
    } catch {
      /* an asset we cannot read cannot be confirmed */
    }
  }
  console.log(`${confirmed.length} confirmed placeholder upload(s)\n`);

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const urls = new Set(confirmed.map((c) => c.url));
  const byPublicId = new Set(confirmed.map((c) => c.public_id));

  const brandDoc = await db.collection("brands").findOne({ slug: BRAND });
  const products = await db
    .collection("products")
    .find({ brand: brandDoc?._id }, { projection: { name: 1, images: 1, specs: 1 } })
    .toArray();

  const idOf = (u) => {
    const m = /image\/upload\/(?:[^/]+\/)*?v\d+\/(.+)$/.exec(String(u || ""));
    return m ? m[1].replace(/\.[a-z0-9]+$/i, "") : "";
  };

  const affected = [];
  for (const p of products) {
    const bad = (p.images || []).filter((u) => urls.has(u) || byPublicId.has(idOf(u)));
    if (!bad.length) continue;
    affected.push({
      id: String(p._id),
      name: p.name,
      sku: p.specs?.sku || "",
      sourceUrl: p.specs?.sourceUrl || "",
      images: (p.images || []).length,
      placeholders: bad.length,
      onlyImage: bad.length === (p.images || []).length,
    });
  }

  affected.sort((a, b) => Number(b.onlyImage) - Number(a.onlyImage) || a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, `${JSON.stringify({ brand: BRAND, placeholderMd5: seedHash, affected }, null, 2)}\n`);

  const blank = affected.filter((a) => a.onlyImage);
  console.log(`${affected.length} product(s) carry the placeholder`);
  console.log(`${blank.length} of them have no other image — the PDP shows nothing else\n`);
  for (const a of affected.slice(0, 30))
    console.log(`  ${a.onlyImage ? "[blank]" : "[mixed]"} ${a.sku.padEnd(12)} ${a.name.slice(0, 58)}`);
  if (affected.length > 30) console.log(`  …and ${affected.length - 30} more`);
  console.log(`\nWritten to scripts/${path.basename(OUT)}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
