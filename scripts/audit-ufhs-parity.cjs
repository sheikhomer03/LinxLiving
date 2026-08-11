/**
 * Recheck every The Under Floor Heating product against the live PDP and
 * re-enrich anything missing or wrong (gallery, options, variants, nested
 * Globo options, Do the Job Right, description, measure-my-room flag).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-ufhs-parity.cjs
 *
 * Options:
 *   LIMIT=20 CONCURRENCY=1 DRY_RUN=1 RESUME=1 ONLY_HANDLE=slug
 *   SKIP_IMAGES=1 REQUEST_GAP_MS=400 FIX=1 (default) REPORT_ONLY=1
 */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const dns = require("dns");
const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const BASE = "https://www.theunderfloorheatingstore.com";
const BRAND_SLUG = "the-under-floor-heating";
const LOG = path.join(__dirname, "_tmp-ufhs-parity.log");
const REPORT = path.join(__dirname, "_tmp-ufhs-parity-report.json");
const PROGRESS = path.join(__dirname, "_tmp-ufhs-parity-progress.json");

const DRY_RUN = process.env.DRY_RUN === "1";
const REPORT_ONLY = process.env.REPORT_ONLY === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 1));
/** Use UFHS_ONLY_HANDLE (not ONLY_HANDLE) to avoid cross-talk from other scrapers. */
const ONLY_HANDLE = String(process.env.UFHS_ONLY_HANDLE || "").trim();
const REQUEST_GAP_MS = Math.max(0, Number(process.env.REQUEST_GAP_MS || 350));
const MAX_RETRIES = Math.max(1, Number(process.env.MAX_RETRIES || 8));
const FIX = process.env.FIX !== "0" && !REPORT_ONLY;

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, `${line}\n`);
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, init = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxUfhsParity/1.0",
          Accept: init.headers?.Accept || "*/*",
          ...(init.headers || {}),
        },
      });
      if (res.status === 429 || res.status === 503) {
        const wait = 1500 * attempt * attempt;
        log(`rate-limit ${res.status} wait=${wait}ms ${url}`);
        await delay(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (/HTTP 404/.test(String(e.message))) throw e;
      if (attempt >= MAX_RETRIES) break;
      await delay(800 * attempt * attempt);
    }
  }
  throw lastErr || new Error(`Failed ${url}`);
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () =>
      run(),
    ),
  );
}

function countNested(nodes) {
  let n = 0;
  const walk = (arr) => {
    for (const el of arr || []) {
      n += 1;
      if (el?.elements) walk(el.elements);
      if (el?.options) walk(el.options);
    }
  };
  walk(nodes);
  return n;
}

/**
 * Unique gallery entries, de-duped the same way the scraper stores them —
 * PDPs sometimes list the same video twice.
 */
function liveGalleryCount(productJs) {
  const media = Array.isArray(productJs.media) ? productJs.media : [];
  if (media.length) {
    const keys = media.map((m) =>
      m.media_type === "external_video" && m.external_id
        ? `youtube:${m.external_id}`
        : String(m.src || m.preview_image?.src || "").split("?")[0],
    );
    return new Set(keys.filter(Boolean)).size;
  }
  const imgs = productJs.images || [];
  const keys = imgs.map((i) =>
    String(typeof i === "string" ? i : i.src || "").split("?")[0],
  );
  return new Set(keys.filter(Boolean)).size || (productJs.featured_image ? 1 : 0);
}

/** Current scrape version — anything older is re-scraped. */
const PARITY_VERSION = 6;

function countLive(html, re) {
  return (String(html || "").match(re) || []).length;
}

function analyzeGaps(local, productJs, html) {
  const gaps = [];
  const handle = local.specs?.ufhsHandle;
  const liveVariants = productJs.variants || [];
  const liveOptions = (productJs.options || []).filter((o) => {
    const name = typeof o === "string" ? o : o?.name;
    return name && !/^title$/i.test(name);
  });
  const localVariants = Array.isArray(local.variants) ? local.variants : [];
  const localOptions = Array.isArray(local.shopifyOptions)
    ? local.shopifyOptions
    : [];
  const localImages = Array.isArray(local.images) ? local.images : [];
  const liveGallery = liveGalleryCount(productJs);
  const liveDesc = String(productJs.description || "").replace(/<[^>]+>/g, " ").trim();
  const localDesc = String(local.description || "").trim();
  const liveHasMeasure = /Measure My Room|room-calc-modal-app|rmc-open/i.test(
    html || "",
  );
  const liveHasGpo = /gpo_config|globoProductOptions|GPO_OPTIONS/i.test(
    html || "",
  );
  const localNested = countNested(local.nestedOptions);
  const localTools = local.doTheJobRight?.items?.length || 0;
  const livePrice =
    Math.round(Number(liveVariants.find((v) => v.available)?.price || liveVariants[0]?.price || 0)) /
      100 || 0;

  if (liveGallery > localImages.length) {
    gaps.push(`gallery ${localImages.length}<${liveGallery}`);
  }
  if (liveOptions.length > localOptions.length) {
    gaps.push(`options ${localOptions.length}<${liveOptions.length}`);
  }
  if (liveVariants.length > localVariants.length) {
    gaps.push(`variants ${localVariants.length}<${liveVariants.length}`);
  }
  if (liveDesc.length > 40 && localDesc.length < Math.min(80, liveDesc.length * 0.4)) {
    gaps.push(`description thin`);
  }
  if (liveHasMeasure && local.specs?.hasMeasureMyRoom !== true) {
    gaps.push(`measureMyRoom`);
  }
  if (liveHasGpo && localNested < 1) {
    gaps.push(`nestedOptions missing`);
  }
  // The option builder drives the PDP flow — headings, conditional copy,
  // swatch colours and defaults must all be captured, not just the fields.
  const localElements = Array.isArray(local.optionElements)
    ? local.optionElements.length
    : 0;
  if (liveHasGpo && localNested > 0 && localElements < 1) {
    gaps.push(`optionElements missing`);
  }
  if (liveHasGpo && /Do the Job Right/i.test(html || "") && localTools < 1) {
    gaps.push(`doTheJobRight`);
  }
  if (livePrice > 0 && Math.abs(Number(local.price || 0) - livePrice) > 0.02) {
    gaps.push(`price ${local.price}!=${livePrice}`);
  }
  if (!handle) gaps.push(`no ufhsHandle`);

  // Coverage axis present live but empty locally
  const hasCoverageLive = liveOptions.some((o) =>
    /coverage/i.test(typeof o === "string" ? o : o?.name || ""),
  );
  const localCoverage = local.coverage?.values?.length || 0;
  if (hasCoverageLive && localCoverage < 1) gaps.push(`coverage`);

  // Blocks added in parity v2
  const liveManuals = countLive(html, /pdp_manual_link/gi);
  const localManuals = (local.manuals || []).length;
  if (liveManuals > localManuals) {
    gaps.push(`manuals ${localManuals}<${liveManuals}`);
  }
  const liveInfo = countLive(html, /\btt__box\b/gi);
  const localInfo = (local.optionInfo || []).length;
  if (liveInfo > 0 && localInfo < 1) gaps.push(`optionInfo`);
  const liveBadge = /data-badge-id="[^"]+"/i.test(html || "");
  if (liveBadge && !(local.badges || []).length) gaps.push(`badges`);
  const liveBanner = /class="[^"]*\bproduct-banner\b/i.test(html || "");
  if (liveBanner && !local.promoBanner?.image) gaps.push(`promoBanner`);
  // measureMyRoom must match the live page in BOTH directions
  if (!liveHasMeasure && local.specs?.hasMeasureMyRoom === true) {
    gaps.push(`measureMyRoom stale`);
  }
  const liveName = String(productJs.title || "").trim();
  if (liveName && liveName !== String(local.name || "").trim()) {
    gaps.push(`name`);
  }
  if (Number(local.specs?.parityVersion || 0) < PARITY_VERSION) {
    gaps.push(`parityVersion<${PARITY_VERSION}`);
  }

  return {
    handle,
    name: local.name,
    gaps,
    live: {
      gallery: liveGallery,
      options: liveOptions.length,
      variants: liveVariants.length,
      measure: liveHasMeasure,
      gpo: liveHasGpo,
      price: livePrice,
      manuals: liveManuals,
      optionInfo: liveInfo,
      badge: liveBadge,
      banner: liveBanner,
    },
    local: {
      gallery: localImages.length,
      options: localOptions.length,
      variants: localVariants.length,
      nested: localNested,
      elements: localElements,
      tools: localTools,
      measure: local.specs?.hasMeasureMyRoom === true,
      price: local.price,
      manuals: localManuals,
      optionInfo: localInfo,
      badges: (local.badges || []).length,
      banner: Boolean(local.promoBanner?.image),
      parityVersion: Number(local.specs?.parityVersion || 0),
    },
  };
}

function runEnrichBatch() {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      RESUME: "1",
      CONCURRENCY: String(process.env.ENRICH_CONCURRENCY || "1"),
      REQUEST_GAP_MS: String(REQUEST_GAP_MS),
      SKIP_IMAGES: process.env.SKIP_IMAGES || "0",
      DRY_RUN: DRY_RUN ? "1" : "0",
    };
    delete env.ONLY_HANDLE;
    log("Launching enrich-ufhs-products.cjs for flagged products…");
    const child = spawn(
      process.execPath,
      ["--require", "./scripts/mongo-dns.cjs", "scripts/enrich-ufhs-products.cjs"],
      {
        cwd: path.join(__dirname, ".."),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (d) => process.stdout.write(d));
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("close", (code) => resolve(code));
  });
}

async function main() {
  fs.writeFileSync(LOG, `UFHS parity ${new Date().toISOString()}\n`);
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("UFHS brand not found");

  const done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    try {
      for (const h of JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []) {
        done.add(String(h));
      }
    } catch {
      /* ignore */
    }
  }

  const filter = {
    brand: brand._id,
    ...(ONLY_HANDLE ? { "specs.ufhsHandle": ONLY_HANDLE } : {}),
  };
  let products = await db
    .collection("products")
    .find(filter)
    .project({
      name: 1,
      price: 1,
      images: 1,
      description: 1,
      variants: 1,
      shopifyOptions: 1,
      coverage: 1,
      nestedOptions: 1,
      doTheJobRight: 1,
      optionElements: 1,
      optionInfo: 1,
      manuals: 1,
      badges: 1,
      promoBanner: 1,
      specs: 1,
    })
    .toArray();

  if (!ONLY_HANDLE) {
    products = products.filter(
      (p) => p.specs?.ufhsHandle && !done.has(String(p.specs.ufhsHandle)),
    );
  }
  if (LIMIT > 0) products = products.slice(0, LIMIT);

  log(
    `Auditing ${products.length} UFHS products concurrency=${CONCURRENCY} fix=${FIX ? 1 : 0}`,
  );

  const report = [];
  const toFixIds = [];
  let needsFix = 0;
  let okCount = 0;
  let fail = 0;

  await mapPool(products, CONCURRENCY, async (product, idx) => {
    const handle = String(product.specs?.ufhsHandle || "").trim();
    const label = `[${idx + 1}/${products.length}]`;
    if (!handle) {
      log(`${label} skip no handle`);
      return;
    }
    try {
      const jsRes = await fetchWithRetry(`${BASE}/products/${handle}.js`);
      const productJs = await jsRes.json();
      await delay(REQUEST_GAP_MS);
      let html = "";
      try {
        const htmlRes = await fetchWithRetry(`${BASE}/products/${handle}`);
        html = await htmlRes.text();
      } catch (e) {
        log(`${label} html warn ${handle}: ${e.message}`);
      }
      await delay(REQUEST_GAP_MS);

      const row = analyzeGaps(product, productJs, html);
      report.push(row);

      if (!row.gaps.length) {
        okCount++;
        log(`${label} OK ${handle}`);
      } else {
        needsFix++;
        toFixIds.push(product._id);
        log(`${label} GAP ${handle}: ${row.gaps.join(", ")}`);
      }

      done.add(handle);
      if (done.size % 20 === 0) {
        fs.writeFileSync(
          PROGRESS,
          JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
        );
      }
    } catch (e) {
      fail++;
      const msg = String(e.message || e);
      report.push({
        handle,
        name: product.name,
        gaps: [`error: ${msg}`],
      });
      log(`${label} ✗ ${handle}: ${msg}`);
      if (/HTTP 404/.test(msg)) done.add(handle);
    }
  });

  // A single-handle spot check must not wipe the full-run coverage record.
  if (!ONLY_HANDLE) {
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );
  }
  fs.writeFileSync(
    REPORT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        totals: {
          checked: report.length,
          ok: okCount,
          needsFix,
          fail,
        },
        rows: report.filter((r) => r.gaps?.length),
      },
      null,
      2,
    ),
  );

  log(
    `Audit complete. checked=${report.length} ok=${okCount} needsFix=${needsFix} fail=${fail}`,
  );
  log(`Report: ${REPORT}`);

  if (FIX && toFixIds.length && !DRY_RUN) {
    // Clear enrichedAt so enrich RESUME=1 picks these up
    const r = await db.collection("products").updateMany(
      { _id: { $in: toFixIds } },
      { $unset: { "specs.enrichedAt": "" }, $set: { updatedAt: new Date() } },
    );
    log(`Flagged ${r.modifiedCount} products for re-enrich`);
    await mongoose.disconnect();
    const code = await runEnrichBatch();
    log(`Enrich batch exit=${code}`);
    process.exit(code || 0);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
