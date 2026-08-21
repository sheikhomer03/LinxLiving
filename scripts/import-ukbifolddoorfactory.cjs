/**
 * Import UK Bifold Door Factory catalogue → Living Mongo + Cloudinary
 *
 * Source: https://www.ukbifolddoorfactory.co.uk/
 * Brand: "UK Bifold Door Factory" (slug: ukbifolddoorfactory)
 * Prices: not published → From £500 enquiry (Add to Cart → Contact)
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-ukbifolddoorfactory.cjs
 *   DRY_RUN=1 SKIP_IMAGES=1 RESUME=1
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

const BASE = "https://www.ukbifolddoorfactory.co.uk";
const BRAND_SLUG = "ukbifolddoorfactory";
const BRAND_NAME = "UK Bifold Door Factory";
const SOURCE_TAG = "ukbifolddoorfactory-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/ukbifolddoorfactory";
const CHECKPOINT = path.join(__dirname, "_tmp-ukbifold-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-ukbifold-progress.json");
const LOG = path.join(__dirname, "_tmp-ukbifold-import.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 24));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);
const FROM_PRICE = 500;

/** Main categories + product pages (WP pages, not WooCommerce). */
const CATALOGUE = [
  {
    handle: "doors",
    title: "Doors",
    products: [
      {
        slug: "ultra-slim-cor-vision-sliding-door",
        name: "Ultra Slim Cor Vision Sliding Door",
        path: "/ultra-slim-cor-vision-sliding-door/",
      },
      {
        slug: "cor-vision-plus-panoramic-sliding-door",
        name: "Cor Vision Plus Panoramic Sliding Door",
        path: "/cor-vision-plus-panoramic-sliding-door/",
      },
      {
        slug: "front-doors",
        name: "Front Doors",
        path: "/front-doors/",
      },
      {
        slug: "bi-folding-doors",
        name: "Bi-Folding Doors",
        path: "/bi-folding-doors/",
      },
    ],
  },
  {
    handle: "windows",
    title: "Windows",
    products: [
      {
        slug: "hidden-sash-tilt-turn",
        name: "Hidden Sash Tilt & Turn",
        path: "/hidden-sash-tilt-turn/",
      },
      {
        slug: "premium-flush-slim-line-windows",
        name: "Premium Flush Slim Line Windows",
        path: "/premium-flush-slim-line-windows/",
      },
      {
        slug: "premium-slim-line-windows",
        name: "Premium Slim Line Windows",
        path: "/premium-slim-line-windows/",
      },
    ],
  },
  {
    handle: "other-products",
    title: "Other Products",
    products: [
      {
        slug: "roofs-lights",
        name: "Roof Lights",
        path: "/roofs-lights/",
      },
    ],
  },
];

const SKIP_IMG =
  /logo|favicon|sprite|icon|avatar|placeholder|data:image|svg\+xml|spinner|tracking|pixel|1x1|cropped-uk-bi-fold|privacy|cookie|wp-includes|uncode-icons|artboard-1\.png|12-low-u-value|19-high-performance|09-slim|13-hidden-handle/i;

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
    .replace(/&#038;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fullSizeWpUrl(url) {
  let u = String(url || "").split("?")[0];
  // Prefer original from Uncode uai crops when possible
  u = u.replace(/-uai-\d+x\d+(?=\.(?:jpe?g|png|webp))/i, "");
  u = u.replace(/-\d+x\d+(?=\.(?:jpe?g|png|webp))/i, "");
  return u;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      Referer: `${BASE}/`,
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchBuffer(url, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          Accept: "image/*,*/*",
          Referer: `${BASE}/`,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("text/html")) throw new Error("not an image (html)");
      return buf;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(400 * attempt);
    }
  }
  throw lastErr;
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

function discoverProducts() {
  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    if (saved.products?.length) {
      log(`Resumed ${saved.products.length} products from checkpoint`);
      return saved;
    }
  }

  const products = [];
  for (const cat of CATALOGUE) {
    for (const p of cat.products) {
      products.push({
        url: `${BASE}${p.path}`,
        slug: p.slug,
        name: p.name,
        category: cat.handle,
        categoryName: cat.title,
      });
    }
  }
  const out = {
    at: new Date().toISOString(),
    categories: CATALOGUE.map((c) => ({
      handle: c.handle,
      title: c.title,
    })),
    products,
  };
  fs.writeFileSync(CHECKPOINT, JSON.stringify(out, null, 2));
  log(`Discovered ${products.length} UK Bifold products across ${CATALOGUE.length} categories`);
  return out;
}

function parsePdp(html, meta) {
  const ogTitle = (
    html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || []
  )[1];
  const titleTag = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || "";
  let name =
    stripTags(ogTitle || "") ||
    stripTags(titleTag).replace(/\s*[-|].*UK Bi-?Fold.*$/i, "").trim() ||
    meta.name;

  const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((m) => stripTags(m[1]))
    .find(
      (t) =>
        t &&
        t.length < 100 &&
        !/key features|technical|configuration|strong|quality|colour|questions|cortizo\s*u/i.test(
          t,
        ),
    );
  if (h2 && /door|window|roof|sash|vision|bifold|bi-fold/i.test(h2)) {
    name = h2;
  }

  const paras = [];
  for (const p of html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []) {
    const t = stripTags(p).replace(/\s+/g, " ").trim();
    if (
      t.length > 60 &&
      !/cookie|privacy|copyright|facebook|login|have you some questions|well established company since/i.test(
        t,
      )
    ) {
      paras.push(t);
    }
  }
  const description =
    paras.slice(0, 6).join("\n\n").slice(0, 8000) ||
    `${name} from UK Bifold Door Factory.`;

  // Feature headings under Key Features area
  const features = [];
  const featureHeads = [
    "Low U-Value",
    "High Performance Runners",
    "Minimal Sightline",
    "Intergrated Handle",
    "Integrated Handle",
    "20mm sightline",
  ];
  for (const m of html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)) {
    const h = stripTags(m[1]).trim();
    if (
      h &&
      h.length < 60 &&
      (featureHeads.some((f) => h.toLowerCase().includes(f.toLowerCase())) ||
        /u-value|sightline|runner|handle|secure|slim|pas\s*24|guarantee/i.test(h))
    ) {
      features.push(h);
    }
  }

  const specs = {};
  // Pull short feature blurb pairs if present
  for (const m of html.matchAll(
    /<h3[^>]*>\s*([^<]{2,60})\s*<\/h3>[\s\S]{0,400}?<p[^>]*>\s*([\s\S]*?)<\/p>/gi,
  )) {
    const k = stripTags(m[1]).trim();
    const v = stripTags(m[2]).trim();
    if (
      k &&
      v &&
      k.length < 60 &&
      v.length > 20 &&
      v.length < 300 &&
      !/door|window|roof lights|front doors|bi-folding|cor vision|premium|hidden sash|have you/i.test(
        k,
      )
    ) {
      specs[k] = v;
    }
  }

  const sectionHeads = [
    ...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi),
  ]
    .map((m) => stripTags(m[1]))
    .filter(
      (t) =>
        t &&
        /key features|technical|configuration|strong|quality|colour|color/i.test(t),
    );
  if (sectionHeads.length) specs.sections = sectionHeads.join(" · ");

  // Images — prefer data-guid (full original), then src
  const seen = new Set();
  const imageUrls = [];
  const addImg = (raw) => {
    if (!raw) return;
    let u = fullSizeWpUrl(raw);
    if (!/^https?:\/\//i.test(u)) {
      try {
        u = new URL(u, BASE).href;
      } catch {
        return;
      }
    }
    if (!/wp-content\/uploads/i.test(u)) return;
    if (!/\.(jpe?g|png|webp)$/i.test(u)) return;
    if (SKIP_IMG.test(u)) return;
    const key = u.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    imageUrls.push(u);
  };

  for (const m of html.matchAll(/data-guid=["'](https?:\/\/[^"']+)["']/gi)) {
    addImg(m[1]);
  }
  for (const m of html.matchAll(
    /(?:src|data-src|data-lazy-src)=["'](https?:\/\/[^"']*wp-content\/uploads\/[^"']+)["']/gi,
  )) {
    addImg(m[1]);
  }
  const og = html.match(
    /property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
  );
  if (og) addImg(og[1]);

  return {
    url: meta.url,
    slug: meta.slug || slugify(name),
    name: name || meta.name,
    category: meta.category,
    categoryName: meta.categoryName,
    description,
    specs,
    features: [...new Set(features)].slice(0, 20),
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
      order: 48,
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
  fs.writeFileSync(LOG, `UK Bifold import ${new Date().toISOString()}\n`);
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
    `UK Bifold import${DRY_RUN ? " (DRY)" : ""} concurrency=${CONCURRENCY} skipImages=${SKIP_IMAGES}`,
  );

  const catalogue = discoverProducts();
  let products = catalogue.products;
  if (LIMIT > 0) products = products.slice(0, LIMIT);

  await connectMongo(process.env.MONGODB_URI);
  const db = require("mongoose").connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  const keepMenuIds = new Set();
  let order = 0;
  for (const cat of CATALOGUE) {
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

  const pending = products.filter((p) => !done.has(p.slug));
  log(`Importing ${pending.length} products…`);

  let imported = 0;
  let failed = 0;

  await mapPool(pending, CONCURRENCY, async (meta, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    try {
      await sleep(250);
      const html = await fetchHtml(meta.url);
      const p = parsePdp(html, meta);

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
        ukbifoldHandle: p.slug,
        ukbifoldCategory: p.categoryName,
        features: p.features,
        vendorBrand: BRAND_NAME,
        priceDisplay: "from",
        enquiryOnly: true,
        priceNote:
          "From £500 — guide price; contact us to order (not sold via cart)",
      };

      const doc = {
        name: p.name,
        slug: p.slug,
        description: p.description,
        price: FROM_PRICE,
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
          $or: [{ "specs.ukbifoldHandle": p.slug }, { slug: p.slug }],
        });
        if (existing) {
          await productsCol.updateOne(
            { _id: existing._id, brand: brand._id },
            { $set: doc },
          );
        } else {
          await productsCol.insertOne({ ...doc, createdAt: new Date() });
        }
        log(`${label} ok ${p.name} cat=${p.category} imgs=${uploaded.length}`);
      }

      imported += 1;
      done.add(p.slug);
      saveProgress();
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${meta.slug}: ${e.message}`);
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
              public_id: "ukbifolddoorfactory-cover",
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
  log(
    `\nDone. imported=${imported} failed=${failed} brandProducts=${brandCount} menus=${CATALOGUE.length}`,
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
