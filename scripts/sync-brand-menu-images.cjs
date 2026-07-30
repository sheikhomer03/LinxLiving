/**
 * Sync dedicated category / subcategory images onto Menu docs
 * for Noken + PORCELANOSA Grupo.
 *
 * Noken: homepage tipology cards + nav menu_image (real category banners).
 *        Subcategories: first listing product image (no dedicated tipology art).
 * Porcelanosa: no public category banners → first product image per menu.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/sync-brand-menu-images.cjs
 *
 * Options:
 *   DRY_RUN=1
 *   BRAND=noken|porcelanosagrupo|all  (default all)
 *   FORCE=1  overwrite existing menu images
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

const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE = process.env.FORCE === "1";
const BRAND_FILTER = (process.env.BRAND || "all").toLowerCase();

const NOKEN_BASE = "https://www.noken.com";
const PORC_BASE = "https://productfinder.porcelanosagrupo.com";

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function http(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,*/*",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return text;
}

async function downloadBuffer(imageUrl) {
  const res = await fetch(imageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: imageUrl.includes("noken.com")
        ? `${NOKEN_BASE}/en`
        : `${PORC_BASE}/en/product_finder.html`,
    },
  });
  if (!res.ok) throw new Error(`download ${res.status}: ${imageUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error(`empty image: ${imageUrl}`);
  return buffer;
}

function uploadBuffer(buffer, folder, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId.slice(0, 180),
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

async function toCloudinary(imageUrl, folder, publicId) {
  if (!imageUrl) return "";
  if (DRY_RUN) return imageUrl;
  if (/res\.cloudinary\.com/i.test(imageUrl)) return imageUrl;
  const buffer = await downloadBuffer(imageUrl.split("?")[0]);
  return uploadBuffer(buffer, folder, publicId);
}

function extractAllProducts(html) {
  const m = html.match(
    /id=["']all-products-data["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m) return [];
  try {
    const data = JSON.parse(m[1].trim());
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function extractSubcategoryLinks(html, parentSlug) {
  const re = new RegExp(
    `href=["'](https://www\\.noken\\.com/en/products/${parentSlug}/([a-z0-9-]+))["']`,
    "gi",
  );
  const out = new Map();
  for (const m of html.matchAll(re)) {
    const sub = m[2];
    if (!sub || sub === "feed") continue;
    out.set(sub, m[1]);
  }
  return [...out.entries()].map(([slug, url]) => ({ slug, url }));
}

/** Prefer homepage tipology cards, fall back to nav menu_image. */
async function scrapeNokenCategoryImages() {
  const bySlug = new Map();

  const home = await http(`${NOKEN_BASE}/en`);

  // Homepage tipology cards (best quality)
  for (const m of home.matchAll(
    /<div class="tipology[\s\S]*?<a href=["']https:\/\/www\.noken\.com\/en\/products\/([a-z0-9-]+)["'][\s\S]*?<img[^>]+src=["']([^"']+)["'][\s\S]*?<\/div>/gi,
  )) {
    bySlug.set(m[1], m[2]);
  }

  // Nav menu_image blocks
  const blocks = new Map();
  for (const m of home.matchAll(
    /<div[^>]*id=["'](menu_image_\d+)["'][^>]*>([\s\S]*?)<\/div>/gi,
  )) {
    const src = m[2].match(/src=["']([^"']+)["']/i)?.[1];
    if (src) blocks.set(m[1], src);
  }
  for (const m of home.matchAll(
    /data-img=["']#(menu_image_\d+)["'][^>]*href=["']https:\/\/www\.noken\.com\/en\/products\/([a-z0-9-]+)["']/gi,
  )) {
    const src = blocks.get(m[1]);
    if (src && !bySlug.has(m[2])) bySlug.set(m[2], src);
  }

  return bySlug;
}

async function scrapeNokenSubcategoryImages(parentSlugs) {
  const out = new Map(); // `${parent}/${sub}` → image url
  for (const parent of parentSlugs) {
    let html;
    try {
      html = await http(`${NOKEN_BASE}/en/products/${parent}`);
    } catch (e) {
      console.warn(`noken parent fail ${parent}: ${e.message}`);
      continue;
    }
    const subs = extractSubcategoryLinks(html, parent);
    // Also include parent itself for first-product fallback if needed
    const pages = [
      { key: parent, url: `${NOKEN_BASE}/en/products/${parent}`, isParent: true },
      ...subs.map((s) => ({
        key: `${parent}/${s.slug}`,
        url: s.url,
        isParent: false,
      })),
    ];

    for (const page of pages) {
      if (page.isParent) continue; // parent uses dedicated banner
      try {
        const pageHtml =
          page.url === `${NOKEN_BASE}/en/products/${parent}`
            ? html
            : await http(page.url);
        const products = extractAllProducts(pageHtml);
        const first = products[0];
        const img =
          first?.image_url ||
          (first?.sap
            ? `https://catalogos.porcelanosagrupo.com/recursos/img/high/${first.sap}.jpg`
            : "");
        if (img) out.set(page.key, img);
        console.log(`  sub ${page.key} → ${img ? "ok" : "none"}`);
        await delay(100);
      } catch (e) {
        console.warn(`  sub fail ${page.key}: ${e.message}`);
      }
    }
    await delay(120);
  }
  return out;
}

async function syncNoken(db) {
  console.log("\n=== Noken menu images ===");
  const brand = await db.collection("brands").findOne({ slug: "noken" });
  if (!brand) {
    console.warn("Brand noken not found — skip");
    return { updated: 0 };
  }

  const catImages = await scrapeNokenCategoryImages();
  console.log(`Dedicated category images: ${catImages.size}`);
  for (const [slug, img] of catImages) {
    console.log(`  ${slug} → ${img.slice(0, 90)}`);
  }

  const parentSlugs = [...catImages.keys()];
  // Also discover parents from menus
  const menus = await db
    .collection("menus")
    .find({ brand: brand._id })
    .toArray();
  for (const m of menus) {
    if (!m.parent && m.slug && !parentSlugs.includes(m.slug)) {
      parentSlugs.push(m.slug);
    }
  }

  console.log("Scraping subcategory listing images…");
  const subImages = await scrapeNokenSubcategoryImages(parentSlugs);
  console.log(`Subcategory images: ${subImages.size}`);

  let updated = 0;
  const folder = "linx-living/menus/noken";

  // Ensure parent menus exist for every scraped category banner
  const parentBySlug = new Map(
    menus.filter((m) => !m.parent).map((m) => [m.slug, m]),
  );
  let order = parentBySlug.size;
  for (const [slug, sourceUrl] of catImages) {
    if (parentBySlug.has(slug)) continue;
    const name = slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    try {
      const uploaded = await toCloudinary(
        sourceUrl,
        folder,
        `${slug}-category`,
      );
      if (DRY_RUN) {
        console.log(`[dry] create category ${slug}`);
        parentBySlug.set(slug, { slug, _id: `dry-${slug}` });
        updated += 1;
        continue;
      }
      const now = new Date();
      const insert = {
        name,
        slug,
        parent: null,
        brand: brand._id,
        order: order++,
        isActive: true,
        image: uploaded || "",
        createdAt: now,
        updatedAt: now,
      };
      const r = await db.collection("menus").insertOne(insert);
      const menu = { ...insert, _id: r.insertedId };
      parentBySlug.set(slug, menu);
      menus.push(menu);
      console.log(`created category ${slug}`);
      updated += 1;
      await delay(60);
    } catch (e) {
      console.warn(`create category ${slug} fail: ${e.message}`);
    }
  }

  // Ensure subcategory menus exist when we have listing images
  for (const [key, sourceUrl] of subImages) {
    const [parentSlug, subSlug] = key.split("/");
    if (!parentSlug || !subSlug) continue;
    const parent = parentBySlug.get(parentSlug);
    if (!parent) continue;
    const exists = menus.some(
      (m) =>
        m.slug === subSlug &&
        String(m.parent) === String(parent._id) &&
        String(m.brand) === String(brand._id),
    );
    if (exists) continue;
    try {
      const uploaded = await toCloudinary(
        sourceUrl,
        folder,
        `${parentSlug}-${subSlug}-sub`,
      );
      if (DRY_RUN) {
        console.log(`[dry] create sub ${key}`);
        updated += 1;
        continue;
      }
      const now = new Date();
      const name = subSlug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      const insert = {
        name,
        slug: subSlug,
        parent: parent._id,
        brand: brand._id,
        order: menus.length,
        isActive: true,
        image: uploaded || "",
        createdAt: now,
        updatedAt: now,
      };
      const r = await db.collection("menus").insertOne(insert);
      menus.push({ ...insert, _id: r.insertedId });
      console.log(`created subcategory ${key}`);
      updated += 1;
      await delay(60);
    } catch (e) {
      console.warn(`create sub ${key} fail: ${e.message}`);
    }
  }

  for (const menu of menus) {
    let sourceUrl = "";
    let kind = "";
    if (!menu.parent) {
      sourceUrl = catImages.get(menu.slug) || "";
      kind = "category";
      // fallback: first product already on menu, or skip
    } else {
      const parent = menus.find(
        (p) => String(p._id) === String(menu.parent),
      );
      const parentSlug = parent?.slug || "";
      sourceUrl =
        subImages.get(`${parentSlug}/${menu.slug}`) ||
        subImages.get(menu.slug) ||
        "";
      kind = "subcategory";
    }

    if (!sourceUrl) continue;
    if (!FORCE && menu.image) continue;

    try {
      const uploaded = await toCloudinary(
        sourceUrl,
        folder,
        menu.parent
          ? `${slugify(String(menu.parent))}-${menu.slug}-sub`
          : `${menu.slug}-category`,
      );
      if (!uploaded) continue;
      if (DRY_RUN) {
        console.log(
          `[dry] ${kind} ${menu.slug} ← ${sourceUrl.slice(0, 80)}`,
        );
      } else {
        await db.collection("menus").updateOne(
          { _id: menu._id },
          { $set: { image: uploaded, updatedAt: new Date() } },
        );
        console.log(`ok ${kind} ${menu.slug}`);
      }
      updated += 1;
      await delay(60);
    } catch (e) {
      console.warn(`fail ${menu.slug}: ${e.message}`);
    }
  }

  return { updated };
}

/** Product Finder home banners: collection0–5.jpg */
async function scrapePorcelanosaParentBanners() {
  const html = await http(`${PORC_BASE}/en/product_finder.html`);
  const bySlug = new Map();
  for (const m of html.matchAll(
    /goto_typology\(['"]([^'"]+)['"]\)[^>]*style=["'][^"']*background-image:\s*url\(([^)]+)\)[^"']*["'][^>]*>\s*<span>([^<]+)<\/span>/gi,
  )) {
    const label = String(m[3] || "").trim();
    const slug = slugify(label);
    let img = String(m[2] || "").replace(/['"]/g, "").trim();
    if (!img) continue;
    if (img.startsWith("/")) img = `${PORC_BASE}${img}`;
    else if (!/^https?:\/\//i.test(img)) img = `${PORC_BASE}/${img}`;
    bySlug.set(slug, img);
    console.log(`  banner ${slug} ← ${img}`);
  }
  // Fallback fixed map if regex misses
  if (!bySlug.size) {
    const fallback = [
      ["floor-and-wall", "collection0.jpg"],
      ["bathrooms", "collection1.jpg"],
      ["kitchens", "collection2.jpg"],
      ["interior-solutions", "collection3.jpg"],
      ["installation-materials", "collection4.jpg"],
      // technical-solutions omitted — Product Finder links only, no scrapable products
    ];
    for (const [slug, file] of fallback) {
      bySlug.set(slug, `${PORC_BASE}/css/images/collections/${file}`);
    }
  }
  return bySlug;
}

async function syncPorcelanosa(db) {
  console.log("\n=== PORCELANOSA Grupo menu images ===");
  const brand = await db
    .collection("brands")
    .findOne({ slug: "porcelanosagrupo" });
  if (!brand) {
    console.warn("Brand porcelanosagrupo not found — skip");
    return { updated: 0 };
  }

  const menus = await db
    .collection("menus")
    .find({ brand: brand._id })
    .toArray();
  const products = db.collection("products");
  const folder = "linx-living/menus/porcelanosagrupo";
  let updated = 0;

  // 1) Dedicated parent category banners from Product Finder home
  console.log("Scraping Product Finder home category banners…");
  const parentBanners = await scrapePorcelanosaParentBanners();
  const parentBySlug = new Map(
    menus.filter((m) => !m.parent).map((m) => [m.slug, m]),
  );

  for (const [slug, sourceUrl] of parentBanners) {
    try {
      // Only refresh banners for menus that already exist (products were scraped).
      // Do not create empty parents like Technical Solutions (link-only section).
      const existing = parentBySlug.get(slug);
      if (!existing) {
        console.log(`skip parent banner ${slug} (no menu — not scraped)`);
        continue;
      }
      const uploaded = await toCloudinary(
        sourceUrl,
        folder,
        `${slug}-category-banner`,
      );
      if (!uploaded) continue;
      if (FORCE || !existing.image || /products\/porcelanosagrupo|imgcom\/high/i.test(existing.image || "")) {
        if (DRY_RUN) {
          console.log(`[dry] parent banner ${slug}`);
        } else {
          await db.collection("menus").updateOne(
            { _id: existing._id },
            { $set: { image: uploaded, updatedAt: new Date() } },
          );
          existing.image = uploaded;
          console.log(`ok parent banner ${slug}`);
        }
        updated += 1;
      }
      await delay(60);
    } catch (e) {
      console.warn(`parent banner ${slug} fail: ${e.message}`);
    }
  }

  // 2) Subcategories: first product / checkpoint image (no dedicated banners)
  for (const menu of menus) {
    if (!menu.parent) continue; // parents handled above
    if (!FORCE && menu.image) continue;

    const query = {
      brand: brand._id,
      "specs.source": "porcelanosa-scrape",
      images: { $exists: true, $ne: [] },
    };
    const parent = menus.find(
      (p) => String(p._id) === String(menu.parent),
    );
    if (parent) query.category = parent.slug;
    query.subCategory = menu.slug;

    const product = await products.findOne(query, {
      sort: { updatedAt: -1 },
      projection: { images: 1, name: 1 },
    });
    const sourceUrl = product?.images?.[0] || "";
    if (!sourceUrl) {
      console.log(`skip ${menu.slug} (no product image)`);
      continue;
    }

    try {
      const uploaded = await toCloudinary(
        sourceUrl,
        folder,
        `${menu.slug}-menu`,
      );
      if (DRY_RUN) {
        console.log(`[dry] ${menu.slug} ← product image`);
      } else if (uploaded) {
        await db.collection("menus").updateOne(
          { _id: menu._id },
          { $set: { image: uploaded, updatedAt: new Date() } },
        );
        console.log(`ok ${menu.slug}`);
      }
      updated += 1;
      await delay(40);
    } catch (e) {
      console.warn(`fail ${menu.slug}: ${e.message}`);
    }
  }

  // Also try scraping first product image from Porcelanosa API for empty menus
  // when products aren't imported yet — use checkpoint if present
  const checkpoint = path.join(__dirname, "_tmp-porcelanosa-urls.json");
  if (fs.existsSync(checkpoint)) {
    try {
      const items = JSON.parse(fs.readFileSync(checkpoint, "utf8")).items || [];
      const byKey = new Map();
      for (const it of items) {
        const parentKey = it.categorySlug;
        const childKey = `${it.categorySlug}::${it.subCategorySlug}`;
        if (it.imagen && !byKey.has(parentKey)) byKey.set(parentKey, it.imagen);
        if (it.imagen && !byKey.has(childKey)) byKey.set(childKey, it.imagen);
      }

      for (const menu of menus) {
        // Parents use dedicated Product Finder banners — never overwrite
        if (!menu.parent) continue;
        if (!FORCE && menu.image) continue;
        const parent = menus.find(
          (p) => String(p._id) === String(menu.parent),
        );
        const rel = byKey.get(`${parent?.slug}::${menu.slug}`) || "";
        if (!rel) continue;
        const sourceUrl = /^https?:\/\//i.test(rel)
          ? rel
          : `${PORC_BASE}/${String(rel).replace(/^\/+/, "")}`;
        try {
          const uploaded = await toCloudinary(
            sourceUrl,
            folder,
            `${menu.slug}-menu`,
          );
          if (!DRY_RUN && uploaded) {
            await db.collection("menus").updateOne(
              { _id: menu._id },
              { $set: { image: uploaded, updatedAt: new Date() } },
            );
            console.log(`ok checkpoint ${menu.slug}`);
            updated += 1;
          } else if (DRY_RUN) {
            console.log(`[dry] checkpoint ${menu.slug}`);
            updated += 1;
          }
          await delay(40);
        } catch (e) {
          console.warn(`fail checkpoint ${menu.slug}: ${e.message}`);
        }
      }
    } catch (e) {
      console.warn(`checkpoint read fail: ${e.message}`);
    }
  }

  return { updated };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (!DRY_RUN) {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      throw new Error("Missing Cloudinary credentials");
    }
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const results = {};

  if (BRAND_FILTER === "all" || BRAND_FILTER === "noken") {
    results.noken = await syncNoken(db);
  }
  if (BRAND_FILTER === "all" || BRAND_FILTER === "porcelanosagrupo") {
    results.porcelanosagrupo = await syncPorcelanosa(db);
  }

  console.log("\nDone", JSON.stringify(results, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
