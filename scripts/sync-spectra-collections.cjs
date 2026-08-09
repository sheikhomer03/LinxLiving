/**
 * Sync Spectra categories + missing products from spectratileandhome.com
 *
 * - Add "600x600 Tiles" + "Adhesive, Grout & Silicone"
 * - Rename Outdoor → Outdoor Tiles
 * - Merge both Matt Carving Shopify collections into one local category
 * - Import any missing products from Glossy / High Gloss / Matt /
 *   Matt Carving / Outdoor Tiles / 600x600 / Adhesive
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-spectra-collections.cjs
 *   DRY_RUN=1 SKIP_IMAGES=1 CONCURRENCY=2
 */
const path = require("path");
const fs = require("fs");
const dns = require("dns");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

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

const BASE = "https://spectratileandhome.com";
const BRAND_SLUG = "spectra";
const SOURCE_TAG = "spectra-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/spectra";
const LOG = path.join(__dirname, "_tmp-spectra-collections-sync.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 12));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 50);

/**
 * Local category slug → one or more Shopify collection handles to scrape.
 * Matt Carving merges both site collections into one local category.
 */
const CATEGORY_MAP = [
  {
    name: "Gloss",
    slug: "gloss",
    handles: ["glossy"],
    order: 0,
  },
  {
    name: "High Gloss",
    slug: "high-gloss",
    handles: ["high-gloss"],
    order: 1,
  },
  {
    name: "Matt",
    slug: "matt",
    handles: ["matt"],
    order: 2,
  },
  {
    name: "Matt Carving",
    slug: "matt-carving",
    handles: ["matt-carving-1", "matt-carving"],
    order: 3,
  },
  {
    name: "600x600 Tiles",
    slug: "600x600-tiles",
    handles: ["600x600-tiles"],
    order: 4,
  },
  {
    name: "Outdoor Tiles",
    slug: "outdoor-tiles",
    handles: ["outdoor-tiles"],
    order: 5,
    /** Rename old local slug */
    renameFrom: ["outdoor"],
  },
  {
    name: "Adhesive, Grout & Silicone",
    slug: "adhesive-grout-silicone",
    handles: ["adhesive-grout-silicone"],
    order: 6,
  },
];

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function cleanText(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(u) {
  let s = String(u || "").trim();
  if (!s) return "";
  if (s.startsWith("//")) s = `https:${s}`;
  if (s.startsWith("/")) s = `${BASE}${s}`;
  return s;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchCollectionProducts(handle) {
  const out = [];
  let page = 1;
  for (;;) {
    const url = `${BASE}/collections/${handle}/products.json?limit=250&page=${page}`;
    const data = await fetchJson(url);
    const batch = data.products || [];
    out.push(...batch);
    if (batch.length < 250) break;
    page++;
    await delay(80);
  }
  return out;
}

async function fetchProductDetail(handle) {
  try {
    const data = await fetchJson(`${BASE}/products/${handle}.json`);
    return data.product || null;
  } catch {
    return null;
  }
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = absUrl(imageUrl).split("?")[0];
  if (!clean) return "";
  if (SKIP_IMAGES || DRY_RUN) return clean;
  try {
    const result = await cloudinary.uploader.upload(clean, {
      folder: CLOUDINARY_FOLDER,
      public_id: String(publicId).slice(0, 180),
      overwrite: false,
      resource_type: "image",
    });
    return result.secure_url || clean;
  } catch {
    return clean;
  }
}

async function ensureBrand(db) {
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Spectra brand not found — create it first");
  return brand;
}

async function ensureMenu(db, brandId, { name, slug, order, departmentId }) {
  const menus = db.collection("menus");
  let menu = await menus.findOne({ brand: brandId, slug, parent: null });
  const now = new Date();
  if (!menu) {
    const insert = {
      name,
      slug,
      parent: null,
      brand: brandId,
      order: order ?? 0,
      isActive: true,
      image: "",
      level: "category",
      ...(departmentId ? { department: departmentId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      log(`[dry] + menu ${name} (${slug})`);
      return { ...insert, _id: `dry-${slug}` };
    }
    const r = await menus.insertOne(insert);
    log(`+ menu ${name} (${slug})`);
    return { ...insert, _id: r.insertedId };
  }
  if (!DRY_RUN) {
    const $set = {
      name,
      brand: brandId,
      isActive: true,
      order: order ?? menu.order,
      updatedAt: now,
    };
    if (departmentId) $set.department = departmentId;
    await menus.updateOne({ _id: menu._id }, { $set });
  }
  return menu;
}

function extractSize(shopify) {
  const opt = (shopify.options || []).find((o) =>
    /size/i.test(String(o.name || "")),
  );
  const fromOpt = opt?.values?.[0];
  if (fromOpt && !/^default title$/i.test(fromOpt)) return String(fromOpt);
  const v = (shopify.variants || [])[0];
  const title = String(v?.title || v?.option1 || "");
  if (title && !/^default title$/i.test(title)) return title;
  // Fallback from tags / title "600 x 600"
  const m = String(shopify.title || "").match(
    /(\d+)\s*[x×]\s*(\d+)/i,
  );
  return m ? `${m[1]} x ${m[2]}` : "";
}

function extractSqmPerBox(shopify, detail) {
  const tags = Array.isArray(shopify.tags)
    ? shopify.tags
    : String(shopify.tags || "").split(",");
  for (const t of tags) {
    const m = String(t).match(/([\d.]+)\s*m2|([\d.]+)\s*sqm/i);
    if (m) return m[1] || m[2];
  }
  const body = cleanText(detail?.body_html || shopify.body_html || "");
  const m2 = body.match(/([\d.]+)\s*m²|([\d.]+)\s*m2|([\d.]+)\s*sqm/i);
  if (m2) return m2[1] || m2[2] || m2[3];
  return "";
}

function productPrice(shopify) {
  const v = (shopify.variants || [])[0] || {};
  const n = Number(v.price || 0);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  fs.writeFileSync(
    LOG,
    `Spectra collections sync ${new Date().toISOString()}\n`,
  );
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (!SKIP_IMAGES && !DRY_RUN) {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      throw new Error("Missing Cloudinary credentials");
    }
  }

  log(
    `Spectra collections sync${DRY_RUN ? " (DRY RUN)" : ""} concurrency=${CONCURRENCY}`,
  );

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");
  const menusCol = db.collection("menus");

  // --- Rename Outdoor → Outdoor Tiles ---
  for (const cat of CATEGORY_MAP) {
    for (const oldSlug of cat.renameFrom || []) {
      const oldMenu = await menusCol.findOne({
        brand: brand._id,
        slug: oldSlug,
        parent: null,
      });
      if (oldMenu) {
        if (DRY_RUN) {
          log(`[dry] rename menu ${oldSlug} → ${cat.slug} (${cat.name})`);
        } else {
          // If target already exists, deactivate old; else rename in place
          const target = await menusCol.findOne({
            brand: brand._id,
            slug: cat.slug,
            parent: null,
          });
          if (target) {
            await menusCol.updateOne(
              { _id: oldMenu._id },
              { $set: { isActive: false, updatedAt: new Date() } },
            );
            log(`Deactivated old menu ${oldSlug} (target ${cat.slug} exists)`);
          } else {
            await menusCol.updateOne(
              { _id: oldMenu._id },
              {
                $set: {
                  name: cat.name,
                  slug: cat.slug,
                  isActive: true,
                  updatedAt: new Date(),
                },
              },
            );
            log(`Renamed menu ${oldSlug} → ${cat.slug}`);
          }
        }
      }
      const moved = DRY_RUN
        ? { modifiedCount: 0 }
        : await productsCol.updateMany(
            {
              brand: brand._id,
              category: oldSlug,
            },
            {
              $set: {
                category: cat.slug,
                updatedAt: new Date(),
              },
            },
          );
      log(
        `Products category ${oldSlug} → ${cat.slug}: ${moved.modifiedCount || 0}`,
      );
    }
  }

  // All Spectra collections live under Tiles.
  const tilesDept = await db.collection("departments").findOne({ slug: "tiles" });
  if (!tilesDept) log("WARN: Tiles department not found — menus will have no department");

  // --- Ensure all category menus ---
  for (const cat of CATEGORY_MAP) {
    await ensureMenu(db, brand._id, {
      name: cat.name,
      slug: cat.slug,
      order: cat.order,
      departmentId: tilesDept?._id || null,
    });
  }

  // Existing Spectra handles in DB
  const existing = await productsCol
    .find({
      $or: [{ brand: brand._id }, { brands: brand._id }],
    })
    .project({ name: 1, "specs.spectraHandle": 1, category: 1 })
    .toArray();
  const existingHandles = new Set(
    existing
      .map((p) => String(p.specs?.spectraHandle || "").trim())
      .filter(Boolean),
  );
  log(`Existing Spectra products: ${existing.length} (handles: ${existingHandles.size})`);

  // --- Fetch each collection and collect products to upsert ---
  /** @type {Map<string, { shopify: any, categorySlug: string, categoryName: string, collectionHandles: string[] }>} */
  const toImport = new Map();
  /**
   * Categories that own their Shopify membership (remap existing products).
   * Finish collections (gloss/high-gloss/matt) only fill gaps — many local
   * products live there from the Excel import beyond Shopify collection lists.
   */
  const OWNING_SLUGS = new Set([
    "matt-carving",
    "600x600-tiles",
    "outdoor-tiles",
    "adhesive-grout-silicone",
  ]);
  /** @type {Map<string, { slug: string, name: string }>} */
  const owningHandleCategory = new Map();

  for (const cat of CATEGORY_MAP) {
    const seenInCat = new Set();
    for (const handle of cat.handles) {
      log(`Fetching collection ${handle}…`);
      let products = [];
      try {
        products = await fetchCollectionProducts(handle);
      } catch (e) {
        log(`  fail ${handle}: ${e.message}`);
        continue;
      }
      log(`  ${handle.length} products`);
      for (const p of products) {
        const h = String(p.handle || "").trim();
        if (!h || seenInCat.has(h)) continue;
        seenInCat.add(h);

        if (OWNING_SLUGS.has(cat.slug) && !owningHandleCategory.has(h)) {
          owningHandleCategory.set(h, { slug: cat.slug, name: cat.name });
        }
        if (existingHandles.has(h)) continue;

        // Prefer first category that claims the product (CATEGORY_MAP order)
        if (!toImport.has(h)) {
          toImport.set(h, {
            shopify: p,
            categorySlug: cat.slug,
            categoryName: cat.name,
            collectionHandles: [handle],
          });
        } else {
          toImport.get(h).collectionHandles.push(handle);
        }
      }
      await delay(100);
    }
  }

  // Prefer owning category when a new product also appears in finish collections
  for (const [h, row] of toImport) {
    const own = owningHandleCategory.get(h);
    if (own) {
      row.categorySlug = own.slug;
      row.categoryName = own.name;
    }
  }

  // Remap existing products into owning categories (Matt Carving merge, 600x600, etc.)
  let remapped = 0;
  if (!DRY_RUN) {
    for (const [handle, cat] of owningHandleCategory) {
      const res = await productsCol.updateMany(
        {
          brand: brand._id,
          "specs.spectraHandle": handle,
          category: { $ne: cat.slug },
        },
        {
          $set: {
            category: cat.slug,
            "specs.spectraCollection": cat.name,
            updatedAt: new Date(),
          },
        },
      );
      remapped += res.modifiedCount || 0;
    }
  }
  log(`Owning-collection handles: ${owningHandleCategory.size}`);
  log(`Remapped into owning categories: ${remapped}`);
  log(`Missing products to import: ${toImport.size}`);

  let imported = 0;
  let failed = 0;
  const pending = [...toImport.values()];

  await mapPool(pending, CONCURRENCY, async (row, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    const shopify = row.shopify;
    const handle = shopify.handle;
    try {
      const detail = (await fetchProductDetail(handle)) || shopify;
      await delay(60);
      const name = cleanText(detail.title || shopify.title) || handle;
      const variant = (detail.variants || shopify.variants || [])[0] || {};
      const price = productPrice(detail.variants ? detail : shopify);
      const compareAt = Number(variant.compare_at_price || 0) || 0;
      const available =
        variant.available === true ||
        (detail.variants || shopify.variants || []).some((v) => v.available);
      const size = extractSize(detail);
      const sqm = extractSqmPerBox(shopify, detail);
      const description =
        cleanText(detail.body_html || shopify.body_html || "") ||
        `${name} from Spectra Tile and Home.`;

      const images = [];
      for (const img of detail.images || shopify.images || []) {
        const src = absUrl(img.src);
        if (src && !images.includes(src)) images.push(src);
        if (images.length >= MAX_IMAGES) break;
      }
      const uploaded = [];
      for (let i = 0; i < images.length; i++) {
        uploaded.push(
          await uploadRemoteImage(images[i], `${handle}-${i + 1}`),
        );
      }

      const specs = {
        source: SOURCE_TAG,
        sourceUrl: `${BASE}/products/${handle}`,
        spectraHandle: handle,
        spectraTitle: name,
        spectraId: detail.id || shopify.id,
        spectraCollection: row.categoryName,
        collectionHandles: row.collectionHandles.join(","),
        shopifyProductId: String(detail.id || shopify.id),
        shopifyVariantId: String(variant.id || ""),
        sku: variant.sku || "",
        shopifySku: variant.sku || "",
        size: size || "",
        sqmPerBox: sqm || "",
        shopifyListPrice: price,
        shopifyCompareAt: compareAt || null,
        unit: /adhesive|grout|silicone/i.test(row.categorySlug)
          ? "each"
          : "per box",
      };

      const now = new Date();
      const doc = {
        name,
        description: description.slice(0, 12000),
        price,
        images: uploaded,
        category: row.categorySlug,
        subCategory: "",
        department: "tiles",
        brand: brand._id,
        brands: [brand._id],
        stock: available ? STOCK_DEFAULT : 0,
        isOutOfStock: !available,
        tagline: row.categoryName,
        linxSku: variant.sku || handle,
        manufacturerSku: variant.sku || "",
        specs,
        showSpecs: true,
        sizeOptions: size
          ? [{ name: size, imageUrl: uploaded[0] || "", sortOrder: 0 }]
          : [],
        updatedAt: now,
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] + ${name} £${price} → ${row.categorySlug} imgs=${images.length}`,
        );
        imported++;
        return;
      }

      const existingDoc = await productsCol.findOne({
        brand: brand._id,
        "specs.spectraHandle": handle,
      });
      if (existingDoc) {
        const prev = Array.isArray(existingDoc.images)
          ? existingDoc.images
          : [];
        if (!uploaded.length && prev.length) doc.images = prev;
        await productsCol.updateOne({ _id: existingDoc._id }, { $set: doc });
        log(`${label} ~ ${name} (updated) → ${row.categorySlug}`);
      } else {
        await productsCol.insertOne({ ...doc, createdAt: now });
        log(
          `${label} + ${name} £${price} → ${row.categorySlug} imgs=${uploaded.length}`,
        );
      }
      imported++;
    } catch (e) {
      failed++;
      log(`${label} ✗ ${handle}: ${e.message}`);
    }
  });

  // Final counts
  const byCat = await productsCol
    .aggregate([
      {
        $match: {
          $or: [{ brand: brand._id }, { brands: brand._id }],
        },
      },
      { $group: { _id: "$category", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();
  const menus = await menusCol
    .find({ brand: brand._id, parent: null, isActive: { $ne: false } })
    .project({ name: 1, slug: 1 })
    .sort({ order: 1 })
    .toArray();
  const total = await productsCol.countDocuments({
    $or: [{ brand: brand._id }, { brands: brand._id }],
  });

  log("\n========== SPECTRA COLLECTIONS SYNC ==========");
  log(`Imported/updated this run: ${imported}`);
  log(`Failed: ${failed}`);
  log(`Remapped: ${remapped}`);
  log(`Active categories: ${menus.map((m) => m.name).join(", ")}`);
  log(`Total Spectra products: ${total}`);
  log(
    `By category: ${byCat.map((r) => `${r._id}:${r.n}`).join(", ")}`,
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
