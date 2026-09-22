/**
 * Drop the unused product text index.
 *
 * `name_text_description_text` is ~70 MB and no application query can reach
 * it: `$text` appears nowhere in `src/` or `scripts/`, and a text index is
 * addressable only through that operator. Search is `$regex` — see
 * `getPublicProducts` (products.ts) and the admin equivalent.
 *
 * Step 1 (removing the declaration from `Product.ts`) MUST already be done,
 * or Mongoose's autoIndex will rebuild it on the next model use. This script
 * refuses to run if the declaration is still present.
 *
 * The full index spec is written to a rollback file before anything is
 * dropped, so it can be recreated exactly.
 *
 * Env:
 *   DRY_RUN=1   report only
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const MB = (n) => (n / 1048576).toFixed(2);

/** Guard: the schema must no longer declare a text index. */
function declarationStillActive() {
  const file = path.join(__dirname, "..", "src", "models", "Product.ts");
  const src = fs.readFileSync(file, "utf8");
  // Strip block comments, then look for a live text-index declaration.
  const live = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return /ProductSchema\.index\(\s*\{[^}]*["']text["']/.test(live);
}

async function main() {
  if (declarationStillActive()) {
    console.error(
      "REFUSING: src/models/Product.ts still declares a text index.\n" +
        "Complete step 1 first, or Mongoose will rebuild it on next boot.",
    );
    process.exit(1);
  }
  console.log("step 1 verified: no live text-index declaration in Product.ts");
  console.log("");

  const { db } = await connectMongo();
  const P = db.collection("products");

  const before = await db.stats();
  const indexes = await P.indexes();
  const target = indexes.find((i) => JSON.stringify(i.key).includes("_fts"));

  if (!target) {
    console.log("no text index present — nothing to do");
    process.exit(0);
  }

  const stats = await db.command({ collStats: "products" });
  const size = (stats.indexSizes || {})[target.name] || 0;

  console.log("index      : " + target.name);
  console.log("size       : " + MB(size) + " MB");
  console.log("key        : " + JSON.stringify(target.key));
  console.log("weights    : " + JSON.stringify(target.weights || {}));
  console.log("");
  console.log("cluster before:");
  console.log("  dataSize  : " + MB(before.dataSize) + " MB");
  console.log("  indexSize : " + MB(before.indexSize) + " MB");
  console.log("  billed    : " + MB(before.dataSize + before.indexSize) + " MB / 512 MB");
  console.log("");

  if (DRY_RUN) {
    console.log("[dry] would drop " + target.name);
    process.exit(0);
  }

  // Everything needed to recreate it, byte for byte.
  const spec = {
    collection: "products",
    name: target.name,
    key: target.key,
    weights: target.weights || null,
    default_language: target.default_language || null,
    language_override: target.language_override || null,
    textIndexVersion: target.textIndexVersion || null,
    sizeBytes: size,
    droppedAt: new Date().toISOString(),
    recreate:
      "db.products.createIndex(" +
      JSON.stringify(
        Object.fromEntries(
          Object.entries(target.weights || {}).map(([k]) => [k, "text"]),
        ),
      ) +
      ")",
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(__dirname, "..", "rollback-text-index-" + stamp + ".json");
  fs.writeFileSync(file, JSON.stringify(spec, null, 2));
  console.log("rollback written: " + path.basename(file));
  console.log("  recreate with: " + spec.recreate);
  console.log("");

  console.log("dropping " + target.name + " …");
  await P.dropIndex(target.name);
  console.log("dropped.");
  console.log("");

  const after = await db.stats();
  console.log("cluster after:");
  console.log("  dataSize  : " + MB(after.dataSize) + " MB");
  console.log("  indexSize : " + MB(after.indexSize) + " MB");
  console.log("  billed    : " + MB(after.dataSize + after.indexSize) + " MB / 512 MB");
  console.log("  freed     : " +
    MB((before.dataSize + before.indexSize) - (after.dataSize + after.indexSize)) + " MB");

  const remaining = await P.indexes();
  console.log("");
  console.log("product indexes remaining: " + remaining.length);
  console.log("text indexes remaining   : " +
    remaining.filter((i) => JSON.stringify(i.key).includes("_fts")).length);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
