/**
 * Mirror every document a Shopify storefront publishes into public/<brand>.
 *
 * Plank Hardware and The Under Floor Heating both keep their literature in the
 * same two places, and neither is reachable from Shopify's product JSON:
 *
 *   products  installation guides, spec sheets and brochures linked from the
 *             PDP body — sometimes as plain <a href>, sometimes inside the
 *             embedded JSON where Shopify escapes the slashes
 *   pages     catalogues and buying guides linked from pages and blog posts
 *
 * Files land in downloads/_files/ keyed by filename, not per product. One
 * ProWarm brochure is linked from hundreds of UFH products, and the per-product
 * copies that scripts/enrich-ufhs-products.cjs originally wrote cost 3.4GB
 * before fix-ufhs-pdfs.cjs collapsed them to ~330MB. Repeating that mistake for
 * a second brand would be careless.
 *
 *   node scripts/download-shopify-brand-files.cjs
 *   BRAND=plank-hardware | the-under-floor-heating | all   (default all)
 *   SCAN_ONLY=1   report what is missing, download nothing
 *   SKIP_PAGES=1  products only
 *   FORCE=1       re-download files already on disk
 *   FROM_REPORT=1 skip the sweep and fetch what the last scan listed as missing
 *   PAGES_ONLY=1  sweep only pages/blogs, merging into the previous report
 *   CONCURRENCY=6
 */
const fs = require("fs");
const path = require("path");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BRANDS = {
  "plank-hardware": { base: "https://plankhardware.com", dir: "plank-hardware" },
  "the-under-floor-heating": {
    base: "https://www.theunderfloorheatingstore.com",
    dir: "the-under-floor-heating",
  },
};

const WANT = String(process.env.BRAND || "all").toLowerCase();
const SCAN_ONLY = process.env.SCAN_ONLY === "1";
const SKIP_PAGES = process.env.SKIP_PAGES === "1";
const FORCE = process.env.FORCE === "1";
const FROM_REPORT = process.env.FROM_REPORT === "1";
const PAGES_ONLY = process.env.PAGES_ONLY === "1";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 6));
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 45000);

const DOC_EXT = "pdf|docx?|xlsx?|zip|dwg";

/**
 * Two ways a document reaches the page, and both have to be read.
 *
 * The link on a UFH product is `href="//host/cdn/shop/files/x.PDF?v=…"` —
 * protocol-relative, and uppercase. Matching only on a leading `https?:`
 * found 2 files across 759 products; reading the attribute finds them all.
 */
const ATTR_FILE_RE = new RegExp(
  `(?:href|src|data-[a-z-]+)\\s*=\\s*["']\\s*([^"']+?\\.(?:${DOC_EXT})(?:\\?[^"']*)?)\\s*["']`,
  "gi",
);

/** And the same file inside embedded JSON, where Shopify escapes the slashes. */
const JSON_FILE_RE = new RegExp(
  `https?:(?:\\\\\\/|\\/)+[^"'\\s<>)\\\\]+?\\.(?:${DOC_EXT})(?:\\?[^"'\\s<>)\\\\]*)?`,
  "gi",
);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, init = {}, attempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": UA, ...(init.headers || {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429 || res.status === 503) {
        await delay(1200 * attempt * attempt);
        continue;
      }
      // A delisted PDP still answers 404 with a full page; the body is useless
      // but the request is not worth retrying.
      if (res.status === 404) return res;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
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
      while (i < items.length) await worker(items[i++]);
    }),
  );
}

function safeName(url) {
  const clean = decodeURIComponent(url.split("?")[0]);
  const base = path.basename(clean) || "file";
  return (
    base
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "file.pdf"
  );
}

async function allHandles(base) {
  const handles = [];
  for (let page = 1; page <= 100; page++) {
    const res = await fetchWithRetry(`${base}/products.json?limit=250&page=${page}`, {
      headers: { Accept: "application/json" },
    });
    const json = await res.json();
    const rows = json.products || [];
    if (!rows.length) break;
    for (const p of rows) if (p.handle) handles.push(p.handle);
    if (rows.length < 250) break;
  }
  return [...new Set(handles)];
}

async function sitemapUrls(base) {
  const res = await fetchWithRetry(`${base}/sitemap.xml`);
  const roots = [
    ...new Set(
      [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
        m[1].replace(/&amp;/g, "&"),
      ),
    ),
  ].filter((u) => /sitemap_(pages|blogs)/.test(u));

  const urls = [];
  for (const root of roots) {
    try {
      const r = await fetchWithRetry(root);
      const text = await r.text();
      for (const m of text.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const u = m[1].replace(/&amp;/g, "&");
        if (u === root) continue;
        // Blog sitemaps nest: the index lists per-blog files, not articles.
        if (/sitemap_blogs/.test(u)) {
          try {
            const r2 = await fetchWithRetry(u);
            for (const m2 of (await r2.text()).matchAll(/<loc>([^<]+)<\/loc>/g))
              urls.push(m2[1].replace(/&amp;/g, "&"));
          } catch {
            /* a missing branch just means fewer pages to sweep */
          }
          continue;
        }
        urls.push(u);
      }
    } catch {
      /* ignore an unreachable sitemap branch */
    }
  }
  return [...new Set(urls)];
}

function filesIn(html, base) {
  const out = new Set();
  const add = (raw) => {
    const u = String(raw).replace(/\\\//g, "/").replace(/&amp;/g, "&").trim();
    if (!u) return;
    try {
      // Absolutises protocol-relative (//host/…) and root-relative (/cdn/…)
      // hrefs alike; an already-absolute URL passes through unchanged.
      out.add(new URL(u, base).toString());
    } catch {
      /* not a resolvable reference */
    }
  };
  for (const m of html.matchAll(ATTR_FILE_RE)) add(m[1]);
  for (const m of html.matchAll(JSON_FILE_RE)) add(m[0]);
  return [...out];
}

async function harvest(urls, label, found) {
  let done = 0;
  await mapPool(urls, CONCURRENCY, async (u) => {
    try {
      const res = await fetchWithRetry(u, { headers: { Accept: "text/html" } });
      const html = await res.text();
      for (const f of filesIn(html, u)) {
        if (!found.has(f)) found.set(f, { url: f, sources: [] });
        const row = found.get(f);
        if (row.sources.length < 5) row.sources.push(u);
      }
    } catch {
      /* a page that will not load has no links to give */
    }
    if (++done % 100 === 0) console.log(`  ${label} ${done}/${urls.length}  files=${found.size}`);
  });
}

/** An error page is HTML and still has length — only trust a real file header. */
function looksReal(buf, ext) {
  if (buf.length < 512) return false;
  const head = buf.subarray(0, 5).toString("latin1");
  if (ext === ".pdf") return head === "%PDF-";
  if (ext === ".zip" || ext === ".docx" || ext === ".xlsx") return head.startsWith("PK");
  return !/^\s*<(!doctype|html)/i.test(buf.subarray(0, 60).toString("latin1"));
}

async function runBrand(key) {
  const { base, dir } = BRANDS[key];
  const PUBLIC = path.join(__dirname, "..", "public", dir);
  const OUT = path.join(PUBLIC, "downloads", "_files");
  const MANIFEST = path.join(__dirname, `${key}-files-manifest.json`);
  const REPORT = path.join(__dirname, `${key}-files-scan.json`);

  console.log(`\n${"=".repeat(64)}\n${key}  —  ${base}\n${"=".repeat(64)}`);

  const jobs = new Map();
  let handles = [];
  const found = new Map();

  if (FROM_REPORT) {
    // Sweeping a storefront costs it well over a thousand requests, and both
    // of these rate-limit once a second pass starts. Downloading from the scan
    // that already ran asks their server only for the files themselves.
    if (!fs.existsSync(REPORT)) throw new Error(`No scan report at ${REPORT} — run without FROM_REPORT first`);
    const prev = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    for (const m of prev.missing || [])
      jobs.set(m.name, { name: m.name, url: m.url, sources: [m.linkedFrom], links: 1 });
    console.log(`Reusing the previous scan: ${jobs.size} file(s) it listed as missing`);
  } else {
    if (!PAGES_ONLY) {
      handles = await allHandles(base);
      console.log(`${handles.length} product handle(s)\n`);

      await harvest(
        handles.map((h) => `${base}/products/${h}`),
        "products",
        found,
      );
      console.log(`${found.size} distinct file link(s) across the catalogue`);
    }
    const afterProducts = found.size;

    if (!SKIP_PAGES) {
      // A storefront that has just served hundreds of PDPs will refuse the
      // sitemap. Losing the sweep should not also throw away what the product
      // pass found, so the run continues and says how to finish the job.
      try {
        const pages = await sitemapUrls(base);
        console.log(`\nSweeping ${pages.length} page(s) and article(s)`);
        await harvest(pages, "pages", found);
        console.log(`${found.size - afterProducts} more from pages/blogs`);
      } catch (e) {
        console.log(`\nPage sweep skipped — ${String(e.message).slice(0, 70)}`);
        console.log("Re-run with PAGES_ONLY=1 once the origin stops rate-limiting.");
      }
    }

    // Key on filename: the same brochure is linked from hundreds of products
    // and is one file on disk, not hundreds of copies.
    for (const row of found.values()) {
      const name = safeName(row.url);
      if (!jobs.has(name)) jobs.set(name, { name, url: row.url, sources: row.sources, links: 0 });
      jobs.get(name).links++;
    }
  }

  // A pages-only pass never sees the product links, so fold this run's
  // findings into what the earlier full scan already recorded — before the
  // missing set is worked out, or the merged rows would never be fetched.
  if (PAGES_ONLY && fs.existsSync(REPORT)) {
    const prev = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    for (const m of prev.missing || [])
      if (!jobs.has(m.name))
        jobs.set(m.name, { name: m.name, url: m.url, sources: [m.linkedFrom], links: 1 });
  }

  fs.mkdirSync(OUT, { recursive: true });
  const onDisk = new Set(fs.readdirSync(OUT));

  /**
   * fix-ufhs-pdfs.cjs stored the same documents under a slugified name cut at
   * 80 characters, so `ProGrip_FX_TDS.pdf` is already there as
   * `progrip-fx-tds.pdf`. Comparing raw filenames alone called 131 files
   * missing that were sitting on disk, and would have downloaded each twice.
   */
  const legacyKey = (name) =>
    path
      .parse(name)
      .name.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "");
  const onDiskKeys = new Set([...onDisk].map(legacyKey));

  const isPresent = (name) => {
    if (onDisk.has(name)) return fs.statSync(path.join(OUT, name)).size > 0;
    return onDiskKeys.has(legacyKey(name));
  };
  const missing = [...jobs.values()].filter((j) => FORCE || !isPresent(j.name));

  // Files already on disk that the site no longer links — reported, never removed.
  const wanted = new Set([...jobs.keys()]);
  // Match the same way, or every slug-named file reads as an orphan.
  const wantedKeys = new Set([...wanted].map(legacyKey));
  const orphans = [...onDisk].filter(
    (f) => !wanted.has(f) && !wantedKeys.has(legacyKey(f)),
  );

  if (!FROM_REPORT) fs.writeFileSync(
    REPORT,
    `${JSON.stringify(
      {
        base,
        handles: handles.length,
        distinctLinks: found.size,
        distinctFiles: jobs.size,
        onDisk: onDisk.size,
        missing: missing.map((m) => ({ name: m.name, url: m.url, linkedFrom: m.sources[0] })),
        orphans,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    `\n${jobs.size} distinct file(s) published → ${jobs.size - missing.length} on disk, ${missing.length} missing`,
  );
  if (orphans.length) console.log(`${orphans.length} on disk the site no longer links (kept)`);
  console.log(`Report written to scripts/${path.basename(REPORT)}`);

  if (SCAN_ONLY) {
    for (const m of missing.slice(0, 40)) console.log(`  would fetch  ${m.name}`);
    if (missing.length > 40) console.log(`  …and ${missing.length - 40} more`);
    return;
  }
  if (!missing.length) {
    console.log("Nothing to download.");
    return;
  }

  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
  let saved = 0;
  let failed = 0;
  let bytes = 0;
  const failures = [];

  console.log(`\nDownloading ${missing.length} file(s)…`);
  await mapPool(missing, CONCURRENCY, async (j) => {
    const dest = path.join(OUT, j.name);
    const ext = path.extname(j.name).toLowerCase();
    try {
      const res = await fetchWithRetry(j.url, { headers: { Accept: "*/*" } });
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok || !looksReal(buf, ext))
        throw new Error(`http=${res.status} ${buf.length}B`);
      fs.writeFileSync(dest, buf);
      manifest[j.url] = `/${dir}/downloads/_files/${j.name}`;
      bytes += buf.length;
      saved++;
    } catch (e) {
      failed++;
      failures.push({ name: j.name, url: j.url, error: String(e.message).slice(0, 80) });
    }
    if ((saved + failed) % 25 === 0)
      console.log(`  ${saved + failed}/${missing.length}  saved=${saved} failed=${failed}`);
  });

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `\nSaved ${saved}, failed ${failed}, ${(bytes / 1024 / 1024).toFixed(0)}MB → public/${dir}/downloads/_files`,
  );
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures.slice(0, 20)) console.log(`  ${f.error.padEnd(24)} ${f.name}`);
  }
}

async function main() {
  const keys = WANT === "all" ? Object.keys(BRANDS) : [WANT];
  for (const k of keys) {
    if (!BRANDS[k]) throw new Error(`Unknown brand "${k}"`);
    await runBrand(k);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
