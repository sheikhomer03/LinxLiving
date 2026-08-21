/**
 * Import SCHÜCO (Schüco) homeowner products → Living Mongo + Cloudinary
 *
 * Source: https://schuecohome.co.uk/products/
 * Brand: "SCHUCO" (slug: schuco) — isolated brand-scoped menus/products.
 * Prices: not published publicly → price 0 (price-on-request / TBC).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-schuco.cjs
 *   DRY_RUN=1 LIMIT=5 CONCURRENCY=2 SKIP_IMAGES=1 RESUME=1
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

const sharp = require("sharp");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BASE = "https://schuecohome.co.uk";
const BRAND_SLUG = "schuco";
const BRAND_NAME = "SCHUCO";
const SOURCE_TAG = "schuco-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/schuco";
const CHECKPOINT = path.join(__dirname, "_tmp-schuco-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-schuco-progress.json");
const LOG = path.join(__dirname, "_tmp-schuco-import.log");
const SEED = path.join(__dirname, "_tmp-schuco-product-urls.json");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 12));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

const CATEGORY_TREE = [
  { handle: "windows", title: "Windows", path: "/products/windows/" },
  { handle: "bi-fold-doors", title: "Bi-Fold Doors", path: "/products/bi-fold-doors/" },
  { handle: "sliding-doors", title: "Sliding Doors", path: "/products/sliding-doors/" },
  { handle: "front-doors", title: "Front Doors", path: "/products/front-doors/" },
  { handle: "interior-doors", title: "Interior Doors", path: "/products/interior-doors/" },
  { handle: "facades", title: "Façades", path: "/products/facades/" },
];

const SKIP_IMG =
  /logo|favicon|sprite|icon|avatar|gravatar|emoji|placeholder|data:image|svg\+xml|spinner|tracking|pixel|1x1|wp-includes/i;

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
    .slice(0, 90);
}

function sleep(ms) {
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
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () => run()),
  );
}

function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Prefer full-size WP uploads (strip -300x200 etc.) */
function fullSizeWpUrl(url) {
  return String(url || "").replace(/-\d+x\d+(?=\.(?:jpe?g|png|webp))/i, "");
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      Referer: `${BASE}/products/`,
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      Accept: "image/*,*/*",
      Referer: `${BASE}/`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadImage(buf, publicId) {
  let out = buf;
  if (buf.length > 400_000) {
    out = await sharp(buf)
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: String(publicId).slice(0, 180),
        overwrite: true,
        invalidate: true,
        resource_type: "image",
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(out);
  });
}

function categoryFromUrl(url) {
  const m = String(url).match(/\/products\/([^/]+)\//i);
  const handle = m?.[1] || "windows";
  const known = CATEGORY_TREE.find((c) => c.handle === handle);
  return {
    handle: known?.handle || slugify(handle),
    title: known?.title || handle.replace(/-/g, " "),
  };
}

async function discoverProducts() {
  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    if (saved.products?.length) {
      log(`Resumed ${saved.products.length} products from checkpoint`);
      return saved.products;
    }
  }

  const byUrl = new Map();

  if (fs.existsSync(SEED)) {
    const seed = JSON.parse(fs.readFileSync(SEED, "utf8"));
    for (const row of seed) {
      const url = String(row.url || "").replace(/\/?$/, "/");
      if (!url) continue;
      byUrl.set(url, {
        url,
        category: row.category || categoryFromUrl(url).handle,
        categoryName: row.categoryName || categoryFromUrl(url).title,
      });
    }
  }

  for (const cat of CATEGORY_TREE) {
    try {
      await sleep(150);
      const html = await fetchHtml(`${BASE}${cat.path}`);
      const links = [
        ...html.matchAll(
          /href=["'](https:\/\/schuecohome\.co\.uk)?(\/products\/[^"'#?]+)/gi,
        ),
      ].map((m) => {
        const pathPart = m[2].replace(/\/?$/, "/");
        return `https://schuecohome.co.uk${pathPart}`;
      });

      for (const url of links) {
        // Product PDPs have /products/{cat}/{slug}/ (3+ segments after host)
        const parts = url.replace(BASE, "").split("/").filter(Boolean);
        if (parts.length < 3) continue;
        if (/^page$|feed|attachment/i.test(parts[2])) continue;
        if (!byUrl.has(url)) {
          byUrl.set(url, {
            url,
            category: cat.handle,
            categoryName: cat.title,
          });
        }
      }
      log(`Category ${cat.handle}: scanned`);
    } catch (e) {
      log(`WARN category ${cat.handle}: ${e.message}`);
    }
  }

  // Also try sitemap
  try {
    const sm = await fetchHtml(`${BASE}/wp-sitemap-posts-product-1.xml`).catch(
      () => null,
    );
    const alt = sm || (await fetchHtml(`${BASE}/sitemap_index.xml`).catch(() => ""));
    const locs = [
      ...String(alt).matchAll(/<loc>(https:\/\/schuecohome\.co\.uk\/products\/[^<]+)<\/loc>/gi),
    ].map((m) => m[1].replace(/\/?$/, "/"));
    for (const url of locs) {
      const parts = url.replace(BASE, "").split("/").filter(Boolean);
      if (parts.length < 3) continue;
      if (!byUrl.has(url)) {
        const cat = categoryFromUrl(url);
        byUrl.set(url, {
          url,
          category: cat.handle,
          categoryName: cat.title,
        });
      }
    }
  } catch {
    /* optional */
  }

  const products = [...byUrl.values()];
  fs.writeFileSync(
    CHECKPOINT,
    JSON.stringify({ at: new Date().toISOString(), products }, null, 2),
  );
  log(`Discovered ${products.length} Schüco products`);
  return products;
}

function parseSchucoPdp(html, meta) {
  const titleMatch =
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<title>([^<]+)<\/title>/i);
  let name = stripTags(titleMatch?.[1] || "")
    .replace(/\s*[-|].*Schüco.*$/i, "")
    .replace(/\s*[-|].*Schuco.*$/i, "")
    .trim();

  const pathSlug =
    (meta.url.match(/\/products\/[^/]+\/([^/]+)\/?$/i) || [])[1] ||
    slugify(name);

  // Description: first meaningful paragraphs in main content
  const contentChunk =
    (html.match(
      /<(?:div|article)[^>]*(?:entry-content|product-content|wp-block-post-content)[^>]*>([\s\S]*?)<\/(?:div|article)>/i,
    ) || [])[1] || html;

  const paras = [];
  for (const p of contentChunk.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []) {
    const t = stripTags(p).replace(/\s+/g, " ").trim();
    if (
      t.length > 50 &&
      !/agree to my details|privacy policy|send enquiry|cookie|partner/i.test(t) &&
      !/\?$/.test(t) // skip FAQ questions as lead
    ) {
      paras.push(t);
    }
  }
  // Prefer first long product blurb
  const description =
    (paras.find((p) => p.length > 120) || paras[0] || "")
      .slice(0, 8000) ||
    `${name} from Schüco.`;

  // Specs from tables / definition-ish rows
  const specs = {};
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
        (c) => stripTags(c[1]),
      );
      if (cells.length >= 2) {
        const k = cells[0].replace(/:$/, "").trim();
        const v = cells.slice(1).join(" · ").trim();
        if (k && v && k.length < 80 && v.length < 300) specs[k] = v;
      }
    }
  }

  // Feature headings + nearby text
  const features = [];
  for (const m of html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)) {
    const h = stripTags(m[1]).trim();
    if (
      h &&
      h.length < 80 &&
      !/tell us about|thanks for|design advice|see more|range|finishing/i.test(h)
    ) {
      features.push(h);
    }
  }

  // Images from uploads
  const seen = new Set();
  const imageUrls = [];
  const imgRe =
    /(?:src|data-src|data-lazy-src)=["'](https?:\/\/schuecohome\.co\.uk\/wp-content\/uploads\/[^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi;
  let im;
  while ((im = imgRe.exec(html))) {
    let u = fullSizeWpUrl(im[1].split("?")[0]);
    if (SKIP_IMG.test(u)) continue;
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    imageUrls.push(u);
  }

  // og:image fallback
  const og = html.match(
    /property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
  );
  if (og) {
    const u = fullSizeWpUrl(og[1].split("?")[0]);
    if (u && !seen.has(u.toLowerCase()) && !SKIP_IMG.test(u)) {
      imageUrls.unshift(u);
    }
  }

  return {
    url: meta.url,
    slug: pathSlug,
    name: name || pathSlug.replace(/-/g, " "),
    category: meta.category,
    categoryName: meta.categoryName,
    description,
    specs,
    features: features.slice(0, 20),
    imageUrls: imageUrls.slice(0, MAX_IMAGES),
  };
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = DRY_RUN ? null : await brands.findOne({ slug: BRAND_SLUG });
  const now = new Date();
  if (!brand) {
    const insert = {
      name: BRAND_NAME,
      slug: BRAND_SLUG,
      order: 46,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) brand = { ...insert, _id: "dry-brand" };
    else {
      const r = await brands.insertOne(insert);
      brand = { ...insert, _id: r.insertedId };
      log(`Created brand ${BRAND_NAME}`);
    }
  } else if (!DRY_RUN) {
    await brands.updateOne(
      { _id: brand._id },
      { $set: { name: BRAND_NAME, isActive: true, updatedAt: now } },
    );
  }
  return brand;
}

async function ensureMenu(db, { name, slug, parent, brandId, order, image }) {
  const menus = db.collection("menus");
  const query = parent
    ? { slug, parent, brand: brandId }
    : { slug, parent: null, brand: brandId };
  let menu = DRY_RUN ? null : await menus.findOne(query);
  const now = new Date();
  if (!menu) {
    const insert = {
      name,
      slug,
      parent: parent || null,
      brand: brandId,
      order: order ?? 0,
      isActive: true,
      image: image || "",
      level: parent ? "subcategory" : "category",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) menu = { ...insert, _id: `dry-${slug}` };
    else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
      log(`Created menu ${name}`);
    }
  } else if (!DRY_RUN) {
    const set = {
      name,
      isActive: true,
      order: order ?? menu.order,
      updatedAt: now,
    };
    if (image) set.image = image;
    await menus.updateOne({ _id: menu._id }, { $set: set });
    menu = { ...menu, ...set };
  }
  return menu;
}

async function main() {
  fs.writeFileSync(LOG, `SCHUCO import ${new Date().toISOString()}\n`);
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (
    !SKIP_IMAGES &&
    !DRY_RUN &&
    (!process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET)
  ) {
    throw new Error("Missing Cloudinary credentials");
  }

  log(
    `SCHUCO import${DRY_RUN ? " (DRY)" : ""} concurrency=${CONCURRENCY} skipImages=${SKIP_IMAGES}`,
  );

  let products = await discoverProducts();
  if (LIMIT > 0) products = products.slice(0, LIMIT);

  await connectMongo(process.env.MONGODB_URI);
  const db = require("mongoose").connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  const keepMenuIds = new Set();
  let order = 0;
  for (const cat of CATEGORY_TREE) {
    const parent = await ensureMenu(db, {
      name: cat.title,
      slug: cat.handle,
      parent: null,
      brandId: brand._id,
      order: order++,
    });
    keepMenuIds.add(String(parent._id));
  }

  if (!DRY_RUN) {
    const all = await db.collection("menus").find({ brand: brand._id }).toArray();
    for (const m of all) {
      if (!keepMenuIds.has(String(m._id))) {
        await db.collection("menus").deleteOne({ _id: m._id, brand: brand._id });
        log(`Deleted obsolete menu ${m.slug}`);
      }
    }
  }

  let done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []);
    } catch {
      /* ignore */
    }
  }
  const saveProgress = () =>
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );

  const pending = products.filter((p) => {
    const slug =
      (p.url.match(/\/products\/[^/]+\/([^/]+)\/?$/i) || [])[1] || p.url;
    return !done.has(slug);
  });
  log(`Importing ${pending.length} products…`);

  let imported = 0;
  let failed = 0;

  await mapPool(pending, CONCURRENCY, async (meta, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    const slugHint =
      (meta.url.match(/\/products\/[^/]+\/([^/]+)\/?$/i) || [])[1] || meta.url;
    try {
      await sleep(200);
      const html = await fetchHtml(meta.url);
      const p = parseSchucoPdp(html, meta);

      const uploaded = [];
      if (!SKIP_IMAGES) {
        for (let i = 0; i < p.imageUrls.length; i++) {
          try {
            if (DRY_RUN) {
              uploaded.push(p.imageUrls[i]);
            } else {
              const buf = await fetchBuffer(p.imageUrls[i]);
              if (buf.length < 8_000) continue;
              const up = await uploadImage(buf, `${p.slug}-${i + 1}`);
              uploaded.push(up.secure_url);
            }
          } catch (e) {
            log(`${label} img fail: ${e.message}`);
          }
        }
      }

      const specs = {
        ...p.specs,
        source: SOURCE_TAG,
        sourceUrl: p.url,
        schucoHandle: p.slug,
        schucoCategory: p.categoryName,
        features: p.features,
        vendorBrand: "Schüco",
        priceNote: "Price on request — not published on Schüco Home site",
      };

      const doc = {
        name: p.name,
        slug: p.slug,
        description: p.description,
        price: 0,
        stock: STOCK_DEFAULT,
        category: p.category,
        subCategory: "",
        brand: brand._id,
        images: uploaded,
        specs,
        isActive: true,
        updatedAt: new Date(),
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] ${p.name} cat=${p.category} imgs=${uploaded.length}`,
        );
      } else {
        const existing = await productsCol.findOne({
          brand: brand._id,
          "specs.schucoHandle": p.slug,
        });
        if (existing) {
          await productsCol.updateOne(
            { _id: existing._id, brand: brand._id },
            { $set: doc },
          );
        } else {
          await productsCol.insertOne({ ...doc, createdAt: new Date() });
        }
        log(
          `${label} ok ${p.name} cat=${p.category} imgs=${uploaded.length}`,
        );
      }

      imported += 1;
      done.add(p.slug);
      if (imported % 3 === 0) saveProgress();
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${slugHint}: ${e.message}`);
    }
  });

  saveProgress();

  if (!DRY_RUN && !SKIP_IMAGES) {
    try {
      const coverProd = await productsCol.findOne(
        { brand: brand._id, "images.0": { $exists: true } },
        { projection: { images: 1 } },
      );
      const src = coverProd?.images?.[0];
      if (src) {
        const buf = await fetchBuffer(src);
        const opt = await sharp(buf)
          .rotate()
          .resize({
            width: 1600,
            height: 1600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer();
        const brandUp = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "linx-living/brands",
              public_id: "schuco-cover",
              overwrite: true,
              invalidate: true,
              format: "jpg",
            },
            (err, result) => (err ? reject(err) : resolve(result)),
          );
          stream.end(opt);
        });
        await db.collection("brands").updateOne(
          { _id: brand._id },
          { $set: { image: brandUp.secure_url, updatedAt: new Date() } },
        );
        log(`Brand cover set ${brandUp.secure_url}`);
      }
    } catch (e) {
      log(`WARN brand cover: ${e.message}`);
    }
  }

  const brandCount = DRY_RUN
    ? imported
    : await productsCol.countDocuments({ brand: brand._id });
  const menuCount = DRY_RUN
    ? CATEGORY_TREE.length
    : await db.collection("menus").countDocuments({ brand: brand._id });

  log(
    `\nDone. imported=${imported} failed=${failed} brandProducts=${brandCount} menus=${menuCount}`,
  );

  try {
    const r = await fetch("http://localhost:3000/api/revalidate-navigation", {
      method: "POST",
    });
    if (r.ok) log("Navigation cache revalidated");
  } catch {
    /* ignore */
  }

  await require("mongoose").disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
