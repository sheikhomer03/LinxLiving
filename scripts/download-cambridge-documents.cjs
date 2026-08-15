/**
 * Mirror the PDFs cambridgeskylights.co.uk links to.
 *
 * The site hosts none of them itself — every link points at a manufacturer:
 * FAKRO's own manual library, VELUX's CDN, and Dow's datasheet viewer. That is
 * the same hotlink exposure that has already cost us five dead Porcelanosa
 * files, and it matters more here because 129 of 149 `/fakro/downloads/…`
 * paths our products reference are already missing from disk.
 *
 * FAKRO's own files land under public/fakro/documents so they sit with the
 * brand; everything else goes to public/cambridge-skylights/documents, since
 * VELUX and Dow literature is not FAKRO's.
 *
 * Driven by scripts/cambridge-media-scan.json.
 *
 *   node scripts/download-cambridge-documents.cjs
 *   DRY=1    list what would be fetched
 *   FORCE=1  re-download files already on disk
 */
const fs = require("fs");
const path = require("path");

const DRY = process.env.DRY === "1";
const FORCE = process.env.FORCE === "1";
const SCAN = path.join(__dirname, "cambridge-media-scan.json");
const ROOT = path.join(__dirname, "..");
const MANIFEST = path.join(__dirname, "cambridge-document-manifest.json");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Manuals our products reference but no cambridgeskylights page links, so the
 * scan cannot see them. Their URLs follow the same two FAKRO library paths as
 * the linked ones and were confirmed to return a PDF before being listed here.
 */
const EXTRA_FAKRO_MANUALS = [
  "https://www.fakro.co.uk/att/COMMON/prof/roofer/fitting%20instructions/DEF_FAKRO.pdf",
  "https://www.fakro.co.uk/att/COMMON/offer/servis/user_manuals/TYPE_F_FAKRO.pdf",
];

/** An error page is HTML and still has length — only trust a real PDF header. */
const isPdf = (buf) =>
  buf.length > 1024 && buf.subarray(0, 5).toString("latin1") === "%PDF-";

/** FAKRO's literature belongs with the FAKRO brand; other makers' does not. */
function destDirFor(url) {
  return /(^|\.)fakro\.co\.uk$/i.test(new URL(url).host)
    ? { dir: path.join(ROOT, "public", "fakro", "documents"), pub: "/fakro/documents" }
    : {
        dir: path.join(ROOT, "public", "cambridge-skylights", "documents"),
        pub: "/cambridge-skylights/documents",
      };
}

/**
 * Dow serves its datasheets through a viewer page whose `docPath` query holds
 * the real file, so the basename has to come from there rather than the path.
 */
function sourceFileName(url) {
  const u = new URL(url);
  const docPath = u.searchParams.get("docPath");
  const raw = decodeURIComponent(path.basename(docPath || u.pathname));
  return raw
    .replace(/\.pdf$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() + ".pdf";
}

async function main() {
  if (!fs.existsSync(SCAN)) {
    throw new Error(`Missing ${SCAN} — run scripts/scan-cambridge-media.cjs first`);
  }
  const scan = JSON.parse(fs.readFileSync(SCAN, "utf8"));
  const urls = [...Object.keys(scan.pdfs || {}), ...EXTRA_FAKRO_MANUALS];
  if (!urls.length) {
    console.log("No PDFs in the scan — nothing to download.");
    return;
  }

  const manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
    : {};
  console.log(`${urls.length} PDF(s) from the scan\n`);

  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (const url of urls) {
    const { dir, pub } = destDirFor(url);
    const name = sourceFileName(url);
    const dest = path.join(dir, name);
    const publicPath = `${pub}/${name}`;

    if (DRY) {
      console.log(`  would fetch  ${publicPath}\n        ${url}`);
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });

    if (!FORCE && fs.existsSync(dest) && isPdf(fs.readFileSync(dest))) {
      manifest[url] = publicPath;
      skipped++;
      console.log(`  SKIP  ${name}  (already on disk)`);
      continue;
    }

    let buf = null;
    let note = "";
    for (let attempt = 1; attempt <= 3 && !buf; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
          redirect: "follow",
        });
        const body = Buffer.from(await res.arrayBuffer());
        if (res.ok && isPdf(body)) {
          buf = body;
          break;
        }
        note = `http=${res.status} ${body.length}B${res.ok ? " (not a PDF)" : ""}`;
      } catch (e) {
        note = String(e.message).slice(0, 60);
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 3000));
    }

    if (!buf) {
      failed++;
      console.log(`  FAIL  ${name}  ${note}`);
      continue;
    }
    fs.writeFileSync(dest, buf);
    manifest[url] = publicPath;
    saved++;
    console.log(`  SAVE  ${publicPath}  ${Math.round(buf.length / 1024)}KB`);
  }

  if (!DRY) {
    fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\nSaved ${saved}, skipped ${skipped}, failed ${failed}`);
    console.log(`Manifest written to scripts/${path.basename(MANIFEST)}`);
    if (failed) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
