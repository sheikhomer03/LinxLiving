/**
 * Fixes a real bug in scripts/import-cambridge-skylights.cjs: FAQ content is
 * the LAST tab on the source page, so extractTabInner's "slice to the next
 * tab" boundary never triggered (no next tab exists) and fell back to a
 * blind 20,000-char slice — which overshot the actual FAQ block and pulled
 * in an unrelated duplicate "Size & Weight" table + "Installation Guide"
 * block from later in the page (the theme's mobile-accordion markup repeats
 * the desktop tab content). That garbage ended up appended to every
 * product's description.
 *
 * This rebuilds `description` for all 32 skylight products as:
 *   clean marketing description (from the product's own .js, never polluted)
 *   + genuine FAQ content only, now bounded to the FAQ tab's own <li>...</li>
 *     (bounded by the closing "</ul>" of the tab-list wrapper, not a blind
 *     char count) — verified against known-good FAQ content before writing.
 * Source links stripped and "Cambridge" removed, same as before.
 *
 * Also rebuilds `dimensionRows` (the Technical Specifications tab): the
 * original import gave every one of the 32 sizes byte-identical rows (the
 * shared Glazing Specs only) with no way to tell them apart. This prepends
 * each product's own accurate "Size" (from its own title) and "Weight"
 * (from its own Shopify variant weight) ahead of the shared Glazing Specs
 * rows, so Technical Specifications is actually correct per size.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-skylight-description-overspill.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-skylight-description-overspill.cjs --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://cambridgeskylights.co.uk";
const APPLY = process.argv.includes("--apply");
const REPRESENTATIVE_HANDLE = "premium-triple-glazed-skylight-600x600mm";
const INTERNAL_CATEGORY_HREF =
  "/category?department=rooflights-and-glass&category=flat-roof-windows&subcategory=fixed-frameless";

function cleanText(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSourceLinks(html) {
  return String(html || "").replace(
    /href="https?:\/\/(?:www\.)?cambridgeskylights\.(?:co\.uk|uk)[^"]*"/gi,
    `href="${INTERNAL_CATEGORY_HREF}"`,
  );
}

function stripCambridge(text) {
  return String(text || "")
    .replace(/\bcambridge\b\s*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
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

/**
 * Bounded properly this time: stops at the next tab item when one exists;
 * when there isn't one (this tab is last, as FAQs is here), falls back to a
 * SMALL cap (3000 chars — the real FAQ block is ~2000) instead of the
 * previous 20,000, so an unrelated duplicate section further down the page
 * can't be swept in. extractFaqSections below also rejects anything that
 * looks like a specs table as a second layer of defense.
 */
function extractTabInner(html, labelRe) {
  const tabId = findTabId(html, labelRe);
  if (!tabId) return "";
  const start = html.indexOf(`id="${tabId}"`);
  if (start < 0) return "";
  const rest = html.slice(start + 20);
  const nextTabIdx = rest.indexOf('id="product-tab--');
  return nextTabIdx > 0 ? rest.slice(0, nextTabIdx) : rest.slice(0, 3000);
}

/** Same extraction the original import used — Technical Specs is NOT the
 * last tab (Installation Guide follows it), so its boundary was already
 * correctly bounded by the next tab and unaffected by the overspill bug.
 * Re-extracted here only so this script is self-contained. */
function extractGlazingSpecsRows(html) {
  const block = extractTabInner(html, "Technical Specs");
  const textMatch = block.match(
    /Glazing Specs[\s\S]*?product-tabs__tab-text[^>]*>([\s\S]*?)<\/div>/i,
  );
  if (!textMatch) return [];
  const inner = textMatch[1];
  const rows = [];
  for (const m of inner.matchAll(
    /<strong>([^<]+?):?<\/strong>\s*([^<]*?)(?=<br|$)/gi,
  )) {
    const label = cleanText(m[1]).replace(/:$/, "");
    const value = cleanText(m[2]);
    if (label && value) rows.push({ label, value });
  }
  return rows;
}

/** e.g. "HorizonLite ... Roof Window 800x1200mm" -> "800 x 1200mm". */
function sizeFromTitle(title) {
  const m = String(title || "").match(/(\d{3,4})\s*x\s*(\d{3,4})\s*mm/i);
  return m ? `${m[1]} x ${m[2]}mm` : null;
}

function extractFaqSections(html) {
  const block = extractTabInner(html, "FAQs");
  if (!block) return [];
  const sections = [];
  const headingRe =
    /<h3[^>]*class="[^"]*product-tabs__tab-heading[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/h3>\s*<div[^>]*class="[^"]*product-tabs__tab-text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  for (const m of block.matchAll(headingRe)) {
    const heading = cleanText(m[1]);
    const body = m[2].replace(/<script[\s\S]*?<\/script>/gi, " ").trim();
    // Guard against the same overspill class of bug: a genuine FAQ heading
    // is short prose, never a heading like "Size & Weight" (which is
    // Technical Specs) or one containing a <table>.
    if (!heading || !body) continue;
    if (/table|size\s*&\s*weight|installation guide/i.test(heading)) continue;
    if (/<table/i.test(body)) continue;
    sections.push({ heading, body });
  }
  return sections;
}

async function main() {
  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");

  console.log(`Re-scraping FAQ content from ${REPRESENTATIVE_HANDLE} with the fixed extractor…`);
  const res = await fetch(`${BASE}/products/${REPRESENTATIVE_HANDLE}`, {
    headers: { "User-Agent": "Mozilla/5.0 LinxSkylightsFix/1.0" },
  });
  const html = await res.text();
  const faqSections = extractFaqSections(html);
  console.log(`Found ${faqSections.length} genuine FAQ sections:`);
  for (const s of faqSections) {
    console.log(`  - "${s.heading}" (${s.body.length} chars)`);
  }
  if (faqSections.length < 1 || faqSections.length > 4) {
    throw new Error(
      `Expected 1-4 genuine FAQ sections, got ${faqSections.length} — aborting, extraction may still be wrong.`,
    );
  }
  const faqHtml = stripCambridge(
    stripSourceLinks(
      faqSections.map((s) => `<h4>${s.heading}</h4>${s.body}`).join("\n"),
    ),
  );

  const sharedGlazingRows = extractGlazingSpecsRows(html);
  console.log(`Shared Glazing Specs rows: ${sharedGlazingRows.length}`);
  if (sharedGlazingRows.length < 5) {
    throw new Error(
      `Expected 5+ Glazing Specs rows, got ${sharedGlazingRows.length} — aborting.`,
    );
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  const targets = await productsCol
    .find({ department: "rooflights-and-glass", "specs.source": "cambridge-skylights" })
    .project({ name: 1, "specs.sourceUrl": 1 })
    .toArray();
  console.log(`\nFound ${targets.length} skylight products to fix`);

  let fixed = 0;
  for (const doc of targets) {
    const handle = String(doc.specs.sourceUrl).split("/").pop();
    const productJs = await (
      await fetch(`${BASE}/products/${handle}.js`, {
        headers: { "User-Agent": "Mozilla/5.0 LinxSkylightsFix/1.0" },
      })
    ).json();

    const cleanBase =
      String(productJs.description || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .trim() || `${productJs.title} skylight.`;
    const newDescription = stripCambridge(
      stripSourceLinks(`${cleanBase}\n<h3>Frequently Asked Questions</h3>\n${faqHtml}`),
    ).slice(0, 60000);

    const size = sizeFromTitle(productJs.title);
    const weightG = productJs.variants?.[0]?.weight;
    const weightKg = weightG ? Math.round((Number(weightG) / 1000) * 100) / 100 : null;
    const ownRows = [
      size ? { label: "Size", value: size } : null,
      weightKg ? { label: "Weight", value: `${weightKg}kg` } : null,
    ].filter(Boolean);
    const newDimensionRows = [...ownRows, ...sharedGlazingRows];

    if (!APPLY) {
      console.log(
        `[dry] ${doc.name}: description ${newDescription.length} chars, dimensionRows ${newDimensionRows.length} (own: ${ownRows.map((r) => `${r.label}=${r.value}`).join(", ") || "none"})`,
      );
    } else {
      await productsCol.updateOne(
        { _id: doc._id },
        {
          $set: {
            description: newDescription,
            dimensionRows: newDimensionRows,
            updatedAt: new Date(),
          },
        },
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
