/**
 * Find every video and extra document Porcelanosa exposes per product.
 *
 * The documents endpoint carries Catalogues, Documentos and an Edificacion
 * bucket; the room-scenes endpoint (pgficha2ambientes) carries a Videos array
 * the existing scrapers never read. Both are empty for most products, so the
 * only way to know what exists is to ask for every product and keep what comes
 * back.
 *
 * Writes scripts/porcelanosa-media-scan.json — the input to the downloader.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/scan-porcelanosa-media.cjs
 *   LIMIT=200      scan only the first N products
 *   CONCURRENCY=3  parallel requests (their origin 500s if pushed harder)
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://productfinder.porcelanosagrupo.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OUT = path.join(__dirname, "porcelanosa-media-scan.json");
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);

const jar = {};
const cookieHeader = () =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

async function http(url, { method = "GET", body } = {}) {
  const headers = {
    "User-Agent": UA,
    Accept: method === "GET" ? "text/html,*/*" : "application/json,*/*",
    "Accept-Language": "en-GB,en;q=0.9",
    Referer: `${BASE}/en/product_finder.html`,
    Origin: BASE,
  };
  if (Object.keys(jar).length) headers.Cookie = cookieHeader();
  if (body != null) {
    headers["Content-Type"] = "application/json";
    headers["X-Requested-With"] = "XMLHttpRequest";
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() || []) {
    const part = c.split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) jar[part.slice(0, eq)] = part.slice(eq + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function post(url, body) {
  const t = await http(url, { method: "POST", body });
  return t && t.trim() ? JSON.parse(t) : {};
}

async function ensureSession() {
  await http(`${BASE}/en/product_finder.html`);
  await post(`${BASE}/queries/pgparamsesion.php`, {
    pgidioma: "3", pgunidades: "'INT'", pgtipoproducto: "", pgmercados: "'INT'",
    pgempresas: "'B','C','G','L','N','P','S'", pgcatalogos: "'B','C','G','L','N','P','S'",
    pgcoleccion: "0", pgbusquedarapida: "", pgbimactivado: "", pgfiltrosbusavactivados: "",
    pgfiltrosconfigactivados: "", pgfiltrosactivados: "", pgpaginabusca: "1",
    pgposicionbusca: "1", pgcoleccionbusca: "0", pgtipoproductobusca: "",
    pgtotalresultados: "-1", pgproductoagrupacion: "", pgpaganterior: "",
    pgordenbusqueda: "", pgcodigoferia: "", pgnombreferiaurl: "",
  });
}

function absResource(rel) {
  let r = String(rel || "").trim();
  if (!r) return "";
  r = r.split("#")[0];
  if (/^https?:\/\//i.test(r)) return r;
  r = r.replace(/^\/+/, "");
  return r.startsWith("resources/") ? `${BASE}/${r}` : `${BASE}/resources/${r}`;
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await worker(items[i++]);
    }),
  );
}

async function main() {
  await ensureSession();
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "porcelanosagrupo" });

  let q = db
    .collection("products")
    .find({ brand: brand._id, "specs.porcelanosaCode": { $exists: true } })
    .project({ name: 1, specs: 1 });
  if (LIMIT) q = q.limit(LIMIT);
  const products = await q.toArray();
  console.log(`Scanning ${products.length} product(s), concurrency ${CONCURRENCY}\n`);

  const videos = new Map();
  const edificacion = new Map();
  let done = 0;
  let errors = 0;

  await mapPool(products, CONCURRENCY, async (p) => {
    const code = p.specs.porcelanosaCode;
    const sap = p.specs.articleSap || "";
    const tipo = p.specs.tipoproducto || "";
    const body = {
      idioma: "3", mercados: "'INT'", unidades: "'INT'",
      tipoproducto: String(tipo), productoagrupacion: String(code),
      codigosap: String(sap), filtrosactivados: "", filtrosbusavactivados: "",
      busquedarapida: "", bimactivado: "", filtrosconfig: "",
    };
    try {
      const amb = await post(`${BASE}/queries/pgficha2ambientes.php`, body);
      for (const row of amb.Videos || []) {
        const url = absResource(row.Fichero || row.Video || row.Url || "");
        if (!url) continue;
        if (!videos.has(url)) videos.set(url, { url, row, products: [] });
        videos.get(url).products.push(p.name);
      }
      const docs = await post(`${BASE}/queries/pgficha2documentos.php`, body);
      for (const row of docs.Edificacion || []) {
        const url = absResource(row.Fichero || "");
        if (!url) continue;
        if (!edificacion.has(url)) edificacion.set(url, { url, row, products: [] });
        edificacion.get(url).products.push(p.name);
      }
    } catch {
      errors++;
    }
    if (++done % 250 === 0)
      console.log(`  ${done}/${products.length}  videos=${videos.size} edificacion=${edificacion.size} errors=${errors}`);
  });

  const out = {
    scanned: products.length,
    errors,
    videos: [...videos.values()].map((v) => ({ url: v.url, row: v.row, products: v.products.length })),
    edificacion: [...edificacion.values()].map((v) => ({ url: v.url, row: v.row, products: v.products.length })),
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);

  console.log(`\nScanned ${products.length}, ${errors} error(s)`);
  console.log(`Videos found:      ${out.videos.length} distinct`);
  for (const v of out.videos.slice(0, 20)) console.log(`   ${v.products}x  ${v.url}`);
  console.log(`Edificacion docs:  ${out.edificacion.length} distinct`);
  for (const v of out.edificacion.slice(0, 20)) console.log(`   ${v.products}x  ${v.url}`);
  console.log(`\nWritten to scripts/${path.basename(OUT)}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
