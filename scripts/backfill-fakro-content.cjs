/**
 * Backfill Fakro Job Description + Technical Spec's from Supabase,
 * and retry images that failed (e.g. GIFs) with URL fallbacks.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/backfill-fakro-content.cjs
 *
 * Options:
 *   DRY_RUN=1
 *   LIMIT=100
 *   SKIP_IMAGES=1
 *   CONCURRENCY=4
 */
const path = require("path");
const dns = require("dns");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({
  path: path.join(__dirname, "..", ".env.migrate"),
  override: false,
});

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const SOURCE_URL = (process.env.SOURCE_SUPABASE_URL || "").replace(/\/$/, "");
const SOURCE_KEY = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
const SOURCE_CLOUD =
  process.env.SOURCE_CLOUDINARY_CLOUD_NAME || "dkuqdi0ho";
const DEST_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 4));
const CLOUDINARY_FOLDER = "linx-living/products/fakro";
const SOURCE_TAG = "fakro-supabase";

const headers = {
  apikey: SOURCE_KEY,
  Authorization: `Bearer ${SOURCE_KEY}`,
  Accept: "application/json",
};

const NOISE_DESC_RE =
  /^(buy now|find a stockist|roof windows 4 you)/i;

const SURVEY_LINE =
  "Survey, supply and professional installation available across London & the South East.";

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same category copy Linx Glass injects when Supabase fields are empty */
function categoryFallbackHighlights(category) {
  const c = String(category || "").toLowerCase();
  if (c.includes("blind")) {
    return [
      "Precision-made FAKRO blinds designed to clip into compatible roof window frames.",
      "Control daylight, heat gain and privacy without compromising the view.",
    ];
  }
  return null;
}

function categoryFallbackSpecs(category) {
  const c = String(category || "").toLowerCase();
  if (c.includes("blind")) {
    return [
      { label: "Warranty", value: "2-year guarantee" },
      { label: "Compatibility", value: "FAKRO roof windows" },
      { label: "Availability", value: "3-5 working days" },
    ];
  }
  if (c.includes("flat")) {
    return [
      { label: "Warranty", value: "10-year guarantee" },
      { label: "Roof pitch", value: "0-15°" },
      { label: "Availability", value: "3-5 working days" },
    ];
  }
  if (c.includes("ladder")) {
    return [
      { label: "Warranty", value: "2-year guarantee" },
      { label: "Installation", value: "Supply or full fit" },
      { label: "Availability", value: "3-5 working days" },
    ];
  }
  return [
    { label: "Warranty", value: "10-year guarantee" },
    { label: "Roof pitch", value: "15-90°" },
    { label: "Availability", value: "3-5 working days" },
  ];
}

function productFieldSpecs(product) {
  const rows = [];
  if (product.category) {
    rows.push({ label: "Product type", value: product.category });
  }
  if (product.product_code) {
    rows.push({ label: "Product code", value: product.product_code });
  }
  if (product.sku) rows.push({ label: "SKU", value: product.sku });
  if (product.size) rows.push({ label: "Size", value: product.size });
  if (product.price != null && product.price !== "") {
    rows.push({ label: "Price (ex VAT)", value: `£${product.price}` });
  }
  const c = String(product.category || "").toLowerCase();
  if (!c.includes("blind") && !c.includes("ladder")) {
    rows.push({
      label: "Operation",
      value: c.includes("electric") ? "Electric" : "Manual",
    });
    rows.push({ label: "Glazing", value: "Double glazed as standard" });
    rows.push({
      label: "Installation gap",
      value: "Allow 10 mm around opening for flashing & insulation",
    });
  }
  return rows;
}

function applySpecRows(specs, rows) {
  for (const row of rows) {
    const key = cleanText(row.label || row.key || row.name);
    const value = cleanText(row.value ?? row.val);
    if (key && value && specs[key] == null) specs[key] = value;
  }
}

function buildSpecs(product) {
  const specs = {
    sku: product.sku,
    source: SOURCE_TAG,
    sourceId: product.id,
  };
  if (product.product_code) specs.productCode = product.product_code;
  if (product.size) specs.size = product.size;
  if (product.base_title) specs.baseTitle = product.base_title;
  if (product.sale_percent != null) specs.salePercent = product.sale_percent;

  const tech = product.technical_specs;
  if (Array.isArray(tech) && tech.length) {
    applySpecRows(specs, tech);
  } else {
    applySpecRows(specs, productFieldSpecs(product));
    applySpecRows(specs, categoryFallbackSpecs(product.category));
  }
  return specs;
}

function buildDescription(product) {
  const rawLong = String(product.long_description || "").trim();
  if (rawLong) {
    const cleaned = rawLong
      .split(/\n+/)
      .map((line) => cleanText(line))
      .filter((line) => line && !NOISE_DESC_RE.test(line))
      .join("\n\n");
    if (cleaned) return cleaned;
  }

  const highlights = Array.isArray(product.highlights)
    ? product.highlights
        .map(cleanText)
        .filter(
          (h) =>
            h &&
            h.length > 40 &&
            !NOISE_DESC_RE.test(h) &&
            h.toLowerCase() !==
              cleanText(product.short_description).toLowerCase(),
        )
    : [];
  if (highlights.length) {
    return [...new Set(highlights)].slice(0, 6).join("\n\n");
  }

  const short = cleanText(product.short_description);
  const fallback = categoryFallbackHighlights(product.category);
  if (fallback) {
    const parts = [];
    if (short && !NOISE_DESC_RE.test(short)) parts.push(short);
    parts.push(...fallback);
    return parts.join("\n\n");
  }

  const lead =
    (short && !NOISE_DESC_RE.test(short) && short.length > 8
      ? short
      : cleanText(product.title)) || "FAKRO product";
  return `${lead}\n\n${SURVEY_LINE}`;
}

function candidateImageUrls(pathOrUrl) {
  const raw = cleanText(pathOrUrl);
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw)) {
    const urls = [raw];
    try {
      const file = new URL(raw).pathname.split("/").pop();
      if (file) {
        urls.push(
          `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/linx-products/fakro/${file}`,
        );
        urls.push(`https://www.linxglass.co.uk/fakro-products/${file}`);
      }
    } catch {
      /* ignore */
    }
    return [...new Set(urls)];
  }
  const cleaned = raw.replace(/^\//, "");
  const file = cleaned.split("/").pop();
  const urls = [];
  if (file) {
    urls.push(
      `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/linx-products/fakro/${file}`,
    );
    urls.push(`https://www.linxglass.co.uk/fakro-products/${file}`);
  }
  if (cleaned.startsWith("image/upload/")) {
    urls.unshift(`https://res.cloudinary.com/${SOURCE_CLOUD}/${cleaned}`);
  } else {
    urls.push(
      `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/${cleaned}`,
    );
  }
  return [...new Set(urls.filter(Boolean))];
}

async function downloadFirstOk(candidates) {
  let lastErr = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "LinxLivingFakroBackfill/1.0" },
      });
      if (!res.ok) {
        lastErr = new Error(`download ${res.status}: ${url}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) {
        lastErr = new Error(`empty: ${url}`);
        continue;
      }
      return { buffer, sourceUrl: url };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("no image candidates");
}

function uploadBuffer(buffer, publicId) {
  const head = buffer.slice(0, 6).toString("ascii");
  const looksGif = head === "GIF89a" || head === "GIF87a";
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: String(publicId).replace(/\.[^.]+$/, "").slice(0, 180),
        overwrite: true,
        resource_type: looksGif ? "auto" : "image",
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

const imageCache = new Map();

async function migrateImage(pathOrUrl, publicIdHint) {
  const candidates = candidateImageUrls(pathOrUrl);
  if (!candidates.length) return null;
  const cacheKey = candidates[0];
  if (SKIP_IMAGES || DRY_RUN) return cacheKey;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

  const { buffer, sourceUrl } = await downloadFirstOk(candidates);
  const publicId =
    slugify(publicIdHint || path.basename(sourceUrl).replace(/\.[^.]+$/, "")) ||
    `img-${Date.now()}`;
  const destUrl = await uploadBuffer(buffer, publicId);
  for (const c of candidates) imageCache.set(c, destUrl);
  return destUrl;
}

async function supabasePaged(pathname, pageSize = 1000) {
  const rows = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const res = await fetch(`${SOURCE_URL}${pathname}`, {
      headers: { ...headers, Range: `${from}-${to}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
    }
    const chunk = await res.json();
    if (!Array.isArray(chunk) || !chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function mapPool(items, concurrency, worker) {
  let idx = 0;
  async function run() {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
}

function needsImageRetry(mongoImages, sourcePath) {
  if (!sourcePath) return false;
  const images = Array.isArray(mongoImages) ? mongoImages : [];
  if (!images.length) return true;
  // GIF / failed uploads often left products on dest cloud with a wrong/blank asset —
  // always re-pull when source path is gif or still points at source cloud.
  if (/\.gif($|\?)/i.test(sourcePath)) return true;
  return images.some(
    (u) =>
      typeof u === "string" &&
      (u.includes(`res.cloudinary.com/${SOURCE_CLOUD}/`) ||
        u.startsWith("/") ||
        /linxglass\.co\.uk/i.test(u)),
  );
}

async function main() {
  if (!SOURCE_URL || !SOURCE_KEY) {
    throw new Error("Missing SOURCE_SUPABASE_* in .env.migrate");
  }
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");

  console.log(
    `Backfill Fakro content | dry=${DRY_RUN} skipImages=${SKIP_IMAGES}`,
  );

  const catFilter =
    "or=(category.eq.Pitched%20Roof%20Windows,category.eq.Flat%20Roof%20Windows,category.eq.Blinds%20%26%20Accessories,category.eq.Loft%20Ladders)";

  console.log("Fetching source products…");
  let sourceProducts = await supabasePaged(
    `/rest/v1/shop_products?${catFilter}&select=id,sku,title,category,size,price,product_code,base_title,short_description,long_description,technical_specs,highlights,image_path,sale_percent&order=sku.asc`,
  );
  if (LIMIT > 0) sourceProducts = sourceProducts.slice(0, LIMIT);
  console.log(`  ${sourceProducts.length} source rows`);

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  if (!brand) throw new Error("FAKRO brand missing — run migrate first");
  const productsCol = db.collection("products");

  const report = {
    updated: 0,
    missing: 0,
    imageUpdated: 0,
    imageFails: 0,
    withLongDesc: 0,
    withTechSpecs: 0,
  };

  await mapPool(sourceProducts, CONCURRENCY, async (src, index) => {
    const sku = src.sku;
    if (!sku) {
      report.missing++;
      return;
    }

    const existing = await productsCol.findOne({
      brand: brand._id,
      "specs.sku": sku,
      "specs.source": SOURCE_TAG,
    });
    if (!existing) {
      report.missing++;
      return;
    }

    const description = buildDescription(src);
    const specs = buildSpecs(src);
    if (cleanText(src.long_description)) report.withLongDesc++;
    if (Array.isArray(src.technical_specs) && src.technical_specs.length) {
      report.withTechSpecs++;
    }

    const $set = {
      description,
      specs,
      showSpecs: true,
      tagline: [src.product_code, src.size].map(cleanText).filter(Boolean).join(" · "),
      updatedAt: new Date(),
    };

    if (!SKIP_IMAGES && needsImageRetry(existing.images, src.image_path)) {
      try {
        const url = await migrateImage(src.image_path, `p-${sku}-retry`);
        if (url) {
          const keep = (existing.images || []).filter(
            (u) =>
              typeof u === "string" &&
              u.includes(`res.cloudinary.com/${DEST_CLOUD}/`) &&
              u !== url,
          );
          $set.images = [url, ...keep].slice(0, 7);
          report.imageUpdated++;
        }
      } catch (e) {
        report.imageFails++;
        if (report.imageFails <= 20) {
          console.warn(`  ! image ${sku}: ${e.message}`);
        }
      }
    }

    if (DRY_RUN) {
      if (index < 3) {
        console.log(
          `[dry] ${sku}\n  desc: ${description.slice(0, 120)}…\n  specs: ${Object.keys(specs).filter((k) => !["sku", "source", "sourceId", "productCode", "baseTitle", "salePercent", "size"].includes(k)).join(", ")}`,
        );
      }
      report.updated++;
      return;
    }

    await productsCol.updateOne({ _id: existing._id }, { $set });
    report.updated++;

    if ((index + 1) % 100 === 0 || index === 0) {
      console.log(
        `  … ${index + 1}/${sourceProducts.length} updated=${report.updated} imgs=${report.imageUpdated} imgFail=${report.imageFails}`,
      );
    }
  });

  console.log("\n========== FAKRO CONTENT BACKFILL ==========");
  console.log(`Updated:          ${report.updated}`);
  console.log(`Missing in Mongo: ${report.missing}`);
  console.log(`Had long_desc:    ${report.withLongDesc}`);
  console.log(`Had tech specs:   ${report.withTechSpecs}`);
  console.log(`Images updated:   ${report.imageUpdated}`);
  console.log(`Image failures:   ${report.imageFails}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
