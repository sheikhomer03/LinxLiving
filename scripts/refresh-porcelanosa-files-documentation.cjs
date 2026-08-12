/**
 * Scrape Porcelanosa “Files and Documentation” into headed sections.
 * Stores Porcelanosa source URLs directly (no Cloudinary download/upload).
 * Clears product.downloads for these products so Downloads stays separate.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/refresh-porcelanosa-files-documentation.cjs
 *
 * Options: LIMIT=20 CONCURRENCY=2 DRY_RUN=1 RESUME=1
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
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://productfinder.porcelanosagrupo.com";
const PDF_GEN = "https://pdfgenerator.porcelanosagrupo.com";
const BRAND_SLUG = "porcelanosagrupo";
const PROGRESS = path.join(
  __dirname,
  "_tmp-porcelanosa-files-documentation-progress.json",
);
const LOG = path.join(__dirname, "_tmp-porcelanosa-files-documentation.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const RESUME = process.env.RESUME !== "0";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const ONLY_IDS = String(process.env.ONLY_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function log(...args) {
  const line = args.map(String).join(" ");
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function cleanText(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

async function http(url, { method = "GET", body, jar, binary = false } = {}) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: binary ? "*/*" : method === "GET" ? "text/html,*/*" : "application/json,*/*",
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
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${url}: ${t.slice(0, 120)}`);
  }
  if (binary) {
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "";
    return { buf, ct };
  }
  return res.text();
}

async function postJson(url, body, jar, { allowEmpty = false } = {}) {
  const text = await http(url, { method: "POST", body, jar });
  if (!String(text || "").trim()) {
    if (allowEmpty) return {};
    throw new Error(`Empty ${url}`);
  }
  return JSON.parse(text);
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

function absResource(rel) {
  let r = String(rel || "").trim();
  if (!r) return "";
  // Drop PDF viewer fragments (#page=…)
  r = r.split("#")[0];
  if (/^https?:\/\//i.test(r)) return r;
  r = r.replace(/^\/+/, "");
  if (r.startsWith("resources/")) return `${BASE}/${r}`;
  return `${BASE}/resources/${r}`;
}

function fileTypeFrom(title, url) {
  if (/\.zip($|\?)/i.test(url) || /\bzip\b/i.test(title)) return "zip";
  if (/\.pdf($|\?)/i.test(url) || /pdf/i.test(title)) return "pdf";
  return "other";
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx], idx);
      }
    },
  );
  await Promise.all(runners);
}

async function resolveSap(code, tipoproducto, jar) {
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
        productoagrupacion: code,
        codigosap: "",
      },
      jar,
    );
    return String(refs.Productos?.[0]?.CodigoSAP || "").trim();
  } catch {
    return "";
  }
}

/**
 * Build headed Files and Documentation from pgficha2documentos.
 */
async function fetchFilesDocumentation(code, sap, jar) {
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

  const phrases = docs.FichasFrases || {};
  const headingCatalogues =
    cleanText(phrases["2104"] || "Catalogues").toUpperCase() || "CATALOGUES";
  const headingTech =
    cleanText(phrases["2124"] || "Technical documentation").toUpperCase() ||
    "TECHNICAL DOCUMENTATION";
  const headingGraphic =
    cleanText(phrases["2125"] || "Graphic files").toUpperCase() ||
    "GRAPHIC FILES";

  const sections = [];
  const pushSection = (heading, files) => {
    if (!files.length) return;
    sections.push({ heading, files });
  };

  const catalogueFiles = [];
  for (const row of docs.Catalogos || []) {
    const title = cleanText(
      `${row.Descripcion || "Catalogue"}${row.Extension ? ` (${row.Extension})` : ""}`,
    );
    const url = absResource(row.Fichero);
    if (title && url) catalogueFiles.push({ title, url, type: "pdf" });
  }
  pushSection(headingCatalogues, catalogueFiles);

  const techFiles = [];
  for (const row of docs.Documentos || []) {
    const title = cleanText(
      `${row.Descripcion || "Document"}${row.Extension ? ` (${row.Extension})` : ""}`,
    );
    const url = absResource(row.Fichero);
    if (title && url) techFiles.push({ title, url, type: "pdf" });
  }

  const ficha = (docs.Fichas || [])[0];
  if (ficha && sap) {
    if (String(ficha.Declaracion) === "1") {
      techFiles.push({
        title: cleanText(phrases["2033"] || "Declaration of Performance") + " (PDF)",
        url: `${PDF_GEN}/generar_DOP_PDF.php?articulos=${encodeURIComponent(sap)}&lang=EN&mercado=INT&output=I&un=0`,
        type: "pdf",
        optional: true,
      });
    }
    techFiles.push({
      title: cleanText(phrases["2032"] || "Technical Sheet") + " (PDF)",
      url: `${PDF_GEN}/generar_FTEC_PDF.php?articulos=${encodeURIComponent(sap)}&lang=EN&mercado=INT&output=I&un=0`,
      type: "pdf",
    });
  }
  pushSection(headingTech, techFiles);

  const graphicFiles = [];
  if (ficha && sap && String(ficha.ZipRender) === "1") {
    graphicFiles.push({
      title: cleanText(phrases["2089"] || "Product Graphics") + " (ZIP)",
      url: `${PDF_GEN}/generar_ZIP.php?articulos=${encodeURIComponent(sap)}&tipo=render`,
      type: "zip",
      optional: true,
    });
  }
  pushSection(headingGraphic, graphicFiles);

  // Keep Porcelanosa source URLs (no Cloudinary upload).
  return sections.map((section) => ({
    heading: section.heading,
    files: section.files.map((file) => ({
      title: file.title,
      url: file.url,
      type: fileTypeFrom(file.title, file.url),
    })),
  }));
}

async function main() {
  fs.writeFileSync(
    LOG,
    `Porcelanosa filesDocumentation ${new Date().toISOString()}\n`,
  );
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");

  const c = await connectMongo();
  const db = c.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Brand not found");

  const filter = { brand: brand._id };
  if (ONLY_IDS.length) {
    filter._id = {
      $in: ONLY_IDS.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }
  let products = await db
    .collection("products")
    .find(filter)
    .project({ name: 1, specs: 1, downloads: 1, filesDocumentation: 1 })
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
  log(
    `Files+Documentation total=${products.length} pending=${pending.length} concurrency=${CONCURRENCY} sourceUrls=true${DRY_RUN ? " DRY" : ""}`,
  );

  const jar = {};
  await ensureSession(jar);

  let updated = 0;
  let failed = 0;
  const save = () =>
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );

  await mapPool(pending, CONCURRENCY, async (p, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    const code = String(
      p.specs?.porcelanosaCode || p.specs?.sku || p.specs?.productCode || "",
    ).trim();
    if (!code) {
      done.add(String(p._id));
      return;
    }
    try {
      if (idx > 0 && idx % 40 === 0) {
        try {
          await ensureSession(jar);
        } catch {
          /* keep */
        }
      }
      const tipoproducto = String(p.specs?.tipoproducto || "");
      let sap = String(p.specs?.articleSap || "").trim();
      if (!sap) sap = await resolveSap(code, tipoproducto, jar);

      const filesDocumentation = await fetchFilesDocumentation(code, sap, jar);
      const fileCount = filesDocumentation.reduce(
        (n, s) => n + s.files.length,
        0,
      );

      if (DRY_RUN) {
        log(
          `${label} [dry] ${code} sections=${filesDocumentation.length} files=${fileCount} sap=${sap || "-"}`,
        );
      } else {
        await db.collection("products").updateOne(
          { _id: p._id },
          {
            $set: {
              filesDocumentation,
              // Keep Downloads separate — clear Porcelanosa docs from downloads
              downloads: [],
              "specs.articleSap": sap || p.specs?.articleSap || "",
              "specs.filesDocumentationRefreshedAt": new Date().toISOString(),
              updatedAt: new Date(),
            },
          },
        );
        log(
          `${label} ok ${code} sections=${filesDocumentation.length} files=${fileCount} sap=${sap || "-"}`,
        );
      }
      updated += 1;
      done.add(String(p._id));
      if (updated % 15 === 0) save();
      await new Promise((r) => setTimeout(r, 80));
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${code} ${e.message}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  save();
  log(`Done updated=${updated} failed=${failed}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
