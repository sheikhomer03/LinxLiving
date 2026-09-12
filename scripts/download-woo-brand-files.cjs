/**
 * Mirror every document a WooCommerce storefront publishes into public/<brand>.
 *
 * Covers flooringsales.co.uk and directflooringonline.co.uk. Both are
 * WordPress, so the product and page lists come from the WP sitemaps rather
 * than a Shopify-style products.json, and both hang their literature off the
 * PDP body — fitting instructions, technical data, declarations of
 * performance — plus catalogues linked from ordinary pages.
 *
 * Flooring Sales shows its trade content only to a logged-in account, so it
 * runs through scripts/fsl-session.cjs with FSL_USERNAME / FSL_PASSWORD from
 * the environment. Anonymous requests get a thinner page and miss documents.
 *
 * Two things learned the hard way on the earlier brands shape this:
 *
 *   links   a document is found by reading the href/src attribute, not by
 *           matching absolute URLs. UFH links its datasheets protocol-relative
 *           ("//host/path.PDF") and a leading-https rule found 2 files across
 *           759 products instead of 439.
 *
 *   names   an existing copy cannot be recognised by filename. The older
 *           scrapes named files after the link *text*, so the same document
 *           sits on disk under an unrelated name. Content is the only reliable
 *           key, so anything downloaded is hashed and dropped if those exact
 *           bytes are already somewhere under the brand's folder.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/download-woo-brand-files.cjs
 *   BRAND=flooring-sales | direct-flooring | likewise | all  (default all)
 *   SCAN_ONLY=1   report what is missing, download nothing
 *   FROM_REPORT=1 skip the sweep and fetch what the last scan listed
 *   CONCURRENCY=3
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const fs = require("fs");
const crypto = require("crypto");
const { createSession } = require("./fsl-session.cjs");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BRANDS = {
  "flooring-sales": {
    base: "https://www.flooringsales.co.uk",
    dir: "flooring-sales",
    auth: true,
  },
  "direct-flooring": {
    base: "https://directflooringonline.co.uk",
    dir: "direct-flooring",
    auth: false,
  },
  likewise: {
    base: "https://likewisefloors.com",
    dir: "likewise",
    auth: false,
  },
};

const WANT = String(process.env.BRAND || "all").toLowerCase();
const SCAN_ONLY = process.env.SCAN_ONLY === "1";
const FROM_REPORT = process.env.FROM_REPORT === "1";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 60000);

const DOC_EXT = "pdf|docx?|xlsx?|zip|dwg";
const ATTR_FILE_RE = new RegExp(
  `(?:href|src|data-[a-z-]+)\\s*=\\s*["']\\s*([^"']+?\\.(?:${DOC_EXT})(?:\\?[^"']*)?)\\s*["']`,
  "gi",
);
const JSON_FILE_RE = new RegExp(
  `https?:(?:\\\\\\/|\\/)+[^"'\\s<>)\\\\]+?\\.(?:${DOC_EXT})(?:\\?[^"'\\s<>)\\\\]*)?`,
  "gi",
);

/**
 * The post types that carry documents. Product lists are paginated — Likewise
 * splits its catalogue across product-sitemap.xml and product-sitemap2.xml —
 * and its range and collection archives are where a brochure would sit, so
 * both are swept too. Plain taxonomy lists (cat, tag, brand, author) are not.
 */
const SITEMAP_RE =
  /\/(?:post|page|product|product_collection|product_range)-sitemap\d*\.xml$|\/wp-sitemap-posts-(?:post|page|product)-\d+\.xml$/i;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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

function filesIn(html, pageUrl) {
  const out = new Set();
  const add = (raw) => {
    const u = String(raw).replace(/\\\//g, "/").replace(/&amp;/g, "&").trim();
    if (!u || /^data:/i.test(u)) return;
    try {
      out.add(new URL(u, pageUrl).toString());
    } catch {
      /* not a resolvable reference */
    }
  };
  for (const m of html.matchAll(ATTR_FILE_RE)) add(m[1]);
  for (const m of html.matchAll(JSON_FILE_RE)) add(m[0]);
  return [...out];
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await worker(items[i++]);
    }),
  );
}

/** An error page is HTML and still has length — only trust a real file header. */
function looksReal(buf, ext) {
  if (buf.length < 512) return false;
  const head = buf.subarray(0, 5).toString("latin1");
  if (ext === ".pdf") return head === "%PDF-";
  if (ext === ".zip" || ext === ".docx" || ext === ".xlsx") return head.startsWith("PK");
  return !/^\s*<(!doctype|html)/i.test(buf.subarray(0, 60).toString("latin1"));
}

/** Every file already under the brand folder, keyed by content. */
function existingByHash(root) {
  const map = new Map();
  if (!fs.existsSync(root)) return map;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(pdf|docx?|xlsx?|zip|dwg)$/i.test(e.name)) continue;
      const h = crypto.createHash("md5").update(fs.readFileSync(full)).digest("hex");
      if (!map.has(h)) map.set(h, path.relative(root, full).replace(/\\/g, "/"));
    }
  };
  walk(root);
  return map;
}

async function runBrand(key) {
  const { base, dir, auth } = BRANDS[key];
  const PUBLIC = path.join(__dirname, "..", "public", dir);
  const OUT = path.join(PUBLIC, "downloads", "_files");
  const REPORT = path.join(__dirname, `${key}-files-scan.json`);
  const MANIFEST = path.join(__dirname, `${key}-files-manifest.json`);

  console.log(`\n${"=".repeat(64)}\n${key}  —  ${base}\n${"=".repeat(64)}`);

  let get;
  if (auth) {
    const s = createSession();
    const ok = await s.login(process.env.FSL_USERNAME, process.env.FSL_PASSWORD);
    if (!ok) throw new Error("flooringsales login failed — check FSL_USERNAME / FSL_PASSWORD");
    console.log("logged in to the trade account");
    get = (u) => s.get(u);
  } else {
    get = (u) =>
      fetch(u, {
        headers: { "User-Agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
  }

  const jobs = new Map();

  if (FROM_REPORT) {
    if (!fs.existsSync(REPORT)) throw new Error(`No scan report at ${REPORT}`);
    for (const m of JSON.parse(fs.readFileSync(REPORT, "utf8")).missing || [])
      jobs.set(m.name, { name: m.name, url: m.url, sources: [m.linkedFrom] });
    console.log(`Reusing the previous scan: ${jobs.size} file(s) listed as missing`);
  } else {
    const idx = await get(`${base}/sitemap.xml`);
    const roots = [...new Set([...(await idx.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]))]
      .filter((u) => SITEMAP_RE.test(u));

    const urls = [];
    for (const r of roots) {
      try {
        const res = await get(r);
        for (const m of (await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(m[1]);
      } catch {
        console.log(`  could not read ${r}`);
      }
    }
    const pages = [...new Set(urls)];
    console.log(`${pages.length} product/page URL(s) to sweep\n`);

    const found = new Map();
    let done = 0;
    await mapPool(pages, CONCURRENCY, async (u) => {
      try {
        const res = await get(u);
        const html = await res.text();
        for (const f of filesIn(html, u)) {
          if (!found.has(f)) found.set(f, { url: f, sources: [] });
          const row = found.get(f);
          if (row.sources.length < 5) row.sources.push(u);
        }
      } catch {
        /* a page that will not load has no links to give */
      }
      if (++done % 200 === 0) console.log(`  ${done}/${pages.length}  files=${found.size}`);
    });

    // Key on filename: one fitting guide is linked from hundreds of products.
    for (const row of found.values()) {
      const name = safeName(row.url);
      if (!jobs.has(name)) jobs.set(name, { name, url: row.url, sources: row.sources });
    }
    console.log(`\n${found.size} distinct link(s) → ${jobs.size} distinct filename(s)`);
  }

  console.log("Indexing what is already on disk by content…");
  const have = existingByHash(PUBLIC);
  console.log(`${have.size} distinct document(s) already under public/${dir}`);

  fs.mkdirSync(OUT, { recursive: true });
  const onDisk = new Set(fs.readdirSync(OUT));
  const missing = [...jobs.values()].filter((j) => !onDisk.has(j.name));

  if (!FROM_REPORT)
    fs.writeFileSync(
      REPORT,
      `${JSON.stringify(
        {
          base,
          distinctFiles: jobs.size,
          alreadyOnDisk: have.size,
          missing: missing.map((m) => ({ name: m.name, url: m.url, linkedFrom: m.sources[0] })),
        },
        null,
        2,
      )}\n`,
    );

  console.log(`${jobs.size} published, ${missing.length} not present under that name`);
  console.log(`Report written to scripts/${path.basename(REPORT)}`);

  if (SCAN_ONLY) {
    for (const m of missing.slice(0, 30)) console.log(`  would fetch  ${m.name}`);
    if (missing.length > 30) console.log(`  …and ${missing.length - 30} more`);
    return;
  }
  if (!missing.length) {
    console.log("Nothing to download.");
    return;
  }

  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
  let saved = 0;
  let duplicate = 0;
  let failed = 0;
  let bytes = 0;
  const failures = [];

  console.log(`\nDownloading ${missing.length} file(s)…`);
  await mapPool(missing, CONCURRENCY, async (j) => {
    const ext = path.extname(j.name).toLowerCase();
    try {
      const res = await get(j.url);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok || !looksReal(buf, ext)) throw new Error(`http=${res.status} ${buf.length}B`);

      // The same document already on disk under a name nothing could predict.
      const h = crypto.createHash("md5").update(buf).digest("hex");
      const hit = have.get(h);
      if (hit) {
        manifest[j.url] = `/${dir}/${hit}`;
        duplicate++;
        return;
      }
      fs.writeFileSync(path.join(OUT, j.name), buf);
      have.set(h, `downloads/_files/${j.name}`);
      manifest[j.url] = `/${dir}/downloads/_files/${j.name}`;
      bytes += buf.length;
      saved++;
    } catch (e) {
      failed++;
      failures.push({ name: j.name, url: j.url, error: String(e.message).slice(0, 70) });
    }
    if ((saved + duplicate + failed) % 50 === 0)
      console.log(`  ${saved + duplicate + failed}/${missing.length}  new=${saved} dup=${duplicate} fail=${failed}`);
  });

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `\nSaved ${saved} new, ${duplicate} already held under another name, ${failed} failed` +
      ` — ${(bytes / 1024 / 1024).toFixed(0)}MB → public/${dir}/downloads/_files`,
  );
  if (failures.length) {
    fs.writeFileSync(
      path.join(__dirname, `_tmp-${key}-file-failures.json`),
      `${JSON.stringify(failures, null, 2)}\n`,
    );
    for (const f of failures.slice(0, 10)) console.log(`  ${f.error.padEnd(26)} ${f.name}`);
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
