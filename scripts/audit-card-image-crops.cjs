/**
 * Which product cards still cut into the product?
 *
 * The card decides how to show an image at render time (useCardImageFit): a
 * product on a plain backdrop is shown whole, a photograph is cropped to fill
 * the tile. This asks the same question of every storefront image, using the
 * replica in lib/card-image-fit.cjs, and reports the cards where cropping
 * removes part of the subject rather than empty backdrop.
 *
 * Two numbers decide it:
 *
 *  - the verdict the card will reach, cover or contain;
 *  - how much of the subject's bounding box falls outside a square centre
 *    crop. A wide photograph loses only scenery and scores low here; a bath
 *    waste diagram spanning its frame loses the ends of the product.
 *
 * A `contain` verdict is never reported: nothing is cropped, so nothing can be
 * lost. Square images are skipped too — the tile is square, so both verdicts
 * render identically and neither can hide anything.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-card-image-crops.cjs
 *   LIMIT=0        products to check (0 = all storefront-visible)
 *   MIN_LOSS=0.15  share of the subject a crop must remove to be reported
 *   CONCURRENCY=6
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
const sharp = require("sharp");
const { connectMongo } = require("./mongo-connect.cjs");
const { classify, subjectBox, subjectLoss } = require("./lib/card-image-fit.cjs");
const { storefrontVisibilityClause } = require("../src/lib/pricedOnly.ts");

const LIMIT = Number(process.env.LIMIT || 0);
const MIN_LOSS = Number(process.env.MIN_LOSS || 0.15);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 6));
const OUT = path.join(__dirname, "card-image-crop-audit.json");

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);

async function mapPool(items, limit, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const index = i++;
        await worker(items[index], index);
      }
    }),
  );
}

async function main() {
  await connectMongo();
  const db = mongoose.connection.db;

  const query = { ...storefrontVisibilityClause(), shopifyProductId: { $nin: [null, ""] } };
  const total = await db.collection("products").countDocuments(query);
  log(`${total} storefront-visible product(s) with a Shopify link`);

  const cursor = db
    .collection("products")
    .find(query)
    .project({ name: 1, images: 1, shopifyImages: 1, brand: 1, category: 1 });
  const products = LIMIT ? await cursor.limit(LIMIT).toArray() : await cursor.toArray();

  const brands = new Map(
    (await db.collection("brands").find({}).project({ slug: 1 }).toArray()).map((b) => [
      String(b._id),
      b.slug,
    ]),
  );

  const flagged = [];
  let checked = 0;
  let square = 0;
  let whole = 0;
  let unreadable = 0;

  await mapPool(products, CONCURRENCY, async (p) => {
    const mirror = new Map((p.shopifyImages || []).map((l) => [l.sourceUrl, l.shopifyUrl]));
    const stored = (p.images || [])[0] || "";
    const url = mirror.get(stored) || stored;
    if (!url) return;

    try {
      const res = await fetch(url);
      if (!res.ok) { unreadable++; return; }
      const buf = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buf).metadata();
      checked++;
      if (meta.width === meta.height) { square++; return; }

      const verdict = await classify(buf);
      if (verdict.fit === "contain") { whole++; return; }

      const box = await subjectBox(buf, meta);
      const loss = subjectLoss(meta, box);
      if (loss < MIN_LOSS) return;

      flagged.push({
        id: String(p._id),
        name: p.name,
        brand: brands.get(String(p.brand)) || "",
        category: p.category || "",
        width: meta.width,
        height: meta.height,
        format: meta.format,
        subject: `${box.width}x${box.height}`,
        loss: Number((loss * 100).toFixed(1)),
        reason: verdict.reason,
        served: url,
      });
    } catch {
      unreadable++;
    }
    if (checked % 500 === 0) log(`  ${checked} checked · ${flagged.length} flagged`);
  });

  flagged.sort((a, b) => b.loss - a.loss);
  const byBrand = new Map();
  for (const f of flagged) byBrand.set(f.brand, (byBrand.get(f.brand) || 0) + 1);

  fs.writeFileSync(
    OUT,
    `${JSON.stringify({ checkedAt: new Date().toISOString(), minLoss: MIN_LOSS, checked, square, whole, flagged }, null, 2)}\n`,
  );

  console.log("\n================ RESULT ================");
  console.log(`images checked                : ${checked}`);
  console.log(`  square (fit cannot differ)  : ${square}`);
  console.log(`  shown whole (nothing lost)  : ${whole}`);
  console.log(`  cropped, losing >=${(MIN_LOSS * 100).toFixed(0)}% subject: ${flagged.length}`);
  console.log(`  unreadable                  : ${unreadable}`);
  console.log("\nby brand:");
  for (const [b, n] of [...byBrand].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`   ${String(n).padStart(4)}  ${b || "(none)"}`);
  }
  console.log("\nworst 25:");
  for (const f of flagged.slice(0, 25)) {
    console.log(
      `   loses ${String(f.loss).padStart(5)}%  ${String(f.width + "x" + f.height).padStart(11)} ${String(f.format).padEnd(4)} ` +
        `${f.reason.slice(0, 30).padEnd(32)} ${f.name.slice(0, 42)}`,
    );
  }
  console.log(`\nWritten to scripts/${path.basename(OUT)}`);

  await mongoose.disconnect();
  unregister();
}

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch { /* down */ }
  process.exit(1);
});
