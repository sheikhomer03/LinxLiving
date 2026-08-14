/**
 * Two fixes to dimensionRows (Technical Specifications) for all 32 skylight
 * products, nothing else touched:
 *
 * 1. Removes the "Weight" row (kept "Size", dropped "Weight" per request).
 * 2. Adds "Acoustics reduction (dB): -42", which the source page genuinely
 *    has but a regex bug silently dropped: the row-extraction regex required
 *    a literal "<br" right after each value to end the match, but Acoustics
 *    reduction is the LAST item in the source's Glazing Specs paragraph (it
 *    ends with "</p>", not "<br"), so it never matched. Fixed lookahead from
 *    (?=<br|$) to (?=<) — stops at the next tag generically, not one
 *    specific tag name.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-skylight-specs-rows.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-skylight-specs-rows.cjs --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://cambridgeskylights.co.uk";
const APPLY = process.argv.includes("--apply");
const REPRESENTATIVE_HANDLE = "premium-triple-glazed-skylight-600x600mm";

function cleanText(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function extractGlazingSpecsRows(html) {
  const block = extractTabInner(html, "Technical Specs");
  const textMatch = block.match(
    /Glazing Specs[\s\S]*?product-tabs__tab-text[^>]*>([\s\S]*?)<\/div>/i,
  );
  if (!textMatch) return [];
  const inner = textMatch[1];
  const rows = [];
  // Fixed: (?=<) stops at the next tag generically (</p>, <br, etc.)
  // instead of requiring a literal "<br", which silently dropped the last
  // item ("Acoustics reduction") since it's followed by </p>, not <br.
  for (const m of inner.matchAll(/<strong>([^<]+?):?<\/strong>\s*([^<]*?)(?=<)/gi)) {
    const label = cleanText(m[1]).replace(/:$/, "");
    const value = cleanText(m[2]);
    if (label && value) rows.push({ label, value });
  }
  return rows;
}

async function main() {
  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");

  console.log(`Re-scraping Glazing Specs from ${REPRESENTATIVE_HANDLE} with the fixed extractor…`);
  const res = await fetch(`${BASE}/products/${REPRESENTATIVE_HANDLE}`, {
    headers: { "User-Agent": "Mozilla/5.0 LinxSkylightsFix/1.0" },
  });
  const html = await res.text();
  const sharedGlazingRows = extractGlazingSpecsRows(html);
  console.log(`Rows: ${sharedGlazingRows.length}`);
  for (const r of sharedGlazingRows) console.log(`  - ${r.label}: ${r.value}`);
  if (!sharedGlazingRows.some((r) => /acoustics/i.test(r.label))) {
    throw new Error("Acoustics reduction still missing — aborting, extractor still wrong.");
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  const targets = await productsCol
    .find({ department: "rooflights-and-glass", "specs.source": "cambridge-skylights" })
    .project({ name: 1, dimensionRows: 1 })
    .toArray();
  console.log(`\nFound ${targets.length} skylight products to fix`);

  let fixed = 0;
  for (const doc of targets) {
    // Keep only the product's own "Size" row (drop "Weight"), then the
    // corrected shared Glazing Specs rows.
    const ownRows = (doc.dimensionRows || []).filter(
      (r) => r.label === "Size",
    );
    const newDimensionRows = [...ownRows, ...sharedGlazingRows];

    if (!APPLY) {
      console.log(
        `[dry] ${doc.name}: ${doc.dimensionRows.length} -> ${newDimensionRows.length} rows`,
      );
    } else {
      await productsCol.updateOne(
        { _id: doc._id },
        { $set: { dimensionRows: newDimensionRows, updatedAt: new Date() } },
      );
      console.log(`✓ fixed ${doc.name}`);
    }
    fixed++;
  }

  console.log(`\n${fixed} product(s) ${APPLY ? "fixed" : "would be fixed"}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
