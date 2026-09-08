/**
 * Repair PORCELANOSA Grupo galleries against the live Product Finder.
 *
 * Two faults are fixed together:
 *
 *  1. Wrong product's photos. The Product Finder re-numbered its
 *     `productoagrupacion` codes after the August import, so a stored code now
 *     resolves to a neighbouring product — "Boulder Negro Marquina" was showing
 *     the Boulder Grey shot. The product page URL never moved, so it is used to
 *     re-anchor the code before anything is pulled.
 *
 *  2. Duplicated gallery entries. The importer kept both `imgcom/high/X.jpg`
 *     and `img/high/X.jpg`, which are the commercial and article renderings of
 *     the same photograph, so most galleries carried each shot twice. Only the
 *     commercial copy is kept here.
 *
 * The new gallery is written to Mongo and reconciled onto Shopify with the same
 * application code the admin uses, so the CDN copies in `shopifyImages` — which
 * is what the storefront actually renders — are rebuilt too.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-porcelanosa-images.cjs
 *
 *   DRY=1            report what would change, write nothing
 *   LIMIT=25         stop after N products (a rehearsal)
 *   IDS=a,b,c        only these Mongo product ids
 *   ALL=1            consider every product, not just the audited mismatches
 *   RESUME=1         skip products already done in a previous run
 *   CONCURRENCY=3    products in flight at once
 *   MAX_IMAGES=16    gallery cap
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const DRY = process.env.DRY === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const ALL = process.env.ALL === "1";
const RESUME = process.env.RESUME === "1";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 3);
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES) || 16);
const CODE = String(process.env.CODE || "").trim();
const IDS = String(process.env.IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const BASE = "https://productfinder.porcelanosagrupo.com";
const BRAND_ID = "6a6b9647d17a2adf5d0d2b35";
const AUDIT = path.join(__dirname, "_tmp-porce-image-audit.json");
const PROGRESS = path.join(__dirname, ".porce-image-fix-progress.json");
const FAILURES = path.join(__dirname, "_tmp-porce-image-fix-failures.json");
const ROLLBACK = path.join(
  __dirname,
  "..",
  "rollback-porcelanosa-images-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json",
);

process.env.SHOPIFY_MAX_CONCURRENCY =
  process.env.SHOPIFY_MAX_CONCURRENCY || String(CONCURRENCY * 2);
process.env.SHOPIFY_MIN_GAP_MS = process.env.SHOPIFY_MIN_GAP_MS || "0";

// --- Product Finder client ------------------------------------------------

const jar = {};
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const INT = String.fromCharCode(39) + "INT" + String.fromCharCode(39);

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

/** The site moved these endpoints from form-encoded to JSON bodies. */
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
  absorb(await fetch(BASE + "/en/product_finder.html", { headers: { "User-Agent": UA } }));
}

async function codeFromPage(url) {
  const headers = { "User-Agent": UA, Accept: "text/html" };
  if (Object.keys(jar).length) headers.Cookie = cookieHeader();
  const res = await fetch(url, { headers });
  absorb(res);
  if (!res.ok) return "";
  const html = await res.text();
  const m = html.match(/name="pgproductoagrupacion"\s+value="([^"]*)"/i);
  return m ? m[1] : "";
}

function absImage(rel) {
  const r = String(rel || "").replace(/^\/+/, "");
  if (!r) return "";
  if (/^https?:\/\//i.test(r)) return r;
  if (r.startsWith("resources/")) return BASE + "/" + r;
  return BASE + "/resources/" + r;
}

function assetKey(url) {
  let b = String(url || "").split("?")[0].split("/").pop() || "";
  b = b.replace(/\.(jpe?g|png|webp|gif)$/i, "");
  b = b.replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "");
  b = b.replace(/_\d{3}$/, "");
  return b.toUpperCase();
}
function norm(s) {
  return String(s || "").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * The gallery the Product Finder holds for one grouping code.
 *
 * `Imagen` (commercial) and `ImagenArticulo` (article) are the same photograph
 * rendered twice; keeping both is what put every shot in the gallery twice, so
 * the first spelling of each asset wins and the second is dropped.
 */
async function fetchSourceGallery(code, tipoproducto) {
  const base = {
    idioma: "3",
    unidades: INT,
    productoagrupacion: String(code),
    codigosap: "",
  };

  const t = await postJson("pgficha2titulo.php", base);
  const title = norm(t.Titulo && t.Titulo[0] ? t.Titulo[0].Descripcion : "");

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
  const sap = String(
    refs.Productos && refs.Productos[0] ? refs.Productos[0].CodigoSAP : "",
  ).trim();

  const withSap = Object.assign({}, base, { codigosap: sap });
  const seen = new Set();
  const urls = [];
  const push = (rel) => {
    const url = absImage(rel);
    if (!url) return;
    const key = assetKey(url);
    if (!key || seen.has(key)) return;
    seen.add(key);
    urls.push(url);
  };

  const img = await postJson("pgficha2imagen.php", withSap);
  for (const row of img.Imagen || []) {
    push(row.Imagen);
    push(row.ImagenArticulo);
  }

  // Lifestyle shots need the article SAP; the grouping code alone returns [].
  const amb = await postJson("pgficha2ambientes.php", withSap);
  for (const row of amb.Ambientes || []) {
    push(String(row.Ruta || "") + String(row.Fichero || ""));
  }

  return { title, sap, urls: urls.slice(0, MAX_IMAGES) };
}

// --- helpers --------------------------------------------------------------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function mapPool(items, limit, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

async function main() {
  const { register } = require("tsx/cjs/api");
  register();

  const mongoose = require("mongoose");
  const { connectMongo } = require("./mongo-connect.cjs");
  const { reconcileProductMedia } = require("../src/lib/shopify/sync-media.ts");

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const products = db.collection("products");

  // Which products to touch. By default the ones the audit flagged; the audit
  // already carries the re-anchored code, which saves a page fetch each.
  const audit = readJson(AUDIT, []);
  const auditById = new Map(audit.map((r) => [r.id, r]));
  let targetIds;
  if (IDS.length) {
    targetIds = IDS;
  } else if (ALL || !audit.length) {
    targetIds = null;
  } else {
    targetIds = audit
      .filter(
        (r) =>
          !r.error &&
          r.srcFound &&
          r.titleMatch !== false &&
          (r.missingFromDb.length || r.extraInDb.length),
      )
      .map((r) => r.id);
  }

  const query = { brand: new mongoose.Types.ObjectId(BRAND_ID) };
  if (targetIds) {
    query._id = { $in: targetIds.map((id) => new mongoose.Types.ObjectId(id)) };
  }
  let docs = await products
    .find(query, {
      projection: {
        name: 1,
        images: 1,
        shopifyImages: 1,
        shopifyProductId: 1,
        "specs.porcelanosaCode": 1,
        "specs.tipoproducto": 1,
        "specs.sourceUrl": 1,
      },
    })
    .toArray();

  const done = new Set(RESUME ? readJson(PROGRESS, { done: [] }).done : []);
  if (done.size) docs = docs.filter((d) => !done.has(String(d._id)));
  if (docs.length > LIMIT) docs = docs.slice(0, LIMIT);

  console.log(
    (DRY ? "[DRY RUN] " : "") +
      "Repairing " + docs.length + " PORCELANOSA products (concurrency " + CONCURRENCY + ")",
  );

  await ensureSession();

  const rollback = [];
  const failures = [];
  const stats = {
    fixed: 0,
    unchanged: 0,
    recoded: 0,
    skippedNoSource: 0,
    skippedIdentity: 0,
    failed: 0,
    imagesBefore: 0,
    imagesAfter: 0,
    mediaUploaded: 0,
    mediaDeleted: 0,
  };
  let seen = 0;

  await mapPool(docs, CONCURRENCY, async (d) => {
    const id = String(d._id);
    const label = d.name;
    const dbName = norm(d.name);
    const fits = (t) => Boolean(t) && (dbName.includes(t) || t.includes(dbName));
    const row = auditById.get(id);
    const tipo = d.specs && d.specs.tipoproducto;

    try {
      // Trust the audit's re-anchored code, else resolve it now.
      let code = row && row.code ? String(row.code) : String((d.specs && d.specs.porcelanosaCode) || "");
      let src = code ? await fetchSourceGallery(code, tipo) : { title: "", urls: [] };
      let urlAnchored = false;

      // A code resolved by hand. Both anchors have failed for a handful of
      // products — Porcelanosa renamed the article and its page URL now points
      // at a neighbour — so the operator supplies the code and takes the
      // identity decision with it.
      if (CODE) {
        code = CODE;
        src = await fetchSourceGallery(code, tipo);
        urlAnchored = true;
        console.log("  [override] " + label + " -> code " + code + ' = "' + src.title + '"');
      } else if (!fits(src.title) && d.specs && d.specs.sourceUrl) {
        const live = await codeFromPage(d.specs.sourceUrl);
        if (live) {
          const alt = live === code ? src : await fetchSourceGallery(live, tipo);
          // A series-level page ("Persia", "Ele") carries no article title, so
          // there is nothing to match a name against. The page URL is the
          // anchor in that case: it belongs to this product and names the code.
          if (fits(alt.title) || !alt.title) {
            src = alt;
            code = live;
            urlAnchored = !alt.title;
          }
        }
      }

      // Never overwrite a gallery on a product we cannot positively identify —
      // that is exactly how the wrong photos got there in the first place.
      if (!fits(src.title) && !urlAnchored) {
        stats.skippedIdentity += 1;
        failures.push({ id, name: label, reason: "identity unconfirmed", srcTitle: src.title, code });
        return;
      }
      if (!src.urls.length) {
        stats.skippedNoSource += 1;
        failures.push({ id, name: label, reason: "source has no images", code });
        return;
      }

      const before = d.images || [];
      const same =
        before.length === src.urls.length &&
        before.every((u, i) => u === src.urls[i]);
      if (same) {
        stats.unchanged += 1;
        // The gallery was already right, but the code that found it may not be
        // the one on record — leaving that stale is what breaks the next run.
        const stored = String((d.specs && d.specs.porcelanosaCode) || "");
        if (!DRY && code && code !== stored) {
          rollback.push({ id, name: label, images: before, shopifyImages: d.shopifyImages || [], porcelanosaCode: stored });
          await products.updateOne(
            { _id: d._id },
            {
              $set: {
                "specs.porcelanosaCode": code,
                "specs.sku": code,
                "specs.productCode": code,
                "specs.articleSap": src.sap || "",
                updatedAt: new Date(),
              },
            },
          );
          stats.recoded += 1;
        }
        return;
      }

      stats.imagesBefore += before.length;
      stats.imagesAfter += src.urls.length;

      if (DRY) {
        stats.fixed += 1;
        if (stats.fixed <= 10) {
          console.log(
            "  [dry] " + label + " code " + (d.specs && d.specs.porcelanosaCode) + " -> " + code +
              " | images " + before.length + " -> " + src.urls.length,
          );
        }
        return;
      }

      rollback.push({
        id,
        name: label,
        images: before,
        shopifyImages: d.shopifyImages || [],
        porcelanosaCode: (d.specs && d.specs.porcelanosaCode) || "",
      });

      await products.updateOne(
        { _id: d._id },
        {
          $set: {
            images: src.urls,
            "specs.porcelanosaCode": code,
            "specs.sku": code,
            "specs.productCode": code,
            "specs.articleSap": src.sap || "",
            "specs.imagesRefreshedAt": new Date().toISOString(),
            updatedAt: new Date(),
          },
        },
      );

      // Rebuild the Shopify gallery so the CDN copies the storefront reads are
      // the new photographs, not the old ones.
      if (d.shopifyProductId) {
        const { links, uploaded, deleted } = await reconcileProductMedia(
          d.shopifyProductId,
          src.urls,
          d.shopifyImages || [],
        );
        stats.mediaUploaded += uploaded;
        stats.mediaDeleted += deleted;
        await products.updateOne(
          { _id: d._id },
          { $set: { shopifyImages: links, shopifySyncedAt: new Date(), shopifySyncError: "" } },
        );
      }

      done.add(id);
      stats.fixed += 1;
    } catch (e) {
      stats.failed += 1;
      failures.push({ id, name: label, reason: String(e.message).slice(0, 300) });
    } finally {
      seen += 1;
      if (seen % 10 === 0) {
        process.stdout.write("  " + seen + "/" + docs.length + " fixed=" + stats.fixed + "\r");
        if (!DRY) {
          fs.writeFileSync(PROGRESS, JSON.stringify({ at: new Date().toISOString(), done: [...done] }));
          fs.writeFileSync(ROLLBACK, JSON.stringify(rollback, null, 2));
        }
      }
    }
  });

  if (!DRY) {
    fs.writeFileSync(PROGRESS, JSON.stringify({ at: new Date().toISOString(), done: [...done] }));
    fs.writeFileSync(ROLLBACK, JSON.stringify(rollback, null, 2));
  }
  fs.writeFileSync(FAILURES, JSON.stringify(failures, null, 2));

  console.log("\n\n=== " + (DRY ? "DRY RUN " : "") + "summary ===");
  console.log("galleries rebuilt        : " + stats.fixed);
  console.log("already correct          : " + stats.unchanged + " (stale code corrected on " + stats.recoded + ")");
  console.log("skipped, identity unclear: " + stats.skippedIdentity);
  console.log("skipped, no source images: " + stats.skippedNoSource);
  console.log("failed                   : " + stats.failed);
  console.log("images " + stats.imagesBefore + " -> " + stats.imagesAfter);
  if (!DRY) {
    console.log("shopify media uploaded   : " + stats.mediaUploaded);
    console.log("shopify media deleted    : " + stats.mediaDeleted);
    console.log("rollback -> " + ROLLBACK);
  }
  if (failures.length) console.log("failures -> " + FAILURES);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
