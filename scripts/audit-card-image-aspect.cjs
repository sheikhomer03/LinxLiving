/**
 * How many product cards letterbox, and how badly?
 *
 * A card tile is square above the mobile breakpoint, and useImageFit switches
 * an image to `object-contain` once `object-cover` would crop more than a
 * fifth of it — so any lead image further than 20% off square is drawn with
 * white bands down two sides. That is what the FAKRO lifestyle shots and the
 * Schüco architectural photography have in common.
 *
 * Dimensions come from Shopify rather than by downloading the files: the CDN
 * is what the storefront actually serves, and its Admin API reports width and
 * height on the media itself, so the whole catalogue is a hundred-odd queries
 * instead of thousands of image fetches.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-card-image-aspect.cjs
 *   BATCH=50    products per Shopify query
 *   LIMIT=0     stop after N products (0 = all)
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { register } = require("tsx/cjs/api");
const unregister = register();

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

const BATCH = Math.max(1, Math.min(Number(process.env.BATCH) || 50, 100));
const LIMIT = Number(process.env.LIMIT || 0);
const OUT = path.join(__dirname, "card-image-aspect-audit.json");

/** Matches MAX_COVER_CROP in src/hooks/useImageFit.ts. */
const MAX_COVER_CROP = 0.2;

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);

const cropLoss = (w, h) => (!w || !h ? 0 : 1 - Math.min(w, h) / Math.max(w, h));

async function main() {
  await connectMongo();
  const db = mongoose.connection.db;

  // Only products the storefront will actually list, and only those whose lead
  // image Shopify holds — anything else is a different fault, not this one.
  const { storefrontVisibilityClause } = require("../src/lib/pricedOnly.ts");
  const query = {
    ...storefrontVisibilityClause(),
    shopifyProductId: { $nin: [null, ""] },
  };
  const total = await db.collection("products").countDocuments(query);
  log(`${total} storefront-visible product(s) with a Shopify link`);

  const cursor = db
    .collection("products")
    .find(query)
    .project({ name: 1, images: 1, shopifyImages: 1, shopifyProductId: 1, brand: 1 });

  const brands = new Map(
    (await db.collection("brands").find({}).project({ slug: 1 }).toArray()).map((b) => [
      String(b._id),
      b.slug,
    ]),
  );

  const rows = [];
  let batch = [];
  let seen = 0;

  async function flush() {
    if (!batch.length) return;
    const ids = batch.map((p) => p.shopifyProductId);
    let data;
    try {
      data = await shopifyAdminRequest(
        `query LeadMedia($ids:[ID!]!){
           nodes(ids:$ids){ id ... on Product { media(first:1){ nodes{
             ... on MediaImage { id status image { url width height } } } } } }
         }`,
        { ids },
      );
    } catch (e) {
      log(`  batch failed: ${e.message}`);
      batch = [];
      return;
    }
    const byId = new Map((data.nodes || []).filter(Boolean).map((n) => [n.id, n]));
    for (const p of batch) {
      const node = byId.get(p.shopifyProductId);
      const media = node?.media?.nodes?.[0];
      const img = media?.image;
      if (!img?.width || !img?.height) continue;
      const loss = cropLoss(img.width, img.height);
      rows.push({
        id: String(p._id),
        name: p.name,
        brand: brands.get(String(p.brand)) || "",
        width: img.width,
        height: img.height,
        loss: Number((loss * 100).toFixed(1)),
        letterboxed: loss > MAX_COVER_CROP,
        shape: img.width > img.height ? "landscape" : img.width < img.height ? "portrait" : "square",
        lead: (p.images || [])[0] || "",
      });
    }
    batch = [];
  }

  for await (const p of cursor) {
    batch.push(p);
    seen += 1;
    if (batch.length >= BATCH) {
      await flush();
      if (seen % 500 === 0) log(`  ${seen}/${total} · ${rows.length} measured`);
    }
    if (LIMIT && seen >= LIMIT) break;
  }
  await flush();

  const boxed = rows.filter((r) => r.letterboxed);
  const byBrand = new Map();
  for (const r of boxed) byBrand.set(r.brand, (byBrand.get(r.brand) || 0) + 1);

  fs.writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        threshold: MAX_COVER_CROP,
        measured: rows.length,
        letterboxed: boxed.length,
        byBrand: [...byBrand].sort((a, b) => b[1] - a[1]),
        products: boxed.sort((a, b) => b.loss - a.loss),
      },
      null,
      2,
    )}\n`,
  );

  console.log("\n================ RESULT ================");
  console.log(`lead images measured        : ${rows.length}`);
  console.log(`square (fill exactly)       : ${rows.filter((r) => r.loss === 0).length}`);
  console.log(`within the 20% crop budget  : ${rows.filter((r) => !r.letterboxed && r.loss > 0).length}`);
  console.log(`LETTERBOXED (>20% off square): ${boxed.length}`);
  console.log(`   landscape ${boxed.filter((r) => r.shape === "landscape").length}` +
    `   portrait ${boxed.filter((r) => r.shape === "portrait").length}`);
  console.log("\nworst affected brands:");
  for (const [b, n] of [...byBrand].sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(`   ${String(n).padStart(5)}  ${b || "(no brand)"}`);
  console.log("\nworst individual cards:");
  for (const r of boxed.slice(0, 12))
    console.log(`   ${String(r.width + "x" + r.height).padStart(11)} ${String(r.loss).padStart(5)}%  ${r.name.slice(0, 55)}`);
  console.log(`\nWritten to scripts/${path.basename(OUT)}`);

  await mongoose.disconnect();
  unregister();
}

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch { /* down */ }
  process.exit(1);
});
