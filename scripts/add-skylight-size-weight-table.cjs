/**
 * Adds the full "Size & Weight" lookup table (all 31 sizes, internal size /
 * external size / weight) to specs.sizeWeightTable on all 32 skylight
 * products, so it renders in the Technical Specifications tab (via the new
 * specTable prop on ProductDetailTabs — see that component + page.tsx).
 * Scoped to the 32 skylight products only; nothing else touched.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/add-skylight-size-weight-table.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/add-skylight-size-weight-table.cjs --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://cambridgeskylights.co.uk";
const APPLY = process.argv.includes("--apply");
const REPRESENTATIVE_HANDLE = "premium-triple-glazed-skylight-600x600mm";

function findTabId(html, labelRe) {
  const re = new RegExp(labelRe, "i");
  for (const m of html.matchAll(
    /<li class="tab-buttons__button-wrapper">([\s\S]*?)<\/li>/g,
  )) {
    if (re.test(m[1])) {
      const am = m[1].match(/aria-controls="([^"]+)"/);
      if (am) return am[1];
    }
  }
  return null;
}

function extractTabInner(html, labelRe) {
  const tabId = findTabId(html, labelRe);
  if (!tabId) return "";
  const start = html.indexOf(`id="${tabId}"`);
  if (start < 0) return "";
  const rest = html.slice(start + 20);
  const nextTabIdx = rest.indexOf('id="product-tab--');
  return nextTabIdx > 0 ? rest.slice(0, nextTabIdx) : rest.slice(0, 3000);
}

function extractSizeWeightTable(html) {
  const block = extractTabInner(html, "Technical Specs");
  const idx = block.indexOf("Size & Weight");
  if (idx < 0) return null;
  const tableMatch = block.slice(idx).match(/<table>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return null;
  const inner = tableMatch[1];
  const headings = [...inner.matchAll(/<th>([\s\S]*?)<\/th>/gi)].map((m) =>
    m[1].replace(/<!--[\s\S]*?-->/g, "").trim(),
  );
  const allRows = [...inner.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)].map((c) => c[1].trim()),
  );
  const rows = allRows.filter((r) => r.length === headings.length);
  if (!headings.length || !rows.length) return null;
  return { caption: "Size & Weight", headings, rows };
}

async function main() {
  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");

  console.log(`Scraping Size & Weight table from ${REPRESENTATIVE_HANDLE}…`);
  const res = await fetch(`${BASE}/products/${REPRESENTATIVE_HANDLE}`, {
    headers: { "User-Agent": "Mozilla/5.0 LinxSkylightsFix/1.0" },
  });
  const html = await res.text();
  const table = extractSizeWeightTable(html);
  if (!table || table.rows.length < 20) {
    throw new Error(
      `Table extraction looks wrong (${table?.rows.length ?? 0} rows, expected 30+) — aborting.`,
    );
  }
  console.log(
    `Headings: ${table.headings.join(" | ")}\nRows: ${table.rows.length}\nFirst row: ${table.rows[0].join(" | ")}\nLast row: ${table.rows[table.rows.length - 1].join(" | ")}`,
  );

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  const targets = await productsCol
    .find({ department: "rooflights-and-glass", "specs.source": "cambridge-skylights" })
    .project({ name: 1 })
    .toArray();
  console.log(`\nFound ${targets.length} skylight products to update`);

  if (!APPLY) {
    console.log("Re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const res2 = await productsCol.updateMany(
    { department: "rooflights-and-glass", "specs.source": "cambridge-skylights" },
    { $set: { "specs.sizeWeightTable": table, updatedAt: new Date() } },
  );
  console.log(`✓ updated ${res2.modifiedCount} products`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
