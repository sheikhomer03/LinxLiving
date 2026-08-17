/**
 * Mirror every PDF found on likewisefloors.com into public/likewise/documents.
 *
 * The site publishes no brochure or catalogue — see scripts/scan-likewise-media.cjs
 * — so what this pulls down is the six Likewise Group corporate documents: a
 * cookie policy and five privacy notices.
 *
 * Worth knowing before these get linked anywhere: they describe Likewise
 * Group's own data processing, CCTV and recruitment, not the flooring. Served
 * from our domain they would read as our policies, so they are stored as
 * supplier reference material and deliberately not attached to any product.
 *
 * Driven by scripts/likewise-media-scan.json, so re-running after a wider scan
 * picks up anything new without editing a list here.
 *
 *   node scripts/download-likewise-documents.cjs
 *   FORCE=1  re-download files already on disk
 */
const fs = require("fs");
const path = require("path");

const FORCE = process.env.FORCE === "1";
const SCAN = path.join(__dirname, "likewise-media-scan.json");
const OUT = path.join(__dirname, "..", "public", "likewise", "documents");
const MANIFEST = path.join(__dirname, "likewise-document-manifest.json");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** An error page is HTML and still has length — only trust a real PDF header. */
const isPdf = (buf) =>
  buf.length > 1024 && buf.subarray(0, 5).toString("latin1") === "%PDF-";

function fileNameFor(url) {
  const base = decodeURIComponent(path.basename(new URL(url).pathname));
  return base
    .replace(/\.pdf$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() + ".pdf";
}

async function main() {
  if (!fs.existsSync(SCAN)) {
    throw new Error(`Missing ${SCAN} — run scripts/scan-likewise-media.cjs first`);
  }
  const scan = JSON.parse(fs.readFileSync(SCAN, "utf8"));
  const urls = Object.keys(scan.pdfs || {}).map((u) =>
    u.startsWith("http") ? u : new URL(u, "https://likewisefloors.com").href,
  );
  if (!urls.length) {
    console.log("No PDFs in the scan — nothing to download.");
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
    : {};

  console.log(`${urls.length} PDF(s) from the scan\n`);
  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (const url of urls) {
    const name = fileNameFor(url);
    const dest = path.join(OUT, name);
    const publicPath = `/likewise/documents/${name}`;

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
          headers: { "User-Agent": UA, Accept: "*/*" },
          redirect: "follow",
        });
        const body = Buffer.from(await res.arrayBuffer());
        if (res.ok && isPdf(body)) {
          buf = body;
          break;
        }
        note = `http=${res.status} ${body.length}B`;
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
    console.log(`  SAVE  ${name}  ${Math.round(buf.length / 1024)}KB`);
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nSaved ${saved}, skipped ${skipped}, failed ${failed} → public/likewise/documents`);
  console.log(`Manifest written to scripts/${path.basename(MANIFEST)}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
