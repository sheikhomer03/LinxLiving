/**
 * Find the brochures, catalogues and site videos on cambridgeskylights.co.uk.
 *
 * Deliberately scoped to content — pages, collections and blog articles — and
 * not to /products/. Product-level datasheets are already mirrored under
 * public/fakro/downloads; what this is after is the site's own literature and
 * the videos it embeds on guide pages, which nothing has collected.
 *
 * Shopify renders these pages server-side, so a plain fetch sees the markup;
 * the per-product .js endpoint that Pooky needed is not required here.
 *
 * Writes scripts/cambridge-media-scan.json.
 *
 *   node scripts/scan-cambridge-media.cjs
 *   CONCURRENCY=4
 */
const fs = require("fs");
const path = require("path");

const BASE = "https://cambridgeskylights.co.uk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OUT = path.join(__dirname, "cambridge-media-scan.json");
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);

async function get(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*", "Accept-Language": "en-GB,en;q=0.9" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await worker(items[i++]);
    }),
  );
}

const locs = (xml) =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));

const PDF_RE = /https?:\/\/[^"'\s<>\\]+\.pdf(?:\?[^"'\s<>\\]*)?/gi;
/**
 * Real video sources only. `player.vimeo.com/api/player.js` and YouTube's
 * iframe_api are libraries a theme loads everywhere — matching those would
 * report a video on every page of a site that has none.
 */
const VIDEO_RE =
  /(?:https?:)?\/\/(?:[^"'\s<>\\]*\.(?:mp4|webm|mov|m3u8)(?:\?[^"'\s<>\\]*)?|www\.youtube\.com\/embed\/[\w-]+|youtu\.be\/[\w-]+|player\.vimeo\.com\/video\/\d+|fast\.wistia\.(?:net|com)\/embed\/[\w-]+)/gi;

async function main() {
  const report = { pdfs: {}, videos: {}, pagesScanned: 0, errors: [] };

  const index = await get(`${BASE}/sitemap.xml`);
  const maps = locs(index).filter((u) => !/sitemap_products|agentic/.test(u));

  let targets = [`${BASE}/`];
  for (const m of maps) {
    try {
      targets.push(...locs(await get(m)));
    } catch (e) {
      report.errors.push(`${m}: ${e.message}`);
    }
  }
  targets = [...new Set(targets)].filter((u) => !u.includes("/products/"));
  console.log(`Scanning ${targets.length} content page(s)\n`);

  let done = 0;
  await mapPool(targets, CONCURRENCY, async (u) => {
    let html;
    try {
      html = await get(u);
    } catch (e) {
      report.errors.push(`${u}: ${e.message}`);
      return;
    }
    report.pagesScanned++;
    // Shopify escapes URLs inside inline JSON, so unescape before matching.
    const text = html.replace(/\\\//g, "/");
    for (const m of text.matchAll(PDF_RE)) (report.pdfs[m[0]] ||= []).push(u);
    for (const m of text.matchAll(VIDEO_RE)) (report.videos[m[0]] ||= []).push(u);
    if (++done % 25 === 0) console.log(`  ${done}/${targets.length}`);
  });

  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nPages scanned: ${report.pagesScanned}, errors: ${report.errors.length}`);
  console.log(`=== PDFs: ${Object.keys(report.pdfs).length}`);
  for (const [u, on] of Object.entries(report.pdfs))
    console.log(`   ${u}\n        on ${on.length} page(s), e.g. ${on[0]}`);
  console.log(`=== Videos: ${Object.keys(report.videos).length}`);
  for (const [u, on] of Object.entries(report.videos))
    console.log(`   ${u}\n        on ${on.length} page(s), e.g. ${on[0]}`);
  console.log(`\nWritten to scripts/${path.basename(OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
