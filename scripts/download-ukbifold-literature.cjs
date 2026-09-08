/**
 * Mirror UK Bifold Door Factory's brochures and technical files into
 * public/uk-bifoldFactory/downloads.
 *
 * The site is a fifteen-page WordPress brochure site with no product post
 * type, so there is no /datasheets/ index and no flipbook viewer to unpick —
 * every PDF is an href on a range page. It is crawled rather than read from
 * the sitemap alone: Yoast lists fifteen pages, and a range page reachable
 * only from the nav would take its files with it. The crawl stays on the
 * site's own host and does not follow into wp-content, so it visits pages and
 * nothing else.
 *
 * Files are served from www.ukbifolddoorfactory.co.uk and from
 * ukbifold.wpengine.com, the WP Engine origin behind it — the pages reference
 * both. Either is fetched as it is written.
 *
 *   node scripts/download-ukbifold-literature.cjs
 *   DRY=1     list what would be fetched
 *   FORCE=1   re-download files already on disk
 *   DEPTH=2   crawl depth from the sitemap pages (default 2)
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DRY = process.env.DRY === "1";
const FORCE = process.env.FORCE === "1";
const DEPTH = Number(process.env.DEPTH || 2);

const BASE = "https://www.ukbifolddoorfactory.co.uk";
const HOSTS = new Set(["www.ukbifolddoorfactory.co.uk", "ukbifolddoorfactory.co.uk"]);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "uk-bifoldFactory", "downloads");
const PUBLIC = "/uk-bifoldFactory/downloads";
const MANIFEST = path.join(__dirname, "ukbifold-literature-manifest.json");

/** An error page is HTML and still has length — only trust a real PDF header. */
const isPdf = (buf) =>
  buf.length > 1024 && buf.subarray(0, 5).toString("latin1") === "%PDF-";

async function getText(url, ms = 45000) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
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

const locs = (xml) =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));

/** Yoast nests a sitemap index over one child map; take whichever answers. */
async function sitemapPages() {
  const out = new Set([`${BASE}/`]);
  for (const candidate of ["/sitemap_index.xml", "/sitemap.xml", "/wp-sitemap.xml"]) {
    let xml;
    try {
      xml = await getText(`${BASE}${candidate}`);
    } catch {
      continue;
    }
    for (const loc of locs(xml)) {
      if (/\.xml($|\?)/i.test(loc)) {
        try {
          for (const page of locs(await getText(loc))) out.add(page);
        } catch {
          /* a child map that will not load is covered by the crawl */
        }
      } else {
        out.add(loc);
      }
    }
    if (out.size > 1) break;
  }
  return [...out];
}

const PDF_RE = /https?:\/\/[^"'\s<>\\)]+\.pdf(?:\?[^"'\s<>\\)]*)?/gi;
const HREF_RE = /href\s*=\s*["']([^"'#]+)["']/gi;

/**
 * Walk the site collecting PDF hrefs and the page each was found on.
 *
 * The provenance matters at review time: a file whose only referrer is the
 * 2025 template page is last year's copy of one the live range page also
 * links, and knowing that is the difference between a duplicate and a gap.
 */
async function crawl(seeds) {
  const seen = new Set();
  const pdfs = new Map();
  let frontier = seeds;

  for (let depth = 0; depth <= DEPTH && frontier.length; depth++) {
    const next = new Set();
    for (const url of frontier) {
      const key = url.replace(/#.*$/, "").replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);

      let html;
      try {
        html = await getText(url);
      } catch (e) {
        console.log(`  NOTE  ${url}: ${e.message}`);
        continue;
      }
      // Inline JSON escapes its slashes; unescape so URLs match.
      const text = html.replace(/\\\//g, "/");

      for (const m of text.matchAll(PDF_RE)) {
        const clean = m[0].replace(/&amp;/g, "&");
        if (!pdfs.has(clean)) pdfs.set(clean, []);
        pdfs.get(clean).push(url);
      }

      if (depth === DEPTH) continue;
      for (const m of text.matchAll(HREF_RE)) {
        let link;
        try {
          link = new URL(m[1], url);
        } catch {
          continue;
        }
        if (!HOSTS.has(link.host)) continue;
        if (/\/wp-(content|admin|json|includes)\//.test(link.pathname)) continue;
        if (/\.(pdf|jpe?g|png|webp|svg|gif|mp4|zip|css|js)$/i.test(link.pathname)) continue;
        next.add(`${link.origin}${link.pathname}`);
      }
    }
    frontier = [...next];
  }

  console.log(`crawled ${seen.size} page(s), found ${pdfs.size} PDF(s)\n`);
  return [...pdfs].map(([url, pages]) => ({
    url,
    pages: [...new Set(pages)],
    name: tidyName(path.basename(new URL(url).pathname)),
  }));
}

function download(job, manifest, counts) {
  const dest = path.join(OUT_DIR, job.name);
  const publicPath = `${PUBLIC}/${job.name}`;

  if (DRY) {
    console.log(`  would fetch  ${publicPath}`);
    console.log(`        ${decodeURIComponent(job.url)}`);
    console.log(`        linked from ${job.pages.length} page(s), e.g. ${job.pages[0]}`);
    return;
  }
  if (!FORCE && fs.existsSync(dest) && isPdf(fs.readFileSync(dest))) {
    manifest[job.url] = publicPath;
    counts.skipped++;
    return;
  }

  // curl rather than fetch, for the same reason the MB Decor mirror uses it:
  // its timeout bounds the whole request, so a transfer that simply stops sits
  // there until the deadline instead of failing. --speed-limit aborts a stall.
  const tmp = `${dest}.part`;
  let ok = false;
  let bytes = 0;
  let note = "";

  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    try {
      execFileSync(
        "curl",
        [
          "-sL",
          "--speed-limit", "2048",
          "--speed-time", "60",
          "--max-time", "600",
          "-A", UA,
          "-e", job.pages[0] || BASE,
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
      if (isPdf(fs.readFileSync(tmp))) {
        ok = true;
        break;
      }
      note = note || `${bytes}B (not a PDF)`;
      fs.unlinkSync(tmp);
    }
  }

  if (!ok) {
    counts.failed++;
    console.log(`  FAIL  ${job.name}  ${note}`);
    return;
  }
  fs.renameSync(tmp, dest);
  manifest[job.url] = publicPath;
  counts.saved++;
  console.log(`  SAVE  ${publicPath}  ${(bytes / 1048576).toFixed(2)}MB`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
    : {};
  const counts = { saved: 0, skipped: 0, failed: 0 };

  const jobs = await crawl(await sitemapPages());
  jobs.sort((a, b) => a.name.localeCompare(b.name));

  for (const job of jobs) download(job, manifest, counts);

  if (!DRY) {
    fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `\nsaved ${counts.saved}, already had ${counts.skipped}, failed ${counts.failed}`,
    );
    console.log(`manifest: scripts/${path.basename(MANIFEST)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
