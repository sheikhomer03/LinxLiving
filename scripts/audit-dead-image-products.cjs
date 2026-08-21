/**
 * The products that can no longer show a picture, and why.
 *
 * A handful of products reference Cloudinary files that are gone. Shopify could
 * not fetch them, so nothing was mirrored, and with Cloudinary no longer served
 * the storefront has nothing left to render — these are the only products in
 * the catalogue showing a placeholder.
 *
 * Each source is fetched to say whether it is genuinely missing or merely
 * failed once, because the answer decides the remedy: a 404 needs the artwork
 * re-supplied, anything else can simply be re-synced.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-dead-image-products.cjs
 */
const path = require("path");
const fs = require("fs");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const VIDEO = /\/video\/upload\/|\.(mp4|webm|mov|m4v)(\?|$)|^youtube:|^vimeo:/i;

async function probe(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    return String(res.status);
  } catch (error) {
    return String(error.message || "error").slice(0, 24);
  }
}

(async () => {
  const c = await connectMongo();
  const col = c.db.collection("products");
  const brands = await c.db.collection("brands").find({}).project({ name: 1 }).toArray();
  const brandName = new Map(brands.map((b) => [String(b._id), b.name]));

  const dead = [];
  for await (const p of col
    .find({ "images.0": { $exists: true } })
    .project({ name: 1, brand: 1, images: 1, shopifyImages: 1, shopifyProductUrl: 1 })) {
    const mirrored = new Set(
      (p.shopifyImages || []).filter((x) => x.shopifyUrl).map((x) => x.sourceUrl),
    );
    const stills = (p.images || []).filter(
      (s) => /^https?:/i.test(s) && !VIDEO.test(s),
    );
    if (!stills.length) continue;
    if (stills.some((s) => mirrored.has(s))) continue;
    dead.push({ product: p, stills });
  }

  console.log(`products with no usable image: ${dead.length}\n`);

  const byBrand = new Map();
  const byStatus = new Map();
  const report = [];

  for (const { product, stills } of dead) {
    const brand = brandName.get(String(product.brand)) || "(no brand)";
    byBrand.set(brand, (byBrand.get(brand) || 0) + 1);

    // One probe per product is enough to characterise it; they fail together.
    const status = await probe(stills[0]);
    byStatus.set(status, (byStatus.get(status) || 0) + 1);

    console.log(
      `  ${String(product.name).slice(0, 44).padEnd(46)} ${brand.slice(0, 18).padEnd(20)} ${stills.length} img  source ${status}`,
    );

    report.push({
      _id: String(product._id),
      name: product.name,
      brand,
      shopifyProductUrl: product.shopifyProductUrl || null,
      sourceStatus: status,
      images: stills,
    });
  }

  console.log("\nby brand:");
  for (const [b, n] of [...byBrand].sort((a, b2) => b2[1] - a[1])) {
    console.log(`   ${String(n).padStart(3)}  ${b}`);
  }
  console.log("\nsource response:");
  for (const [s, n] of [...byStatus].sort((a, b2) => b2[1] - a[1])) {
    console.log(`   ${String(n).padStart(3)}  ${s}${s === "404" ? "  (file gone — needs new artwork)" : "  (re-syncable)"}`);
  }

  const out = path.join(process.cwd(), "products-without-images.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nfull list -> ${out}`);

  await c.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
