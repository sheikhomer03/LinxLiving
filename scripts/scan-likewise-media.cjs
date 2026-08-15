/**
 * Find every brochure, catalogue and video likewisefloors.com exposes.
 *
 * The site is WordPress/WooCommerce and its sitemap lists no downloads page,
 * so anything downloadable is either linked from a content page or attached to
 * a product — typically as a /wp-content/uploads/*.pdf. Both are scanned, plus
 * the range and collection pages, which is where a flooring brand usually puts
 * its collection brochures.
 *
 * Writes scripts/likewise-media-scan.json.
 *
 *   node scripts/scan-likewise-media.cjs
 *   PRODUCTS=200   how many product pages to sample (0 = all)
 *   CONCURRENCY=4
 */
const fs = require("fs");
const path = require("path");

const BASE = "https://likewisefloors.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OUT = path.join(__dirname, "likewise-media-scan.json");
const PRODUCTS = process.env.PRODUCTS === undefined ? 200 : Number(process.env.PRODUCTS);
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

const PDF_RE = /https?:\/\/[^"'\s<>]+\.pdf(?:\?[^"'\s<>]*)?|\/[^"'\s<>]+\.pdf(?:\?[^"'\s<>]*)?/gi;
const VIDEO_RE =
  /(?:https?:)?\/\/[^"'\s<>]*(?:\.(?:mp4|webm|mov|m3u8)|youtube\.com\/embed|youtu\.be\/|player\.vimeo\.com|wistia\.(?:net|com))[^"'\s<>]*/gi;
/** Words a brochure link would use even when the href is opaque. */
const WORD_RE = /\b(brochure|catalogue|catalog|lookbook|datasheet|data sheet|spec sheet|specification sheet|download)\b/gi;

async function main() {
  const report = { pdfs: {}, videos: {}, words: {}, pagesScanned: 0, errors: [] };

  const index = await get(`${BASE}/sitemap_index.xml`);
  const maps = locs(index);

  // Content pages, plus category / collection / range listings.
  let pages = [];
  for (const m of maps.filter((u) => !/product-sitemap/.test(u))) {
    try {
      pages.push(...locs(await get(m)));
    } catch (e) {
      report.errors.push(`${m}: ${e.message}`);
    }
  }

  // A sample of product pages — a datasheet would hang off these.
  let productUrls = [];
  for (const m of maps.filter((u) => /product-sitemap/.test(u))) {
    try {
      productUrls.push(...locs(await get(m)).filter((u) => u.includes("/product/")));
    } catch (e) {
      report.errors.push(`${m}: ${e.message}`);
    }
  }
  const sample = PRODUCTS > 0 ? productUrls.slice(0, PRODUCTS) : productUrls;

  const targets = [...new Set([...pages, ...sample])];
  console.log(
    `Scanning ${pages.length} content/listing page(s) + ` +
      `${sample.length} of ${productUrls.length} product page(s)\n`,
  );

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
    for (const m of html.matchAll(PDF_RE)) (report.pdfs[m[0]] ||= []).push(u);
    for (const m of html.matchAll(VIDEO_RE)) (report.videos[m[0]] ||= []).push(u);
    for (const m of html.matchAll(WORD_RE)) {
      const w = m[0].toLowerCase();
      (report.words[w] ||= new Set()).add(u);
    }
    if (++done % 100 === 0) console.log(`  ${done}/${targets.length}`);
  });

  for (const k of Object.keys(report.words)) report.words[k] = [...report.words[k]];
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nPages scanned: ${report.pagesScanned}, errors: ${report.errors.length}`);
  console.log(`=== PDFs: ${Object.keys(report.pdfs).length}`);
  for (const [u, on] of Object.entries(report.pdfs)) console.log(`   ${u}  (on ${on.length} page(s))`);
  console.log(`=== Videos: ${Object.keys(report.videos).length}`);
  for (const [u, on] of Object.entries(report.videos).slice(0, 20))
    console.log(`   ${u.slice(0, 110)}  (on ${on.length})`);
  console.log(`=== Brochure-ish words seen:`);
  for (const [w, on] of Object.entries(report.words))
    console.log(`   "${w}" on ${on.length} page(s), e.g. ${on[0]}`);
  console.log(`\nWritten to scripts/${path.basename(OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
