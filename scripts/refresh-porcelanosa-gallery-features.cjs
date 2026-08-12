/**
 * Refresh ALL PORCELANOSA Grupo products from Product Finder:
 * - image gallery (product + ambient images)
 * - Features (pgficha2caracfijas)
 * - Packing (pgficha2packing)
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/refresh-porcelanosa-gallery-features.cjs
 *
 * Options:
 *   DRY_RUN=1
 *   LIMIT=50
 *   CONCURRENCY=2
 *   SKIP_IMAGES=1
 *   MAX_IMAGES=16
 *   RESUME=1
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
const SOURCE_TAG = "porcelanosa-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/porcelanosagrupo";
const PROGRESS = path.join(
  __dirname,
  "_tmp-porcelanosa-gallery-refresh-progress.json",
);
const LOG = path.join(__dirname, "_tmp-porcelanosa-gallery-refresh.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const RESUME = process.env.RESUME !== "0";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 16));

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usableFeatureValue(v) {
  const u = cleanText(v).toUpperCase();
  return Boolean(u) && u !== "-" && u !== "NO APLICA" && u !== "#";
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseSetCookie(res) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
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

async function uploadRemoteImage(url, publicId, jar) {
  if (SKIP_IMAGES || DRY_RUN) return "";
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Referer: `${BASE}/en/product_finder.html`,
  };
  if (jar && Object.keys(jar).length) headers.Cookie = cookieHeader(jar);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`img ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const uploaded = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: String(publicId || "").slice(0, 100),
        overwrite: true,
        resource_type: "image",
        format: "avif",
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buf);
  });
  return uploaded.secure_url || "";
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

const DEFAULT_LEGAL =
  "All details provided by the PORCELANOSA Group's Product Finder has an information purpose without any contractual value. In order to obtain further information about the materials and their installation please visit our showrooms. PORCELANOSA Group reserves the right to modify or delete any information on this site. The images and colours shown in this site may differ from the real ones.";

async function resolveArticleSaps(code, tipoproducto, jar) {
  try {
    const refs = await postJson(
      `${BASE}/queries/pgficha2referencias.php`,
      {
        idioma: "3",
        unidades: "'INT'",
        tipoproducto: String(tipoproducto || ""),
        filtrosactivados: "",
        filtrosbusavactivados: "",
        busquedarapida: "",
        bimactivado: "",
        filtrosconfig: "",
        productoagrupacion: String(code),
        codigosap: "",
      },
      jar,
    );
    const list = refs.Productos || [];
    return [
      ...new Set(
        list
          .map((p) => String(p.CodigoSAP || "").trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

async function fetchPacking(code, sap, jar) {
  const pack = await postJson(
    `${BASE}/queries/pgficha2packing.php`,
    {
      idioma: "3",
      unidades: "'INT'",
      productoagrupacion: String(code),
      codigosap: String(sap || ""),
      listacompletacodigosap: String(sap || code),
    },
    jar,
  );
  const out = [];
  for (const row of pack.Packing || []) {
    const label = cleanText(row.Descripcion);
    const value = cleanText([row.Valor, row.Unidad].filter(Boolean).join(" "));
    if (!label || !usableFeatureValue(value)) continue;
    out.push({ label, value });
  }
  return out;
}

async function fetchDocuments(code, sap, jar) {
  const docs = await postJson(
    `${BASE}/queries/pgficha2documentos.php`,
    {
      idioma: "3",
      mercados: "'INT'",
      unidades: "'INT'",
      productoagrupacion: String(code),
      codigosap: String(sap || ""),
    },
    jar,
  );
  const out = [];
  const pushDoc = (row, group) => {
    const title = cleanText(
      `${row.Descripcion || group || "Document"}${
        row.Extension ? ` (${row.Extension})` : ""
      }`,
    );
    const url = absImage(row.Fichero);
    if (!title || !url) return;
    if (out.some((d) => d.url === url)) return;
    out.push({
      title,
      url,
      type: "pdf",
    });
  };
  for (const row of docs.Catalogos || []) pushDoc(row, "Catalogue");
  for (const row of docs.Documentos || []) pushDoc(row, "Document");
  for (const row of docs.Fichas || []) {
    // Technical sheets often use a PDF generator URL when no Fichero
    if (row.Fichero) {
      pushDoc(row, "Datasheet");
    } else if (row.CodigoSAP) {
      const title = cleanText(row.Descripcion || "Technical sheet");
      const url = `${BASE}/queries/generar_FTEC_PDF.php?articulos=${encodeURIComponent(
        row.CodigoSAP,
      )}&lang=3&un=0&mercado=INT&output=I`;
      if (title && !out.some((d) => d.url === url)) {
        out.push({ title, url, type: "pdf" });
      }
    }
  }
  return out;
}

async function enrichCode(code, jar, tipoproducto = "") {
  const body = {
    idioma: "3",
    unidades: "'INT'",
    productoagrupacion: code,
    codigosap: "",
    listacompletacodigosap: code,
  };

  const images = [];
  const featureEntries = [];
  let packingEntries = [];
  let downloads = [];
  const specs = {};
  let articleSap = "";

  const saps = await resolveArticleSaps(code, tipoproducto, jar);
  articleSap = saps[0] || "";
  const bodyWithSap = {
    ...body,
    codigosap: articleSap,
    listacompletacodigosap: saps.length ? saps.join("$$") : code,
  };

  try {
    const img = await postJson(
      `${BASE}/queries/pgficha2imagen.php`,
      bodyWithSap,
      jar,
    );
    for (const row of img.Imagen || []) {
      const a = absImage(row.Imagen);
      const b = absImage(row.ImagenArticulo);
      if (a && !images.includes(a)) images.push(a);
      if (b && !images.includes(b)) images.push(b);
    }
  } catch {
    /* ignore */
  }

  // Ambient / lifestyle gallery (Product Finder slick strip under the hero).
  // Requires a real article SAP — grouping code alone returns Ambientes:[].
  const ambBodies = [
    bodyWithSap,
    articleSap
      ? {
          ...body,
          codigosap: articleSap,
          listacompletacodigosap: articleSap,
        }
      : null,
    body,
  ].filter(Boolean);
  for (const ambBody of ambBodies) {
    try {
      const amb = await postJson(
        `${BASE}/queries/pgficha2ambientes.php`,
        ambBody,
        jar,
      );
      const rows = amb.Ambientes || [];
      if (!rows.length) continue;
      for (const row of rows) {
        const url = absImage(`${row.Ruta || ""}${row.Fichero || ""}`);
        if (url && !images.includes(url)) images.push(url);
      }
      break;
    } catch {
      /* try next body */
    }
  }

  try {
    const car = await postJson(
      `${BASE}/queries/pgficha2caracfijas.php`,
      bodyWithSap,
      jar,
    );
    for (const row of car.CaracFijas || []) {
      const k = cleanText(row.Titulo);
      const v = cleanText(row.Valor);
      if (!k || !usableFeatureValue(v)) continue;
      specs[k] = v;
      featureEntries.push({ label: k, value: v });
    }
  } catch {
    /* ignore */
  }

  // Packing requires a real article SAP (grouping code alone returns []).
  const sapCandidates = [...saps, ""];
  for (const sap of sapCandidates) {
    try {
      const rows = await fetchPacking(code, sap, jar);
      if (rows.length) {
        packingEntries = rows;
        if (sap) articleSap = sap;
        break;
      }
    } catch {
      /* try next */
    }
  }

  // Files and Documentation are handled by
  // refresh-porcelanosa-files-documentation.cjs (Cloudinary uploads + headings).
  // Do not write flat downloads here — that mixed with Noken Downloads.

  return {
    images: images.slice(0, MAX_IMAGES),
    featureEntries,
    packingEntries,
    downloads: [],
    legalDisclaimer: DEFAULT_LEGAL,
    articleSap,
    specs,
  };
}

function log(line) {
  const s = String(line);
  console.log(s);
  fs.appendFileSync(LOG, `${s}\n`);
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

  fs.writeFileSync(
    LOG,
    `Porcelanosa gallery/features refresh ${new Date().toISOString()}\n`,
  );
  log(
    `Refresh ALL Porcelanosa products${DRY_RUN ? " (DRY RUN)" : ""} concurrency=${CONCURRENCY} skipImages=${SKIP_IMAGES}`,
  );

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("porcelanosagrupo brand missing");

  let products = await db
    .collection("products")
    .find({
      brand: brand._id,
      "specs.source": SOURCE_TAG,
    })
    .project({
      name: 1,
      images: 1,
      specs: 1,
      featureEntries: 1,
      packingEntries: 1,
    })
    .toArray();

  if (LIMIT > 0) products = products.slice(0, LIMIT);

  let done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []);
    } catch {
      /* ignore */
    }
  }

  const pending = products.filter((p) => !done.has(String(p._id)));
  log(`Total=${products.length} pending=${pending.length} skippedDone=${done.size}`);

  const jar = {};
  await ensureSession(jar);

  let updated = 0;
  let failed = 0;
  let skipped = 0;

  const saveProgress = () => {
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );
  };

  await mapPool(pending, CONCURRENCY, async (p, idx) => {
    const code = String(p.specs?.porcelanosaCode || p.specs?.sku || "").trim();
    const label = `[${idx + 1}/${pending.length}] ${code || p._id}`;
    if (!code) {
      skipped += 1;
      done.add(String(p._id));
      log(`${label} skip no code`);
      return;
    }

    try {
      if (idx > 0 && idx % 60 === 0) {
        try {
          await ensureSession(jar);
        } catch {
          /* keep going */
        }
      }

      const tipoproducto = String(p.specs?.tipoproducto || "");
      const live = await enrichCode(code, jar, tipoproducto);
      const uploaded = [];
      if (!SKIP_IMAGES) {
        for (let i = 0; i < live.images.length; i++) {
          try {
            const url = await uploadRemoteImage(
              live.images[i],
              `${code}-g${i + 1}`,
              jar,
            );
            if (url) uploaded.push(url);
          } catch (e) {
            log(`${label} image fail: ${e.message}`);
          }
        }
      }

      // Prefer freshly uploaded Cloudinary URLs; when SKIP_IMAGES=1 still
      // apply remote Product Finder gallery URLs so ambient slides are not lost.
      const nextImages =
        uploaded.length > 0
          ? uploaded
          : live.images.length > 0
            ? live.images
            : Array.isArray(p.images) && p.images.length
              ? p.images
              : [];

      const metaKeep = {
        sku: p.specs?.sku || code,
        productCode: p.specs?.productCode || code,
        source: SOURCE_TAG,
        sourceUrl: p.specs?.sourceUrl || "",
        serie: p.specs?.serie || "",
        porcelanosaCode: code,
        tipoproducto,
        articleSap: live.articleSap || "",
      };
      const specs = {
        ...live.specs,
        ...metaKeep,
        galleryRefreshedAt: new Date().toISOString(),
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] imgs=${live.images.length} features=${live.featureEntries.length} packing=${live.packingEntries.length} docs=${(live.downloads || []).length} sap=${live.articleSap || "-"}`,
        );
      } else {
        await db.collection("products").updateOne(
          { _id: p._id, brand: brand._id },
          {
            $set: {
              ...(nextImages.length ? { images: nextImages } : {}),
              featureEntries: live.featureEntries,
              packingEntries: live.packingEntries,
              legalDisclaimer: live.legalDisclaimer || DEFAULT_LEGAL,
              specs: { ...(p.specs || {}), ...specs },
              updatedAt: new Date(),
            },
          },
        );
        log(
          `${label} ok imgs=${nextImages.length} features=${live.featureEntries.length} packing=${live.packingEntries.length} docs=${(live.downloads || []).length} sap=${live.articleSap || "-"}`,
        );
      }

      updated += 1;
      done.add(String(p._id));
      if (updated % 25 === 0) saveProgress();
      await delay(60);
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${e.message}`);
    }
  });

  saveProgress();
  log(
    JSON.stringify(
      {
        brand: BRAND_SLUG,
        total: products.length,
        updated,
        failed,
        skipped,
        dryRun: DRY_RUN,
      },
      null,
      2,
    ),
  );
  process.exit(failed && !updated ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
