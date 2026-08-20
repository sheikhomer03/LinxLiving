/**
 * Find a supplier site's videos OUTSIDE product galleries — homepage, content
 * pages, collections/categories and blog articles — then check each YouTube id
 * still plays.
 *
 *   node scripts/audit-supplier-videos.cjs https://www.flooringsales.co.uk/
 *
 * Env: CONCURRENCY (3), GAP (250ms), MAX_PAGES (600)
 *
 * Two traps this handles, both hit on an earlier run:
 *  - Shopify themes ship a `shopify.webm` placeholder and a JS regex listing
 *    video hostnames (wistia|youku|hulu|…). Both look like video references in
 *    raw HTML and made every page on a site appear to have one.
 *  - A YouTube link on the page says nothing about whether the video still
 *    exists. oEmbed 404s under rate limiting too, so liveness is judged from
 *    the thumbnail, which is not rate limited.
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.argv[2];
if (!ROOT) {
  console.error("usage: node scripts/audit-supplier-videos.cjs <site-url>");
  process.exit(1);
}
const BASE = ROOT.replace(/\/+$/, "");
const HOST = new URL(BASE).hostname.replace(/^www\./, "");
const OUT = path.join(__dirname, `_tmp-videos-${HOST.replace(/\W+/g, "-")}.json`);

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const GAP = Math.max(0, Number(process.env.GAP || 250));
const MAX_PAGES = Number(process.env.MAX_PAGES || 600);
/**
 * Some suppliers block browser-spoofing user agents but serve an identified
 * crawler — flooringsales.co.uk 403s a bare Chrome string (see the note in
 * scripts/fsl-session.cjs). Override with SCRAPE_UA when a site needs it.
 */
const UA = {
  "User-Agent":
    process.env.SCRAPE_UA ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxVideoAudit/1.0",
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 429 || r.status === 503) { await delay(1500 * a); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    } catch (e) { if (a === 3) throw e; await delay(500 * a); }
  }
}

/** Theme scaffolding that is not page content. */
const BOILERPLATE = [/^shopify\.webm$/i, /wistia\\\./, /youku/, /hulu/, /googletagmanager/i];

function findVideos(html) {
  const hits = [];
  const push = (kind, value) => {
    const v = String(value).trim();
    if (!v || BOILERPLATE.some((re) => re.test(v))) return;
    if (!hits.some((h) => h.value === v)) hits.push({ kind, value: v });
  };
  for (const m of html.matchAll(/<video[^>]*>[\s\S]{0,800}?<\/video>/gi)) {
    const src = m[0].match(/src=["']([^"']+)["']/i);
    push("video-tag", src ? src[1] : "(inline <video>)");
  }
  for (const m of html.matchAll(/https?:\/\/cdn\.shopify\.com\/videos\/[^"'\\\s>)]+/gi)) push("self-hosted", m[0]);
  for (const m of html.matchAll(/[^"'\s>]+\.(?:mp4|webm|mov|m4v)(?:\?[^"'\s>]*)?/gi)) {
    if (!/cdn\.shopify\.com\/videos/i.test(m[0])) push("file", m[0]);
  }
  for (const m of html.matchAll(/(?:youtube\.com\/(?:embed|watch|shorts)[^"'\s<>\\]*|youtu\.be\/[A-Za-z0-9_-]{6,}|youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{6,})/gi)) {
    push("youtube", m[0]);
  }
  for (const m of html.matchAll(/(?:player\.)?vimeo\.com\/(?:video\/)?\d{6,}/gi)) push("vimeo", m[0]);
  for (const m of html.matchAll(/(?:wistia\.(?:com|net)|loom\.com|vidyard|brightcove)\/[^"'\s<>]{0,80}/gi)) push("other-host", m[0]);
  return hits;
}

function youtubeId(v) {
  const m =
    v.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ||
    v.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ||
    v.match(/(?:youtube|youtube-nocookie)\.com\/embed\/([A-Za-z0-9_-]{6,})/) ||
    v.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

/** Live videos serve a real thumbnail; dead ones 404 every size. */
async function isLive(id) {
  try {
    const r = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, { headers: UA });
    if (!r.ok) return false;
    const len = Number(r.headers.get("content-length") || 0);
    return len > 2000; // the grey placeholder is tiny
  } catch { return false; }
}

async function youtubeTitle(id) {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
      { headers: UA },
    );
    if (r.ok) return (await r.json()).title || "";
  } catch { /* fall through */ }
  return "";
}

async function collectUrls() {
  const urls = new Set([BASE + "/"]);
  let subs = [];
  try {
    const root = await get(`${BASE}/sitemap.xml`);
    subs = [...root.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  } catch (e) {
    console.log("no /sitemap.xml:", e.message);
  }
  const isProductMap = (u) => /sitemap[-_]?products?/i.test(u);
  if (subs.length && subs.every((s) => /\.xml/i.test(s))) {
    for (const s of subs) {
      if (isProductMap(s) || /agentic_discovery/i.test(s)) continue;
      try {
        const xml = await get(s);
        for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(m[1].replace(/&amp;/g, "&"));
      } catch { /* skip this sub-sitemap */ }
      await delay(GAP);
    }
  } else {
    for (const s of subs) if (!/\.xml/i.test(s)) urls.add(s);
  }
  // Never scan product pages — gallery videos are explicitly out of scope.
  return [...urls].filter((u) => !/\/products?\//i.test(u)).slice(0, MAX_PAGES);
}

(async () => {
  console.log("site:", BASE);
  const urls = await collectUrls();
  console.log("non-product urls to scan:", urls.length, "\n");

  const results = [];
  let done = 0;
  const queue = urls.slice();
  async function work() {
    while (queue.length) {
      const u = queue.shift();
      done++;
      try {
        const hits = findVideos(await get(u));
        if (hits.length) results.push({ url: u, hits });
      } catch (e) { console.log("  fail", u, e.message); }
      if (done % 50 === 0) console.log(`  [${done}/${urls.length}] pages with video: ${results.length}`);
      await delay(GAP);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, work));

  const ids = new Map();
  const others = new Map();
  for (const r of results) {
    const page = r.url.replace(BASE, "") || "/";
    for (const h of r.hits) {
      if (h.kind === "youtube") {
        const id = youtubeId(h.value);
        if (!id) continue;
        if (!ids.has(id)) ids.set(id, new Set());
        ids.get(id).add(page);
      } else {
        if (!others.has(h.value)) others.set(h.value, { kind: h.kind, pages: new Set() });
        others.get(h.value).pages.add(page);
      }
    }
  }

  console.log(`\nscanned ${done} pages — ${results.length} carry video`);
  console.log(`distinct youtube ids: ${ids.size} | distinct non-youtube: ${others.size}\n`);

  const youtube = [];
  for (const [id, pages] of ids) {
    const live = await isLive(id);
    const title = live ? await youtubeTitle(id) : "";
    youtube.push({ id, live, title, pages: [...pages] });
    console.log(live ? "LIVE" : "DEAD", id.padEnd(13), (title || "").slice(0, 68));
    await delay(GAP);
  }

  const files = [...others.entries()].map(([value, v]) => ({ value, kind: v.kind, pages: [...v.pages] }));
  if (files.length) {
    console.log("\nNON-YOUTUBE:");
    for (const f of files) console.log(` [${f.kind}] ${f.value.slice(0, 120)}\n     pages: ${f.pages.join(", ")}`);
  }

  const liveCount = youtube.filter((v) => v.live).length;
  console.log(`\nyoutube live: ${liveCount} / ${youtube.length}`);
  fs.writeFileSync(OUT, JSON.stringify({ site: BASE, pages: results, youtube, files }, null, 2));
  console.log("written:", path.relative(process.cwd(), OUT));
})().catch((e) => { console.error(e.stack); process.exit(1); });
