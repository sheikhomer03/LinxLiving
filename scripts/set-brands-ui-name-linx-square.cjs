/**
 * Set storefront UI names for selected brands to "Linx Square".
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/set-brands-ui-name-linx-square.cjs
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { connectMongo } = require("./mongo-connect.cjs");

const TARGETS = [
  { match: /^mb\s*decor$/i, label: "MB Decor" },
  { match: /^nutra\s*flooring$/i, label: "Nutra Flooring" },
  { match: /^direct\s*flooring$/i, label: "Direct Flooring" },
];

const UI_NAME = "Linx Square";

async function main() {
  const { db } = await connectMongo();
  const brands = await db
    .collection("brands")
    .find({}, { projection: { name: 1, slug: 1, uiName: 1 } })
    .toArray();

  for (const t of TARGETS) {
    const brand =
      brands.find((b) => t.match.test(String(b.name || "").trim())) ||
      brands.find((b) => t.match.test(String(b.slug || "").replace(/-/g, " ")));

    if (!brand) {
      console.log(`NOT FOUND: ${t.label}`);
      const nearby = brands
        .filter((b) =>
          /mb|decor|nutra|direct|floor/i.test(
            `${b.name || ""} ${b.slug || ""}`,
          ),
        )
        .map((b) => `${b.name} (${b.slug})`);
      if (nearby.length) console.log("  nearby:", nearby.join(", "));
      continue;
    }

    const res = await db.collection("brands").updateOne(
      { _id: brand._id },
      { $set: { uiName: UI_NAME, updatedAt: new Date() } },
    );
    console.log({
      name: brand.name,
      slug: brand.slug,
      previousUiName: brand.uiName || null,
      uiName: UI_NAME,
      modified: res.modifiedCount,
    });
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
