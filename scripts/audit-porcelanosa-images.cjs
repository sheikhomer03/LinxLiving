/**
 * Audit PORCELANOSA Grupo products: DB images vs Shopify vs Product Finder source.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-porcelanosa-images.cjs
 *
 * Env: SAMPLE=40 (0 = all), CONCURRENCY=6, OUT=path
 */
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://productfinder.porcelanosagrupo.com";
const BRAND_ID = "6a6b9647d17a2adf5d0d2b35";
const SAMPLE = Number(process.env.SAMPLE || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 6));
const OUT = process.env.OUT || path.join(__dirname, "_tmp-porce-image-audit.json");

const jar = {};
function cookieHeader() {
  return Object.entries(jar)
    .map(([k, v]) => k + "=" + v)
    .join("; ");
}
function absorb(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const p = c.split(";")[0];
    const e = p.indexOf("=");
    if (e > 0) jar[p.slice(0, e)] = p.slice(e + 1);
  }
}
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const INT = String.fromCharCode(39) + "INT" + String.fromCharCode(39);

async function postJson(endpoint, payload) {
  const headers = {
    "User-Agent": UA,
    Accept: "*/*",
    Origin: BASE,
    Referer: BASE + "/en/product_finder.html",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (Object.keys(jar).length) headers.Cookie = cookieHeader();
  const res = await fetch(BASE + "/queries/" + endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  absorb(res);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function ensureSession() {
  const res = await fetch(BASE + "/en/product_finder.html", {
    headers: { "User-Agent": UA },
  });
  absorb(res);
}

/**
 * The Product Finder has re-numbered its productoagrupacion codes since the
 * import, so the stored code can point at a neighbouring product. The product
 * page URL is stable; read the live code out of its hidden input.
 */
async function codeFromPage(url) {
  const headers = { "User-Agent": UA, Accept: "text/html" };
  if (Object.keys(jar).length) headers.Cookie = cookieHeader();
  const res = await fetch(url, { headers });
  absorb(res);
  if (!res.ok) return { status: res.status, code: "" };
  const html = await res.text();
  const m = html.match(/name="pgproductoagrupacion"\s+value="([^"]*)"/i);
  return { status: res.status, code: m ? m[1] : "" };
}

/** Strip Shopify/Cloudinary suffixes so 100388453_8af4-uuid.jpg becomes 100388453. */
function assetKey(url) {
  let base = String(url || "").split("?")[0].split("/").pop() || "";
  base = base.replace(/\.(jpe?g|png|webp|gif)$/i, "");
  base = base.replace(
    /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "",
  );
  base = base.replace(/_\d{3}$/, "");
  return base.toUpperCase();
}
function norm(s) {
  return String(s || "").replace(/\s+/g, " ").trim().toUpperCase();
}

async function fetchSource(code, tipoproducto) {
  const base = {
    idioma: "3",
    unidades: INT,
    productoagrupacion: String(code),
    codigosap: "",
  };
  const out = { title: "", sap: "", images: [], ok: false };

  const t = await postJson("pgficha2titulo.php", base);
  out.title = norm(t.Titulo && t.Titulo[0] ? t.Titulo[0].Descripcion : "");

  const refs = await postJson("pgficha2referencias.php", {
    idioma: "3",
    unidades: INT,
    tipoproducto: String(tipoproducto || ""),
    filtrosactivados: "",
    filtrosbusavactivados: "",
    busquedarapida: "",
    bimactivado: "",
    filtrosconfig: "",
    productoagrupacion: String(code),
    codigosap: "",
  });
  out.sap = String(
    refs.Productos && refs.Productos[0] ? refs.Productos[0].CodigoSAP : "",
  ).trim();

  const withSap = Object.assign({}, base, { codigosap: out.sap });

  const img = await postJson("pgficha2imagen.php", withSap);
  for (const row of img.Imagen || []) {
    for (const v of [row.Imagen, row.ImagenArticulo]) {
      const k = assetKey(v);
      if (k && !out.images.includes(k)) out.images.push(k);
    }
  }

  const amb = await postJson("pgficha2ambientes.php", withSap);
  for (const row of amb.Ambientes || []) {
    const k = assetKey(String(row.Ruta || "") + String(row.Fichero || ""));
    if (k && !out.images.includes(k)) out.images.push(k);
  }

  out.ok = Boolean(out.title || out.images.length);
  return out;
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = await fn(items[i], i);
        } catch (e) {
          results[i] = { id: String(items[i]._id), error: e.message };
        }
      }
    }),
  );
  return results;
}

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const IDS = String(process.env.IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const query = { brand: new mongoose.Types.ObjectId(BRAND_ID) };
  if (IDS.length) query._id = { $in: IDS.map((id) => new mongoose.Types.ObjectId(id)) };

  let docs = await db
    .collection("products")
    .find(
      query,
      {
        projection: {
          name: 1,
          images: 1,
          shopifyImages: 1,
          shopifyProductId: 1,
          shopifyHandle: 1,
          "specs.porcelanosaCode": 1,
          "specs.tipoproducto": 1,
          "specs.articleSap": 1,
          "specs.sourceUrl": 1,
        },
      },
    )
    .sort({ _id: 1 })
    .toArray();

  if (SAMPLE > 0) {
    const step = Math.max(1, Math.floor(docs.length / SAMPLE));
    docs = docs.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  }
  console.log("Auditing " + docs.length + " products (concurrency " + CONCURRENCY + ")");

  await ensureSession();

  let done = 0;
  const rows = await mapPool(docs, CONCURRENCY, async (d) => {
    const storedCode = String((d.specs && d.specs.porcelanosaCode) || "");
    const tipo = d.specs && d.specs.tipoproducto;
    const dbName = norm(d.name);
    const fits = (t) => Boolean(t) && (dbName.includes(t) || t.includes(dbName));

    let code = storedCode;
    let src = code
      ? await fetchSource(code, tipo)
      : { title: "", sap: "", images: [], ok: false };
    let reanchored = false;
    let pageStatus = null;

    // Stale stored code: re-resolve through the stable product page URL.
    if (!fits(src.title) && d.specs && d.specs.sourceUrl) {
      const page = await codeFromPage(d.specs.sourceUrl);
      pageStatus = page.status;
      if (page.code && page.code !== storedCode) {
        const alt = await fetchSource(page.code, tipo);
        if (fits(alt.title) || (!src.ok && alt.ok)) {
          src = alt;
          code = page.code;
          reanchored = true;
        }
      }
    }

    const dbKeys = (d.images || []).map(assetKey).filter(Boolean);
    const shopKeys = (d.shopifyImages || [])
      .map((s) => assetKey(s.shopifyUrl || s.sourceUrl))
      .filter(Boolean);
    const srcSet = new Set(src.images);
    const dbSet = new Set(dbKeys);
    const hosts = [
      ...new Set(
        (d.images || []).map((u) => {
          try {
            return new URL(u).hostname;
          } catch {
            return "(bad)";
          }
        }),
      ),
    ];

    done += 1;
    if (done % 25 === 0) process.stdout.write("  " + done + "/" + docs.length + "\r");

    return {
      id: String(d._id),
      name: d.name,
      storedCode,
      code,
      reanchored,
      pageStatus,
      sourceUrl: (d.specs && d.specs.sourceUrl) || "",
      dbArticleSap: (d.specs && d.specs.articleSap) || "",
      srcTitle: src.title,
      srcSap: src.sap,
      titleMatch: src.title ? fits(src.title) : null,
      srcFound: src.ok,
      nDb: dbKeys.length,
      nShop: shopKeys.length,
      nSrc: src.images.length,
      imageHosts: hosts,
      missingFromDb: src.images.filter((k) => !dbSet.has(k)),
      extraInDb: dbKeys.filter((k) => !srcSet.has(k)),
      dbVsShopMismatch:
        JSON.stringify([...dbKeys].sort()) !== JSON.stringify([...shopKeys].sort()),
    };
  });

  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));

  const ok = rows.filter((r) => !r.error);
  const n = ok.length;
  const errored = rows.length - n;
  const srcMissing = ok.filter((r) => !r.srcFound).length;
  const titleBad = ok.filter((r) => r.srcFound && r.titleMatch === false).length;
  const imgExact = ok.filter(
    (r) => r.srcFound && !r.missingFromDb.length && !r.extraInDb.length,
  ).length;
  const imgPartial = ok.filter(
    (r) => r.srcFound && (r.missingFromDb.length || r.extraInDb.length),
  ).length;
  const imgNone = ok.filter(
    (r) => r.srcFound && r.nSrc > 0 && r.nDb > 0 && r.extraInDb.length === r.nDb,
  ).length;
  const hostBad = ok.filter((r) =>
    r.imageHosts.some((h) => h !== "cdn.shopify.com"),
  ).length;
  const shopMismatch = ok.filter((r) => r.dbVsShopMismatch).length;

  const reanchored = ok.filter((r) => r.reanchored).length;

  console.log("\n=== PORCELANOSA image audit (" + n + " products, " + errored + " errored) ===");
  console.log("stored source code stale (re-anchored)  : " + reanchored);
  console.log("source lookup failed (code not on site) : " + srcMissing);
  console.log("name != source title                    : " + titleBad);
  console.log("images identical to source              : " + imgExact);
  console.log("images partially differ from source     : " + imgPartial);
  console.log("  of which share NO image with source   : " + imgNone);
  console.log("images[] not served from cdn.shopify.com: " + hostBad);
  console.log("images[] != shopifyImages[]             : " + shopMismatch);
  console.log("report -> " + OUT);
  await mongoose.disconnect();
})();
