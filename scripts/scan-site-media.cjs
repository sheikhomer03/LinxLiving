/**
 * Sitemap-driven scan for a supplier site's brochures, catalogues and videos.
 *
 * Generalised from the per-supplier scanners (Likewise, Cambridge, Pooky):
 * every one of those walks a sitemap, pulls PDF hrefs and video embeds, and
 * separates content pages from product pages. Only the base URL differed, so
 * new sites use this instead of another copy.
 *
 * Content pages are always scanned. Product pages are sampled — supplier sites
 * run to thousands and a datasheet, when it exists, is usually linked from the
 * range page rather than each variant. PRODUCTS=0 scans them all; do that
 * before concluding a site has nothing, since a 250-product sample of Pooky
 * missed 88 products that carried video.
 *
 *   BASE=https://mbdecor.co.uk NAME=mbdecor node scripts/scan-site-media.cjs
 *   PRODUCTS=300   product pages to sample (0 = all, default 300)
 *   CONCURRENCY=4
 */
const fs = require("fs");
const path = require("path");

const BASE = (process.env.BASE || "").replace(/\/+$/, "");
const NAME = process.env.NAME || (BASE ? new URL(BASE).host.replace(/\W+/g, "-") : "");
if (!BASE) throw new Error("Set BASE, e.g. BASE=https://mbdecor.co.uk");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OUT = path.join(__dirname, `${NAME}-media-scan.json`);
const PRODUCTS = process.env.PRODUCTS === undefined ? 300 : Number(process.env.PRODUCTS);
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
 * Real video sources only. A theme loading `player.vimeo.com/api/player.js` or
 * YouTube's iframe_api says nothing about whether the site has a video, and
 * matching those reports one on every page of a site that has none.
 */
const VIDEO_RE =
  /(?:https?:)?\/\/(?:[^"'\s<>\\]*\.(?:mp4|webm|mov|m3u8)(?![a-z0-9])(?:\?[^"'\s<>\\]*)?|www\.youtube\.com\/embed\/[\w-]+|youtu\.be\/[\w-]+|player\.vimeo\.com\/video\/\d+|fast\.wistia\.(?:net|com)\/embed\/[\w-]+)/gi;

/** Sitemap URLs that list products rather than content. */
const PRODUCT_MAP_RE = /product(?:s)?-?\d*\.xml|posts-product|sitemap_products/i;

async function findSitemaps() {
  for (const candidate of ["/sitemap_index.xml", "/sitemap.xml", "/wp-sitemap.xml"]) {
    try {
      const xml = await get(`${BASE}${candidate}`);
      const found = locs(xml);
      if (found.length) return found;
    } catch {
      /* try the next well-known location */
    }
  }
  throw new Error("No sitemap found");
}

async function main() {
  const report = { base: BASE, pdfs: {}, videos: {}, pagesScanned: 0, errors: [] };

  const maps = await findSitemaps();
  const contentMaps = maps.filter((u) => !PRODUCT_MAP_RE.test(u));
  const productMaps = maps.filter((u) => PRODUCT_MAP_RE.test(u));

  let pages = [`${BASE}/`];
  for (const m of contentMaps) {
    try {
      pages.push(...locs(await get(m)));
    } catch (e) {
      report.errors.push(`${m}: ${e.message}`);
    }
  }

  let productUrls = [];
  for (const m of productMaps) {
    try {
      productUrls.push(...locs(await get(m)));
    } catch (e) {
      report.errors.push(`${m}: ${e.message}`);
    }
  }
  const sample = PRODUCTS > 0 ? productUrls.slice(0, PRODUCTS) : productUrls;
  const targets = [...new Set([...pages, ...sample])];
  console.log(
    `${BASE}\n${pages.length} content page(s) + ${sample.length} of ` +
      `${productUrls.length} product page(s)\n`,
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
    // Inline JSON escapes its slashes; unescape so URLs match.
    const text = html.replace(/\\\//g, "/");
    for (const m of text.matchAll(PDF_RE)) (report.pdfs[m[0]] ||= []).push(u);
    for (const m of text.matchAll(VIDEO_RE)) (report.videos[m[0]] ||= []).push(u);
    if (++done % 100 === 0) console.log(`  ${done}/${targets.length}`);
  });

  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nPages scanned: ${report.pagesScanned}, errors: ${report.errors.length}`);
  console.log(`=== PDFs: ${Object.keys(report.pdfs).length}`);
  for (const [u, on] of Object.entries(report.pdfs).slice(0, 60))
    console.log(`   ${u}\n        on ${on.length} page(s), e.g. ${on[0]}`);
  console.log(`=== Videos: ${Object.keys(report.videos).length}`);
  for (const [u, on] of Object.entries(report.videos).slice(0, 40))
    console.log(`   ${u}\n        on ${on.length} page(s), e.g. ${on[0]}`);
  console.log(`\nWritten to scripts/${path.basename(OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
