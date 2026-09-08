/**
 * Is public/mb-decor holding everything mbdecor.co.uk publishes?
 *
 * download-mbdecor-literature.cjs mirrored 208 files — 200 datasheets and the
 * 8 flipbook catalogues. This answers whether that is still the whole set.
 *
 * mbdecor answers this machine with HTTP 418 "Country Blocked", so every
 * request goes through r.jina.ai, and what the relay can reach decides how
 * each check is made:
 *
 *  - Datasheets. /datasheets/ is the complete index — the earlier 404-page
 *    scan found no datasheet anywhere that was not on it — so the index is
 *    re-read and compared against the manifest.
 *  - Products. The earlier scan sampled 300 of ~2,360 product pages. Rather
 *    than crawl the rest, the WooCommerce Store API is walked 100 products a
 *    request, so every product is checked for a file linked outside the
 *    indexes. This must be fetched WITHOUT `x-return-format: html`: with it
 *    the relay hands back SiteGround's sgcaptcha stub, while its own reader
 *    follows the redirect and returns the JSON.
 *  - Brochures. Their filenames carry the revision — `…Decorwall 2026
 *    Revision 3.pdf` — so a rebuild is a new file under a name nothing would
 *    notice. The name lives in each viewer's javascript/config.js, which the
 *    relay cannot fetch at all: it answers 422 "Failed to interpret" for a
 *    .js URL, and allorigins and codetabs cannot reach the host either. What
 *    the relay does do is render the viewer and report when it was published,
 *    so the check is a date: a viewer published after we took our copy has
 *    been rebuilt since, and its PDF needs re-fetching.
 *
 * Nothing here downloads. A blocked host cannot be mirrored from, so the
 * report names what needs fetching and the fetching waits for a UK address.
 *
 * The catalogue walk is paced and resumable. SiteGround starts answering with
 * its captcha stub after a few hundred products in quick succession — the
 * first full run stopped at page 5 — so pages are spaced out and what has been
 * read is checkpointed. Re-running picks up at the page that failed rather
 * than starting over, and only a run that reaches the end of the catalogue
 * reports `catalogue read in full`.
 *
 *   node scripts/audit-mbdecor-completeness.cjs
 *   PAGES=40   most Store API pages per run (default 40, ~4,000 products)
 *   DELAY=8000 pause between pages, ms — raise it if the stub returns
 *   FRESH=1    discard the checkpoint and walk from page 1
 */
const fs = require("fs");
const path = require("path");

const BASE = "https://mbdecor.co.uk";
const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "mbdecor-completeness-audit.json");
const MANIFEST = path.join(__dirname, "mbdecor-literature-manifest.json");
const MAX_PAGES = Number(process.env.PAGES || 40);
const DELAY = Number(process.env.DELAY || 8000);
const FRESH = process.env.FRESH === "1";
const CHECKPOINT = path.join(__dirname, "_tmp-mbdecor-audit-progress.json");

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (msg) => console.log(`[${stamp()}] ${msg}`);

/**
 * Fetch through the relay.
 *
 * `html` asks for the raw document, which is what the two index pages need and
 * what the Store API must NOT have. A first hit often returns SiteGround's
 * sgcaptcha stub instead of the page — a couple of hundred bytes carrying a
 * meta-refresh — so that is retried; a 4xx from the relay is a verdict, not a
 * hiccup, and returns immediately rather than burning the backoff.
 */
async function via(url, { html = false, tries = 6 } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers: html ? { "x-return-format": "html" } : {},
        signal: AbortSignal.timeout(90000),
      });
      const text = await res.text();
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, note: `relay ${res.status}`, text };
      }
      if (/sgcaptcha/.test(text) || text.length < 400) {
        // The stub is a rate limit wearing a captcha; it clears with time, so
        // the wait grows rather than repeating the request that provoked it.
        await new Promise((r) => setTimeout(r, attempt * 10000));
        continue;
      }
      return { ok: true, text };
    } catch (e) {
      await new Promise((r) => setTimeout(r, attempt * 4000));
      if (attempt === tries) return { ok: false, note: e.message };
    }
  }
  return { ok: false, note: "captcha stub after every attempt" };
}

/** r.jina.ai prefixes the body with a header block of its own. */
function payload(text) {
  const i = text.indexOf("Markdown Content:");
  return (i >= 0 ? text.slice(i + "Markdown Content:".length) : text).trim();
}

const unescapeSlashes = (s) => s.split("\\/").join("/");
const PDF_RE = /https?:\/\/[^"'\s<>\\)]+?\.pdf(?:\?[^"'\s<>\\)]*)?/gi;

/** Re-read /datasheets/ and compare it against what we hold. */
async function datasheets(held) {
  const res = await via(`${BASE}/datasheets/`, { html: true });
  if (!res.ok) {
    log(`  /datasheets/ unreadable: ${res.note}`);
    return { readable: false, live: 0, missing: [], stale: [] };
  }
  const live = [
    ...new Set(
      [...unescapeSlashes(res.text).matchAll(
        /https?:\/\/mbdecor\.co\.uk\/datasheet\/[^"'\s<>]+?\.pdf/gi,
      )].map((m) => m[0]),
    ),
  ];
  const missing = live.filter((u) => !held.has(u));
  const stale = [...held].filter((u) => /\/datasheet\//i.test(u) && !live.includes(u));
  log(`  /datasheets/ lists ${live.length}; ${missing.length} not held, ${stale.length} no longer listed`);
  return { readable: true, live: live.length, missing, stale };
}

/**
 * Has a flipbook been rebuilt since we took our copy?
 *
 * Compares the viewer's publish date against the mtime of the PDF on disk.
 * Equal dates mean nothing changed; a viewer newer than our file is the signal
 * that its catalogue has been reissued.
 */
async function brochures(manifest) {
  const bySlug = new Map();
  for (const [url, pub] of Object.entries(manifest)) {
    const m = /\/brochure\/([a-z0-9-]+)\/files\//i.exec(url);
    if (m) bySlug.set(m[1], { url, file: path.join(ROOT, "public", pub.replace(/^\//, "")) });
  }

  const rows = [];
  for (const [slug, held] of bySlug) {
    const mirroredAt = fs.existsSync(held.file) ? fs.statSync(held.file).mtime : null;
    const res = await via(`${BASE}/brochure/${slug}/`);
    if (!res.ok) {
      rows.push({ slug, verdict: "unknown", note: res.note, held: held.url });
      log(`  ${slug.padEnd(20)} unknown (${res.note})`);
      continue;
    }
    const title = (res.text.match(/^Title:\s*(.+)$/m) || [])[1]?.trim() || "";
    const publishedRaw = (res.text.match(/^Published Time:\s*(.+)$/m) || [])[1]?.trim() || "";
    const published = publishedRaw ? new Date(publishedRaw) : null;

    let verdict = "unknown";
    if (published && mirroredAt) {
      verdict = published > mirroredAt ? "REBUILT" : "current";
    }
    rows.push({
      slug,
      title,
      published: published ? published.toISOString() : null,
      mirroredAt: mirroredAt ? mirroredAt.toISOString() : null,
      verdict,
      held: held.url,
    });
    log(
      `  ${slug.padEnd(20)} ${verdict.padEnd(8)} published ${publishedRaw || "?"}` +
        `  (ours ${mirroredAt ? mirroredAt.toISOString().slice(0, 10) : "?"})`,
    );
  }
  return rows;
}

/** Every product's payload, checked for a PDF linked outside the indexes. */
async function productPdfs() {
  let found = new Map();
  let products = 0;
  let complete = false;
  let startPage = 1;

  if (!FRESH && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    found = new Map(saved.found || []);
    products = saved.products || 0;
    startPage = saved.nextPage || 1;
    log(`  resuming at page ${startPage} (${products} products already read)`);
  }

  const save = (nextPage, done) =>
    fs.writeFileSync(
      CHECKPOINT,
      `${JSON.stringify({ nextPage, products, complete: done, found: [...found] }, null, 2)}
`,
    );

  for (let page = startPage; page < startPage + MAX_PAGES; page++) {
    const res = await via(`${BASE}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!res.ok) {
      log(`  page ${page}: unreadable (${res.note}) — stopping here, re-run to resume`);
      save(page, false);
      break;
    }
    let rows;
    try {
      rows = JSON.parse(payload(res.text));
    } catch {
      log(`  page ${page}: not JSON — stopping here, re-run to resume`);
      save(page, false);
      break;
    }
    if (!Array.isArray(rows)) {
      log(`  page ${page}: unexpected shape — stopping here, re-run to resume`);
      save(page, false);
      break;
    }
    if (!rows.length) {
      complete = true;
      save(page, true);
      break;
    }
    products += rows.length;

    for (const p of rows) {
      for (const m of unescapeSlashes(JSON.stringify(p)).matchAll(PDF_RE)) {
        const url = m[0].replace(/&amp;/g, "&");
        if (!found.has(url)) found.set(url, []);
        found.get(url).push(p.slug);
      }
    }
    log(`  page ${page}: ${rows.length} products (${products} total), ${found.size} distinct PDF(s)`);
    if (rows.length < 100) {
      complete = true;
      save(page + 1, true);
      break;
    }
    save(page + 1, false);
    await new Promise((r) => setTimeout(r, DELAY));
  }
  return { products, found, complete };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const held = new Set(Object.keys(manifest));
  log(`holding ${held.size} file(s) from the earlier mirror`);

  log("re-reading /datasheets/…");
  const sheets = await datasheets(held);

  log("checking the 8 flipbook viewers for a rebuild since our copy…");
  const books = await brochures(manifest);

  log("walking the catalogue for product-level PDFs…");
  const { products, found, complete } = await productPdfs();

  const missingProductPdfs = [...found]
    .filter(([url]) => !held.has(url))
    .map(([url, slugs]) => ({ url, products: slugs.length, sample: slugs[0] }));
  const rebuilt = books.filter((b) => b.verdict === "REBUILT");
  const unknown = books.filter((b) => b.verdict === "unknown");

  const report = {
    base: BASE,
    checkedAt: new Date().toISOString(),
    heldFiles: held.size,
    datasheets: sheets,
    brochures: books,
    catalogue: { productsRead: products, complete, pdfsReferenced: found.size },
    missingProductPdfs,
    note:
      "mbdecor country-blocks this machine (HTTP 418); everything above was " +
      "read through r.jina.ai, which cannot fetch .js or binary files. " +
      "Nothing can be downloaded from here — a UK address is needed.",
  };
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  console.log("\n================ RESULT ================");
  console.log(`datasheets index readable         : ${sheets.readable}`);
  console.log(`  listed live                     : ${sheets.live}`);
  console.log(`  listed but not held             : ${sheets.missing.length}`);
  for (const u of sheets.missing) console.log(`     ! ${decodeURIComponent(u)}`);
  console.log(`  held but no longer listed       : ${sheets.stale.length}`);
  console.log(`brochures rebuilt since our copy  : ${rebuilt.length}`);
  for (const b of rebuilt) console.log(`     ! ${b.slug} — "${b.title}" published ${b.published}`);
  console.log(`brochures undetermined            : ${unknown.length}`);
  for (const b of unknown) console.log(`     ? ${b.slug} (${b.note})`);
  console.log(`catalogue read in full            : ${complete}`);
  console.log(`  products read                   : ${products}`);
  console.log(`  distinct PDFs they reference    : ${found.size}`);
  console.log(`  of those, not held              : ${missingProductPdfs.length}`);
  for (const m of missingProductPdfs.slice(0, 60))
    console.log(`     ! ${decodeURIComponent(m.url)}  (${m.products} product(s), e.g. ${m.sample})`);
  if (missingProductPdfs.length > 60)
    console.log(`     …and ${missingProductPdfs.length - 60} more`);
  console.log(`\nWritten to scripts/${path.basename(OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
