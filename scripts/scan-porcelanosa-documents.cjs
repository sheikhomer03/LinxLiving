/**
 * Ask Porcelanosa's product finder what documents exist for every product.
 *
 * scan-porcelanosa-media.cjs already walks pgficha2documentos.php but keeps
 * only the Videos and Edificacion buckets. The same response carries three
 * more we never recorded:
 *
 *   Documentos  fixing / maintenance / warranty sheets — a small shared set
 *   Catalogos   the catalogue PDFs (13 of which are already mirrored)
 *   Fichas      per-SAP flags for files their PDF generator builds on demand
 *               (technical sheet, DoP, spare parts, aerator, extension,
 *               exhibition) — no file exists until the generator is called
 *
 * Writes scripts/porcelanosa-document-scan.json — the input to
 * download-porcelanosa-documents.cjs.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/scan-porcelanosa-documents.cjs
 *   LIMIT=200      scan only the first N products
 *   CONCURRENCY=4  parallel requests (their origin 500s if pushed harder)
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://productfinder.porcelanosagrupo.com";
const GEN = "https://pdfgenerator.porcelanosagrupo.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OUT = path.join(__dirname, "porcelanosa-document-scan.json");
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);

/**
 * The generated-file flags on each Fichas row, and the generator script that
 * builds the file. "unit" rows take &un=0; the rest are keyed on Empresa.
 */
const GENERATED = [
  { flag: "UnidadINT", label: "Technical Sheet", script: "generar_FTEC_PDF.php", style: "unit" },
  { flag: "Declaracion", label: "Declaration of Performance", script: "generar_DP_PDF.php", style: "unit" },
  { flag: "Repuestos", label: "Spare Parts Sheet", script: "generar_REP_PDF.php", style: "unit" },
  { flag: "Aireador", label: "Aerators Sheet", script: "generar_AIREADORES.php", style: "empresa" },
  { flag: "Prolongador", label: "Extension Sheet", script: "generar_PROLONGADORES.php", style: "empresa" },
  { flag: "Exposicion", label: "Exhibition Sheet", script: "generar_EXPO.php", style: "empresa" },
];

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

/** Their Fichero values are site-relative and some carry a #page anchor. */
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
    .project({ name: 1, slug: 1, specs: 1 });
  if (LIMIT) q = q.limit(LIMIT);
  const products = await q.toArray();
  console.log(`Scanning ${products.length} product(s), concurrency ${CONCURRENCY}\n`);

  // Static files: many products share one URL, so key on the URL.
  const statics = new Map();
  // Generated files: one per SAP code per flag, so key on the built URL.
  const generated = new Map();
  let done = 0;
  let errors = 0;

  const addStatic = (bucket, row) => {
    const url = absResource(row.Fichero || "");
    if (!url) return;
    if (!statics.has(url))
      statics.set(url, {
        url,
        bucket,
        title: row.Descripcion || "",
        tipoDoc: row.TipoDoc || "",
        ext: String(row.Extension || "PDF").toLowerCase(),
        products: 0,
      });
    statics.get(url).products++;
  };

  await mapPool(products, CONCURRENCY, async (p) => {
    const code = p.specs.porcelanosaCode;
    const sap = String(p.specs.articleSap || "");
    const body = {
      idioma: "3", mercados: "'INT'", unidades: "'INT'",
      tipoproducto: String(p.specs.tipoproducto || ""),
      productoagrupacion: String(code), codigosap: sap,
      filtrosactivados: "", filtrosbusavactivados: "",
      busquedarapida: "", bimactivado: "", filtrosconfig: "",
    };
    try {
      const d = await post(`${BASE}/queries/pgficha2documentos.php`, body);
      for (const row of d.Documentos || []) addStatic("documentos", row);
      for (const row of d.Catalogos || []) addStatic("catalogos", row);
      for (const row of d.Edificacion || []) addStatic("edificacion", row);

      for (const f of d.Fichas || []) {
        const s = String(f.CodigoSAP || sap);
        if (!s) continue;
        for (const g of GENERATED) {
          if (String(f[g.flag] || "0") !== "1") continue;
          const url =
            g.style === "unit"
              ? `${GEN}${g.script}?articulos=${s}&lang=3&un=0&mercado=INT&output=I`
              : `${GEN}${g.script}?articulos=${s}&lang=3&industrial=${f.Empresa || ""}` +
                `&descatalogado=1&mercado=INT&output=I`;
          if (generated.has(url)) continue;
          generated.set(url, {
            url,
            bucket: "fichas",
            kind: g.flag,
            title: g.label,
            sap: s,
            empresa: f.Empresa || "",
            product: p.name,
          });
        }
      }
    } catch {
      errors++;
    }
    if (++done % 250 === 0)
      console.log(
        `  ${done}/${products.length}  static=${statics.size} generated=${generated.size} errors=${errors}`,
      );
  });

  const out = {
    scanned: products.length,
    errors,
    statics: [...statics.values()].sort((a, b) => b.products - a.products),
    generated: [...generated.values()],
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);

  const byBucket = {};
  for (const s of out.statics) byBucket[s.bucket] = (byBucket[s.bucket] || 0) + 1;
  const byKind = {};
  for (const g of out.generated) byKind[g.kind] = (byKind[g.kind] || 0) + 1;

  console.log(`\nScanned ${products.length}, ${errors} error(s)`);
  console.log(`Static documents: ${out.statics.length} distinct`);
  for (const [k, v] of Object.entries(byBucket)) console.log(`   ${k}: ${v}`);
  for (const s of out.statics)
    console.log(`   ${s.products}x [${s.bucket}] ${s.title} — ${s.url}`);
  console.log(`Generated documents: ${out.generated.length}`);
  for (const [k, v] of Object.entries(byKind)) console.log(`   ${k}: ${v}`);
  console.log(`\nWritten to scripts/${path.basename(OUT)}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
