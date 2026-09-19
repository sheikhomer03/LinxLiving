/**
 * Capture a Gibe shop's non-product pages: categories, CMS content, and the
 * BTU calculator.
 *
 * `capture-gibe.cjs` walks sitemap-products.xml and the nav. That leaves the
 * category pages (their own copy, SEO text and hero imagery), the CMS pages
 * from sitemap-content.xml, and — on Toasty — the site-wide BTU calculator,
 * which is a standalone tool rather than a per-product configurator.
 *
 * Crawl only: writes JSON to the capture directory and nothing to Mongo.
 * Listing grids render client-side against /api/*, which robots.txt
 * disallows, so only the server-rendered HTML is read.
 *
 * Env:
 *   SITE=name      which shop (default "toasty")
 *   CONCURRENCY=n  parallel fetches (default 3)
 *   GIBE_DATA=dir  capture directory
 */
const path = require("path");
const fs = require("fs");

const SITES = {
  toasty: "https://www.toasty.co.uk",
  drench: "https://www.drench.co.uk",
  tapwarehouse: "https://www.tapwarehouse.com",
};

const SITE = process.env.SITE || "toasty";
const ORIGIN = SITES[SITE];
if (!ORIGIN) throw new Error("unknown SITE: " + SITE);

const DATA = process.env.GIBE_DATA || path.join(__dirname, "..", ".capture");
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 3, 6));
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENTITIES = { "&amp;": "&", "&pound;": "\u00a3", "&quot;": '"', "&#39;": "'", "&nbsp;": " ", "&lt;": "<", "&gt;": ">" };
function clean(s) {
  let out = String(s || "").replace(/<[^>]*>/g, " ");
  for (const [e, c] of Object.entries(ENTITIES)) out = out.split(e).join(c);
  return out.replace(/\s+/g, " ").trim();
}

async function fetchText(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-GB,en;q=0.9" },
      signal: AbortSignal.timeout(45000),
    });
    if (res.status === 429 || res.status >= 500) throw new Error("HTTP " + res.status);
    if (!res.ok) return { error: "HTTP " + res.status };
    return { html: await res.text() };
  } catch (e) {
    if (attempt >= 4) return { error: String(e.message || e).slice(0, 200) };
    await sleep(1200 * Math.pow(2, attempt));
    return fetchText(url, attempt + 1);
  }
}

async function sitemapUrls(name) {
  const { html, error } = await fetchText(ORIGIN + "/" + name);
  if (error) throw new Error(name + ": " + error);
  return [...html.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

/** Inline <script type="application/json"> blobs, by id/class. */
function jsonBlobs(html) {
  const out = {};
  for (const m of html.matchAll(
    /<script[^>]*(?:id|class)="([^"]+)"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try { out[m[1]] = JSON.parse(m[2]); } catch { /* skip malformed */ }
  }
  return out;
}

function parsePage(html, url) {
  const meta = (n) => {
    const m = html.match(new RegExp('<meta[^>]*(?:name|property)="' + n + '"[^>]*content="([^"]*)"'));
    return m ? clean(m[1]) : "";
  };
  const ld = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { ld.push(JSON.parse(m[1])); } catch { /* skip */ }
  }
  const crumbs = ld.find((x) => x && x["@type"] === "BreadcrumbList");
  // The CMS body: the shop wraps editorial copy in .c-cms blocks.
  const cms = [...html.matchAll(/<div class="c-cms[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<\/div>)/g)]
    .map((m) => ({ html: m[1], text: clean(m[1]) }))
    .filter((b) => b.text.length > 40);

  return {
    url,
    h1: clean((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || ""),
    metaTitle: meta("title") || clean((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""),
    metaDescription: meta("description"),
    canonical: (html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"/) || [])[1] || url,
    breadcrumb: ((crumbs && crumbs.itemListElement) || []).map((x) => ({
      name: clean(x.name || (x.item && x.item.name) || ""),
      url: (x.item && x.item["@id"]) || "",
    })),
    cmsBlocks: cms,
    // Category pages advertise their child categories as links in the sub-nav.
    childLinks: [
      ...new Set(
        [...html.matchAll(/href="(\/c\/[^"?#]+)"/g)].map((m) => m[1]),
      ),
    ],
    productLinks: [
      ...new Set([...html.matchAll(/href="(\/p\/[^"?#]+)"/g)].map((m) => m[1])),
    ],
    jsonBlobs: jsonBlobs(html),
    heroImages: [
      ...new Set(
        [...html.matchAll(/(\/\/img\.[a-z0-9.-]+\/[^"'\s]+\.(?:jpg|jpeg|png|webp))/gi)].map(
          (m) => "https:" + m[1].split("?")[0],
        ),
      ),
    ].slice(0, 20),
    capturedAt: new Date().toISOString(),
  };
}

async function crawl(urls, label) {
  const out = [];
  let done = 0;
  let failed = 0;
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const url = urls[i++];
      const { html, error } = await fetchText(url);
      done += 1;
      if (error) { failed += 1; out.push({ url, error }); }
      else out.push(parsePage(html, url));
      process.stdout.write(`\r     ${label}: ${done}/${urls.length} · failed ${failed}`);
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");
  return out;
}

(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  console.log(`capture-gibe-pages · ${SITE} · ${ORIGIN}`);

  const cats = await sitemapUrls("sitemap-categories.xml");
  const content = await sitemapUrls("sitemap-content.xml");
  const extra = [ORIGIN + "/btu-calculator"];
  const contentAll = [...new Set([...content, ...extra])];
  console.log(`  ${cats.length} categories · ${contentAll.length} content pages`);

  const categories = await crawl(cats, "categories");
  const pages = await crawl(contentAll, "content");

  const catFile = path.join(DATA, SITE + "-categories.json");
  const pageFile = path.join(DATA, SITE + "-content.json");
  fs.writeFileSync(catFile, JSON.stringify(categories, null, 1));
  fs.writeFileSync(pageFile, JSON.stringify(pages, null, 1));

  const catFail = categories.filter((c) => c.error).length;
  const pageFail = pages.filter((p) => p.error).length;
  console.log(`\ncategories: ${categories.length} (${catFail} failed) -> ${catFile}`);
  console.log(`content:    ${pages.length} (${pageFail} failed) -> ${pageFile}`);
  if (catFail || pageFail) console.log("NOTE: failures recorded inline with an `error` key");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
