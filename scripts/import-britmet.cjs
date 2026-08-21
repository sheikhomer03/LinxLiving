/**
 * Import Britmet catalogue from:
 *   - prices/categories: "2026 5R Rates.pdf"
 *   - images/descriptions/specs: https://www.britmet.co.uk/
 *
 * Brand: "Britmet" (slug: britmet) — brand-scoped menus/products only.
 * Source: britmet-pdf / specs.sourceUrl from site. Never touches other brands.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-britmet.cjs
 *   DRY_RUN=1 LIMIT=10 SKIP_IMAGES=1 RESUME=1 CONCURRENCY=2
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

const { PDFParse } = require("pdf-parse");
const sharp = require("sharp");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BASE = "https://www.britmet.co.uk";
const BRAND_SLUG = "britmet";
const BRAND_NAME = "Britmet";
const SOURCE_TAG = "britmet-pdf";
const CLOUDINARY_FOLDER = "linx-living/products/britmet";
const PDF_PATH = path.join(__dirname, "..", "2026 5R Rates.pdf");
const PROGRESS = path.join(__dirname, "_tmp-britmet-progress.json");
const LOG = path.join(__dirname, "_tmp-britmet-import.log");
const PAGE_CACHE = path.join(__dirname, "_tmp-britmet-page-cache.json");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 8));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 50);

/** PDF section headers → storefront category slugs */
const CATEGORY_ORDER = [
  ["Panels", "panels"],
  ["Panel Flashings", "panel-flashings"],
  ["Panel Fixings", "panel-fixings"],
  ["Panel Accessories", "panel-accessories"],
  ["Pantile 2000", "pantile-2000"],
  ["Ecopan Plus", "ecopan-plus"],
  ["Membrane", "membrane"],
  ["Misc Accessories", "misc-accessories"],
  ["Roof Lights", "roof-lights"],
  ["Machinery", "machinery"],
  ["Liteslate", "liteslate"],
  ["Parcpan", "parcpan"],
  ["Ecopan", "ecopan"],
  ["Carriage", "carriage"],
  ["Paint", "paint"],
];

/** Match PDF product name → Britmet product page for enrichment */
const FAMILY_PAGES = [
  { re: /\bultratile\b/i, page: "ultratile.asp", cover: "images/products/ultratile.jpg" },
  { re: /\bshingle\b/i, page: "shingle.asp", cover: "images/products/shingle.jpg" },
  { re: /\bslate\s*2000\b/i, page: "slate2000.asp", cover: "images/products/slate2000.jpg" },
  { re: /\bprofile\s*49\b/i, page: "profile49.asp", cover: "images/products/profile49.jpg" },
  { re: /\bvillatile\b/i, page: "villatile.asp", cover: "images/products/villatile.jpg" },
  { re: /\bplaintile\b/i, page: "plaintile.asp", cover: "images/products/plaintile.jpg" },
  { re: /\bpantile\s*2000\b|\bpantile2000\b/i, page: "pantile2000.asp", cover: "images/products/pantile2000.jpg" },
  { re: /\bliteslate\b/i, page: "liteslate.asp", cover: "images/products/liteslate.jpg" },
  { re: /\becopan\b/i, page: "ecopan.asp", cover: "images/products/ecopan.jpg" },
  { re: /\bparcpan\b/i, page: "parcpan.asp", cover: "images/products/parcpan.jpg" },
  { re: /\b(stipple|masonry|primer|roof\s*coat|scrim|roller)\b/i, page: "paint.asp", cover: "images/products/paints2.jpg" },
  { re: /\bfakro\b/i, page: "lightweight-roofing.asp", cover: "images/products/lightweight.jpg" },
  { re: /\b(guillotine|bender)\b/i, page: "lightweight-roofing.asp", cover: "images/products/lightweight.jpg" },
];

const SKIP_IMG =
  /favicon|email\.png|search|x\.png|youtube|pinterest|instagram|facebook|twitter|linkedin|sprite|icon|logo|_t\.jpg|_t\.png|swatches\//i;

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
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractImages(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const re =
    /(?:src|data-src|href)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let u = m[1].trim();
    try {
      u = new URL(u, pageUrl).href;
    } catch {
      continue;
    }
    if (SKIP_IMG.test(u)) continue;
    // Prefer full gallery over thumbnails
    const full = u.replace(/_t\.(jpg|jpeg|png|webp)$/i, ".$1");
    const key = full.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(full);
  }
  // Prefer productphoto / gallery / products paths first
  out.sort((a, b) => {
    const score = (u) =>
      (/\/gallery\//i.test(u) ? 3 : 0) +
      (/productphoto/i.test(u) ? 4 : 0) +
      (/\/products\//i.test(u) ? 2 : 0) -
      (/swatch/i.test(u) ? 2 : 0);
    return score(b) - score(a);
  });
  return out;
}

function extractSpecsFromTables(html) {
  const specs = {};
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const table of tables) {
    // Prefer key:value style rows
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
        (c) => stripTags(c[1]),
      );
      if (cells.length >= 2) {
        const k = cells[0].replace(/:$/, "").trim();
        const v = cells.slice(1).join(" · ").trim();
        if (k && v && k.length < 80 && v.length < 300) {
          const key = slugify(k).replace(/-/g, "_") || "spec";
          if (!specs[key]) specs[key] = v;
        }
      }
    }
    // Also parse "Label: value" text blocks from single-cell tables
    const flat = stripTags(table);
    const kv = flat.matchAll(/([A-Za-z][A-Za-z0-9 /().-]{2,40}):\s*([^:\n]+?)(?=(?:[A-Za-z][A-Za-z0-9 /().-]{2,40}:)|$)/g);
    for (const m of kv) {
      const k = m[1].trim();
      const v = m[2].trim();
      if (k && v && v.length < 200) {
        const key = slugify(k).replace(/-/g, "_");
        if (!specs[key]) specs[key] = v;
      }
    }
  }
  return specs;
}

function extractDescription(html, h1) {
  const meta =
    ((/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i.exec(
      html,
    ) || [])[1] || "").trim();

  // Prefer overview / features section
  const overview =
    html.match(
      /<(?:h2|h3)[^>]*>[\s\S]{0,40}Overview[\s\S]*?<\/(?:h2|h3)>([\s\S]*?)(?=<(?:h2|h3|section)\b)/i,
    ) ||
    html.match(
      /<(?:h2|h3)[^>]*>[\s\S]{0,40}Features[\s\S]*?<\/(?:h2|h3)>([\s\S]*?)(?=<(?:h2|h3|section)\b)/i,
    );

  let body = "";
  if (overview) {
    body = stripTags(overview[1]).slice(0, 2500);
  }
  if (!body) {
    // First substantial paragraphs in main content
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => stripTags(m[1]))
      .filter((t) => t.length > 60 && !/cookie|subscribe|01295/i.test(t));
    body = paras.slice(0, 4).join("\n\n").slice(0, 2500);
  }

  if (meta && body && !body.includes(meta.slice(0, 40))) {
    return `${meta}\n\n${body}`.trim();
  }
  return body || meta || `${h1} from Britmet Lightweight Roofing.`;
}

async function loadPageEnrichment(pagePath, cache) {
  if (cache[pagePath]) return cache[pagePath];
  const url = `${BASE}/${pagePath}`;
  log(`Fetch page ${pagePath}`);
  const html = await fetchHtml(url);
  const title = ((/<title>([^<]+)/i.exec(html) || [])[1] || "").trim();
  const h1 = stripTags(
    ((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1] || title).trim(),
  );
  const enrichment = {
    url,
    title,
    h1,
    description: extractDescription(html, h1),
    specs: extractSpecsFromTables(html),
    images: extractImages(html, url).slice(0, 20),
  };
  cache[pagePath] = enrichment;
  fs.writeFileSync(PAGE_CACHE, JSON.stringify(cache, null, 2));
  await sleep(200);
  return enrichment;
}

function matchFamily(name) {
  for (const f of FAMILY_PAGES) {
    if (f.re.test(name)) return f;
  }
  return null;
}

function parsePdfProducts(text) {
  const lines = String(text)
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const catByName = new Map(CATEGORY_ORDER.map(([n, s]) => [n.toLowerCase(), s]));
  const products = [];
  let currentCat = "panels";
  let currentCatName = "Panels";

  for (const line of lines) {
    if (/^PRICE LIST/i.test(line)) continue;
    if (/^Order QTY/i.test(line)) continue;
    if (/^--\s*\d+\s*of\s*\d+/i.test(line)) continue;
    if (/^Order subject/i.test(line)) continue;
    if (/^King Fisher/i.test(line)) continue;
    if (/^T:\s*01295/i.test(line)) continue;
    if (/^BLR/i.test(line)) continue;

    const catHit = catByName.get(line.toLowerCase());
    if (catHit) {
      currentCat = catHit;
      currentCatName = line;
      continue;
    }

    // "1 Product Name 12.34" or "1 Product Name 1,234.56"
    const m = line.match(/^(\d+)\s+(.+?)\s+(\d+(?:\.\d{1,2})?)$/);
    if (!m) continue;
    const qty = Number(m[1]);
    const name = m[2].trim();
    const price = Number(m[3]);
    if (!name || !Number.isFinite(price)) continue;

    products.push({
      name,
      price,
      orderQty: qty,
      category: currentCat,
      categoryName: currentCatName,
      // Include category + price so duplicate names (e.g. Special flashing,
      // Parcpan flashing ranges) stay distinct.
      handle: slugify(`${currentCat}-${name}-${price}`),
    });
  }

  // Dedupe exact same name+price+category (PDF may repeat barrel ridge)
  const seen = new Set();
  const deduped = [];
  for (const p of products) {
    const key = `${p.category}::${p.name.toLowerCase()}::${p.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }
  return deduped;
}

async function uploadImage(buf, publicId) {
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

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: publicId,
        overwrite: true,
        invalidate: true,
        resource_type: "image",
        format: "jpg",
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(opt);
  });
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
  });
  if (!res.ok) throw new Error(`img ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: BRAND_SLUG });
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

async function ensureMenu(db, { name, slug, brandId, order, image }) {
  const menus = db.collection("menus");
  const query = { slug, parent: null, brand: brandId };
  let menu = DRY_RUN ? null : await menus.findOne(query);
  const now = new Date();
  if (!menu) {
    const insert = {
      name,
      slug,
      parent: null,
      brand: brandId,
      order: order ?? 0,
      isActive: true,
      image: image || "",
      level: "category",
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
  if (!fs.existsSync(PDF_PATH)) {
    throw new Error(`Missing PDF: ${PDF_PATH}`);
  }

  log(`Britmet import DRY_RUN=${DRY_RUN} SKIP_IMAGES=${SKIP_IMAGES}`);

  const parser = new PDFParse({ data: fs.readFileSync(PDF_PATH) });
  const pdf = await parser.getText();
  const products = parsePdfProducts(pdf.text || "");
  log(`Parsed ${products.length} products from PDF`);
  if (!products.length) throw new Error("No products parsed from PDF");

  // Category covers from site
  const catCovers = {
    panels: `${BASE}/images/products/ultratile.jpg`,
    "panel-flashings": `${BASE}/images/products/slate2000.jpg`,
    "panel-fixings": `${BASE}/images/products/lightweight.jpg`,
    "panel-accessories": `${BASE}/images/products/lightweight.jpg`,
    "pantile-2000": `${BASE}/images/products/pantile2000.jpg`,
    "ecopan-plus": `${BASE}/images/products/ecopan.jpg`,
    membrane: `${BASE}/images/products/lightweight.jpg`,
    "misc-accessories": `${BASE}/images/products/lightweight.jpg`,
    "roof-lights": `${BASE}/images/products/lightweight.jpg`,
    machinery: `${BASE}/images/products/lightweight.jpg`,
    liteslate: `${BASE}/images/products/liteslate.jpg`,
    parcpan: `${BASE}/images/products/parcpan.jpg`,
    ecopan: `${BASE}/images/products/ecopan.jpg`,
    carriage: `${BASE}/images/products/lightweight.jpg`,
    paint: `${BASE}/images/products/paints2.jpg`,
  };

  let pageCache = {};
  if (fs.existsSync(PAGE_CACHE)) {
    try {
      pageCache = JSON.parse(fs.readFileSync(PAGE_CACHE, "utf8"));
    } catch {
      pageCache = {};
    }
  }

  // Prefetch unique family pages
  const familiesNeeded = new Set();
  for (const p of products) {
    const f = matchFamily(p.name);
    if (f) familiesNeeded.add(f.page);
  }
  for (const page of familiesNeeded) {
    try {
      await loadPageEnrichment(page, pageCache);
    } catch (e) {
      log(`WARN page ${page}: ${e.message}`);
    }
  }

  await connectMongo();
  const db = require("mongoose").connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  // Menus for categories present in PDF
  const catsPresent = [...new Set(products.map((p) => p.category))];
  const menuBySlug = {};
  let order = 0;
  for (const [name, slug] of CATEGORY_ORDER) {
    if (!catsPresent.includes(slug)) continue;
    let coverUrl = "";
    if (!SKIP_IMAGES && catCovers[slug]) {
      try {
        const buf = await fetchBuffer(catCovers[slug]);
        if (!DRY_RUN) {
          const up = await uploadImage(buf, `menu-${slug}`);
          coverUrl = up.secure_url;
        }
      } catch (e) {
        log(`WARN menu cover ${slug}: ${e.message}`);
      }
    }
    const menu = await ensureMenu(db, {
      name,
      slug,
      brandId: brand._id,
      order: order++,
      image: coverUrl,
    });
    menuBySlug[slug] = menu;
  }

  let done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []);
    } catch {
      done = new Set();
    }
  }

  let list = products.filter((p) => !done.has(p.handle));
  if (LIMIT > 0) list = list.slice(0, LIMIT);
  log(`Importing ${list.length} products…`);

  let imported = 0;
  let failed = 0;

  await mapPool(list, CONCURRENCY, async (item, idx) => {
    const label = `[${idx + 1}/${list.length}]`;
    try {
      const family = matchFamily(item.name);
      const enrichment = family
        ? pageCache[family.page] || null
        : null;

      const description =
        enrichment?.description ||
        `${item.name} — Britmet Lightweight Roofing (${item.categoryName}). Price from 2026 5R rates list.`;

      const specs = {
        ...(enrichment?.specs || {}),
        source: SOURCE_TAG,
        sourceUrl: enrichment?.url || `${BASE}/products.asp`,
        britmetHandle: item.handle,
        britmetCategory: item.categoryName,
        orderQty: item.orderQty,
        priceList: "2026 5R Rates",
        family: enrichment?.h1 || family?.page?.replace(/\.asp$/i, "") || "",
      };

      // Images: family gallery + cover fallback
      const sources = [];
      if (enrichment?.images?.length) sources.push(...enrichment.images);
      if (family?.cover) sources.push(`${BASE}/${family.cover}`);
      if (catCovers[item.category]) sources.push(catCovers[item.category]);

      const uploaded = [];
      if (!SKIP_IMAGES) {
        const uniq = [...new Set(sources)].slice(0, MAX_IMAGES);
        for (let i = 0; i < uniq.length; i++) {
          try {
            const buf = await fetchBuffer(uniq[i]);
            if (DRY_RUN) {
              uploaded.push(uniq[i]);
            } else {
              const up = await uploadImage(
                buf,
                `${item.handle}-${i + 1}`.slice(0, 100),
              );
              uploaded.push(up.secure_url);
            }
          } catch (e) {
            log(`${label} img fail ${uniq[i]}: ${e.message}`);
          }
        }
      }

      const doc = {
        name: item.name,
        slug: item.handle,
        description,
        price: item.price,
        stock: STOCK_DEFAULT,
        category: item.category,
        subCategory: "",
        brand: brand._id,
        images: uploaded,
        specs,
        isActive: true,
        updatedAt: new Date(),
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] ${item.name.slice(0, 45)} £${item.price} cat=${item.category} imgs=${uploaded.length}`,
        );
      } else {
        const existing = await productsCol.findOne({
          brand: brand._id,
          "specs.britmetHandle": item.handle,
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
          `${label} ok ${item.name.slice(0, 45)} £${item.price} cat=${item.category} imgs=${uploaded.length}`,
        );
      }

      imported += 1;
      done.add(item.handle);
      if (imported % 15 === 0) {
        fs.writeFileSync(
          PROGRESS,
          JSON.stringify({ done: [...done] }, null, 2),
        );
      }
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${item.name}: ${e.message}`);
    }
  });

  fs.writeFileSync(PROGRESS, JSON.stringify({ done: [...done] }, null, 2));

  // Brand cover
  if (!DRY_RUN && !SKIP_IMAGES) {
    try {
      const coverSrc = `${BASE}/images/products/ultratile.jpg`;
      const buf = await fetchBuffer(coverSrc);
      const up = await uploadImage(buf, "britmet-cover");
      // also store under brands folder
      const brandUp = await new Promise((resolve, reject) => {
        sharp(buf)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer()
          .then((opt) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                folder: "linx-living/brands",
                public_id: "britmet-cover",
                overwrite: true,
                invalidate: true,
                format: "jpg",
              },
              (err, result) => (err ? reject(err) : resolve(result)),
            );
            stream.end(opt);
          })
          .catch(reject);
      });
      await db.collection("brands").updateOne(
        { _id: brand._id },
        {
          $set: {
            image: brandUp.secure_url || up.secure_url,
            updatedAt: new Date(),
          },
        },
      );
      log(`Brand cover set ${brandUp.secure_url || up.secure_url}`);
    } catch (e) {
      log(`WARN brand cover: ${e.message}`);
    }
  }

  const brandCount = DRY_RUN
    ? imported
    : await productsCol.countDocuments({ brand: brand._id });
  const menuCount = DRY_RUN
    ? Object.keys(menuBySlug).length
    : await db.collection("menus").countDocuments({ brand: brand._id });

  log(
    `\nDone. imported=${imported} failed=${failed} brandProducts=${brandCount} menus=${menuCount}`,
  );

  // Revalidate nav if local
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
