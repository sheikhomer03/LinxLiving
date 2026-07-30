/**
 * Migrate Fakro categories + products from source Supabase → MongoDB,
 * re-uploading images from source Cloudinary into destination Cloudinary.
 *
 * Requires `.env` (Mongo + dest Cloudinary) and `.env.migrate` (source Supabase).
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/migrate-fakro-from-supabase.cjs
 *
 * Options (env):
 *   DRY_RUN=1                 — no Mongo/Cloudinary writes
 *   LIMIT=50                  — cap products processed
 *   SKIP_IMAGES=1             — skip image download/upload
 *   ACTIVE_MENUS_ONLY=1       — only active Fakro categories (default 1)
 *   CONCURRENCY=4             — parallel product workers
 *   MAX_GALLERY_IMAGES=6      — extra images from shop_product_images
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

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const ACTIVE_MENUS_ONLY = process.env.ACTIVE_MENUS_ONLY !== "0";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 4));
const MAX_GALLERY_IMAGES = Math.max(
  0,
  Number(process.env.MAX_GALLERY_IMAGES || 6),
);
const DEFAULT_STOCK = Number(process.env.DEFAULT_STOCK || 25);
const BRAND_ORDER = Number(process.env.FAKRO_BRAND_ORDER || 4);
const CLOUDINARY_FOLDER = "linx-living/products/fakro";
const SOURCE_TAG = "fakro-supabase";

const headers = {
  apikey: SOURCE_KEY,
  Authorization: `Bearer ${SOURCE_KEY}`,
  Accept: "application/json",
};

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function supabaseGet(pathname) {
  const res = await fetch(`${SOURCE_URL}${pathname}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status} ${pathname}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function supabasePaged(pathname, pageSize = 1000) {
  const rows = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const res = await fetch(`${SOURCE_URL}${pathname}`, {
      headers: { ...headers, Range: `${from}-${to}`, Prefer: "count=exact" },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Supabase page ${res.status} ${pathname}: ${body.slice(0, 300)}`,
      );
    }
    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

/** Candidate absolute URLs for a source path / Cloudinary URL */
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
        headers: { "User-Agent": "LinxLivingFakroMigrator/1.0" },
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
  const looksGif = /\.gif$/i.test(publicId) || buffer.slice(0, 6).toString() === "GIF89a" || buffer.slice(0, 6).toString() === "GIF87a";
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

async function migrateImage(sourcePathOrUrl, publicIdHint) {
  const candidates = candidateImageUrls(sourcePathOrUrl);
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

const NOISE_DESC_RE =
  /^(buy now|find a stockist|roof windows 4 you)/i;

const SURVEY_LINE =
  "Survey, supply and professional installation available across London & the South East.";

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
  // Meta keys (lowercase) are filtered out on the PDP Technical Spec's tab.
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

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: "fakro" });
  const now = new Date();
  if (!brand) {
    const insert = {
      name: "FAKRO",
      slug: "fakro",
      order: BRAND_ORDER,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      brand = { ...insert, _id: "dry-run-brand" };
      console.log("[dry] would create brand FAKRO");
    } else {
      const result = await brands.insertOne(insert);
      brand = { ...insert, _id: result.insertedId };
      console.log(`Created brand FAKRO (${brand._id})`);
    }
  } else {
    console.log(`Using brand: ${brand.name} (${brand._id})`);
    if (!DRY_RUN) {
      await brands.updateOne(
        { _id: brand._id },
        { $set: { isActive: true, updatedAt: now } },
      );
    }
  }
  return brand;
}

async function ensureMenu(db, { name, slug, parent, brandId, order, isActive, image }) {
  const menus = db.collection("menus");
  const query = parent
    ? { slug, parent, brand: brandId }
    : { slug, parent: null, brand: brandId };
  let menu = DRY_RUN ? null : await menus.findOne(query);
  // Fallback: same slug under brand without parent match quirks
  if (!menu && !DRY_RUN) {
    menu = await menus.findOne(
      parent
        ? { slug, parent, brand: brandId }
        : { slug, parent: null, brand: brandId },
    );
  }

  const now = new Date();
  if (!menu) {
    const insert = {
      name,
      slug,
      parent: parent || null,
      brand: brandId,
      order: order ?? 0,
      isActive: !!isActive,
      image: image || "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      menu = { ...insert, _id: `dry-${slug}-${parent || "root"}` };
      console.log(`[dry] + menu ${name} (${slug})`);
    } else {
      const result = await menus.insertOne(insert);
      menu = { ...insert, _id: result.insertedId };
      console.log(`+ menu ${name} (${slug})`);
    }
  } else if (!DRY_RUN) {
    await menus.updateOne(
      { _id: menu._id },
      {
        $set: {
          name,
          order: order ?? menu.order ?? 0,
          isActive: !!isActive,
          ...(image ? { image } : {}),
          brand: brandId,
          updatedAt: now,
        },
      },
    );
    console.log(`· menu ${name} (${slug})`);
  }
  return menu;
}

async function mapPool(items, concurrency, worker) {
  let idx = 0;
  const results = new Array(items.length);
  async function run() {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
  return results;
}

async function main() {
  if (!SOURCE_URL || !SOURCE_KEY) {
    throw new Error("Missing SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SERVICE_ROLE_KEY in .env.migrate");
  }
  if (
    !process.env.MONGODB_URI ||
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("Missing MongoDB or destination Cloudinary env vars in .env");
  }

  console.log(
    `Mode: ${DRY_RUN ? "DRY_RUN" : "WRITE"} | images=${SKIP_IMAGES ? "skip" : "migrate"} | concurrency=${CONCURRENCY}`,
  );

  console.log("Fetching Fakro categories…");
  let categories = await supabaseGet(
    "/rest/v1/shop_categories?brand=ilike.*fakro*&select=*&order=sort_order.asc",
  );
  if (ACTIVE_MENUS_ONLY) {
    categories = categories.filter((c) => c.is_active);
  }
  console.log(`  ${categories.length} categories`);

  const catIds = categories.map((c) => c.id);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const catByName = new Map(categories.map((c) => [c.name, c]));

  console.log("Fetching category types…");
  const types =
    catIds.length === 0
      ? []
      : await supabaseGet(
          `/rest/v1/shop_category_types?category_id=in.(${catIds.join(",")})&select=*&order=sort_order.asc`,
        );
  console.log(`  ${types.length} types`);
  const typeById = new Map(types.map((t) => [t.id, t]));

  const categoryNames = categories.map((c) => c.name);
  const orFilter = categoryNames
    .map((n) => `category.eq.${encodeURIComponent(n)}`)
    .join(",");

  console.log("Fetching Fakro products…");
  let products = orFilter
    ? await supabasePaged(
        `/rest/v1/shop_products?or=(${orFilter})&select=*&order=created_at.asc`,
      )
    : [];
  // Safety net: any remaining title-matched Fakro products
  const byTitle = await supabasePaged(
    "/rest/v1/shop_products?title=ilike.*fakro*&select=*&order=created_at.asc",
  );
  const seen = new Set(products.map((p) => p.id));
  for (const p of byTitle) {
    if (!seen.has(p.id)) {
      products.push(p);
      seen.add(p.id);
    }
  }

  if (LIMIT > 0) products = products.slice(0, LIMIT);
  console.log(`  ${products.length} products to process`);

  console.log("Fetching gallery images…");
  const skus = [...new Set(products.map((p) => p.sku).filter(Boolean))];
  const galleryBySku = new Map();
  if (skus.length && MAX_GALLERY_IMAGES > 0) {
    // PostgREST in.() has URL length limits — chunk skus
    const chunkSize = 80;
    for (let i = 0; i < skus.length; i += chunkSize) {
      const chunk = skus.slice(i, i + chunkSize);
      const rows = await supabaseGet(
        `/rest/v1/shop_product_images?sku=in.(${chunk.map(encodeURIComponent).join(",")})&select=sku,image_url,sort_order&order=sort_order.asc`,
      );
      for (const row of rows) {
        if (!galleryBySku.has(row.sku)) galleryBySku.set(row.sku, []);
        galleryBySku.get(row.sku).push(row.image_url);
      }
    }
  }
  console.log(`  gallery rows for ${galleryBySku.size} skus`);

  console.log("Connecting MongoDB…");
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const productsCol = db.collection("products");

  const brand = await ensureBrand(db);
  const brandId = brand._id;

  // Brand image from first category with an image
  if (!DRY_RUN && !SKIP_IMAGES) {
    const withImg = categories.find((c) => c.image_path);
    if (withImg?.image_path) {
      try {
        const brandImg = await migrateImage(withImg.image_path, "fakro-brand");
        if (brandImg) {
          await db.collection("brands").updateOne(
            { _id: brandId },
            { $set: { image: brandImg, updatedAt: new Date() } },
          );
        }
      } catch (e) {
        console.warn("Brand image skip:", e.message);
      }
    }
  }

  const menuByCatId = new Map();
  const menuByTypeId = new Map();

  for (const cat of categories) {
    let image = "";
    if (cat.image_path && !SKIP_IMAGES) {
      try {
        image = (await migrateImage(cat.image_path, `cat-${cat.slug}`)) || "";
      } catch (e) {
        console.warn(`  ! cat image ${cat.slug}:`, e.message);
      }
    }
    const menu = await ensureMenu(db, {
      name: cat.name,
      slug: cat.slug || slugify(cat.name),
      parent: null,
      brandId,
      order: cat.sort_order ?? 0,
      isActive: !!cat.is_active,
      image,
    });
    menuByCatId.set(cat.id, menu);
  }

  for (const type of types) {
    const parentMenu = menuByCatId.get(type.category_id);
    if (!parentMenu) continue;
    let image = "";
    if (type.image_path && !SKIP_IMAGES) {
      try {
        image =
          (await migrateImage(type.image_path, `type-${type.slug}`)) || "";
      } catch (e) {
        console.warn(`  ! type image ${type.slug}:`, e.message);
      }
    }
    const menu = await ensureMenu(db, {
      name: type.name,
      slug: type.slug || slugify(type.name),
      parent: parentMenu._id,
      brandId,
      order: type.sort_order ?? 0,
      isActive: type.is_active !== false,
      image,
    });
    menuByTypeId.set(type.id, menu);
  }

  const report = {
    created: 0,
    updated: 0,
    skipped: 0,
    imageFails: 0,
    errors: [],
  };

  console.log("Migrating products…");
  await mapPool(products, CONCURRENCY, async (product, index) => {
    const label = `${product.sku || "?"} · ${cleanText(product.title).slice(0, 60)}`;
    try {
      const cat =
        catByName.get(product.category) ||
        (product.category_type_id
          ? catById.get(typeById.get(product.category_type_id)?.category_id)
          : null);

      const parentMenu = cat ? menuByCatId.get(cat.id) : null;
      const typeMenu = product.category_type_id
        ? menuByTypeId.get(product.category_type_id)
        : null;

      const categorySlug = parentMenu?.slug || slugify(product.category || "uncategorized");
      const subCategorySlug = typeMenu?.slug || "";

      const imageUrls = [];
      const primary = product.image_path;
      if (primary) {
        try {
          const url = await migrateImage(
            primary,
            `p-${product.sku || product.id}-1`,
          );
          if (url) imageUrls.push(url);
        } catch (e) {
          report.imageFails++;
          console.warn(`  ! image ${label}:`, e.message);
        }
      }

      const gallery = (galleryBySku.get(product.sku) || []).slice(
        0,
        MAX_GALLERY_IMAGES,
      );
      let gi = 2;
      for (const g of gallery) {
        if (imageUrls.length >= 1 + MAX_GALLERY_IMAGES) break;
        try {
          const url = await migrateImage(g, `p-${product.sku}-${gi++}`);
          if (url && !imageUrls.includes(url)) imageUrls.push(url);
        } catch (e) {
          report.imageFails++;
        }
      }

      const price = Number(product.price);
      const stock =
        product.stock_quantity == null
          ? DEFAULT_STOCK
          : Number(product.stock_quantity);
      const specs = buildSpecs(product);
      const description = buildDescription(product);
      const tagline = [product.product_code, product.size]
        .map(cleanText)
        .filter(Boolean)
        .join(" · ");

      const now = new Date();
      const payload = {
        name: cleanText(product.title) || product.sku || "FAKRO product",
        description,
        price: Number.isFinite(price) ? price : 0,
        images: imageUrls,
        category: categorySlug,
        subCategory: subCategorySlug,
        brand: brandId,
        stock: Number.isFinite(stock) ? stock : DEFAULT_STOCK,
        tagline,
        schematicImage: "",
        specs,
        showSpecs: true,
        updatedAt: now,
      };

      if (DRY_RUN) {
        if (index < 5) {
          console.log(
            `[dry] ${label} → ${categorySlug}/${subCategorySlug || "-"} £${payload.price} imgs=${imageUrls.length}`,
          );
        }
        report.created++;
        return;
      }

      const existing = await productsCol.findOne({
        "specs.sku": product.sku,
        "specs.source": SOURCE_TAG,
      });

      if (existing) {
        const update = { ...payload };
        if (!imageUrls.length) delete update.images;
        await productsCol.updateOne({ _id: existing._id }, { $set: update });
        report.updated++;
      } else {
        await productsCol.insertOne({ ...payload, createdAt: now });
        report.created++;
      }

      if ((index + 1) % 50 === 0 || index === 0) {
        console.log(
          `  … ${index + 1}/${products.length} (created=${report.created} updated=${report.updated} imgCache=${imageCache.size})`,
        );
      }
    } catch (err) {
      report.errors.push({ sku: product.sku, error: err.message });
      console.error(`  ✗ ${label}:`, err.message);
    }
  });

  console.log("\n========== FAKRO MIGRATE SUMMARY ==========");
  console.log(`Brand:     FAKRO`);
  console.log(`Menus:     ${categories.length} categories + ${types.length} types`);
  console.log(`Created:   ${report.created}`);
  console.log(`Updated:   ${report.updated}`);
  console.log(`Image fails: ${report.imageFails}`);
  console.log(`Unique images uploaded/cached: ${imageCache.size}`);
  if (report.errors.length) {
    console.log(`Errors: ${report.errors.length}`);
    for (const e of report.errors.slice(0, 20)) {
      console.log(`  - ${e.sku}: ${e.error}`);
    }
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
