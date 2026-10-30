/**
 * Dry run for Al Murad stock sync (no writes to MongoDB or Shopify).
 * Complies with .claude/claude.md Phase 4.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "../../", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const mongoose = require("mongoose");
const { applyDns } = require("../../scripts/mongo-connect.cjs");
applyDns();

const DATA_DIR = __dirname;
const SNAPSHOT_FILE = path.join(DATA_DIR, "stock-live-snapshot.jsonl");
const DIFF_FILE = path.join(DATA_DIR, `stock-diff-${new Date().toISOString().slice(0, 10)}.json`);

async function main() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    throw new Error(`Snapshot file not found: ${SNAPSHOT_FILE}`);
  }

  console.log("Loading live snapshot...");
  const liveMap = new Map();
  const rlSnap = readline.createInterface({ input: fs.createReadStream(SNAPSHOT_FILE) });
  for await (const line of rlSnap) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.url) liveMap.set(rec.url, rec);
    } catch {}
  }
  console.log(`Loaded ${liveMap.size} live snapshot records.`);

  // Load SKU to URL map from am-pdp.jsonl
  const skuToUrl = new Map();
  const pdpFile = path.join(DATA_DIR, "am-pdp.jsonl");
  if (fs.existsSync(pdpFile)) {
    const rlPdp = readline.createInterface({ input: fs.createReadStream(pdpFile) });
    for await (const line of rlPdp) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.sku && rec.sourceUrl) skuToUrl.set(String(rec.sku).trim(), rec.sourceUrl);
      } catch {}
    }
  }

  const conn = await mongoose.createConnection(process.env.MONGODB_URL2, { serverSelectionTimeoutMS: 20000 }).asPromise();
  const pCol = conn.db.collection("products");
  const brandId = new mongoose.Types.ObjectId("6ab2662f89e24d150e85e61a");

  const products = await pCol.find({ brand: brandId }).toArray();
  console.log(`Loaded ${products.length} products from DB2.`);

  let inToOos = 0;
  let oosToIn = 0;
  let unchanged = 0;
  let nowFullyOos = 0;
  let totalVariantsChecked = 0;

  const productDiffs = [];
  const examples = [];

  for (const p of products) {
    const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;
    let targetProductStock = 0;
    let targetIsOutOfStock = false;
    let targetStockStatus = "in_stock";
    let variantDiffs = [];

    if (!hasVariants) {
      totalVariantsChecked++;
      const live = liveMap.get(p.sourceUrl);
      const liveAvail = live ? Boolean(live.available) : false; // gone from live = sold out
      const currentAvail = !p.isOutOfStock && p.stock > 0;

      targetProductStock = liveAvail ? 100 : 0;
      targetIsOutOfStock = !liveAvail;
      targetStockStatus = liveAvail ? "in_stock" : "out_of_stock";

      if (currentAvail && !liveAvail) {
        inToOos++;
        nowFullyOos++;
      } else if (!currentAvail && liveAvail) {
        oosToIn++;
      } else {
        unchanged++;
      }

      const changed = p.stock !== targetProductStock || p.isOutOfStock !== targetIsOutOfStock || p.stockStatus !== targetStockStatus;

      const diff = {
        productId: p._id,
        name: p.name,
        sourceUrl: p.sourceUrl,
        hasVariants: false,
        before: { stock: p.stock, isOutOfStock: p.isOutOfStock, stockStatus: p.stockStatus },
        after: { stock: targetProductStock, isOutOfStock: targetIsOutOfStock, stockStatus: targetStockStatus },
        liveStatus: live ? live.statusText : "missing_from_snapshot",
        changed,
      };

      productDiffs.push(diff);

      if (changed && examples.length < 5) {
        examples.push(diff);
      }
    } else {
      let anyVariantInStock = false;
      let variantStockSum = 0;
      let productChanged = false;

      for (let i = 0; i < p.variants.length; i++) {
        totalVariantsChecked++;
        const v = p.variants[i];
        const vUrl = skuToUrl.get(String(v.sku).trim()) || p.sourceUrl;
        const live = liveMap.get(vUrl);
        const liveAvail = live ? Boolean(live.available) : false;

        const currentVAvail = v.available === true || (v.available === undefined && (v.stock || p.stock) > 0);
        const targetVStock = liveAvail ? 100 : 0;
        const targetVAvail = liveAvail;

        if (liveAvail) {
          anyVariantInStock = true;
          variantStockSum += targetVStock;
        }

        if (currentVAvail && !liveAvail) inToOos++;
        else if (!currentVAvail && liveAvail) oosToIn++;
        else unchanged++;

        const vChanged = v.available !== targetVAvail || v.stock !== targetVStock;
        if (vChanged) productChanged = true;

        variantDiffs.push({
          sku: v.sku,
          shopifyVariantId: v.shopifyVariantId,
          shopifyInventoryItemId: v.shopifyInventoryItemId,
          before: { available: v.available, stock: v.stock },
          after: { available: targetVAvail, stock: targetVStock },
          liveStatus: live ? live.statusText : "missing_from_snapshot",
          changed: vChanged,
        });
      }

      targetProductStock = variantStockSum;
      targetIsOutOfStock = !anyVariantInStock;
      targetStockStatus = anyVariantInStock ? "in_stock" : "out_of_stock";
      if (!anyVariantInStock && !p.isOutOfStock) nowFullyOos++;

      if (p.stock !== targetProductStock || p.isOutOfStock !== targetIsOutOfStock || p.stockStatus !== targetStockStatus) {
        productChanged = true;
      }

      const diff = {
        productId: p._id,
        name: p.name,
        sourceUrl: p.sourceUrl,
        hasVariants: true,
        variantsCount: p.variants.length,
        before: { stock: p.stock, isOutOfStock: p.isOutOfStock, stockStatus: p.stockStatus },
        after: { stock: targetProductStock, isOutOfStock: targetIsOutOfStock, stockStatus: targetStockStatus },
        variants: variantDiffs,
        changed: productChanged,
      };

      productDiffs.push(diff);

      if (productChanged && examples.length < 5) {
        examples.push(diff);
      }
    }
  }

  await conn.close();

  const report = {
    generatedAt: new Date().toISOString(),
    totalProducts: products.length,
    totalVariantsOrItems: totalVariantsChecked,
    summary: {
      inStockToSoldOut: inToOos,
      soldOutToInStock: oosToIn,
      unchanged: unchanged,
      productsBecomingFullySoldOut: nowFullyOos,
      totalProductsWithChanges: productDiffs.filter((d) => d.changed).length,
    },
    examples,
    diffs: productDiffs,
  };

  fs.writeFileSync(DIFF_FILE, JSON.stringify(report, null, 2));

  console.log("\n================ DRY RUN SUMMARY ================");
  console.log(`Total Products Evaluated:          ${products.length}`);
  console.log(`Total Items/Variants Evaluated:    ${totalVariantsChecked}`);
  console.log(`In-Stock -> Sold-Out:              ${inToOos}`);
  console.log(`Sold-Out -> In-Stock:              ${oosToIn}`);
  console.log(`Unchanged:                         ${unchanged}`);
  console.log(`Products becoming fully Sold Out:  ${nowFullyOos}`);
  console.log(`Products needing updates:          ${report.summary.totalProductsWithChanges}`);
  console.log(`Full diff saved to:                ${DIFF_FILE}`);
  console.log("\nSample Before -> After Examples:");
  console.log(JSON.stringify(examples.slice(0, 3), null, 2));
}

main().catch((err) => {
  console.error("Dry run error:", err);
  process.exit(1);
});
