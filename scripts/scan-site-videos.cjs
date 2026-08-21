/**
 * Every video a supplier site references, and which pages carry it.
 *
 *   BASE=https://likewisefloors.com NAME=likewise node scripts/scan-site-videos.cjs
 *   PRODUCTS=0     product pages to sample (0 = all, default 0)
 *   CONCURRENCY=6
 *   MAX_PAGES=4000 crawl-mode cap only; a sitemap scan is never capped
 *
 * Wider than the video half of scripts/scan-site-media.cjs, which only matches
 * absolute `//host/…` sources and so cannot see a root-relative
 * `/wp-content/uploads/x.mp4`, a page-builder background video, or a plain
 * `vimeo.com/123` link. That script reported "no videos" on sites that have
 * them.
 *
 * With no sitemap the script crawls links instead, breadth-first from the
 * homepage — fakro.com is a hand-built CMS that publishes none of the three
 * usual sitemap paths, and a scan that gives up there sees one page. Crawl
 * mode is capped by MAX_PAGES and says so in the report when it hits the cap.
 *
 * Product pages are reported separately rather than dropped: a film that
 * appears only under /product/ is gallery media and belongs to the product,
 * while one on a range or about page is marketing footage the homepage rail
 * can use.
 */
const fs = require("fs");
const path = require("path");

const BASE = (process.env.BASE || "").replace(/\/+$/, "");
if (!BASE) throw new Error("Set BASE, e.g. BASE=https://likewisefloors.com");
const NAME = process.env.NAME || new URL(BASE).host.replace(/\W+/g, "-");
const OUT = path.join(__dirname, `${NAME}-video-scan.json`);
const PRODUCTS = process.env.PRODUCTS === undefined ? 0 : Number(process.env.PRODUCTS);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const RETRIES = Number(process.env.RETRIES || 5);
const MAX_PAGES = Number(process.env.MAX_PAGES || 4000);
/**
 * Pause between requests, in ms — set it to whatever the site's robots.txt
 * asks for. ukbifolddoorfactory.co.uk publishes `Crawl-delay: 10`, and a
 * fifteen-page site is not worth ignoring a stated request over.
 */
const GAP = Number(process.env.GAP || 0);
/**
 * Force link-crawling even where a sitemap exists. A sitemap is a claim about
 * what a site wants indexed, not an inventory of its pages — a Yoast install
 * publishing only a page-sitemap says nothing about the posts.
 */
const MODE = process.env.MODE || "auto";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** [pattern, kind]; capture group 1 is the id for embed kinds. */
const PATTERNS = [
  [/(?:https?:\/\/[^"'\s<>\)]+|\/[^"'\s<>\)]*)\.(?:mp4|webm|mov|m4v|m3u8)(?:\?[^"'\s<>\)]*)?/gi, "file"],
  [/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/gi, "youtube"],
  [/(?:www\.)?youtube\.com\/watch\?[^"'\s<>]*?v=([\w-]{6,})/gi, "youtube"],
  [/youtu\.be\/([\w-]{6,})/gi, "youtube"],
  [/player\.vimeo\.com\/video\/(\d{6,})/gi, "vimeo"],
  [/vimeo\.com\/(?:channels\/[^/"'\s]+\/)?(\d{6,})/gi, "vimeo"],
  [/fast\.wistia\.(?:net|com)\/embed\/(?:iframe|medias)\/([\w-]+)/gi, "wistia"],
  [/loom\.com\/(?:embed|share)\/([\w-]+)/gi, "loom"],
];

/**
 * Player libraries, sprites and analytics. A theme loading Vimeo's player.js
 * on every page says nothing about whether the site has a video — the previous
 * Likewise scan reported exactly that URL on 3,742 pages and nothing else.
 */
const NOISE =
  /iframe_api|api\/player\.js|\/player\.js|mediaelement|mejs|video-?js|plyr|jquery|\.min\.js|googletagmanager|doubleclick|analytics|\/embed\/iframe\.js|player\.vimeo\.com\/api/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Shopify rate-limits a sitemap-wide sweep hard: a first pass over
 * cambridgeskylights.co.uk at concurrency 6 lost 133 of 418 pages to HTTP 429,
 * and a scan that quietly drops a third of a site reports "no video" for pages
 * it never read. 429 and 5xx are retried with backoff, honouring Retry-After.
 */
async function get(url, attempt = 0) {
  if (GAP) await sleep(GAP);
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*", "Accept-Language": "en-GB,en;q=0.9" },
      redirect: "follow",
    });
  } catch (e) {
    // A dropped connection is not a verdict on the page. fakro.com sits behind
    // a gateway that connect-times-out or closes without a TLS close_notify
    // under any sustained load, which undici surfaces as a bare "fetch failed"
    // — an unretried run lost all 680 of its pages to it and reported the site
    // as having no video at all.
    if (attempt >= RETRIES) throw e;
    await sleep(1000 * 2 ** attempt);
    return get(url, attempt + 1);
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= RETRIES) throw new Error(`HTTP ${res.status} after ${RETRIES} retries`);
    const after = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt);
    return get(url, attempt + 1);
  }
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

/** Record every video `html` references against the page it came from. */
function scanHtml(url, html, report) {
  // Inline JSON escapes its slashes and entity-encodes its ampersands.
  const text = html.split(String.fromCharCode(92) + "/").join("/").replace(/&#0?38;|&amp;/g, "&");
  for (const [re, kind] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (NOISE.test(m[0])) continue;
      // Resolved against the page rather than BASE: a hand-built CMS links its
      // media the same way it links its pages, with ../ from where you stand.
      const key = kind === "file" ? new URL(m[0], url).href : kind + ":" + m[1];
      const rec = (report.videos[key] ||= { kind, pages: [] });
      if (!rec.pages.includes(url)) rec.pages.push(url);
    }
  }
}

const PRODUCT_MAP_RE = /product-sitemap|products?-?\d*\.xml|posts-product|sitemap_products/i;
/** WooCommerce puts products under /product/, Shopify under /products/. */
const isProductUrl = (u) => /\/products?\//.test(u);

/** Paths robots.txt commonly closes off, plus anything that is not a page. */
const SKIP_PATH = /\/(?:wp-admin|wp-json|author|print|cart|checkout|account)\//i;
const ASSET_EXT =
  /\.(?:css|js|json|xml|rss|png|jpe?g|gif|svg|webp|ico|pdf|zip|rar|dwg|dxf|docx?|xlsx?|pptx?|mp4|webm|mov|m4v|m3u8)$/i;

/**
 * Same-host page links, normalised.
 *
 * Query strings are dropped: fakro.com disallows `/*?*` in robots.txt, and on
 * a CMS of that shape a query only re-sorts a listing whose items are linked
 * plainly as well.
 */
function pageLinks(url, html) {
  const host = new URL(BASE).host;
  const out = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'>]+)["']/gi)) {
    let u;
    try { u = new URL(m[1], url); } catch { continue; }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    if (u.host !== host) continue;
    u.hash = "";
    u.search = "";
    if (SKIP_PATH.test(u.pathname) || ASSET_EXT.test(u.pathname)) continue;
    out.push(u.href);
  }
  return out;
}

/**
 * A page stripped of what differs between two loads of the same URL.
 *
 * fakro.com sits behind an F5 gateway that stamps a fresh anti-bot token into
 * every response, so two fetches of the homepage never match byte for byte.
 * Without stripping it the soft-404 check below never fires.
 */
const fingerprint = (html) =>
  html
    .replace(/<script id="f5_cspm">[\s\S]*?<\/script>/g, "")
    .replace(/f5avr\w+/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Breadth-first crawl, for sites that publish no sitemap.
 *
 * Guarded against soft 404s: fakro.com answers an unknown path with HTTP 200
 * and the homepage body, whose own relative links then resolve *under* that
 * bogus path — /nope/advice/, /nope/advice/architects/, on forever. Any page
 * whose fingerprint matches the homepage is therefore counted, contributes no
 * videos, and is never harvested for links.
 */
async function crawl(report) {
  const root = `${BASE}/`;
  const rootHtml = await get(root);
  const rootPrint = fingerprint(rootHtml);
  report.pagesScanned++;
  scanHtml(root, rootHtml, report);

  const seen = new Set([root]);
  let frontier = [];
  for (const l of pageLinks(root, rootHtml)) if (!seen.has(l)) { seen.add(l); frontier.push(l); }

  let soft404 = 0;
  while (frontier.length && report.pagesScanned < MAX_PAGES) {
    const batch = frontier.slice(0, MAX_PAGES - report.pagesScanned);
    const deferred = frontier.slice(batch.length);
    frontier = [];
    await mapPool(batch, CONCURRENCY, async (u) => {
      let html;
      try { html = await get(u); }
      catch (e) { report.errors.push(`${u}: ${e.message}`); return; }
      report.pagesScanned++;
      if (fingerprint(html) === rootPrint) { soft404++; return; }
      scanHtml(u, html, report);
      for (const l of pageLinks(u, html)) if (!seen.has(l)) { seen.add(l); frontier.push(l); }
      if (report.pagesScanned % 100 === 0) {
        console.log(`  ${report.pagesScanned} scanned, ${seen.size} known, ${Object.keys(report.videos).length} video(s)`);
      }
    });
    frontier.push(...deferred);
  }
  report.softNotFound = soft404;
  if (frontier.length) {
    const msg = `crawl stopped at MAX_PAGES=${MAX_PAGES} with ${frontier.length} link(s) unvisited`;
    report.errors.push(msg);
    console.log(`\n! ${msg}`);
  }
  console.log(`\ncrawled ${report.pagesScanned} page(s), ${soft404} of them soft 404s`);
}

async function main() {
  /**
   * A sitemap is either an index of other sitemaps or a flat list of pages,
   * and the two must not be confused. `<loc>`s under `<sitemapindex>` are
   * sitemaps to fetch; under `<urlset>` they are the pages themselves.
   *
   * Treating a urlset as an index is not a small mistake: fakro.com's flat
   * sitemap holds 680 page URLs, so the discovery loop re-fetched all 680
   * serially, found no `<loc>` in any of them (they are HTML), and scanned
   * the homepage alone — after half an hour of looking busy.
   */
  let maps = [];
  let flatPages = [];
  for (const c of MODE === "crawl" ? [] : ["/sitemap_index.xml", "/sitemap.xml", "/wp-sitemap.xml"]) {
    let xml;
    try { xml = await get(`${BASE}${c}`); } catch { continue; }
    const found = locs(xml);
    if (!found.length) continue;               // a soft-404 HTML page, most often
    if (/<sitemapindex/i.test(xml)) maps = found;
    else flatPages = found;
    break;
  }

  const haveSitemap = maps.length > 0 || flatPages.length > 0;
  const report = { base: BASE, mode: haveSitemap ? "sitemap" : "crawl", pagesScanned: 0, errors: [], videos: {} };

  if (!haveSitemap) {
    console.log(`${BASE}\nno sitemap — crawling links, up to ${MAX_PAGES} page(s)\n`);
    await crawl(report);
  } else {
    const pages = [`${BASE}/`];
    const productUrls = [];
    // A flat sitemap names no child maps to classify by, so each URL is sorted
    // on its own path instead.
    for (const u of flatPages) (isProductUrl(u) ? productUrls : pages).push(u);
    for (const m of maps) {
      let urls = [];
      try { urls = locs(await get(m)); }
      catch (e) { report.errors.push(`${m}: ${e.message}`); continue; }
      if (PRODUCT_MAP_RE.test(m)) productUrls.push(...urls);
      else pages.push(...urls);
    }
    const sample = PRODUCTS > 0 ? productUrls.slice(0, PRODUCTS) : productUrls;
    const targets = [...new Set([...pages, ...sample])];
    console.log(`${BASE}\n${pages.length} content page(s) + ${sample.length} of ${productUrls.length} product page(s)\n`);

    let done = 0;
    await mapPool(targets, CONCURRENCY, async (u) => {
      let html;
      try { html = await get(u); }
      catch (e) { report.errors.push(`${u}: ${e.message}`); return; }
      report.pagesScanned++;
      scanHtml(u, html, report);
      if (++done % 200 === 0) console.log(`  ${done}/${targets.length}`);
    });
  }

  const rows = Object.entries(report.videos).map(([ref, v]) => ({
    ref,
    kind: v.kind,
    contentPages: v.pages.filter((p) => !isProductUrl(p)).length,
    productPages: v.pages.filter(isProductUrl).length,
    pages: v.pages.slice(0, 10),
  })).sort((a, b) => b.contentPages - a.contentPages || b.productPages - a.productPages);

  fs.writeFileSync(OUT, `${JSON.stringify({ ...report, summary: rows }, null, 2)}\n`);
  console.log(`\npages scanned: ${report.pagesScanned}, errors: ${report.errors.length}`);
  console.log(`distinct videos: ${rows.length}\n`);
  for (const r of rows) {
    console.log(`[${r.kind}] ${r.ref}`);
    console.log(`    content pages: ${r.contentPages}, product pages: ${r.productPages}`);
    console.log(`    e.g. ${r.pages[0]}`);
  }
  console.log(`\n-> scripts/${path.basename(OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
