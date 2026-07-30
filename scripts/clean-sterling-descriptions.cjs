/**
 * Clean Sterlingbuild product descriptions that still contain Magento scrape junk
 * (wishlist / cart / checkout / raw markdown).
 *
 * Usage: node --require ./scripts/mongo-dns.cjs scripts/clean-sterling-descriptions.cjs
 *        DRY_RUN=1 ...  — preview only
 */
require("dotenv").config({ path: ".env" });
const { connectMongo } = require("./mongo-connect.cjs");

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractProductDescription(md) {
  let raw = String(md || "");
  const start = raw.search(/Short Description|Product Highlights|Why Choose/i);
  if (start >= 0) raw = raw.slice(start);

  const cut = raw.search(
    /More Information|From\s*£|Add to Wishlist|Add To Bag|Est\.?\s*delivery|Click\s*&\s*Collect|Checkout as|You may also need|Qty\s*-|Window Size|Choose product options|Creating an account|Forgot Your Password|##\s*Products/i,
  );
  if (cut > 40) raw = raw.slice(0, cut);

  raw = raw
    .replace(/^Short Description\s*/i, "")
    .replace(/^Product Highlights\s*/i, "")
    .replace(/^Why Choose[^\n]*\s*/i, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\*+/g, " ")
    .replace(/#{1,6}\s*/g, "")
    .replace(/https?:\/\/\S+/g, " ");

  // Undo over-aggressive brand splits from an earlier cleanup pass
  raw = raw.replace(/\bRoof\s+LITE\b/gi, "RoofLITE");

  return cleanText(raw).slice(0, 4000);
}

(async () => {
  const dry = process.env.DRY_RUN === "1";
  const conn = await connectMongo();
  const db = conn.db;
  const brand = await db.collection("brands").findOne({ slug: "sterlingbuild" });
  if (!brand) throw new Error("sterlingbuild brand not found");

  const products = await db
    .collection("products")
    .find({ brand: brand._id })
    .project({ name: 1, description: 1 })
    .toArray();

  let updated = 0;
  let skipped = 0;
  let empty = 0;
  const samples = [];

  for (const p of products) {
    const next = extractProductDescription(p.description);
    if (!next) {
      empty++;
      continue;
    }
    if (next === cleanText(p.description)) {
      skipped++;
      continue;
    }
    if (samples.length < 3) {
      samples.push({
        name: p.name,
        before: String(p.description || "").slice(0, 180),
        after: next.slice(0, 280),
      });
    }
    if (!dry) {
      await db.collection("products").updateOne(
        { _id: p._id },
        { $set: { description: next, updatedAt: new Date() } },
      );
    }
    updated++;
  }

  console.log(
    JSON.stringify(
      {
        dry,
        total: products.length,
        updated,
        skipped,
        empty,
        samples,
      },
      null,
      2,
    ),
  );
  await conn.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
