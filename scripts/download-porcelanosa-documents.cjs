/**
 * Mirror the documents scan-porcelanosa-documents.cjs found into public/porcelanosa.
 *
 * download-porcelanosa-catalogues.cjs only ever covered the catalogue and
 * dossier links the scrape had already stored on products. The finder exposes
 * far more per SAP code, in two shapes:
 *
 *   static     files sitting on their CDN — fixing instructions, maintenance,
 *              warranty, technical drawings, installation, exploded views,
 *              BIM/Revit, plus CAD and 3D model binaries
 *   generated  built on demand by pdfgenerator.porcelanosagrupo.com — the
 *              technical sheet, DoP, spare parts, aerator and extension sheets
 *
 * GROUPS decides what gets pulled. The default is everything a customer would
 * call literature or a product document; the CAD and 3D model binaries run to
 * several GB and are opt-in, since a Next.js public/ tree is a poor home for
 * 12MB .max files.
 *
 *   node scripts/download-porcelanosa-documents.cjs
 *   GROUPS=catalogues,dossiers,documents,sheets   (default)
 *   GROUPS=all      include the cad group as well
 *   DRY=1           list what would be fetched, download nothing
 *   FORCE=1         re-download files already on disk
 *   CONCURRENCY=3   their origin 500s in bursts; keep this low
 */
const fs = require("fs");
const path = require("path");

const SCAN = path.join(__dirname, "porcelanosa-document-scan.json");
const PUBLIC = path.join(__dirname, "..", "public", "porcelanosa");
const MANIFEST = path.join(__dirname, "porcelanosa-document-manifest.json");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REFERER = "https://productfinder.porcelanosagrupo.com/en/product_finder.html";

const DRY = process.env.DRY === "1";
const FORCE = process.env.FORCE === "1";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const GROUPS = String(process.env.GROUPS || "catalogues,dossiers,documents,sheets")
  .toLowerCase()
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const wants = (g) => GROUPS.includes("all") || GROUPS.includes(g);

/** Binary model formats, kept apart from the document groups by size alone. */
const CAD_EXT = new Set(["dwg", "max", "blend", "fbx", "zip", "jpg", "jpeg", "png"]);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** A 403 or a 500 still arrives as bytes — only trust a real file header. */
function looksReal(buf, ext) {
  if (buf.length < 512) return false;
  const head = buf.subarray(0, 5).toString("latin1");
  if (ext === "pdf") return head === "%PDF-";
  if (ext === "zip") return head.startsWith("PK");
  if (ext === "jpg" || ext === "jpeg") return buf[0] === 0xff && buf[1] === 0xd8;
  // .dwg/.max/.blend/.fbx have no header worth asserting; an HTML error page
  // would, so reject anything that starts like one.
  return !/^\s*<(!doctype|html)/i.test(buf.subarray(0, 60).toString("latin1"));
}

function extOf(url) {
  const clean = url.split("?")[0].split("#")[0];
  return (path.extname(clean).slice(1) || "pdf").toLowerCase();
}

/**
 * Their filenames carry spaces and accents; keep the stem recognisable but
 * safe on disk, and keep the extension the URL actually had.
 */
function safeName(stem, ext) {
  const base =
    String(stem)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "file";
  return `${base}.${ext}`;
}

/** Turn a scan row into the group it belongs to and where it lands on disk. */
function planStatic(row) {
  const ext = extOf(row.url);
  const stem = path.parse(decodeURIComponent(row.url.split("?")[0])).name;
  if (row.bucket === "catalogos")
    return { group: "catalogues", dir: "catalogues", name: safeName(stem, ext) };
  if (row.tipoDoc === "dosier")
    return { group: "dossiers", dir: "dossiers", name: safeName(stem, ext) };
  if (CAD_EXT.has(ext))
    return { group: "cad", dir: `cad/${row.tipoDoc || "misc"}`, name: safeName(stem, ext) };
  return {
    group: "documents",
    dir: `documents/${row.tipoDoc || "misc"}`,
    name: safeName(stem, ext),
  };
}

function planGenerated(row) {
  const kind = String(row.kind || "sheet").toLowerCase();
  return {
    group: "sheets",
    dir: `sheets/${kind}`,
    name: safeName(`${row.sap}_${kind}`, "pdf"),
  };
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await worker(items[i++]);
    }),
  );
}

/**
 * Their origin rate-limits: a burst comes back as an HTML 500, and the biggest
 * catalogues need well over two minutes. Both clear on a retry with a pause.
 */
async function download(url, dest, ext) {
  let note = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "*/*", Referer: REFERER },
        signal: AbortSignal.timeout(300000),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && looksReal(buf, ext)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        return buf.length;
      }
      note = `http=${res.status} ${buf.length}B`;
      if (res.status === 404) break;
    } catch (e) {
      note = String(e.message).split("\n")[0].slice(0, 50);
    }
    if (attempt < 4) await delay(attempt * 6000);
  }
  throw new Error(note || "failed");
}

async function main() {
  if (!fs.existsSync(SCAN))
    throw new Error("Run scripts/scan-porcelanosa-documents.cjs first");
  const scan = JSON.parse(fs.readFileSync(SCAN, "utf8"));
  const manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
    : {};

  const jobs = [];
  const seen = new Set();
  const add = (url, plan, title) => {
    if (!wants(plan.group)) return;
    const abs = path.join(PUBLIC, plan.dir, plan.name);
    if (seen.has(abs)) return;
    seen.add(abs);
    jobs.push({
      url,
      abs,
      title,
      group: plan.group,
      ext: extOf(url),
      publicPath: `/porcelanosa/${plan.dir}/${plan.name}`,
    });
  };

  for (const row of scan.statics) add(row.url, planStatic(row), row.title);
  for (const row of scan.generated) add(row.url, planGenerated(row), row.title);

  // The original catalogue mirror wrote bare hashes into catalogues/; those are
  // the same bytes under the same name, so they count as already present.
  const missing = jobs.filter(
    (j) => FORCE || !fs.existsSync(j.abs) || fs.statSync(j.abs).size === 0,
  );

  const tally = (rows) => {
    const t = {};
    for (const r of rows) t[r.group] = (t[r.group] || 0) + 1;
    return t;
  };
  console.log(`Groups: ${GROUPS.join(", ")}`);
  console.log(`On the site : ${jobs.length}`, tally(jobs));
  console.log(`Missing     : ${missing.length}`, tally(missing));

  if (DRY) {
    for (const m of missing.slice(0, 60)) console.log(`  would fetch  ${m.publicPath}`);
    if (missing.length > 60) console.log(`  …and ${missing.length - 60} more`);
    return;
  }
  if (!missing.length) {
    console.log("\nNothing to download.");
    return;
  }

  let saved = 0;
  let failed = 0;
  let bytes = 0;
  const failures = [];
  await mapPool(missing, CONCURRENCY, async (j) => {
    try {
      bytes += await download(j.url, j.abs, j.ext);
      manifest[j.url] = j.publicPath;
      saved++;
    } catch (e) {
      failed++;
      failures.push({ url: j.url, dest: j.publicPath, error: e.message });
    }
    if ((saved + failed) % 50 === 0)
      console.log(
        `  ${saved + failed}/${missing.length}  saved=${saved} failed=${failed} ` +
          `${(bytes / 1024 / 1024).toFixed(0)}MB`,
      );
  });

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  if (failures.length)
    fs.writeFileSync(
      path.join(__dirname, "_tmp-porcelanosa-doc-failures.json"),
      `${JSON.stringify(failures, null, 2)}\n`,
    );

  console.log(
    `\nSaved ${saved}, failed ${failed}, ` +
      `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB → public/porcelanosa`,
  );
  console.log(`Manifest written to scripts/${path.basename(MANIFEST)}`);
  if (failures.length)
    console.log("Failures listed in scripts/_tmp-porcelanosa-doc-failures.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
