/**
 * Import PORCELANOSA Grupo Product Finder → Living Mongo + Cloudinary
 *
 * Source: https://productfinder.porcelanosagrupo.com/en/product_finder.html
 * Brand slug: porcelanosagrupo (isolated — never upserts other brands)
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/import-porcelanosagrupo.cjs
 *
 * Options:
 *   DRY_RUN=1
 *   LIMIT=50
 *   CONCURRENCY=2
 *   SKIP_IMAGES=1
 *   RESUME=1
 *   MAX_IMAGES=4
 *   PAGE_SIZE=32
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

const BASE = "https://productfinder.porcelanosagrupo.com";
const BRAND_SLUG = "porcelanosagrupo";
const BRAND_NAME = "PORCELANOSA Grupo";
const SOURCE_TAG = "porcelanosa-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/porcelanosagrupo";
const CHECKPOINT = path.join(__dirname, "_tmp-porcelanosa-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-porcelanosa-progress.json");
const CAT_MAP_FILE = path.join(__dirname, "_tmp-porc-category-map.json");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const RESUME = process.env.RESUME !== "0";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 4));
const PAGE_SIZE = Math.max(1, Number(process.env.PAGE_SIZE || 32));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 0);

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseSetCookie(res) {
  const raw =
    typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const jar = {};
  for (const c of raw) {
    const part = String(c).split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) jar[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function http(url, { method = "GET", body, jar } = {}) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept:
      method === "GET"
        ? "text/html,application/xhtml+xml,*/*;q=0.8"
        : "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-GB,en;q=0.9",
    Referer: `${BASE}/en/product_finder.html`,
    Origin: BASE,
  };
  if (jar && Object.keys(jar).length) headers.Cookie = cookieHeader(jar);
  if (body != null) {
    headers["Content-Type"] = "application/json";
    headers["X-Requested-With"] = "XMLHttpRequest";
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (jar) Object.assign(jar, parseSetCookie(res));
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 160)}`);
  return text;
}

async function postJson(url, body, jar, { allowEmpty = false } = {}) {
  const text = await http(url, { method: "POST", body, jar });
  if (!String(text || "").trim()) {
    if (allowEmpty) return {};
    throw new Error(`Empty response from ${url}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON from ${url}: ${text.slice(0, 200)}`);
  }
}

async function ensureSession(jar) {
  await http(`${BASE}/en/product_finder.html`, { jar });
  await postJson(
    `${BASE}/queries/pgparamsesion.php`,
    {
      pgidioma: "3",
      pgunidades: "'INT'",
      pgtipoproducto: "",
      pgmercados: "'INT'",
      pgempresas: "'B','C','G','L','N','P','S'",
      pgcatalogos: "'B','C','G','L','N','P','S'",
      pgcoleccion: "0",
      pgbusquedarapida: "",
      pgbimactivado: "",
      pgfiltrosbusavactivados: "",
      pgfiltrosconfigactivados: "",
      pgfiltrosactivados: "",
      pgpaginabusca: "1",
      pgposicionbusca: "1",
      pgcoleccionbusca: "0",
      pgtipoproductobusca: "",
      pgtotalresultados: "-1",
      pgproductoagrupacion: "",
      pgpaganterior: "",
      pgordenbusqueda: "",
      pgcodigoferia: "",
      pgnombreferiaurl: "",
    },
    jar,
    { allowEmpty: true },
  );
}

function absImage(rel) {
  const r = String(rel || "").replace(/^\/+/, "");
  if (!r) return "";
  if (/^https?:\/\//i.test(r)) return r;
  if (r.startsWith("resources/")) return `${BASE}/${r}`;
  return `${BASE}/resources/${r}`;
}

async function downloadImageBuffer(imageUrl, jar) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    Referer: `${BASE}/en/product_finder.html`,
  };
  if (jar && Object.keys(jar).length) headers.Cookie = cookieHeader(jar);
  const res = await fetch(imageUrl, { headers });
  if (!res.ok) throw new Error(`download ${res.status}: ${imageUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error(`empty image: ${imageUrl}`);
  return buffer;
}

function uploadBuffer(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
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

async function uploadRemoteImage(imageUrl, publicId, jar) {
  const clean = String(imageUrl).split("?")[0];
  if (!clean) return "";
  if (SKIP_IMAGES || DRY_RUN) return clean;
  const buffer = await downloadImageBuffer(clean, jar);
  return uploadBuffer(buffer, publicId);
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: BRAND_SLUG });
  const now = new Date();
  if (!brand) {
    const insert = {
      name: BRAND_NAME,
      slug: BRAND_SLUG,
      order: 60,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      brand = { ...insert, _id: "dry-brand" };
      console.log("[dry] create brand", BRAND_NAME);
    } else {
      const r = await brands.insertOne(insert);
      brand = { ...insert, _id: r.insertedId };
      console.log(`Created brand ${BRAND_NAME} (${brand._id})`);
    }
  } else {
    console.log(`Using brand ${brand.name} (${brand._id})`);
    if (!DRY_RUN) {
      await brands.updateOne(
        { _id: brand._id },
        { $set: { isActive: true, name: BRAND_NAME, updatedAt: now } },
      );
    }
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
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      menu = { ...insert, _id: `dry-${slug}` };
    } else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
    }
  } else if (!DRY_RUN) {
    await menus.updateOne(
      { _id: menu._id },
      {
        $set: {
          isActive: true,
          name,
          updatedAt: now,
          ...(image ? { image } : {}),
        },
      },
    );
    if (image) menu.image = image;
  }
  return menu;
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

function loadCategories() {
  if (!fs.existsSync(CAT_MAP_FILE)) {
    throw new Error(
      `Missing ${CAT_MAP_FILE}. Run scripts/_tmp-porc-map-cats.cjs first.`,
    );
  }
  return JSON.parse(fs.readFileSync(CAT_MAP_FILE, "utf8")).filter(
    (c) => c.tipoproducto && Number(c.total) > 0,
  );
}

async function discoverAll(jar, categories) {
  if (RESUME && fs.existsSync(CHECKPOINT)) {
    try {
      const prev = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
      if (Array.isArray(prev.items) && prev.items.length) {
        console.log(`Resume checkpoint: ${prev.items.length} products`);
        return prev.items;
      }
    } catch {
      /* ignore */
    }
  }

  const items = [];
  const seen = new Set();

  for (const cat of categories) {
    const total = Number(cat.total) || 0;
    const pages = Math.ceil(total / PAGE_SIZE) || 1;
    console.log(
      `Discover ${cat.parent} > ${cat.name} (tp=${cat.tipoproducto}) total≈${total}`,
    );
    for (let page = 1; page <= pages; page++) {
      const data = await postJson(
        `${BASE}/queries/pgartresults.php`,
        {
          idioma: "3",
          unidades: "'INT'",
          tipoproducto: String(cat.tipoproducto),
          coleccion: String(cat.coleccion ?? "0"),
          pagina: page,
          productosporpagina: PAGE_SIZE,
          filtrosactivados: "",
          filtrosbusavactivados: "",
          busquedarapida: "",
          bimactivado: "",
          ordenbusqueda: "",
        },
        jar,
      );
      const list = data.Productos || [];
      if (!list.length) break;
      for (const row of list) {
        const code = String(row.CodigoAgrupacion || "").trim();
        if (!code || seen.has(code)) continue;
        seen.add(code);
        items.push({
          code,
          serie: cleanText(row.Serie),
          descripcion: cleanText(row.Descripcion),
          enlace: String(row.Enlace || "").replace(/^\//, ""),
          imagen: String(row.Imagen || ""),
          categorySlug: cat.parentSlug,
          categoryName: cat.parent,
          subCategorySlug: slugify(cat.name),
          subCategoryName: cat.name,
          tipoproducto: String(cat.tipoproducto),
          coleccion: String(cat.coleccion ?? "0"),
        });
      }
      process.stdout.write(`  page ${page}/${pages} → ${items.length}\r`);
      await delay(120);
    }
    console.log(`  → ${items.length} unique so far`);
  }

  fs.writeFileSync(
    CHECKPOINT,
    JSON.stringify({ at: new Date().toISOString(), items }, null, 2),
  );
  return items;
}

async function enrichProduct(item, jar) {
  const body = {
    idioma: "3",
    unidades: "'INT'",
    productoagrupacion: item.code,
    codigosap: "",
  };

  let title = "";
  let description = "";
  const specs = {};
  const images = [];

  try {
    const t = await postJson(`${BASE}/queries/pgficha2titulo.php`, body, jar);
    title = cleanText(t.Titulo?.[0]?.Descripcion || "");
  } catch {
    /* ignore */
  }

  try {
    const img = await postJson(`${BASE}/queries/pgficha2imagen.php`, body, jar);
    for (const row of img.Imagen || []) {
      const a = absImage(row.Imagen);
      const b = absImage(row.ImagenArticulo);
      if (a && !images.includes(a)) images.push(a);
      if (b && !images.includes(b)) images.push(b);
    }
  } catch {
    /* ignore */
  }

  if (!images.length && item.imagen) {
    images.push(absImage(item.imagen));
  }

  try {
    const txt = await postJson(
      `${BASE}/queries/pgficha2textoproducto.php`,
      body,
      jar,
    );
    description = cleanText(txt.DescripcionProducto?.[0]?.Descripcion || "");
  } catch {
    /* ignore */
  }

  try {
    const car = await postJson(
      `${BASE}/queries/pgficha2caracfijas.php`,
      body,
      jar,
    );
    for (const row of car.CaracFijas || []) {
      const k = cleanText(row.Titulo);
      const v = cleanText(row.Valor);
      if (k && v) specs[k] = v;
    }
  } catch {
    /* ignore */
  }

  const nameParts = [item.serie, title || item.descripcion].filter(Boolean);
  const name = cleanText(nameParts.join(" ")) || `PORCELANOSA ${item.code}`;

  if (!description) {
    const bits = Object.entries(specs)
      .slice(0, 12)
      .map(([k, v]) => `${k}: ${v}`);
    description =
      bits.length > 0
        ? `${name}. ${bits.join(". ")}.`
        : `${name} from PORCELANOSA Grupo.`;
  }

  return {
    name,
    description: description.slice(0, 8000),
    images: images.slice(0, MAX_IMAGES),
    specs,
  };
}

async function main() {
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

  console.log(
    `PORCELANOSA Grupo import${DRY_RUN ? " (DRY RUN)" : ""} concurrency=${CONCURRENCY}`,
  );

  const jar = {};
  await ensureSession(jar);
  const categories = loadCategories();
  console.log(`Categories: ${categories.length}`);

  let items = await discoverAll(jar, categories);
  if (LIMIT > 0) items = items.slice(0, LIMIT);

  let done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []);
    } catch {
      /* ignore */
    }
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  const parentMenus = new Map();
  const childMenus = new Map();

  // Product Finder home has dedicated parent category banners
  const parentBannerUrls = {};
  try {
    const homeHtml = await http(`${BASE}/en/product_finder.html`, { jar });
    for (const m of homeHtml.matchAll(
      /goto_typology\(['"]([^'"]+)['"]\)[^>]*style=["'][^"']*background-image:\s*url\(([^)]+)\)[^"']*["'][^>]*>\s*<span>([^<]+)<\/span>/gi,
    )) {
      const slug = slugify(m[3]);
      let img = String(m[2] || "").replace(/['"]/g, "").trim();
      if (!img) continue;
      if (img.startsWith("/")) img = `${BASE}${img}`;
      else if (!/^https?:\/\//i.test(img)) img = `${BASE}/${img}`;
      parentBannerUrls[slug] = img;
    }
    console.log(
      `Parent category banners: ${Object.keys(parentBannerUrls).join(", ")}`,
    );
  } catch (e) {
    console.warn(`Parent banner scrape failed: ${e.message}`);
  }
  const uploadedParentBanners = {};
  for (const [slug, url] of Object.entries(parentBannerUrls)) {
    try {
      uploadedParentBanners[slug] = await uploadRemoteImage(
        url,
        `menu-cat-${slug}`,
        jar,
      );
    } catch (e) {
      console.warn(`Parent banner upload ${slug}: ${e.message}`);
    }
  }

  async function menusFor(item) {
    if (!parentMenus.has(item.categorySlug)) {
      const parent = await ensureMenu(db, {
        name: item.categoryName,
        slug: item.categorySlug,
        parent: null,
        brandId: brand._id,
        order: parentMenus.size,
        image: uploadedParentBanners[item.categorySlug] || "",
      });
      parentMenus.set(item.categorySlug, parent);
      if (
        !DRY_RUN &&
        uploadedParentBanners[item.categorySlug] &&
        parent?._id &&
        !String(parent._id).startsWith("dry")
      ) {
        await db.collection("menus").updateOne(
          { _id: parent._id },
          {
            $set: {
              image: uploadedParentBanners[item.categorySlug],
              updatedAt: new Date(),
            },
          },
        );
      }
    }
    const parent = parentMenus.get(item.categorySlug);
    const childKey = `${item.categorySlug}::${item.subCategorySlug}`;
    if (!childMenus.has(childKey)) {
      // Subcategories: seed with listing thumbnail when present
      let seedImage = "";
      if (item.imagen && !SKIP_IMAGES && !DRY_RUN) {
        try {
          seedImage = await uploadRemoteImage(
            absImage(item.imagen),
            `menu-sub-${item.categorySlug}-${item.subCategorySlug}`,
            jar,
          );
        } catch {
          /* product images fill later */
        }
      }
      const child = await ensureMenu(db, {
        name: item.subCategoryName,
        slug: item.subCategorySlug,
        parent: parent._id,
        brandId: brand._id,
        order: childMenus.size,
        image: seedImage,
      });
      childMenus.set(childKey, child);
    }
    return {
      parent: parentMenus.get(item.categorySlug),
      child: childMenus.get(childKey),
    };
  }

  const pending = items.filter((it) => !done.has(it.code));
  console.log(
    `\nImporting ${pending.length} (skip ${items.length - pending.length} done)`,
  );

  let imported = 0;
  let failed = 0;
  let skipped = 0;

  const saveProgress = () => {
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );
  };

  await mapPool(pending, CONCURRENCY, async (item, idx) => {
    const label = `[${idx + 1}/${pending.length}] ${item.code}`;
    try {
      // Refresh session periodically
      if (idx > 0 && idx % 80 === 0) {
        try {
          await ensureSession(jar);
        } catch {
          /* keep going */
        }
      }

      const enriched = await enrichProduct(item, jar);
      if (!enriched.name) {
        skipped += 1;
        done.add(item.code);
        return;
      }

      const { parent, child } = await menusFor(item);
      const handle = slugify(`${item.serie}-${item.descripcion}-${item.code}`) || item.code;

      const uploaded = [];
      for (let i = 0; i < enriched.images.length; i++) {
        try {
          const url = await uploadRemoteImage(
            enriched.images[i],
            `${handle}-${i + 1}`,
            jar,
          );
          if (url) uploaded.push(url);
        } catch (e) {
          console.warn(`${label} image fail: ${e.message}`);
        }
      }

      // Fill subcategory menu image from product only when empty
      if (!DRY_RUN && uploaded[0] && child?._id && !String(child._id).startsWith("dry")) {
        await db.collection("menus").updateOne(
          { _id: child._id, $or: [{ image: "" }, { image: { $exists: false } }] },
          { $set: { image: uploaded[0], updatedAt: new Date() } },
        );
      }
      // Never overwrite dedicated parent category banners with product thumbs
      if (
        !DRY_RUN &&
        uploaded[0] &&
        parent?._id &&
        !String(parent._id).startsWith("dry") &&
        !uploadedParentBanners[item.categorySlug]
      ) {
        await db.collection("menus").updateOne(
          { _id: parent._id, $or: [{ image: "" }, { image: { $exists: false } }] },
          { $set: { image: uploaded[0], updatedAt: new Date() } },
        );
      }

      const specs = {
        ...enriched.specs,
        sku: item.code,
        productCode: item.code,
        source: SOURCE_TAG,
        sourceUrl: item.enlace ? `${BASE}/${item.enlace}` : "",
        serie: item.serie,
        porcelanosaCode: item.code,
        tipoproducto: item.tipoproducto,
      };

      const doc = {
        name: enriched.name,
        description: enriched.description,
        // Public catalogue has no list prices
        price: 0,
        images: uploaded,
        category: parent.slug,
        subCategory: child.slug,
        brand: brand._id,
        stock: STOCK_DEFAULT,
        tagline: item.serie || "",
        schematicImage: "",
        specs,
        showSpecs: true,
        updatedAt: new Date(),
      };

      if (DRY_RUN) {
        console.log(
          `${label} [dry] ${enriched.name} imgs=${uploaded.length} cat=${parent.slug}/${child.slug}`,
        );
      } else {
        // Strict brand isolation: only match this brand + source + sku
        await productsCol.updateOne(
          {
            brand: brand._id,
            "specs.source": SOURCE_TAG,
            "specs.sku": item.code,
          },
          { $set: doc, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        );
        console.log(
          `${label} ok ${enriched.name.slice(0, 60)} imgs=${uploaded.length}`,
        );
      }

      imported += 1;
      done.add(item.code);
      if (imported % 25 === 0) saveProgress();
      await delay(80);
    } catch (e) {
      failed += 1;
      console.warn(`${label} FAIL ${e.message}`);
    }
  });

  saveProgress();
  console.log(
    JSON.stringify(
      {
        brand: BRAND_SLUG,
        discovered: items.length,
        imported,
        skipped,
        failed,
        done: done.size,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
