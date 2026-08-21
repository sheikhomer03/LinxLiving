/**
 * Mirror Pooky's customer-facing PDFs into public/pooky/literature.
 *
 * pooky.com publishes no catalogue or brochure PDF — the "brochure sign up"
 * page posts a printed one — so what exists is the Care Guide and the
 * Sustainability report, found by scripts/scan-pooky-media.cjs.
 *
 * The Care Guide has three URLs and they are not interchangeable. The FAQ
 * bulbs page links two different revisions of it at once, whose bytes differ,
 * so both are kept and named by upload date rather than one being assumed a
 * duplicate. The third, a 2019 edition on blog.pooky.com, is still linked from
 * three articles but 404s — it is listed here so the failure stays visible
 * rather than being quietly dropped from the set.
 *
 * Product instruction sheets are already local under public/pooky/downloads
 * and are not touched here.
 *
 *   node scripts/download-pooky-literature.cjs
 *   FORCE=1  re-download files already on disk
 */
const fs = require("fs");
const path = require("path");

const FORCE = process.env.FORCE === "1";
const OUT = path.join(__dirname, "..", "public", "pooky", "literature");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MANIFEST = path.join(__dirname, "pooky-literature-manifest.json");

const FILES = [
  {
    name: "pooky-care-guide.pdf",
    label: "Pooky Care Guide (latest upload, July 2026)",
    url: "https://cdn.shopify.com/s/files/1/0550/1075/4765/files/Updated_Pooky_Care_Guide_250625_7d37514b-b09e-437b-bb8d-61edc0acee2b.pdf?v=1783681686",
  },
  {
    name: "pooky-care-guide-2025-06.pdf",
    label: "Pooky Care Guide (June 2025 upload — linked from the same page)",
    url: "https://cdn.shopify.com/s/files/1/0550/1075/4765/files/Updated_Pooky_Care_Guide_250625.pdf?v=1750851514",
  },
  {
    name: "pooky-care-guide-2019.pdf",
    label: "Pooky Care Guide (2019 edition — dead upstream, expected to fail)",
    url: "https://blog.pooky.com/wp-content/uploads/2019/11/Pooky-Care-Guide.pdf",
  },
  {
    name: "pooky-sustainability-report-2025.pdf",
    label: "Pooky Sustainability Report v2.5 (May 2025)",
    url: "https://cdn.shopify.com/s/files/1/0550/1075/4765/files/2025-05-22_Sustainability_report_V.2.5.pdf?v=1749464481",
  },
];

/** An error page is HTML and still has length — only trust a real PDF header. */
const isPdf = (buf) =>
  buf.length > 1024 && buf.subarray(0, 5).toString("latin1") === "%PDF-";

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
    : {};

  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (const f of FILES) {
    const dest = path.join(OUT, f.name);
    if (!FORCE && fs.existsSync(dest) && isPdf(fs.readFileSync(dest))) {
      manifest[f.url] = `/pooky/literature/${f.name}`;
      skipped++;
      console.log(`  SKIP  ${f.name}  (already on disk)`);
      continue;
    }
    let buf = null;
    let note = "";
    for (let attempt = 1; attempt <= 3 && !buf; attempt++) {
      try {
        const res = await fetch(f.url, { headers: { "User-Agent": UA, Accept: "*/*" } });
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
      console.log(`  FAIL  ${f.name}  ${note}`);
      continue;
    }
    fs.writeFileSync(dest, buf);
    manifest[f.url] = `/pooky/literature/${f.name}`;
    saved++;
    console.log(`  SAVE  ${f.name}  ${Math.round(buf.length / 1024)}KB  — ${f.label}`);
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nSaved ${saved}, skipped ${skipped}, failed ${failed} → public/pooky/literature`);
  console.log(`Manifest written to scripts/${path.basename(MANIFEST)}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
