/**
 * Topps Tiles — full catalogue capture straight from the storefront JSON API.
 *
 * The earlier DOM scrape (topps-scrape.cjs) read every <img> on the page and
 * the nav menu as breadcrumbs, and never saw coverage, tiles per box or the
 * colour/size grouping. The storefront itself loads all of that as JSON from
 * /api/n/load, so this walks every product id through it instead.
 *
 * Cloudflare blocks plain HTTP, so requests are made from inside a stealth
 * browser page on the site (same origin, cleared challenge).
 *
 * Output (.scratch/toppstiles/v2/):
 *   attributes.json      attribute code → { label, options { id → {label, swatch} } }
 *   raw-products.jsonl   one line per live product (simple + configurable), verbosity 3
 *
 *   node scripts/topps-api-scrape.cjs [--max=16000] [--batch=150]
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-extra");
chromium.use(require("puppeteer-extra-plugin-stealth")());

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? Number(a.split("=")[1]) : d;
};
const MAX_ID = arg("max", 16000);
const BATCH = arg("batch", 150);
const OUT_DIR = path.join(__dirname, "../.scratch/toppstiles/v2");
const RAW = path.join(OUT_DIR, "raw-products.jsonl");
const ATTRS = path.join(OUT_DIR, "attributes.json");
const PROGRESS = path.join(OUT_DIR, "progress.json");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function openSite(browser) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("https://www.toppstiles.co.uk/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !document.title.includes("Just a moment"), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return page;
}

const apiGet = (page, url) =>
  page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: "include" });
    return { status: r.status, text: await r.text() };
  }, url);

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let page = await openSite(browser);

  if (!fs.existsSync(ATTRS)) {
    const { text } = await apiGet(page, "/api/p/static/js/retail/init.js?");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const out = {};
    for (const a of json.data.attribute || []) {
      const options = {};
      for (const o of a.options || []) options[o.value] = { label: String(o.label ?? "").trim(), swatch: o.swatch || "" };
      out[a.code] = { id: a.id, label: a.label, input: a.frontend_input, configurable: !!a.configurable, isSwatch: !!a.isSwatch, options };
    }
    fs.writeFileSync(ATTRS, JSON.stringify(out));
    console.log(`attributes: ${Object.keys(out).length}`);
  }

  const seen = new Set();
  if (fs.existsSync(RAW)) for (const l of fs.readFileSync(RAW, "utf8").split("\n")) if (l) seen.add(JSON.parse(l).id);
  let start = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, "utf8")).next : 1;
  console.log(`resuming at id ${start}, ${seen.size} products already captured`);

  for (let from = start; from <= MAX_ID; from += BATCH) {
    const ids = Array.from({ length: BATCH }, (_, i) => from + i).join(",");
    let got = null;
    for (let attempt = 1; attempt <= 6 && !got; attempt++) {
      try {
        const { status, text } = await apiGet(page, `/api/n/load?type=product&verbosity=3&ids=${ids}`);
        if (status !== 200 || text.startsWith("<")) throw new Error(`HTTP ${status}`);
        got = JSON.parse(text).result || [];
      } catch (e) {
        console.log(`  ids ${from}+: ${e.message} (attempt ${attempt})`);
        await delay(3000 * attempt);
        if (attempt >= 3) page = await openSite(browser).catch(() => page);
      }
    }
    if (!got) throw new Error(`gave up at id ${from}`);
    let added = 0;
    for (const p of got) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      fs.appendFileSync(RAW, JSON.stringify(p) + "\n");
      added++;
    }
    fs.writeFileSync(PROGRESS, JSON.stringify({ next: from + BATCH }));
    console.log(`ids ${from}-${from + BATCH - 1}: +${added} (total ${seen.size})`);
    await delay(700 + Math.random() * 600);
  }
  await browser.close();
  console.log(`done: ${seen.size} products`);
}

run().catch((e) => { console.error(e); process.exit(1); });
