/**
 * Download the documents a captured shop links, into `public/`.
 *
 * Drench and Tap Warehouse serve datasheets, installation guides and cleaning
 * instructions from `/file/<Kind>/<hash path>.pdf`. Hotlinking those would
 * leave the storefront depending on a competitor's CDN staying up and keeping
 * the path stable, so each file is fetched once and served from our own
 * `public/product-files/<site>/` instead.
 *
 * The stored name keeps the source hash. Those names are already unique and
 * content-addressed, so a re-run re-downloads nothing and two products
 * sharing a guide share one file.
 *
 * Reads the capture JSONL; writes files plus a manifest mapping source URL to
 * local path, which the importer uses to fill `Product.downloads`.
 *
 * Env:
 *   SITE=name     which capture (default "drench")
 *   CONCURRENCY=n parallel downloads (default 4)
 *   DRY_RUN=1     report what would be fetched
 *   LIMIT=n       stop after n files
 */
const path = require("path");
const fs = require("fs");

const SITE = process.env.SITE || "drench";
const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 4, 8));

const DATA =
  process.env.GIBE_DATA ||
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/a167de67-d47a-4f6e-aa8a-c11dee9e30bc/scratchpad";

const PDP_FILE = path.join(DATA, SITE + "-pdp.jsonl");
const OUT_DIR = path.join(__dirname, "..", "public", "product-files", SITE);
const MANIFEST = path.join(DATA, SITE + "-files-manifest.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Keep the source's content hash; drop anything a filesystem would object to. */
function safeName(filename) {
  return String(filename || "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 150);
}

async function download(url, dest, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
      signal: AbortSignal.timeout(60000),
    });
    if (res.status === 429 || res.status >= 500) throw new Error("HTTP " + res.status);
    if (!res.ok) return { error: "HTTP " + res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { error: "empty" };
    fs.writeFileSync(dest, buf);
    return { bytes: buf.length };
  } catch (e) {
    if (attempt >= 3) return { error: String(e.message || e).slice(0, 160) };
    await sleep(1000 * Math.pow(2, attempt));
    return download(url, dest, attempt + 1);
  }
}

async function pool(items, worker, n) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await worker(items[i++]);
    }),
  );
}

async function main() {
  if (!fs.existsSync(PDP_FILE)) throw new Error("no capture at " + PDP_FILE);

  // Every distinct document across the capture.
  const byUrl = new Map();
  let products = 0;
  for (const line of fs.readFileSync(PDP_FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.skipped) continue;
    products += 1;
    for (const d of r.downloads || []) {
      if (!d.url || byUrl.has(d.url)) continue;
      byUrl.set(d.url, { ...d, products: 1 });
    }
  }

  const files = [...byUrl.values()];
  console.log("site       : " + SITE);
  console.log("products   : " + products);
  console.log("documents  : " + files.length + " distinct");
  const kinds = {};
  for (const f of files) kinds[f.kind || "(none)"] = (kinds[f.kind || "(none)"] || 0) + 1;
  for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
    console.log("   " + String(k).padEnd(28) + n);
  }
  console.log("");
  console.log("destination: public/product-files/" + SITE + "/");
  console.log(DRY_RUN ? "MODE: DRY RUN" : "MODE: LIVE");
  console.log("");
  if (DRY_RUN) {
    files.slice(0, 5).forEach((f) => console.log("  [dry] " + safeName(f.filename).slice(0, 80)));
    process.exit(0);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
    : {};

  let done = 0, saved = 0, skipped = 0, failed = 0, bytes = 0;
  const todo = files.slice(0, LIMIT);

  await pool(todo, async (f) => {
    const name = safeName(f.filename);
    const dest = path.join(OUT_DIR, name);
    done += 1;

    // Content-addressed names: a file already here is the same file.
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      manifest[f.url] = { path: "/product-files/" + SITE + "/" + name, kind: f.kind, label: f.label };
      skipped += 1;
    } else {
      const r = await download(f.url, dest);
      if (r.error) {
        failed += 1;
        if (failed <= 8) console.log("  FAIL " + name.slice(0, 60) + " -> " + r.error);
      } else {
        saved += 1;
        bytes += r.bytes;
        manifest[f.url] = { path: "/product-files/" + SITE + "/" + name, kind: f.kind, label: f.label };
      }
    }
    if (done % 100 === 0 || done === todo.length) {
      console.log("  " + done + "/" + todo.length + "  saved " + saved +
        "  already had " + skipped + "  failed " + failed);
    }
  }, CONCURRENCY);

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  console.log("");
  console.log("saved      : " + saved + "  (" + (bytes / 1048576).toFixed(1) + " MB)");
  console.log("already had: " + skipped);
  console.log("failed     : " + failed);
  console.log("manifest   : " + MANIFEST);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
