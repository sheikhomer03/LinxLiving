/**
 * Mirror MB Decor's brochures, catalogues and datasheets into public/mb-decor.
 *
 * Two sources, found differently:
 *
 *  - Brochures. /online-brochure/ links eight FlipPDF viewers, one per
 *    catalogue, and none of those viewer pages appears in the sitemap — a
 *    sitemap-driven scan misses all eight. Each viewer's javascript/config.js
 *    carries a `downloadconfig` naming the source PDF it was built from, which
 *    is what gets fetched here rather than the flipbook's page images.
 *  - Datasheets. /datasheets/ links one PDF per finish, ~200 of them.
 *
 *   node scripts/download-mbdecor-literature.cjs
 *   DRY=1          list what would be fetched
 *   FORCE=1        re-download files already on disk
 *   SKIP_SHEETS=1  brochures only
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DRY = process.env.DRY === "1";
const FORCE = process.env.FORCE === "1";
const SKIP_SHEETS = process.env.SKIP_SHEETS === "1";

const BASE = "https://mbdecor.co.uk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ROOT = path.join(__dirname, "..");
const BROCHURE_DIR = path.join(ROOT, "public", "mb-decor", "brochures");
const SHEET_DIR = path.join(ROOT, "public", "mb-decor", "datasheets");
const MANIFEST = path.join(__dirname, "mbdecor-literature-manifest.json");

/** An error page is HTML and still has length — only trust a real PDF header. */
const isPdf = (buf) =>
  buf.length > 1024 && buf.subarray(0, 5).toString("latin1") === "%PDF-";

/**
 * Node's fetch has no default timeout, so a stalled connection hangs the run
 * indefinitely rather than failing. Every request here is bounded.
 */
async function getText(url, ms = 45000) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function tidyName(raw) {
  return (
    decodeURIComponent(raw)
      .replace(/\.pdf$/i, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() + ".pdf"
  );
}

/** The eight flipbook viewers linked from /online-brochure/. */
async function findBrochures() {
  const html = await getText(`${BASE}/online-brochure/`);
  const slugs = [
    ...new Set(
      [...html.matchAll(/https?:\/\/mbdecor\.co\.uk\/brochure\/([a-z0-9-]+)\/?/gi)].map(
        (m) => m[1],
      ),
    ),
  ];
  const out = [];
  for (const slug of slugs) {
    const viewer = `${BASE}/brochure/${slug}/`;
    let cfg;
    try {
      cfg = await getText(`${viewer}javascript/config.js`);
    } catch (e) {
      console.log(`  NOTE  ${slug}: no config.js (${e.message})`);
      continue;
    }
    // downloadconfig = {"pdf":{"isOriginPath":true,"url":"files/….pdf",…
    const m = cfg.match(/downloadconfig\s*=\s*\{[^]*?"url"\s*:\s*"([^"]+\.pdf)"/i);
    const title = (cfg.match(/"bookTitle"\s*:\s*"([^"]*)"/i) || [])[1] || slug;
    if (!m) {
      console.log(`  NOTE  ${slug}: config.js has no source PDF`);
      continue;
    }
    const url = new URL(m[1].split("/").map(encodeURIComponent).join("/"), viewer).href;
    out.push({ slug, title, url, name: tidyName(path.basename(m[1])), size: await sizeOf(url) });
  }
  // Smallest first. The set runs from 7MB to 200MB over a ~1MB/s origin, and
  // leading with the largest means a stalled run delivers nothing at all.
  return out.sort((a, b) => (a.size || 0) - (b.size || 0));
}

/** Content-length via HEAD, so progress can be reported and jobs ordered. */
async function sizeOf(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(45000),
    });
    return Number(res.headers.get("content-length")) || 0;
  } catch {
    return 0;
  }
}

/** One datasheet PDF per finish, all linked from /datasheets/. */
async function findDatasheets() {
  const html = await getText(`${BASE}/datasheets/`);
  const urls = [
    ...new Set(
      [...html.matchAll(/https?:\/\/mbdecor\.co\.uk\/datasheet\/[^"'\s<>]+\.pdf/gi)].map(
        (m) => m[0],
      ),
    ),
  ];
  return urls.map((url) => ({ url, name: tidyName(path.basename(new URL(url).pathname)) }));
}

async function download(job, dir, pub, manifest, counts) {
  const dest = path.join(dir, job.name);
  const publicPath = `${pub}/${job.name}`;

  if (DRY) {
    console.log(`  would fetch  ${publicPath}\n        ${decodeURIComponent(job.url)}`);
    return;
  }
  if (!FORCE && fs.existsSync(dest) && isPdf(fs.readFileSync(dest))) {
    manifest[job.url] = publicPath;
    counts.skipped++;
    return;
  }

  // curl rather than fetch. These catalogues run to 200MB over a ~1MB/s
  // origin, and Node's fetch stalled mid-body with no way to notice: its
  // timeout bounds the whole request, so a transfer that simply stops sits
  // there until the deadline. curl resumes a part-file with -C and aborts a
  // stall via --speed-limit, which is exactly the behaviour this needs.
  let ok = false;
  let bytes = 0;
  let note = "";
  const tmp = `${dest}.part`;

  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    const have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
    if (have > 0) console.log(`        resuming at ${(have / 1048576).toFixed(0)}MB`);
    try {
      execFileSync(
        "curl",
        [
          "-sL",
          "-C", "-",
          "--speed-limit", "2048",
          "--speed-time", "60",
          "--max-time", "1800",
          "-A", UA,
          "-o", tmp,
          job.url,
        ],
        { stdio: "ignore" },
      );
    } catch (e) {
      note = `curl exit ${e.status ?? "?"}`;
    }

    if (fs.existsSync(tmp)) {
      bytes = fs.statSync(tmp).size;
      const head = Buffer.alloc(5);
      const fd = fs.openSync(tmp, "r");
      fs.readSync(fd, head, 0, 5, 0);
      fs.closeSync(fd);
      if (bytes > 1024 && head.toString("latin1") === "%PDF-") {
        ok = true;
        break;
      }
      // Bad content rather than a truncated transfer — resuming would append
      // to an error page, so this one starts over.
      note = note || `${bytes}B (not a PDF)`;
      fs.unlinkSync(tmp);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5000));
  }

  if (!ok) {
    counts.failed++;
    console.log(`  FAIL  ${job.name}  ${note}`);
    return;
  }
  fs.renameSync(tmp, dest);
  manifest[job.url] = publicPath;
  counts.saved++;
  console.log(
    `  SAVE  ${publicPath}  ${(bytes / 1048576).toFixed(1)}MB` +
      (job.title ? `  — ${job.title}` : ""),
  );
}

async function main() {
  const manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
    : {};
  const counts = { saved: 0, skipped: 0, failed: 0 };

  console.log("Finding brochures…");
  const brochures = await findBrochures();
  console.log(
    `${brochures.length} brochure(s), ` +
      `${(brochures.reduce((s, b) => s + (b.size || 0), 0) / 1048576).toFixed(0)}MB total\n`,
  );
  if (!DRY) fs.mkdirSync(BROCHURE_DIR, { recursive: true });
  for (const b of brochures) {
    console.log(`  → ${b.name}  (${(b.size / 1048576).toFixed(0)}MB)`);
    await download(b, BROCHURE_DIR, "/mb-decor/brochures", manifest, counts);
  }

  if (!SKIP_SHEETS) {
    console.log("\nFinding datasheets…");
    const sheets = await findDatasheets();
    console.log(`${sheets.length} datasheet(s)\n`);
    if (!DRY) fs.mkdirSync(SHEET_DIR, { recursive: true });
    let n = 0;
    for (const s of sheets) {
      await download(s, SHEET_DIR, "/mb-decor/datasheets", manifest, counts);
      if (++n % 50 === 0) console.log(`  …${n}/${sheets.length}`);
    }
  }

  if (!DRY) {
    fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `\nSaved ${counts.saved}, skipped ${counts.skipped}, failed ${counts.failed} → public/mb-decor`,
    );
    console.log(`Manifest written to scripts/${path.basename(MANIFEST)}`);
    if (counts.failed) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
