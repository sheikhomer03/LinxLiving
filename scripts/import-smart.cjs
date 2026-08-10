/**
 * Import SMART Systems product catalogue → Living Mongo + Cloudinary
 *
 * Source: https://www.smartsystems.co.uk/product-catalogue
 * Brand: "SMART" (slug: smart) — isolated brand-scoped menus/products.
 * Prices: not published publicly → price 0 (price-on-request / TBC).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-smart.cjs
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

const BASE = "https://www.smartsystems.co.uk";
const BRAND_SLUG = "smart";
const BRAND_NAME = "SMART";
const SOURCE_TAG = "smart-systems-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/smart";
const CHECKPOINT = path.join(__dirname, "_tmp-smart-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-smart-progress.json");
const LOG = path.join(__dirname, "_tmp-smart-import.log");
const RANGES_CACHE = path.join(__dirname, "_tmp-smart-ranges.json");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 10));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

/** Catalogue Type taxonomy (from product-catalogue filters) */
const TYPE_TREE = [
  {
    handle: "windows",
    title: "Windows",
    children: [
      ["side-hung", "Side Hung"],
      ["top-hung", "Top Hung"],
      ["fixed", "Fixed"],
      ["tilt-turn", "Tilt Turn"],
      ["reversible", "Reversible"],
      ["parallel", "Parallel"],
      ["vertical-sliding", "Vertical Sliding"],
      ["horizontal-sliding", "Horizontal Sliding"],
      ["pivot", "Pivot"],
    ],
  },
  {
    handle: "doors",
    title: "Doors",
    children: [
      ["single", "Single"],
      ["double", "Double"],
      ["slide-folding", "Slide Folding"],
      ["sliding", "Sliding"],
      ["door-panels", "Door Panels"],
    ],
  },
  {
    handle: "curtain-wall",
    title: "Curtain Wall",
    children: [
      ["ground-floor", "Ground Floor"],
      ["multi-storey", "Multi-storey"],
      ["shopfront", "Shopfront"],
    ],
  },
  {
    handle: "internal-doors-screens",
    title: "Internal Doors & Screens",
    children: [
      ["fixed-internal-screens", "Fixed Internal Screens"],
      ["hinged-internal-doors", "Hinged Internal Doors"],
      ["sliding-internal-doors", "Sliding Internal Doors"],
      ["pivot-internal-doors", "Pivot Internal Doors"],
    ],
  },
  {
    handle: "roofing",
    title: "Roofing",
    children: [],
  },
  {
    handle: "other",
    title: "Other",
    children: [],
  },
];

const APPLICATIONS = [
  "Residential",
  "Heritage and Renovations",
  "Light/medium Commercial",
  "Commercial",
  "Education",
  "Retail",
  "Other",
];

/** Hard overrides when name heuristics are ambiguous */
const RANGE_TYPE = {
  "alitherm-300": "windows",
  "alitherm-400": "windows",
  "alitherm-400-hd": "windows",
  "alitherm-600": "windows",
  "alitherm-700": "windows",
  "alitherm-800": "windows",
  "alitherm-heritage": "windows",
  "alitherm-heritage-hd": "windows",
  "alitherm-heritage-60": "windows",
  ecofutural: "windows",
  visotherm: "windows",
  "vs-600": "windows",
  "mc-600": "windows",
  "mc-600-plus": "windows",
  smartform: "windows",
  "designer-doors": "doors",
  "signature-doors": "doors",
  "designer-panels": "doors",
  "slide-2000": "doors",
  ultraglide: "doors",
  "visofold-1000": "doors",
  "visofold-2000": "doors",
  "visofold-6000": "doors",
  "visoglide-plus": "doors",
  "visoglide-original": "doors",
  "visoglide-hybrid": "doors",
  invisoglide: "doors",
  fr90: "doors",
  "mc-wall": "curtain-wall",
  smartwall: "curtain-wall",
  shopline: "curtain-wall",
  decowall: "curtain-wall",
  "mac-glass": "curtain-wall",
  "aliver-orangery-roof": "roofing",
  "aliver-rooflight": "roofing",
  "smart-lantern": "roofing",
  "aluspace-screen": "internal-doors-screens",
};

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

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      Referer: `${BASE}/product-catalogue`,
    },
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

async function discoverProductUrls() {
  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    if (saved.urls?.length) {
      log(`Resumed ${saved.urls.length} product URLs from checkpoint`);
      return saved.urls;
    }
  }

  let urls = [];
  if (fs.existsSync(RANGES_CACHE)) {
    const raw = JSON.parse(fs.readFileSync(RANGES_CACHE, "utf8"));
    urls = raw.sitemapProducts || [];
  }

  if (!urls.length) {
    const sitemap = await fetchHtml(`${BASE}/sitemap.xml`);
    urls = [
      ...sitemap.matchAll(/<loc>(https:\/\/www\.smartsystems\.co\.uk\/product\/\d+\/[^<]+)<\/loc>/gi),
    ].map((m) => m[1]);
  }

  urls = [...new Set(urls)];
  fs.writeFileSync(
    CHECKPOINT,
    JSON.stringify({ at: new Date().toISOString(), urls }, null, 2),
  );
  log(`Discovered ${urls.length} Smart product URLs`);
  return urls;
}

function inferPrimaryType(slug, name, text) {
  if (RANGE_TYPE[slug]) return RANGE_TYPE[slug];
  const n = `${slug} ${name}`.toLowerCase();
  if (/wall|curtain|shopline|decowall|mac-glass|mac glass|smartwall/.test(n))
    return "curtain-wall";
  if (/roof|lantern|orangery|aliver|rooflight/.test(n)) return "roofing";
  if (/aluspace|internal|screen/.test(n)) return "internal-doors-screens";
  if (
    /door|fold|glide|slide|inviso|designer|signature|fr90|ultraglide|visofold|visoglide/.test(
      n,
    )
  )
    return "doors";
  if (/therm|window|heritage|eco|smartform|vs-600|mc-600/.test(n))
    return "windows";
  // soft text fallback
  if (/\bcurtain wall\b/i.test(text)) return "curtain-wall";
  if (/\broof/i.test(text)) return "roofing";
  if (/\bdoor/i.test(text)) return "doors";
  if (/\bwindow/i.test(text)) return "windows";
  return "other";
}

function inferSubType(primary, text) {
  const tree = TYPE_TREE.find((t) => t.handle === primary);
  if (!tree?.children?.length) return "";
  for (const [handle, title] of tree.children) {
    const re = new RegExp(`\\b${title.replace(/[/*/]/g, ".")}\\b`, "i");
    if (re.test(text)) return handle;
  }
  // name-based door/window hints
  if (primary === "doors") {
    if (/fold/i.test(text)) return "slide-folding";
    if (/slide|glide/i.test(text)) return "sliding";
    if (/panel/i.test(text)) return "door-panels";
  }
  if (primary === "curtain-wall") {
    if (/shop/i.test(text)) return "shopfront";
  }
  return "";
}

function parseSmartPdp(html, url) {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const name = (titleMatch?.[1] || "")
    .replace(/\s*-\s*Smart Systems.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const slug =
    (url.match(/\/product\/\d+\/([^/?#]+)/i) || [])[1] || slugify(name);
  const productId = (url.match(/\/product\/(\d+)\//i) || [])[1] || "";

  const paras = [];
  const pre = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  for (const p of pre) {
    const t = stripTags(p).replace(/\s+/g, " ").trim();
    if (
      t.length > 60 &&
      !/forty years|cookie|login|register|looking for something/i.test(t)
    ) {
      paras.push(t);
    }
  }
  const description =
    paras.slice(0, 5).join("\n\n").slice(0, 8000) ||
    `${name} aluminium glazing system from Smart Systems.`;

  const text = stripTags(html);
  const applications = APPLICATIONS.filter((a) => {
    const re = new RegExp(a.replace(/[/*/]/g, "."), "i");
    return re.test(text);
  });

  // Image file downloads — skip tiny chrome assets
  const SKIP_IDS = new Set(["12", "13", "14", "15", "16", "21135"]);
  const fileIds = [
    ...new Set(
      [...html.matchAll(/\/download\/file\/(\d+)/g)].map((m) => m[1]),
    ),
  ].filter((id) => !SKIP_IDS.has(id) && Number(id) > 100);

  const imageUrls = fileIds
    .slice(0, MAX_IMAGES)
    .map((id) => `${BASE}/download/file/${id}?ispreview=true`);

  // Spec-ish labels from definition lists / bold labels
  const specs = {};
  const labelPairs =
    html.matchAll(
      /<(?:strong|b|dt|th)[^>]*>\s*([^<:]{2,60})\s*:?\s*<\/(?:strong|b|dt|th)>\s*<(?:p|dd|td|span)[^>]*>\s*([^<]{2,200})/gi,
    ) || [];
  for (const m of labelPairs) {
    const k = stripTags(m[1]).replace(/:$/, "").trim();
    const v = stripTags(m[2]).trim();
    if (k && v && k.length < 60 && v.length < 200 && !/cookie|login/i.test(k)) {
      specs[k] = v;
    }
  }

  // Related downloads (brochures)
  const docs = [
    ...new Set(
      [...html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)].map((m) => {
        try {
          return new URL(m[1].replace(/&amp;/g, "&"), BASE).href;
        } catch {
          return null;
        }
      }),
    ),
  ].filter(Boolean).slice(0, 10);

  const primary = inferPrimaryType(slug, name, text);
  const sub = inferSubType(primary, `${name} ${text.slice(0, 2000)}`);

  return {
    url,
    productId,
    slug,
    name: name || slugify(slug).replace(/-/g, " "),
    description,
    applications,
    primary,
    sub,
    imageUrls,
    docs,
    extraSpecs: specs,
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
      order: 45,
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
  fs.writeFileSync(LOG, `SMART import ${new Date().toISOString()}\n`);
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
    `SMART import${DRY_RUN ? " (DRY)" : ""} concurrency=${CONCURRENCY} skipImages=${SKIP_IMAGES}`,
  );

  let urls = await discoverProductUrls();
  if (LIMIT > 0) urls = urls.slice(0, LIMIT);

  await connectMongo(process.env.MONGODB_URI);
  const db = require("mongoose").connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  const keepMenuIds = new Set();
  let order = 0;
  for (const cat of TYPE_TREE) {
    const parent = await ensureMenu(db, {
      name: cat.title,
      slug: cat.handle,
      parent: null,
      brandId: brand._id,
      order: order++,
    });
    keepMenuIds.add(String(parent._id));
    let childOrder = 0;
    for (const [leaf, leafTitle] of cat.children) {
      const child = await ensureMenu(db, {
        name: leafTitle,
        slug: leaf,
        parent: parent._id,
        brandId: brand._id,
        order: childOrder++,
      });
      keepMenuIds.add(String(child._id));
    }
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

  const pending = urls.filter((u) => {
    const slug = (u.match(/\/product\/\d+\/([^/?#]+)/i) || [])[1] || u;
    return !done.has(slug);
  });
  log(`Importing ${pending.length} products…`);

  let imported = 0;
  let failed = 0;

  await mapPool(pending, CONCURRENCY, async (url, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    const slugHint = (url.match(/\/product\/\d+\/([^/?#]+)/i) || [])[1] || url;
    try {
      await sleep(200);
      const html = await fetchHtml(url);
      const p = parseSmartPdp(html, url);

      const uploaded = [];
      if (!SKIP_IMAGES) {
        for (let i = 0; i < p.imageUrls.length; i++) {
          try {
            if (DRY_RUN) {
              uploaded.push(p.imageUrls[i]);
            } else {
              const buf = await fetchBuffer(p.imageUrls[i]);
              // skip tiny icons
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
        ...p.extraSpecs,
        source: SOURCE_TAG,
        sourceUrl: p.url,
        smartHandle: p.slug,
        smartProductId: p.productId,
        smartRange: p.name,
        applications: p.applications,
        productType: p.primary,
        documents: p.docs,
        vendorBrand: "Smart Systems",
        priceNote: "Price on request — not published on Smart Systems catalogue",
      };

      const doc = {
        name: p.name,
        slug: p.slug,
        description: p.description,
        price: 0,
        stock: STOCK_DEFAULT,
        category: p.primary,
        subCategory: p.sub || "",
        brand: brand._id,
        images: uploaded,
        specs,
        isActive: true,
        updatedAt: new Date(),
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] ${p.name} cat=${p.primary}/${p.sub || "-"} imgs=${uploaded.length}`,
        );
      } else {
        const existing = await productsCol.findOne({
          brand: brand._id,
          "specs.smartHandle": p.slug,
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
          `${label} ok ${p.name} cat=${p.primary}/${p.sub || "-"} imgs=${uploaded.length}`,
        );
      }

      imported += 1;
      done.add(p.slug);
      if (imported % 5 === 0) saveProgress();
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${slugHint}: ${e.message}`);
    }
  });

  saveProgress();

  // Brand cover from first product with images
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
              public_id: "smart-cover",
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
    ? TYPE_TREE.length
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
