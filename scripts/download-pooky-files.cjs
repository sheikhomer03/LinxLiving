/**
 * Mirror every downloadable file pooky.com publishes into public/pooky.
 *
 * Two sources, because Pooky keeps its files in two unrelated places:
 *
 *   products  the instruction sheet lives on a variant metafield
 *             (dimensions.product_instructions) served by their productsDB
 *             GraphQL, not by Shopify's public product JSON. Landing under
 *             public/pooky/downloads/<handle>/, matching what
 *             enrich-pooky-products.cjs already writes.
 *
 *   pages     the Care Guide and Sustainability report are plain links in
 *             page and blog HTML. Landing under public/pooky/literature/.
 *
 * enrich-pooky-products.cjs only downloads a sheet for a product it happens to
 * re-scrape, so the on-disk set drifts behind the site. This walks the whole
 * catalogue instead and fetches what is missing, without touching Mongo.
 *
 *   node scripts/download-pooky-files.cjs
 *   SCAN_ONLY=1   report what is missing, download nothing
 *   SKIP_PAGES=1  products only
 *   FORCE=1       re-download files already on disk
 *   CONCURRENCY=6
 */
const fs = require("fs");
const path = require("path");

const BASE = "https://www.pooky.com";
const PRODUCTS_DB =
  process.env.POOKY_PRODUCTS_DB ||
  "https://graphql-server-uk-464125e5708d.herokuapp.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PUBLIC = path.join(__dirname, "..", "public", "pooky");
const MANIFEST = path.join(__dirname, "pooky-files-manifest.json");
const REPORT = path.join(__dirname, "pooky-files-scan.json");

const SCAN_ONLY = process.env.SCAN_ONLY === "1";
const SKIP_PAGES = process.env.SKIP_PAGES === "1";
const FORCE = process.env.FORCE === "1";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 6));
const GQL_BATCH = 60;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function fetchWithRetry(url, init = {}, attempts = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // Without a deadline a single stalled connection parks a worker for
      // good, and six of them stall the whole sweep.
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": UA, ...(init.headers || {}) },
        signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 45000)),
      });
      if (res.status === 429 || res.status === 503) {
        await delay(1200 * attempt * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (/HTTP 404/.test(String(e.message))) throw e;
      if (attempt >= attempts) break;
      await delay(600 * attempt * attempt);
    }
  }
  throw lastErr || new Error(`Failed ${url}`);
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx], idx);
      }
    }),
  );
}

/** Shopify caps products.json at 250 a page and stops returning rows at the end. */
async function allHandles() {
  const handles = [];
  for (let page = 1; page <= 100; page++) {
    const res = await fetchWithRetry(
      `${BASE}/products.json?limit=250&page=${page}`,
      { headers: { Accept: "application/json" } },
    );
    const json = await res.json();
    const rows = json.products || [];
    if (!rows.length) break;
    for (const p of rows) if (p.handle) handles.push(p.handle);
    if (rows.length < 250) break;
  }
  return [...new Set(handles)];
}

const PRODUCT_QUERY = `
  query ($handles: [String!]!) {
    productsByHandle(handle: $handles, take: 60) {
      handle
      title
      metafields { namespace key type value }
      variants { sku metafields { namespace key type value } }
    }
  }
`;

async function gql(query, variables) {
  const res = await fetchWithRetry(PRODUCTS_DB, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: BASE,
      Referer: `${BASE}/`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

/** Any metafield whose value is a link to a document, whatever it is called. */
const FILE_RE = /^https?:\/\/\S+\.(pdf|zip|docx?|xlsx?)(\?|$)/i;

function filesFromProduct(p) {
  const out = new Map();
  const scan = (metafields, scope) => {
    for (const m of metafields || []) {
      const value = String(m.value || "").trim();
      if (!FILE_RE.test(value)) continue;
      if (!out.has(value)) out.set(value, { url: value, key: `${m.namespace}.${m.key}`, scope });
      }
  };
  scan(p.metafields, "product");
  for (const v of p.variants || []) scan(v.metafields, `variant:${v.sku || ""}`);
  return [...out.values()];
}

/** product_instructions keeps the name enrich-pooky-products.cjs gave it. */
function destFor(handle, file) {
  const dir = slugify(handle) || "misc";
  const clean = file.url.split("?")[0];
  const ext = path.extname(clean).toLowerCase() || ".pdf";
  const name = /product_instructions/i.test(file.key)
    ? `${slugify(`${handle}-instructions`)}${ext}`
    : `${slugify(`${handle}-${path.parse(clean).name}`)}${ext}`;
  return {
    abs: path.join(PUBLIC, "downloads", dir, name),
    publicPath: `/pooky/downloads/${dir}/${name}`,
  };
}

/** Pooky's own pages and blog posts, where the care/sustainability PDFs live. */
async function sitemapUrls() {
  const res = await fetchWithRetry(`${BASE}/sitemap.xml`);
  const roots = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    m[1].replace(/&amp;/g, "&"),
  );
  const wanted = roots.filter((u) => /sitemap_(pages|blogs)/.test(u));
  const urls = [];
  for (const root of wanted) {
    try {
      const r = await fetchWithRetry(root);
      const text = await r.text();
      for (const m of text.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const u = m[1].replace(/&amp;/g, "&");
        if (u !== root) urls.push(u);
      }
      // Blog sitemaps nest one level: article lists sit behind per-blog files.
      for (const m of text.matchAll(/<loc>([^<]*sitemap_blogs[^<]*)<\/loc>/g)) {
        const nested = m[1].replace(/&amp;/g, "&");
        if (nested === root) continue;
        try {
          const r2 = await fetchWithRetry(nested);
          for (const m2 of (await r2.text()).matchAll(/<loc>([^<]+)<\/loc>/g))
            urls.push(m2[1].replace(/&amp;/g, "&"));
        } catch {
          /* a missing nested sitemap just means fewer pages to sweep */
        }
      }
    } catch {
      /* ignore an unreachable sitemap branch */
    }
  }
  return [...new Set(urls)].filter((u) => /^https?:\/\/(www\.)?pooky\.com\//.test(u));
}

const PAGE_PDF_RE = /https?:(?:\\\/|\/)+[^\s"'<>)\\]+?\.pdf(?:\?[^\s"'<>)\\]*)?/gi;

async function scanPages() {
  const urls = await sitemapUrls();
  console.log(`Sweeping ${urls.length} page(s) and article(s) for PDF links\n`);
  const found = new Map();
  let done = 0;
  await mapPool(urls, CONCURRENCY, async (u) => {
    try {
      const res = await fetchWithRetry(u, { headers: { Accept: "text/html" } });
      const html = await res.text();
      for (const m of html.match(PAGE_PDF_RE) || []) {
        const url = m.replace(/\\\//g, "/");
        if (!found.has(url)) found.set(url, { url, pages: [] });
        if (found.get(url).pages.length < 5) found.get(url).pages.push(u);
      }
    } catch {
      /* a page that will not load has no links to give us */
    }
    if (++done % 100 === 0) console.log(`  pages ${done}/${urls.length}  pdfs=${found.size}`);
  });
  return [...found.values()];
}

/** An error page is HTML and still has length — only trust a real file header. */
function looksReal(buf, ext) {
  if (buf.length < 1024) return false;
  if (ext === ".pdf") return buf.subarray(0, 5).toString("latin1") === "%PDF-";
  if (ext === ".zip") return buf.subarray(0, 2).toString("latin1") === "PK";
  return true;
}

async function download(url, dest) {
  const ext = path.extname(dest).toLowerCase();
  const res = await fetchWithRetry(url, { headers: { Accept: "*/*" } });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!looksReal(buf, ext)) throw new Error(`not a ${ext || "file"} (${buf.length}B)`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  const manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
    : {};

  console.log("Listing the catalogue…");
  const handles = await allHandles();
  console.log(`${handles.length} product handle(s) live on pooky.com\n`);

  const batches = [];
  for (let i = 0; i < handles.length; i += GQL_BATCH)
    batches.push(handles.slice(i, i + GQL_BATCH));

  /** @type {{handle:string,url:string,key:string,abs:string,publicPath:string}[]} */
  const wanted = [];
  const seenHandles = new Set();
  let gqlErrors = 0;
  let done = 0;

  await mapPool(batches, CONCURRENCY, async (batch) => {
    try {
      const data = await gql(PRODUCT_QUERY, { handles: batch });
      for (const p of data.productsByHandle || []) {
        seenHandles.add(p.handle);
        for (const f of filesFromProduct(p)) {
          const { abs, publicPath } = destFor(p.handle, f);
          wanted.push({ handle: p.handle, url: f.url, key: f.key, abs, publicPath });
        }
      }
    } catch (e) {
      gqlErrors++;
      console.log(`  gql batch failed: ${String(e.message).slice(0, 60)}`);
    }
    done += batch.length;
    if (done % 600 < GQL_BATCH)
      console.log(`  products ${done}/${handles.length}  files=${wanted.length}`);
  });

  console.log(
    `\n${wanted.length} product file link(s) across ${seenHandles.size} product(s)` +
      `${gqlErrors ? `, ${gqlErrors} batch error(s)` : ""}`,
  );

  const pagePdfs = SKIP_PAGES ? [] : await scanPages();
  // download-pooky-literature.cjs already named the care guides and the
  // sustainability report by hand; reuse those names so a sweep that
  // rediscovers the same URL does not save a second copy under a slug.
  const known = {};
  const litManifest = path.join(__dirname, "pooky-literature-manifest.json");
  if (fs.existsSync(litManifest))
    for (const [url, p] of Object.entries(JSON.parse(fs.readFileSync(litManifest, "utf8"))))
      known[url.split("?")[0]] = path.basename(p);
  const pageJobs = pagePdfs.map((p) => {
    const name =
      known[p.url.split("?")[0]] ||
      `${slugify(path.parse(p.url.split("?")[0]).name)}.pdf`;
    return {
      handle: "(site literature)",
      url: p.url,
      key: "page-link",
      pages: p.pages,
      abs: path.join(PUBLIC, "literature", name),
      publicPath: `/pooky/literature/${name}`,
    };
  });
  if (!SKIP_PAGES) console.log(`\n${pageJobs.length} distinct PDF link(s) in page/blog HTML`);

  // A shared instruction sheet is linked from hundreds of products but each
  // product keeps its own copy, so dedupe on destination, not on URL.
  const jobs = [];
  const byDest = new Set();
  for (const j of [...wanted, ...pageJobs]) {
    if (byDest.has(j.abs)) continue;
    byDest.add(j.abs);
    jobs.push(j);
  }

  const missing = jobs.filter(
    (j) => FORCE || !fs.existsSync(j.abs) || fs.statSync(j.abs).size === 0,
  );
  const present = jobs.length - missing.length;

  // Anything on disk the site no longer lists — reported, never deleted.
  const onDisk = [];
  for (const sub of ["downloads", "literature"]) {
    const root = path.join(PUBLIC, sub);
    if (!fs.existsSync(root)) continue;
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else onDisk.push(full);
      }
    };
    walk(root);
  }
  const orphans = onDisk.filter((f) => !byDest.has(f));

  fs.writeFileSync(
    REPORT,
    `${JSON.stringify(
      {
        handles: handles.length,
        productsWithFiles: seenHandles.size,
        productFileLinks: wanted.length,
        pagePdfs: pageJobs.length,
        distinctDestinations: jobs.length,
        onDisk: onDisk.length,
        missing: missing.map((m) => ({ handle: m.handle, url: m.url, dest: m.publicPath })),
        orphans: orphans.map((f) => path.relative(PUBLIC, f).replace(/\\/g, "/")),
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\n${jobs.length} file(s) the site publishes → ${present} on disk, ${missing.length} missing`);
  if (orphans.length)
    console.log(`${orphans.length} file(s) on disk the site no longer lists (kept, not deleted)`);
  console.log(`Report written to scripts/${path.basename(REPORT)}`);

  if (SCAN_ONLY) {
    for (const m of missing.slice(0, 40)) console.log(`  would fetch  ${m.publicPath}`);
    if (missing.length > 40) console.log(`  …and ${missing.length - 40} more`);
    return;
  }
  if (!missing.length) {
    console.log("\nNothing to download.");
    return;
  }

  console.log(`\nDownloading ${missing.length} file(s)…`);
  let saved = 0;
  let failed = 0;
  let bytes = 0;
  await mapPool(missing, CONCURRENCY, async (j) => {
    try {
      const n = await download(j.url, j.abs);
      manifest[j.url] = j.publicPath;
      bytes += n;
      saved++;
      if (saved % 25 === 0) console.log(`  ${saved}/${missing.length} saved`);
    } catch (e) {
      failed++;
      console.log(`  FAIL  ${j.publicPath}  ${String(e.message).slice(0, 60)}`);
    }
  });

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `\nSaved ${saved}, failed ${failed}, ${Math.round(bytes / 1024 / 1024)}MB → public/pooky`,
  );
  console.log(`Manifest written to scripts/${path.basename(MANIFEST)}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
