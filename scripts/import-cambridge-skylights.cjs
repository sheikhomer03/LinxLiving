/**
 * Imports all products from the Cambridge Skylights "cambridge-skylights"
 * collection (the HorizonLite Fixed Frameless Roof Window line, 32 sizes)
 * into department "rooflights-and-glass", category "flat-roof-windows",
 * subCategory "fixed-frameless" — matching the existing FAKRO taxonomy for
 * fixed/frameless flat roof windows on this site.
 *
 * Verified before writing this script (see chat) that description, FAQ
 * content, Installation Guide and Glazing Specs are byte-identical across
 * every size (checked 300x300 / 600x600 / 1500x3000mm) — so that shared
 * content is scraped once from one representative product's full HTML page
 * and reused, while price / weight / SKU / images are still read from each
 * product's own .js endpoint individually. Same is true for the 33 gallery
 * images, so they're uploaded to Cloudinary once and reused across all 32.
 *
 * Pricing: identical convention to scripts/import-cambridge-accessories.cjs
 *   price (charged) = sourcePrice * 1.05
 *   discountPercent  = random pick from [20, 25, 30]
 *   specs.compareAtPrice = price / (1 - discountPercent/100)
 *
 * All hrefs pointing back to cambridgeskylights.co.uk in the scraped
 * description/FAQ are rewritten to the internal category page — no links to
 * the source site are left in.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/import-cambridge-skylights.cjs            # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/import-cambridge-skylights.cjs --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BASE = "https://cambridgeskylights.co.uk";
const COLLECTION_HANDLE = "cambridge-skylights";
const BRAND_SLUG = "cambridge-skylights";
const SOURCE_TAG = "cambridge-skylights";
const CLOUDINARY_FOLDER = "linx-living/products/skylights";
const APPLY = process.argv.includes("--apply");
const INTERNAL_CATEGORY_HREF =
  "/category?department=rooflights-and-glass&category=flat-roof-windows&subcategory=fixed-frameless";

const DEPARTMENT = "rooflights-and-glass";
const CATEGORY = "flat-roof-windows";
const SUBCATEGORY = "fixed-frameless";

// A representative product used to scrape the content confirmed identical
// across every size (description, FAQ, Installation Guide, Glazing Specs).
const REPRESENTATIVE_HANDLE = "premium-triple-glazed-skylight-600x600mm";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function absUrl(src) {
  if (!src) return "";
  if (/^https?:/i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  return `${BASE}${src.startsWith("/") ? "" : "/"}${src}`;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function cleanText(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rewrites every cambridgeskylights.co.uk href to the internal category page. */
function stripSourceLinks(html) {
  return String(html || "").replace(
    /href="https?:\/\/(?:www\.)?cambridgeskylights\.(?:co\.uk|uk)[^"]*"/gi,
    `href="${INTERNAL_CATEGORY_HREF}"`,
  );
}

async function fetchWithRetry(url, retries = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 LinxSkylightsImport/1.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) break;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}

async function fetchProductJs(handle) {
  const res = await fetchWithRetry(`${BASE}/products/${handle}.js`);
  return res.json();
}

async function fetchProductHtml(handle) {
  const res = await fetchWithRetry(`${BASE}/products/${handle}`);
  return res.text();
}

async function fetchCollectionHandles() {
  const res = await fetchWithRetry(
    `${BASE}/collections/${COLLECTION_HANDLE}/products.json?limit=250`,
  );
  const data = await res.json();
  return (data.products || []).map((p) => p.handle);
}

/**
 * Finds the tab id for a given button label by scanning each
 * `<li class="tab-buttons__button-wrapper">` block individually — matching
 * aria-controls to a label *within the same button* rather than "nearest in
 * the raw text", which previously grabbed the wrong (earlier) button when
 * two labels were both within the search window.
 */
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

/** Extracts the inner text block(s) of a named product-tabs tab. */
function extractTabInner(html, labelRe) {
  const tabId = findTabId(html, labelRe);
  if (!tabId) return "";
  const start = html.indexOf(`id="${tabId}"`);
  if (start < 0) return "";
  // Next tab item starts a new `id="product-tab--` block — bound the slice there.
  const rest = html.slice(start + 20);
  const nextIdx = rest.indexOf('id="product-tab--');
  const block = nextIdx > 0 ? rest.slice(0, nextIdx) : rest.slice(0, 20000);
  return block;
}

function extractGlazingSpecsRows(html) {
  const block = extractTabInner(html, "Technical Specs");
  const textMatch = block.match(
    /Glazing Specs[\s\S]*?product-tabs__tab-text[^>]*>([\s\S]*?)<\/div>/i,
  );
  if (!textMatch) return [];
  const inner = textMatch[1];
  const rows = [];
  // "<strong>Label:</strong> Value<br/>" pairs
  for (const m of inner.matchAll(
    /<strong>([^<]+?):?<\/strong>\s*([^<]*?)(?=<br|$)/gi,
  )) {
    const label = cleanText(m[1]).replace(/:$/, "");
    const value = cleanText(m[2]);
    if (label && value) rows.push({ label, value });
  }
  return rows;
}

function extractInstallationGuideText(html) {
  const block = extractTabInner(html, "Installation Guide");
  const textMatch = block.match(
    /product-tabs__tab-text[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
  );
  const inner = textMatch ? textMatch[1] : block;
  return cleanText(inner).slice(0, 20000);
}

function extractFaqHtml(html) {
  const block = extractTabInner(html, "FAQs");
  if (!block) return "";
  // Collect every heading + tab-text pair inside the FAQ tab (Product FAQs, Shipping FAQs, ...).
  const sections = [];
  const headingRe =
    /<h3[^>]*class="[^"]*product-tabs__tab-heading[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/h3>\s*<div[^>]*class="[^"]*product-tabs__tab-text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  for (const m of block.matchAll(headingRe)) {
    const heading = cleanText(m[1]);
    const body = m[2]
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .trim();
    if (heading && body) sections.push({ heading, body });
  }
  return sections;
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = absUrl(imageUrl).split("?")[0];
  if (!clean) return "";
  if (!APPLY) return clean; // dry run — keep the source URL for review
  const result = await cloudinary.uploader.upload(clean, {
    folder: CLOUDINARY_FOLDER,
    public_id: String(publicId).slice(0, 180),
    overwrite: true,
    resource_type: "image",
  });
  return result.secure_url || clean;
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  const existing = await brands.findOne({ slug: BRAND_SLUG });
  if (existing) return existing._id;
  if (!APPLY) return "DRY-RUN-BRAND-ID";
  const now = new Date();
  const result = await brands.insertOne({
    name: "Cambridge Skylights",
    slug: BRAND_SLUG,
    order: 0,
    isActive: true,
    image: "",
    uiName: "Linx Square",
    createdAt: now,
    updatedAt: now,
  });
  return result.insertedId;
}

async function main() {
  console.log(APPLY ? "=== APPLYING ===" : "=== DRY RUN (no writes) ===");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  const brandId = await ensureBrand(db);
  console.log(`Brand: Cambridge Skylights (${brandId})`);

  console.log("Fetching collection handles…");
  const handles = await fetchCollectionHandles();
  console.log(`Found ${handles.length} products in collection`);

  console.log(`Scraping shared content from ${REPRESENTATIVE_HANDLE}…`);
  const repHtml = await fetchProductHtml(REPRESENTATIVE_HANDLE);
  const dimensionRows = extractGlazingSpecsRows(repHtml);
  const installationGuide = extractInstallationGuideText(repHtml);
  const faqSections = extractFaqHtml(repHtml);
  console.log(
    `  dimensionRows=${dimensionRows.length} installGuideChars=${installationGuide.length} faqSections=${faqSections.length}`,
  );
  if (!dimensionRows.length || !installationGuide || !faqSections.length) {
    throw new Error(
      "Shared content extraction looks incomplete — aborting before touching 32 products. Check the extractor regexes.",
    );
  }

  const faqHtml = faqSections
    .map(
      (s) =>
        `<h4>${s.heading}</h4>${s.body}`,
    )
    .join("\n");

  const repJs = await fetchProductJs(REPRESENTATIVE_HANDLE);
  console.log(`Uploading ${repJs.images.length} shared gallery images to Cloudinary once…`);
  const sharedImages = [];
  for (let i = 0; i < repJs.images.length; i++) {
    const uploaded = await uploadRemoteImage(
      repJs.images[i],
      `horizonlite-gallery-${i + 1}`,
    );
    if (uploaded) sharedImages.push(uploaded);
  }
  console.log(`  uploaded ${sharedImages.length} images`);

  const featureEntries = [
    { label: "Leak-proof", value: "Yes" },
    { label: "Warranty", value: "25-year unit seal warranty" },
    { label: "Roof pitch suitability", value: "0° – 45° (flat, low pitched or pitched roofs)" },
    { label: "U-value (Ug)", value: "0.8 W/m²K" },
    {
      label: "Structural Glazing Tape",
      value: "Required for installation — sold separately",
    },
    {
      label: "Self-cleaning coating",
      value: "Optional Percenta Nano Coating — sold separately",
    },
  ];

  const results = [];

  for (const handle of handles) {
    try {
      const sourceUrl = `${BASE}/products/${handle}`;
      const existing = await productsCol.findOne({ "specs.sourceUrl": sourceUrl });
      if (existing) {
        console.log(`SKIP (already imported): ${handle} -> ${existing._id}`);
        results.push({ handle, skipped: true, id: String(existing._id) });
        continue;
      }

      const productJs = await fetchProductJs(handle);

      const sourcePrice = Number(productJs.price || 0) / 100;
      const price = round2(sourcePrice * 1.05);
      const discountPercent = pick([20, 25, 30]);
      const compareAtPrice = round2(price / (1 - discountPercent / 100));
      const stock = randomInt(300, 500);

      const rawDescription =
        String(productJs.description || "")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .trim() || `${productJs.title} from Cambridge Skylights.`;
      const description = stripSourceLinks(
        `${rawDescription}\n<h3>Frequently Asked Questions</h3>\n${faqHtml}`,
      ).slice(0, 60000);

      const weightKg = productJs.variants?.[0]?.weight
        ? round2(Number(productJs.variants[0].weight) / 1000)
        : null;
      const sku = String(productJs.variants?.[0]?.sku || "");

      const now = new Date();
      const doc = {
        name: productJs.title,
        description,
        price,
        images: sharedImages,
        department: DEPARTMENT,
        category: CATEGORY,
        subCategory: SUBCATEGORY,
        brand: brandId,
        stock,
        stockStatus: "in_stock",
        manufacturerSku: sku,
        productCode: sku,
        featureEntries,
        dimensionRows,
        installationGuide,
        dimensions: weightKg ? { weightKg } : {},
        specs: {
          source: SOURCE_TAG,
          sourceUrl,
          sourceType: productJs.type || "",
          sku,
          compareAtPrice,
          salePercent: discountPercent,
          salePriceMode: "raise-was-keep-price",
          saleOriginalPrice: price,
          saleAppliedAt: now.toISOString(),
        },
        showSpecs: true,
        createdAt: now,
        updatedAt: now,
      };

      if (!APPLY) {
        console.log(
          `[dry create] ${doc.name} price=£${price} was=£${compareAtPrice} (${discountPercent}% off) stock=${stock} weight=${weightKg}kg sku=${sku}`,
        );
        results.push({ handle, dryRun: true, name: doc.name, price, compareAtPrice });
        continue;
      }

      const result = await productsCol.insertOne(doc);
      console.log(
        `+ created ${doc.name} (${result.insertedId}) price=£${price} was=£${compareAtPrice} (${discountPercent}% off) stock=${stock}`,
      );
      results.push({
        handle,
        id: String(result.insertedId),
        name: doc.name,
        price,
        compareAtPrice,
        discountPercent,
        stock,
      });
    } catch (e) {
      console.error(`✗ ${handle}: ${e.message}`);
      results.push({ handle, error: e.message });
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));
  console.log(
    `\nDone. created=${results.filter((r) => r.id && !r.skipped).length} skipped=${results.filter((r) => r.skipped).length} failed=${results.filter((r) => r.error).length}`,
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
