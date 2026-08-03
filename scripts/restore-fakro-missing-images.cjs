/**
 * Restore Fakro products that have no images or Shopify-only galleries.
 * Sources: Linx Glass Supabase + linxglass.co.uk + source Cloudinary (dkuqdi0ho)
 * Dest: Living Cloudinary (CLOUDINARY_CLOUD_NAME)
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/restore-fakro-missing-images.cjs
 *   DRY_RUN=1 ...
 *   LIMIT=20 ...
 *   CONCURRENCY=3 ...
 *   ONLY_MISSING=1   — skip Shopify-only, only empty galleries
 */
const path = require("path");
const dns = require("dns");
const fs = require("fs");

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
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const SOURCE_URL = (
  process.env.SOURCE_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SOURCE_KEY =
  process.env.SOURCE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
const SOURCE_CLOUD =
  process.env.SOURCE_CLOUDINARY_CLOUD_NAME || "dkuqdi0ho";
const DEST_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const DRY_RUN = process.env.DRY_RUN === "1";
const ONLY_MISSING = process.env.ONLY_MISSING === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const MAX_GALLERY = Math.max(1, Number(process.env.MAX_GALLERY_IMAGES || 8));
const CLOUDINARY_FOLDER = "linx-living/products/fakro";

const headers = {
  apikey: SOURCE_KEY,
  Authorization: `Bearer ${SOURCE_KEY}`,
  Accept: "application/json",
};

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isShopify(u) {
  return /cdn\.shopify\.com|cdn\.shopifycdn\.net/i.test(String(u || ""));
}

function isCloudinary(u) {
  return /res\.cloudinary\.com|cloudinary\.com/i.test(String(u || ""));
}

function isDestCloudUrl(url) {
  return (
    typeof url === "string" &&
    url.includes(`res.cloudinary.com/${DEST_CLOUD}/`)
  );
}

function cleanImages(list) {
  return (Array.isArray(list) ? list : []).filter(
    (u) => typeof u === "string" && u.trim(),
  );
}

/** Parse "Style B" + "1500x2500" from CIRRUS titles */
function cirrusCandidatesFromName(name) {
  const n = cleanText(name);
  const style = /style\s*a/i.test(n) ? "a" : /style\s*b/i.test(n) ? "b" : null;
  const size = (n.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i) || []).slice(1);
  if (!style || size.length < 2) return [];
  const dim = `${size[0]}x${size[1]}`;
  const base = `cir-${style}-${dim}`;
  const urls = [];
  for (const i of [1, 2, 3]) {
    urls.push(
      `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/cirrus/${base}-${i}.png`,
    );
    urls.push(`https://www.linxglass.co.uk/fakro-products/${base}-${i}.png`);
  }
  // Style tile fallbacks
  urls.push(
    `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/cirrus/cir-${style}-1000x1250-1.png`,
  );
  return urls;
}

function absSourceUrl(pathOrUrl) {
  const raw = cleanText(pathOrUrl);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/fakro-products/")) {
    return `https://www.linxglass.co.uk${raw}`;
  }
  if (raw.startsWith("fakro-products/")) {
    return `https://www.linxglass.co.uk/${raw}`;
  }
  if (raw.startsWith("image/upload/") || raw.startsWith("video/upload/")) {
    return `https://res.cloudinary.com/${SOURCE_CLOUD}/${raw}`;
  }
  const cleaned = raw.replace(/^\//, "");
  const file = cleaned.split("/").pop();
  return [
    `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/${cleaned}`,
    file
      ? `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/linx-products/fakro/${file}`
      : "",
    file
      ? `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/fakro-products/${file}`
      : "",
    file ? `https://www.linxglass.co.uk/fakro-products/${file}` : "",
  ].filter(Boolean);
}

function expandCandidates(pathOrUrl) {
  const raw = cleanText(pathOrUrl);
  if (!raw) return [];
  if (isDestCloudUrl(raw)) return [raw];
  if (isShopify(raw)) {
    // Try live Shopify first; also try Glass/Cloudinary by filename
    const file = raw.split("?")[0].split("/").pop() || "";
    const base = file.replace(/_[0-9a-f-]{8,}(?=\.)/i, ""); // strip shopify uuid suffix
    const outs = [raw];
    if (file) {
      outs.push(`https://www.linxglass.co.uk/fakro-products/${file}`);
      outs.push(`https://www.linxglass.co.uk/fakro-products/${base}`);
      outs.push(
        `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/linx-products/fakro/${base}`,
      );
      outs.push(
        `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/fakro-products/${base}`,
      );
      outs.push(
        `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/cirrus/${base}`,
      );
    }
    return [...new Set(outs)];
  }
  const abs = absSourceUrl(raw);
  return Array.isArray(abs) ? [...new Set(abs)] : [abs].filter(Boolean);
}

async function downloadFirstOk(candidates) {
  let lastErr = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "LinxLivingFakroRestore/1.0" },
        redirect: "follow",
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}: ${url}`);
        continue;
      }
      const ct = String(res.headers.get("content-type") || "");
      if (ct.includes("text/html")) {
        lastErr = new Error(`HTML not image: ${url}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length || buffer.length < 200) {
        lastErr = new Error(`empty/tiny: ${url}`);
        continue;
      }
      return { buffer, sourceUrl: url, contentType: ct };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("no candidates");
}

function uploadBuffer(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: publicId.replace(/\.[^.]+$/, "").slice(0, 180),
        overwrite: true,
        resource_type: "image",
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

async function migrateToDest(pathOrUrl, publicIdHint) {
  const candidates = expandCandidates(pathOrUrl);
  if (!candidates.length) return null;

  // Already on dest — keep
  if (candidates.length === 1 && isDestCloudUrl(candidates[0])) {
    return candidates[0];
  }

  const cacheKey = candidates.join("|");
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

  // Prefer any already-dest URL in candidates
  const destHit = candidates.find(isDestCloudUrl);
  if (destHit) {
    imageCache.set(cacheKey, destHit);
    return destHit;
  }

  if (DRY_RUN) {
    imageCache.set(cacheKey, candidates[0]);
    return candidates[0];
  }

  const { buffer, sourceUrl } = await downloadFirstOk(candidates);
  const base =
    slugify(publicIdHint || path.basename(sourceUrl).replace(/\.[^.]+$/, "")) ||
    `img-${Date.now()}`;
  const destUrl = await uploadBuffer(buffer, base);
  imageCache.set(cacheKey, destUrl);
  for (const c of candidates) imageCache.set(c, destUrl);
  return destUrl;
}

async function supabaseGet(pathname) {
  if (!SOURCE_URL || !SOURCE_KEY) return null;
  const res = await fetch(`${SOURCE_URL}${pathname}`, { headers });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
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

function needsRestore(product) {
  const imgs = cleanImages(product.images);
  if (!imgs.length) return true;
  if (ONLY_MISSING) return false;
  const hasCloud = imgs.some(isCloudinary);
  const hasShop = imgs.some(isShopify);
  return hasShop && !hasCloud;
}

async function main() {
  if (
    !process.env.MONGODB_URI ||
    !DEST_CLOUD ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("Missing Mongo / dest Cloudinary env");
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({
    $or: [{ slug: "fakro" }, { name: /^fakro$/i }],
  });
  if (!brand) throw new Error("FAKRO brand not found");

  const productsCol = db.collection("products");
  const all = await productsCol
    .find({
      $or: [
        { brand: brand._id },
        { "specs.source": { $in: ["fakro-supabase", "roof-lanterns-supabase"] } },
        { name: /^FAKRO\b/i },
        { name: /CIRRUS Roof Lantern/i },
      ],
    })
    .project({
      _id: 1,
      name: 1,
      images: 1,
      category: 1,
      linxSku: 1,
      manufacturerSku: 1,
      "specs.sku": 1,
      "specs.source": 1,
      "specs.sourceId": 1,
    })
    .toArray();

  let targets = all.filter(needsRestore);
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  console.log(
    `Fakro-related: ${all.length} | needing restore: ${targets.length} | dry=${DRY_RUN} onlyMissing=${ONLY_MISSING}`,
  );
  console.log(
    `  empty galleries: ${all.filter((p) => !cleanImages(p.images).length).length}`,
  );
  console.log(
    `  Shopify-only: ${all.filter((p) => {
      const imgs = cleanImages(p.images);
      return imgs.length && imgs.some(isShopify) && !imgs.some(isCloudinary);
    }).length}`,
  );

  if (!targets.length) {
    await mongoose.disconnect();
    return;
  }

  // Pull Glass source rows by SKU when available
  const skus = [
    ...new Set(
      targets
        .map((p) => p.specs?.sku || p.linxSku || p.manufacturerSku)
        .map(cleanText)
        .filter(Boolean),
    ),
  ];
  const sourceBySku = new Map();
  const sourceByTitle = new Map();
  const galleryBySku = new Map();

  function titleKey(t) {
    return cleanText(t).toLowerCase();
  }

  if (SOURCE_URL && SOURCE_KEY) {
    console.log(`Fetching Glass source (SKUs=${skus.length})…`);
    const chunkSize = 60;
    for (let i = 0; i < skus.length; i += chunkSize) {
      const chunk = skus.slice(i, i + chunkSize);
      try {
        const rows = await supabaseGet(
          `/rest/v1/shop_products?sku=in.(${chunk.map(encodeURIComponent).join(",")})&select=sku,image_path,title,id`,
        );
        for (const row of rows || []) {
          sourceBySku.set(row.sku, row);
          if (row.title) sourceByTitle.set(titleKey(row.title), row);
        }

        const imgs = await supabaseGet(
          `/rest/v1/shop_product_images?sku=in.(${chunk.map(encodeURIComponent).join(",")})&select=sku,image_url,sort_order&order=sort_order.asc`,
        );
        for (const row of imgs || []) {
          if (!galleryBySku.has(row.sku)) galleryBySku.set(row.sku, []);
          galleryBySku.get(row.sku).push(row.image_url);
        }
      } catch (e) {
        console.warn(`  supabase SKU chunk failed: ${e.message}`);
      }
    }

    // Title fallback for targets still unmatched (e.g. CIRRUS with no specs.sku)
    const needTitle = targets.filter((p) => {
      const sku = cleanText(
        p.specs?.sku || p.linxSku || p.manufacturerSku,
      );
      return !sku || !sourceBySku.has(sku);
    });
    if (needTitle.length) {
      console.log(`Fetching Glass by title for ${needTitle.length} products…`);
      // Pull CIRRUS + FAKRO-ish catalogue chunks
      const queries = [
        `/rest/v1/shop_products?title=ilike.*CIRRUS*&select=sku,image_path,title,id&limit=500`,
        `/rest/v1/shop_products?title=ilike.*FAKRO*&select=sku,image_path,title,id&limit=1000`,
        `/rest/v1/shop_products?category=eq.Roof%20Lanterns&select=sku,image_path,title,id&limit=500`,
      ];
      for (const q of queries) {
        try {
          const rows = await supabaseGet(q);
          for (const row of rows || []) {
            if (row.sku && !sourceBySku.has(row.sku)) sourceBySku.set(row.sku, row);
            if (row.title) sourceByTitle.set(titleKey(row.title), row);
          }
        } catch (e) {
          console.warn(`  title query failed: ${e.message}`);
        }
      }

      // Galleries for newly discovered SKUs
      const extraSkus = [
        ...new Set(
          needTitle
            .map((p) => {
              const sku = cleanText(
                p.specs?.sku || p.linxSku || p.manufacturerSku,
              );
              const byTitle = sourceByTitle.get(titleKey(p.name));
              return sku || byTitle?.sku;
            })
            .filter(Boolean)
            .filter((s) => !galleryBySku.has(s)),
        ),
      ];
      for (let i = 0; i < extraSkus.length; i += chunkSize) {
        const chunk = extraSkus.slice(i, i + chunkSize);
        try {
          const imgs = await supabaseGet(
            `/rest/v1/shop_product_images?sku=in.(${chunk.map(encodeURIComponent).join(",")})&select=sku,image_url,sort_order&order=sort_order.asc`,
          );
          for (const row of imgs || []) {
            if (!galleryBySku.has(row.sku)) galleryBySku.set(row.sku, []);
            galleryBySku.get(row.sku).push(row.image_url);
          }
        } catch (e) {
          console.warn(`  gallery chunk failed: ${e.message}`);
        }
      }
    }

    console.log(
      `  source by sku: ${sourceBySku.size} | by title: ${sourceByTitle.size} | galleries: ${galleryBySku.size}`,
    );
  } else {
    console.warn("No Supabase credentials — using name/Shopify filename fallbacks only");
  }

  const report = {
    updated: 0,
    failed: 0,
    unchanged: 0,
    imageFails: 0,
    failures: [],
  };

  await mapPool(targets, CONCURRENCY, async (product, index) => {
    let sku = cleanText(
      product.specs?.sku || product.linxSku || product.manufacturerSku,
    );
    const byTitle = sourceByTitle.get(titleKey(product.name));
    if (!sku && byTitle?.sku) sku = cleanText(byTitle.sku);
    const label = `${sku || product._id} · ${cleanText(product.name).slice(0, 55)}`;
    try {
      const imageUrls = [];
      const keepExistingCloud = cleanImages(product.images).filter(isCloudinary);

      for (const u of keepExistingCloud) {
        if (isDestCloudUrl(u)) {
          if (!imageUrls.includes(u)) imageUrls.push(u);
        } else {
          // Re-host source cloud → dest
          try {
            const dest = await migrateToDest(u, `keep-${sku || product._id}-${imageUrls.length + 1}`);
            if (dest && !imageUrls.includes(dest)) imageUrls.push(dest);
          } catch {
            if (!imageUrls.includes(u)) imageUrls.push(u); // keep source cloud if rehost fails
            report.imageFails++;
          }
        }
      }

      const src = (sku && sourceBySku.get(sku)) || byTitle || null;
      const seedPaths = [];
      if (src?.image_path) seedPaths.push(src.image_path);
      for (const g of (galleryBySku.get(sku) || []).slice(0, MAX_GALLERY)) {
        seedPaths.push(g);
      }

      // Shopify filenames as recovery seeds
      for (const u of cleanImages(product.images).filter(isShopify)) {
        seedPaths.push(u);
      }

      // CIRRUS size-based candidates when still empty
      if (!seedPaths.length || /cirrus|roof lantern/i.test(product.name)) {
        seedPaths.push(...cirrusCandidatesFromName(product.name));
      }

      for (let i = 0; i < seedPaths.length; i++) {
        if (imageUrls.length >= MAX_GALLERY) break;
        try {
          const dest = await migrateToDest(
            seedPaths[i],
            `p-${slugify(sku || String(product._id))}-${i + 1}`,
          );
          if (dest && !imageUrls.includes(dest)) imageUrls.push(dest);
        } catch (e) {
          report.imageFails++;
        }
      }

      const unique = [...new Set(imageUrls.filter(Boolean))];
      if (!unique.length) {
        report.failed++;
        report.failures.push(label);
        console.warn(`  ✗ no images: ${label}`);
        return;
      }

      const prev = cleanImages(product.images);
      const same =
        unique.length === prev.length &&
        unique.every((u, i) => u === prev[i]) &&
        !prev.some(isShopify);

      if (same) {
        report.unchanged++;
        return;
      }

      if (!DRY_RUN) {
        await productsCol.updateOne(
          { _id: product._id },
          { $set: { images: unique, updatedAt: new Date() } },
        );
      }
      report.updated++;
      if ((index + 1) % 10 === 0 || index === 0 || index === targets.length - 1) {
        console.log(
          `  … ${index + 1}/${targets.length} updated=${report.updated} failed=${report.failed} cache=${imageCache.size}`,
        );
      }
    } catch (err) {
      report.failed++;
      report.failures.push(`${label}: ${err.message}`);
      console.error(`  ✗ ${label}:`, err.message);
    }
  });

  console.log("\n========== FAKRO IMAGE RESTORE ==========");
  console.log(`Updated:    ${report.updated}`);
  console.log(`Unchanged:  ${report.unchanged}`);
  console.log(`Failed:     ${report.failed}`);
  console.log(`Image errs: ${report.imageFails}`);
  console.log(`Cache:      ${imageCache.size}`);
  if (report.failures.length) {
    console.log("Failures:");
    report.failures.slice(0, 30).forEach((f) => console.log("  -", f));
  }

  fs.writeFileSync(
    path.join(__dirname, "_tmp-fakro-restore-report.json"),
    JSON.stringify(report, null, 2),
  );

  // Quick re-count
  const after = await productsCol
    .find({ brand: brand._id })
    .project({ images: 1 })
    .toArray();
  const empty = after.filter((p) => !cleanImages(p.images).length).length;
  const shopOnly = after.filter((p) => {
    const imgs = cleanImages(p.images);
    return imgs.length && imgs.some(isShopify) && !imgs.some(isCloudinary);
  }).length;
  const withCloud = after.filter((p) =>
    cleanImages(p.images).some(isCloudinary),
  ).length;
  console.log("\nFakro brand after:");
  console.log(`  total=${after.length} cloudinary=${withCloud} shopifyOnly=${shopOnly} empty=${empty}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
