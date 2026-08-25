/**
 * Point the Otto usage icons at the Shopify copies that already exist.
 *
 * The PDP's "Tile Usage" block rendered a tick and a label with an empty box
 * between them. The icons were in the database all along — 357 products carry
 * fourteen-odd `usage[].image` URLs each — but they pointed at Cloudinary, and
 * `withShopifyOptionImages` blanks an option image with no Shopify copy on the
 * way to the page. Nothing was broken about the files; the site refuses to
 * display that host, which is the rule.
 *
 * No upload is involved. mirror-cloudinary-assets-to-shopify lists
 * `usage.image` among the fields it mirrors, and it has already run: all 4,962
 * icon URLs are in `assetMirrors` with a live Shopify CDN URL against each.
 * What it does not do — by design, it is a mirror rather than a migration — is
 * rewrite the products, and nothing on the storefront reads that map. So the
 * bytes have been sitting in the shop while the page asked Cloudinary for
 * them. This swaps each stored URL for the copy already recorded.
 *
 * A missing mirror is left alone rather than blanked: an icon still on
 * Cloudinary renders nothing today and would render nothing after, and leaving
 * the URL in place means a later mirror run can still pick it up.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-usage-icon-images.cjs
 *   DRY=1                 report the work, write nothing
 *   ROLLBACK=<file.json>  restore the URLs recorded by a previous run
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY = process.env.DRY === "1";
const ROLLBACK_FILE = process.env.ROLLBACK || "";
const ON_SHOPIFY = /cdn\.shopify\.com|cdn\.shopifycdn\.net/i;

async function main() {
  await connectMongo();
  const db = mongoose.connection.db;
  const products = db.collection("products");
  const mirrors = db.collection("assetMirrors");

  if (ROLLBACK_FILE) {
    const data = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
    let n = 0;
    for (const row of data.products || []) {
      await products.updateOne(
        { _id: new mongoose.Types.ObjectId(row._id) },
        { $set: { usage: row.usage } },
      );
      n += 1;
    }
    console.log(`rolled back ${n} product(s)`);
    await mongoose.disconnect();
    return;
  }

  const rows = await products
    .find({ "usage.image": { $regex: "^https?://" } })
    .project({ name: 1, usage: 1 })
    .toArray();
  console.log(`${rows.length} product(s) carry usage icons`);

  const stored = new Set();
  for (const p of rows) {
    for (const u of p.usage || []) {
      const src = String(u?.image || "").trim();
      if (src && !ON_SHOPIFY.test(src)) stored.add(src);
    }
  }
  console.log(`${stored.size} distinct icon URL(s) still pointing at Cloudinary`);

  // One query for the lot: the mirror is keyed by the URL stored before it ran.
  const map = new Map();
  const cursor = mirrors.find(
    { sourceUrl: { $in: [...stored] }, shopifyUrl: { $nin: ["", null] } },
    { projection: { sourceUrl: 1, shopifyUrl: 1 } },
  );
  for await (const m of cursor) map.set(m.sourceUrl, m.shopifyUrl);
  console.log(`${map.size} of them have a Shopify copy recorded`);

  const rollback = { products: [] };
  const ops = [];
  let swapped = 0;
  let unmirrored = 0;

  for (const p of rows) {
    const usage = (p.usage || []).map((u) => ({ ...u }));
    let changed = false;
    usage.forEach((u, i) => {
      const src = String(u?.image || "").trim();
      if (!src || ON_SHOPIFY.test(src)) return;
      const shopifyUrl = map.get(src);
      if (!shopifyUrl) { unmirrored++; return; }
      usage[i].image = shopifyUrl;
      swapped++;
      changed = true;
    });
    if (!changed) continue;
    rollback.products.push({ _id: String(p._id), name: p.name, usage: p.usage });
    ops.push({
      updateOne: { filter: { _id: p._id }, update: { $set: { usage, updatedAt: new Date() } } },
    });
  }

  console.log(`\nproducts to rewrite : ${ops.length}`);
  console.log(`icon URLs to swap   : ${swapped}`);
  if (unmirrored) console.log(`left on Cloudinary  : ${unmirrored} (no mirror recorded)`);

  if (DRY) {
    const sample = rollback.products[0];
    if (sample) {
      console.log(`\nexample — ${sample.name}`);
      console.log(`  from ${sample.usage[0]?.image}`);
      console.log(`  to   ${map.get(sample.usage[0]?.image) || "(unchanged)"}`);
    }
    console.log("\nDRY=1 — nothing written.");
    await mongoose.disconnect();
    return;
  }

  for (let i = 0; i < ops.length; i += 200) {
    await products.bulkWrite(ops.slice(i, i + 200), { ordered: false });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), `rollback-usage-icons-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(rollback, null, 2)}\n`);
  console.log(`\nrewritten ${ops.length} product(s)`);
  console.log(`rollback: ${file}`);

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch { /* down */ }
  process.exit(1);
});
