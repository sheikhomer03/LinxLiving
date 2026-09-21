/**
 * Re-capture tilemountain.co.uk from the page's own data payload.
 *
 * The first crawl read the rendered HTML with regexes, which is why it came
 * back without datasheets, pack pricing, sibling colourways, samples, reviews
 * or real stock: the shop is a Nuxt front end over Magento, and every one of
 * those fields is in the `__NUXT_DATA__` island rather than in the markup.
 * This pass hydrates that payload instead, so what lands in the capture is the
 * same object the site itself renders from.
 *
 * Writes one JSON object per line to `tm-pdp-v2.jsonl` and resumes from what
 * is already there, so it can be stopped and restarted.
 *
 * Env:
 *   LIMIT=n        stop after n products
 *   CONCURRENCY=n  parallel fetches (default 4)
 *   FRESH=1        ignore an existing capture and start over
 *   URLS=a,b,c     capture just these slugs
 */
const path = require("path");
const fs = require("fs");

const ORIGIN = "https://www.tilemountain.co.uk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DATA =
  process.env.TM_DATA ||
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/a167de67-d47a-4f6e-aa8a-c11dee9e30bc/scratchpad";

const OUT = path.join(DATA, "tm-pdp-v2.jsonl");
const URLS_FILE = path.join(DATA, "tm-urls.json");
const LIMIT = Number(process.env.LIMIT) || Infinity;
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 4, 8));
const FRESH = process.env.FRESH === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, "accept-language": "en-GB,en;q=0.9" },
        signal: AbortSignal.timeout(45000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) {
      if (i === tries) throw e;
      await sleep(900 * i);
    }
  }
  return null;
}

/**
 * Nuxt serialises its payload in devalue's flat form: an array where every
 * value holds indices into the same array rather than nested objects. This
 * walks it back into a plain object, remembering nodes so the cycles the
 * format allows do not spin.
 */
function hydrate(flat) {
  const seen = new Map();
  const walk = (i) => {
    if (typeof i !== "number") return i;
    if (i < 0) return undefined;
    if (seen.has(i)) return seen.get(i);
    const v = flat[i];
    if (v === null || typeof v !== "object") { seen.set(i, v); return v; }
    if (Array.isArray(v)) {
      if (typeof v[0] === "string" && ["Date", "Set", "Map", "BigInt", "RegExp", "NaN"].includes(v[0])) {
        const out = v[0] === "Date" ? v[1] : v.slice(1).map(walk);
        seen.set(i, out);
        return out;
      }
      const arr = [];
      seen.set(i, arr);
      for (const c of v) arr.push(walk(c));
      return arr;
    }
    const obj = {};
    seen.set(i, obj);
    for (const [k, c] of Object.entries(v)) obj[k] = walk(c);
    return obj;
  };
  return walk(0);
}

/** The product object is the richest node carrying both a sku and a gallery. */
function findProduct(root) {
  let best = null;
  const seen = new Set();
  const scan = (o) => {
    if (!o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    if (!Array.isArray(o) && o.sku && o.name && (o.media_gallery || o.price_range)) {
      if (!best || Object.keys(o).length > Object.keys(best).length) best = o;
    }
    for (const v of Array.isArray(o) ? o : Object.values(o)) scan(v);
  };
  scan(root);
  return best;
}

/** Breadcrumbs and review bodies are rendered, not carried in the payload. */
function parseExtras(html) {
  const out = { breadcrumbs: [], jsonld: null };
  const ld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  for (const m of ld) {
    try {
      const j = JSON.parse(m[1]);
      const arr = Array.isArray(j) ? j : [j];
      for (const node of arr) {
        if (node["@type"] === "BreadcrumbList") {
          out.breadcrumbs = (node.itemListElement || []).map((e) => ({
            name: e.name || e.item?.name || "",
            url: typeof e.item === "string" ? e.item : e.item?.["@id"] || "",
          }));
        }
        if (node["@type"] === "Product") out.jsonld = node;
      }
    } catch {}
  }
  return out;
}

async function capture(slug) {
  const url = ORIGIN + (slug.startsWith("/") ? slug : "/" + slug);
  const html = await get(url);
  if (!html) return { slug, url, error: "404" };
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { slug, url, error: "no payload" };
  let product = null;
  try {
    product = findProduct(hydrate(JSON.parse(m[1])));
  } catch (e) {
    return { slug, url, error: "payload: " + e.message };
  }
  if (!product) return { slug, url, error: "no product node" };
  return { slug, url, capturedAt: new Date().toISOString(), product, ...parseExtras(html) };
}

async function main() {
  if (FRESH && fs.existsSync(OUT)) fs.rmSync(OUT);
  const done = new Set();
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { done.add(JSON.parse(line).slug); } catch {}
    }
  }
  let urls = process.env.URLS
    ? process.env.URLS.split(",").map((s) => s.trim()).filter(Boolean)
    : JSON.parse(fs.readFileSync(URLS_FILE, "utf8"));
  const todo = urls.filter((u) => !done.has(u)).slice(0, LIMIT === Infinity ? undefined : LIMIT);

  console.log("urls      : " + urls.length);
  console.log("already   : " + done.size);
  console.log("to capture: " + todo.length);
  console.log("");

  const stream = fs.createWriteStream(OUT, { flags: "a" });
  let i = 0, ok = 0, bad = 0;
  const started = Date.now();
  const worker = async () => {
    while (i < todo.length) {
      const slug = todo[i++];
      const n = i;
      try {
        const rec = await capture(slug);
        if (rec.error) bad += 1; else ok += 1;
        stream.write(JSON.stringify(rec) + "\n");
      } catch (e) {
        bad += 1;
        stream.write(JSON.stringify({ slug, error: e.message }) + "\n");
      }
      if (n % 50 === 0) {
        const rate = (Date.now() - started) / n;
        const left = Math.round((rate * (todo.length - n)) / 60000);
        console.log("  " + n + "/" + todo.length + "  ok " + ok + "  bad " + bad + "  ~" + left + "m left");
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await new Promise((r) => stream.end(r));
  console.log("");
  console.log("captured : " + ok);
  console.log("failed   : " + bad);
  console.log("file     : " + OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
