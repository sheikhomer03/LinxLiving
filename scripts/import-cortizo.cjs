/**
 * Import CORTIZO systems catalogue → Living Mongo + Cloudinary
 *
 * Source (EN): https://www.cortizo.com/en/sistemas/familias
 * Brand: "Cortizo" (slug: cortizo) — brand-scoped menus/products.
 * Prices: not published publicly → price 0 (price-on-request).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-cortizo.cjs
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

const BASE = "https://www.cortizo.com";
const LANG = "en";
const FAMILIAS_URL = `${BASE}/${LANG}/sistemas/familias`;
const BRAND_SLUG = "cortizo";
const BRAND_NAME = "Cortizo";
const SOURCE_TAG = "cortizo-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/cortizo";
const CHECKPOINT = path.join(__dirname, "_tmp-cortizo-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-cortizo-progress.json");
const LOG = path.join(__dirname, "_tmp-cortizo-import.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 40));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

/** Site chrome / feature-badge icons — not product gallery photos. */
const SKIP_IMG =
  /logo|favicon|sprite|icon|avatar|placeholder|data:image|svg\+xml|spinner|tracking|pixel|1x1|dwg_|memoria|linea_|bim_p|term_|acus_|aire_|agua_|viento_|seg_icon|herr_icon|drenaje|accesibilidad|_icon|\/recursos\/cortizofrontend/i;

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

function absUrl(href, base = BASE) {
  try {
    return new URL(String(href || "").replace(/:443/, "").replace(/&amp;/g, "&"), base)
      .href;
  } catch {
    return null;
  }
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
      Referer: FAMILIAS_URL,
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
          Referer: `${BASE}/en/sistemas/familias`,
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

function titleFromSlug(slug) {
  return String(slug || "")
    .replace(/\.html$/i, "")
    .replace(/-+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

async function discoverCatalogue() {
  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    if (saved.categories?.length && saved.products?.length) {
      log(
        `Resumed checkpoint: ${saved.categories.length} cats, ${saved.products.length} products`,
      );
      return saved;
    }
  }

  log(`Fetching familias ${FAMILIAS_URL}`);
  const familiasHtml = await fetchHtml(FAMILIAS_URL);

  const categories = [];
  const seenCat = new Set();
  const catRe =
    /href=["']((?:https:\/\/www\.cortizo\.com(?::443)?)?\/en\/sistemas\/desplegar\/(\d+)\/([^"'#?]+))["']/gi;
  let m;
  while ((m = catRe.exec(familiasHtml))) {
    const id = m[2];
    if (seenCat.has(id)) continue;
    seenCat.add(id);
    const slugRaw = m[3].replace(/\.html$/i, "").replace(/-+$/g, "");
    const url = absUrl(m[1]);
    // category image near id in landing folder
    const imgMatch = familiasHtml.match(
      new RegExp(
        `ficheros/familias/imagenlanding/${id}\\.[^"'\\s]+`,
        "i",
      ),
    );
    categories.push({
      id,
      handle: slugify(slugRaw),
      name: titleFromSlug(slugRaw),
      url,
      imageUrl: imgMatch ? absUrl(`/${imgMatch[0]}`) : "",
    });
  }

  // Prefer English names from link text when available
  for (const cat of categories) {
    const re = new RegExp(
      `href=["'][^"']*desplegar/${cat.id}/[^"']+["'][^>]*>\\s*([^<]{2,80})`,
      "i",
    );
    const tm = familiasHtml.match(re);
    if (tm?.[1]) {
      const name = stripTags(tm[1]).replace(/\+$/, "").trim();
      if (name && name.length < 80) {
        cat.name = name;
        cat.handle = slugify(name);
      }
    }
  }

  log(`Found ${categories.length} main categories`);

  const byUrl = new Map();
  for (const cat of categories) {
    try {
      await sleep(200);
      const html = await fetchHtml(cat.url);
      const prodRe =
        /href=["']((?:https:\/\/www\.cortizo\.com(?::443)?)?\/en\/sistemas\/ver\/(\d+)\/([^"'#?]+))["']/gi;
      let pm;
      let n = 0;
      while ((pm = prodRe.exec(html))) {
        const productId = pm[2];
        const slug = pm[3].replace(/\.html$/i, "");
        const url = absUrl(pm[1]);
        if (!url || byUrl.has(url)) continue;
        const thumb =
          absUrl(`/ficheros/sistemas/landing/${cat.id}_${productId}.jpg`) || "";
        byUrl.set(url, {
          url,
          productId,
          slug,
          categoryId: cat.id,
          category: cat.handle,
          categoryName: cat.name,
          thumbUrl: thumb,
        });
        n += 1;
      }
      log(`  ${cat.name}: ${n} products`);
    } catch (e) {
      log(`WARN category ${cat.name}: ${e.message}`);
    }
  }

  const products = [...byUrl.values()];
  const out = {
    at: new Date().toISOString(),
    categories,
    products,
  };
  fs.writeFileSync(CHECKPOINT, JSON.stringify(out, null, 2));
  log(`Discovered ${products.length} Cortizo products`);
  return out;
}

function parseCortizoPdp(html, meta) {
  const title =
    (html.match(/<title>([^<]+)<\/title>/i) || [])[1]?.trim() ||
    stripTags(
      (
        [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((x) =>
          stripTags(x[1]),
        ).find((t) => t && !/^products?$/i.test(t) && !/cookie|possibilit/i.test(t)) || ""
      ),
    );

  const name = (title || meta.slug || "")
    .replace(/\s*[-|].*Cortizo.*$/i, "")
    .trim();

  const baseHref = (
    (html.match(/<base[^>]+href=["']([^"']+)["']/i) || [])[1] || ""
  ).replace(/:443/, "");

  const specs = {};
  // FEATURES rows: label in paragraph-45, value in paragraph-46
  const featureBlocks = [
    ...html.matchAll(
      /<p class="paragraph-45">\s*([^<]+?)\s*<\/p>[\s\S]{0,400}?<p class="paragraph-46">\s*([^<]+?)\s*<\/p>/gi,
    ),
  ];
  for (const fm of featureBlocks) {
    const k = stripTags(fm[1]).replace(/:$/, "").trim();
    const v = stripTags(fm[2]).trim();
    if (
      k &&
      v &&
      k.length < 80 &&
      v.length < 200 &&
      !/^features$/i.test(k)
    ) {
      specs[k] = v;
    }
  }

  // Strong-labeled technical blocks
  const strongBlock = html.match(
    /<p class="paragraph-43">([\s\S]*?)<\/p>/i,
  );
  if (strongBlock) {
    const chunk = strongBlock[1]
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?strong>/gi, "\n**");
    const lines = stripTags(chunk.replace(/\*\*/g, "")).split(/\n+/).map((l) => l.trim()).filter(Boolean);
    // Pair label/value heuristically: bold-ish short lines followed by values
    const plain = stripTags(strongBlock[1].replace(/<br\s*\/?>/gi, "\n"));
    const parts = plain.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      const v = parts[i + 1];
      if (
        k &&
        v &&
        k.length < 60 &&
        v.length < 200 &&
        !/consult maximum/i.test(k) &&
        (/sections|polyamide|profile|glazing|dimensions|weight|opening/i.test(k) ||
          /\d/.test(v))
      ) {
        if (!specs[k]) specs[k] = v;
        i += 1;
      }
    }
    if (lines.length) specs.technicalNotes = lines.join(" · ").slice(0, 1500);
  }

  // Possibilities / feature chips
  const possibilities = [
    ...html.matchAll(/<p class="paragraph-5[18]">([\s\S]*?)<\/p>/gi),
  ]
    .map((x) => stripTags(x[1]).replace(/\s+/g, " ").trim())
    .filter((t) => t && t.length < 80);

  const paras = [];
  for (const p of html.match(/<p class="paragraph-50">([\s\S]*?)<\/p>/gi) || []) {
    const t = stripTags(p).replace(/\s+/g, " ").trim();
    if (t.length > 40) paras.push(t);
  }
  if (!paras.length) {
    for (const p of html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []) {
      const t = stripTags(p).replace(/\s+/g, " ").trim();
      if (
        t.length > 80 &&
        !/cookie|login|register|forty years|looking for/i.test(t)
      ) {
        paras.push(t);
      }
    }
  }
  const description =
    paras.slice(0, 4).join("\n\n").slice(0, 8000) ||
    `${name} aluminium system from Cortizo.`;

  const docs = [
    ...new Set(
      [...html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)]
        .map((x) => absUrl(x[1]))
        .filter(Boolean),
    ),
  ].slice(0, 10);

  // Full product gallery under <base>/images/… (sistemasinline pack)
  const seen = new Set();
  const imageUrls = [];
  const addImg = (raw) => {
    if (!raw) return;
    let u = absUrl(raw, baseHref || meta.url);
    if (!u) return;
    // Collapse responsive variants → full-size file
    u = u.replace(/-p-\d+(?=\.(?:jpe?g|png|webp))/i, "");
    if (SKIP_IMG.test(u)) return;
    if (!/\.(jpe?g|png|webp)(?:\?|$)/i.test(u)) return;
    if (/-\d+w\b/i.test(u)) return;
    // Gallery photos live under ficheros/sistemasinline (or landing thumbs)
    const isInline = /\/ficheros\/sistemasinline\//i.test(u);
    const isLanding = /\/ficheros\/sistemas\/landing\//i.test(u);
    if (!isInline && !isLanding) return;
    const key = u.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    imageUrls.push(u);
  };

  for (const im of html.matchAll(
    /(?:src|data-src)=["'](images\/[^"']+\.(?:jpe?g|png|webp))["']/gi,
  )) {
    addImg(im[1]);
  }
  for (const im of html.matchAll(/srcset=["']([^"']+)["']/gi)) {
    const parts = im[1].split(",").map((s) => s.trim().split(/\s+/)[0]);
    const last = parts[parts.length - 1];
    if (last && /^images\//i.test(last)) addImg(last);
  }
  // Any absolute sistemasinline image references
  for (const im of html.matchAll(
    /(?:src|data-src|href)=["']([^"']*\/ficheros\/sistemasinline\/[^"']+\.(?:jpe?g|png|webp))["']/gi,
  )) {
    addImg(im[1]);
  }

  // Landing thumbnail as cover fallback only if gallery empty
  if (!imageUrls.length && meta.thumbUrl) addImg(meta.thumbUrl);

  return {
    url: meta.url,
    productId: meta.productId,
    slug: meta.slug || slugify(name),
    name: name || titleFromSlug(meta.slug),
    category: meta.category,
    categoryName: meta.categoryName,
    description,
    specs,
    possibilities: [...new Set(possibilities)].slice(0, 20),
    docs,
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
      order: 47,
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
  fs.writeFileSync(LOG, `CORTIZO import ${new Date().toISOString()}\n`);
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
    `CORTIZO import${DRY_RUN ? " (DRY)" : ""} concurrency=${CONCURRENCY} skipImages=${SKIP_IMAGES} resume=${RESUME}`,
  );

  const catalogue = await discoverCatalogue();
  let products = catalogue.products;
  if (LIMIT > 0) products = products.slice(0, LIMIT);

  await connectMongo(process.env.MONGODB_URI);
  const db = require("mongoose").connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  const keepMenuIds = new Set();
  let order = 0;
  for (const cat of catalogue.categories) {
    let menuImage = "";
    if (!SKIP_IMAGES && cat.imageUrl && !DRY_RUN) {
      try {
        const buf = await fetchBuffer(cat.imageUrl);
        if (buf.length >= 8_000) {
          const up = await uploadImage(buf, `menu-${cat.handle}`);
          menuImage = up.secure_url;
        }
      } catch (e) {
        log(`WARN menu img ${cat.handle}: ${e.message}`);
      }
    }
    const parent = await ensureMenu(db, {
      name: cat.name,
      slug: cat.handle,
      parent: null,
      brandId: brand._id,
      order: order++,
      image: menuImage,
    });
    keepMenuIds.add(String(parent._id));
  }

  if (!DRY_RUN) {
    const all = await db.collection("menus").find({ brand: brand._id }).toArray();
    for (const menu of all) {
      if (!keepMenuIds.has(String(menu._id))) {
        await db.collection("menus").deleteOne({ _id: menu._id, brand: brand._id });
        log(`Deleted obsolete menu ${menu.slug}`);
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

  const pending = products.filter((p) => !done.has(p.slug || p.productId));
  log(`Importing ${pending.length} products (done=${done.size})…`);

  let imported = 0;
  let failed = 0;

  await mapPool(pending, CONCURRENCY, async (meta, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    const slugHint = meta.slug || meta.productId;
    try {
      await sleep(250);
      const html = await fetchHtml(meta.url);
      const p = parseCortizoPdp(html, meta);

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
        cortizoHandle: p.slug,
        cortizoProductId: p.productId,
        cortizoCategory: p.categoryName,
        possibilities: p.possibilities,
        documents: p.docs,
        vendorBrand: "Cortizo",
        priceNote: "Price on request — not published on Cortizo systems catalogue",
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
          `${label} [dry] ${p.name} cat=${p.category} imgs=${uploaded.length} specs=${Object.keys(p.specs).length}`,
        );
      } else {
        const existing = await productsCol.findOne({
          brand: brand._id,
          $or: [
            { "specs.cortizoHandle": p.slug },
            { "specs.cortizoProductId": p.productId },
            { slug: p.slug },
          ],
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
              public_id: "cortizo-cover",
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
    ? catalogue.categories.length
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
