/**
 * Mirror the documents Noken products link into public/noken.
 *
 * Nothing was ever mirrored for this brand: 3,279 distinct files sit on
 * products as supplier URLs, so every download link on a Noken PDP is a
 * hotlink. Noken is a Porcelanosa Grupo brand and most of that literature is
 * served from catalogos.porcelanosagrupo.com, with the rest on noken.com.
 *
 * PDFs only, by the same reasoning applied to Porcelanosa: the set also holds
 * 1,189 .dwg drawings and 507 .zip render packs, which run to several GB and
 * are a poor fit for a Next.js public/ tree. They stay hotlinked. Pass
 * GROUPS=all to take them too.
 *
 * Files land in documents/<type>/ — ptec (technical drawings), idm
 * (installation), explode (exploded views), usuario, mant, garantia — mirroring
 * how public/porcelanosa is laid out.
 *
 * Reads scripts/_tmp-noken-doc-urls.json, written by the survey that pulled
 * these URLs off the products.
 *
 *   node scripts/download-noken-documents.cjs
 *   GROUPS=pdf | all   (default pdf)
 *   DRY=1              list what would be fetched
 *   CONCURRENCY=3
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SRC = path.join(__dirname, "_tmp-noken-doc-urls.json");
const PUBLIC = path.join(__dirname, "..", "public", "noken");
const MANIFEST = path.join(__dirname, "noken-document-manifest.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DRY = process.env.DRY === "1";
const GROUPS = String(process.env.GROUPS || "pdf").toLowerCase();
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 120000);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const extOf = (u) => (u.split("?")[0].split(".").pop() || "").toLowerCase();

/** Their paths carry the document type: /recursos/pdf/<type>/files/x.pdf */
function typeOf(url) {
  const m = /\/(?:recursos|resources)\/(?:extra\/)?(?:pdf|cad)\/([^/]+)\//i.exec(url);
  return (m ? m[1] : "misc").replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "misc";
}

function safeName(url) {
  const base = decodeURIComponent(url.split("?")[0].split("/").pop() || "file");
  return (
    base
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "file.pdf"
  );
}

/** An error page is HTML and still has length — only trust a real header. */
function looksReal(buf, ext) {
  if (buf.length < 512) return false;
  const head = buf.subarray(0, 5).toString("latin1");
  if (ext === "pdf") return head === "%PDF-";
  if (ext === "zip") return head.startsWith("PK");
  return !/^\s*<(!doctype|html)/i.test(buf.subarray(0, 60).toString("latin1"));
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await worker(items[i++]);
    }),
  );
}

/** What the brand folder already holds, keyed by content not by name. */
function existingByHash(root) {
  const map = new Map();
  if (!fs.existsSync(root)) return map;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else map.set(crypto.createHash("md5").update(fs.readFileSync(full)).digest("hex"), full);
    }
  };
  walk(root);
  return map;
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`No URL list at ${SRC}`);
  const all = JSON.parse(fs.readFileSync(SRC, "utf8")).all || [];

  const wanted = all.filter((u) => (GROUPS === "all" ? true : extOf(u) === "pdf"));
  const skipped = all.length - wanted.length;

  const jobs = new Map();
  for (const url of wanted) {
    const dir = path.join("documents", typeOf(url));
    const rel = path.join(dir, safeName(url)).replace(/\\/g, "/");
    if (!jobs.has(rel)) jobs.set(rel, { url, rel });
  }

  const have = existingByHash(PUBLIC);
  const missing = [...jobs.values()].filter((j) => !fs.existsSync(path.join(PUBLIC, j.rel)));

  const byType = {};
  for (const j of missing) byType[j.rel.split("/")[1]] = (byType[j.rel.split("/")[1]] || 0) + 1;

  console.log(`${all.length} document URL(s) referenced by Noken products`);
  console.log(`${wanted.length} in scope (${GROUPS}), ${skipped} left hotlinked (CAD / render packs)`);
  console.log(`${jobs.size} distinct destination(s), ${missing.length} not yet on disk`);
  console.log("by type:", byType);

  if (DRY) {
    for (const m of missing.slice(0, 25)) console.log(`  would fetch  ${m.rel}`);
    if (missing.length > 25) console.log(`  …and ${missing.length - 25} more`);
    return;
  }
  if (!missing.length) {
    console.log("Nothing to download.");
    return;
  }

  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
  let saved = 0;
  let duplicate = 0;
  let failed = 0;
  let bytes = 0;
  const failures = [];

  console.log(`\nDownloading ${missing.length} file(s)…`);
  await mapPool(missing, CONCURRENCY, async (j) => {
    const ext = extOf(j.url);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(j.url, {
          headers: { "User-Agent": UA, Accept: "*/*", Referer: "https://www.noken.com/" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const buf = Buffer.from(await res.arrayBuffer());
        if (!res.ok || !looksReal(buf, ext)) {
          if (res.status === 404) throw new Error(`http=404 ${buf.length}B`);
          throw new Error(`http=${res.status} ${buf.length}B`);
        }
        const h = crypto.createHash("md5").update(buf).digest("hex");
        const hit = have.get(h);
        if (hit) {
          manifest[j.url] = `/noken/${path.relative(PUBLIC, hit).replace(/\\/g, "/")}`;
          duplicate++;
          return;
        }
        const dest = path.join(PUBLIC, j.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        have.set(h, dest);
        manifest[j.url] = `/noken/${j.rel}`;
        bytes += buf.length;
        saved++;
        return;
      } catch (e) {
        if (attempt === 3 || /http=404/.test(String(e.message))) {
          failed++;
          failures.push({ rel: j.rel, url: j.url, error: String(e.message).slice(0, 70) });
          return;
        }
        await delay(attempt * 2000);
      }
    }
  });

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  if (failures.length)
    fs.writeFileSync(
      path.join(__dirname, "_tmp-noken-doc-failures.json"),
      `${JSON.stringify(failures, null, 2)}\n`,
    );

  console.log(
    `\nSaved ${saved}, ${duplicate} already held under another name, ${failed} failed` +
      ` — ${(bytes / 1024 / 1024).toFixed(0)}MB → public/noken/documents`,
  );
  if (failures.length) console.log("Failures in scripts/_tmp-noken-doc-failures.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
