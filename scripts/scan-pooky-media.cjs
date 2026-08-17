/**
 * Find every brochure, catalogue and video pooky.com exposes.
 *
 * Two surfaces to check, because they fail differently:
 *
 *  - Content pages. Read from the sitemap rather than guessed at, then scanned
 *    for PDF links and for video embeds (Shopify CDN, YouTube, Vimeo, Wistia).
 *  - Product media. Shopify's /products.json omits video entirely, so a
 *    product that carries one looks image-only there. The per-product .js
 *    endpoint does return it, so media types are sampled that way.
 *
 * Writes scripts/pooky-media-scan.json.
 *
 *   node scripts/scan-pooky-media.cjs
 *   PRODUCTS=300   how many products to sample for video media (0 = all)
 *   CONCURRENCY=4
 */
const fs = require("fs");
const path = require("path");

const BASE = "https://www.pooky.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OUT = path.join(__dirname, "pooky-media-scan.json");
const PRODUCT_SAMPLE = process.env.PRODUCTS === undefined ? 300 : Number(process.env.PRODUCTS);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);

async function get(url, { json = false } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: json ? "application/json,*/*" : "text/html,*/*" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return json ? res.json() : res.text();
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
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    m[1].replace(/&amp;/g, "&"),
  );

/** Anything that would play as a video, from any of the hosts Shopify allows. */
const VIDEO_RE =
  /(?:https?:)?\/\/[^"'\s<>]*(?:\.(?:mp4|webm|mov|m3u8)|youtube\.com\/embed|youtu\.be\/|player\.vimeo\.com|wistia\.(?:net|com))[^"'\s<>]*/gi;
const PDF_RE = /(?:https?:)?\/\/[^"'\s<>]+\.pdf(?:\?[^"'\s<>]*)?|\/[^"'\s<>]+\.pdf(?:\?[^"'\s<>]*)?/gi;

async function main() {
  const report = { pages: [], pdfs: {}, videos: {}, productsSampled: 0, productsWithVideo: [] };

  // ---- content pages -------------------------------------------------
  const index = await get(`${BASE}/sitemap.xml`);
  const pageMaps = locs(index).filter((u) => /sitemap_pages|sitemap_blogs/.test(u));
  let pages = [`${BASE}/`];
  for (const m of pageMaps) pages.push(...locs(await get(m)));
  pages = [...new Set(pages)];
  console.log(`Scanning ${pages.length} content page(s)…`);

  await mapPool(pages, CONCURRENCY, async (u) => {
    let html;
    try {
      html = await get(u);
    } catch (e) {
      report.pages.push({ url: u, error: String(e.message) });
      return;
    }
    const pdfs = [...new Set([...html.matchAll(PDF_RE)].map((m) => m[0]))];
    const vids = [...new Set([...html.matchAll(VIDEO_RE)].map((m) => m[0]))]
      // Shopify ships a tiny placeholder poster loop on some themes; keep all,
      // and let the report show what they are.
      .filter((v) => !/\.mp4$/i.test(v) || !/placeholder/i.test(v));
    for (const p of pdfs) (report.pdfs[p] ||= []).push(u);
    for (const v of vids) (report.videos[v] ||= []).push(u);
    report.pages.push({ url: u, pdfs: pdfs.length, videos: vids.length });
  });

  // ---- product media -------------------------------------------------
  const prodMaps = locs(index).filter((u) => /sitemap_products/.test(u));
  let handles = [];
  for (const m of prodMaps) {
    handles.push(
      ...locs(await get(m))
        .filter((u) => u.includes("/products/"))
        .map((u) => u.split("/products/")[1].split("?")[0]),
    );
  }
  handles = [...new Set(handles)];
  const sample = PRODUCT_SAMPLE > 0 ? handles.slice(0, PRODUCT_SAMPLE) : handles;
  console.log(`Sampling ${sample.length} of ${handles.length} product(s) for video media…`);

  let done = 0;
  await mapPool(sample, CONCURRENCY, async (h) => {
    try {
      const j = await get(`${BASE}/products/${h}.js`, { json: true });
      const nonImage = (j.media || []).filter((m) => m.media_type !== "image");
      if (nonImage.length) {
        report.productsWithVideo.push({ handle: h, media: nonImage });
        console.log(`  VIDEO  ${h}  ${nonImage.map((m) => m.media_type).join(",")}`);
      }
    } catch {
      /* a delisted handle 404s; not interesting */
    }
    report.productsSampled++;
    if (++done % 100 === 0) console.log(`  ${done}/${sample.length}`);
  });

  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\n=== PDFs found: ${Object.keys(report.pdfs).length}`);
  for (const [u, on] of Object.entries(report.pdfs)) console.log(`   ${u}  (on ${on.length} page(s))`);
  console.log(`=== Videos found: ${Object.keys(report.videos).length}`);
  for (const [u, on] of Object.entries(report.videos).slice(0, 30))
    console.log(`   ${u.slice(0, 120)}  (on ${on.length} page(s))`);
  console.log(`=== Products with non-image media: ${report.productsWithVideo.length}/${report.productsSampled}`);
  console.log(`\nWritten to scripts/${path.basename(OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
