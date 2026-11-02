// Read-only: snapshot Frontline's public Stock Checker (https://www.frontlinebathrooms.co.uk/stock-checker/), every page.
//   node .scratch/_stock-sync/fl-snapshot.cjs      → .scratch/frontlinebathrooms/stock-<date>.jsonl  (resumable by page)
const fs = require("fs"), path = require("path");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const OUT = path.join(ROOT, `.scratch/frontlinebathrooms/stock-${new Date().toISOString().slice(0, 10)}.jsonl`);
const BASE = "https://www.frontlinebathrooms.co.uk/stock-checker/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&#8211;/g, "-").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();
let stopped = null;

function parse(html) {
  const total = (html.match(/(\d+) result\(s\) found/) || [])[1];
  const rows = [];
  for (const e of html.split('class="stock-checker__entry"').slice(1)) {
    const cols = [...e.matchAll(/<div class="col-\d px-3">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
    const cls = (e.match(/stock-status--([a-z-]+)/) || [])[1] || null;
    rows.push({ code: text(cols[0]), desc: text(cols[1]), rrp: text(cols[2]), status: text(cols[3]), statusClass: cls, availability: text(cols[4]) });
  }
  return { total: total ? Number(total) : null, rows };
}

async function get(page) {
  const url = page === 1 ? `${BASE}?q=` : `${BASE}page/${page}/?q`;
  for (let a = 0; a < 4; a++) {
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-GB" } }).catch(() => null);
    if (!r) { await sleep(5000 * (a + 1)); continue; }
    if (r.status === 429 || r.status === 403) { stopped = `HTTP ${r.status} on page ${page}`; return null; }
    if (r.status >= 500) { await sleep(5000 * (a + 1)); continue; }
    const h = await r.text();
    if (!/stock-checker__results/.test(h)) { stopped = `unexpected page (bot check?) on page ${page}`; return null; }
    return parse(h);
  }
  stopped = `network errors on page ${page} (resume later)`; return null;
}

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const done = new Set();
  if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, "utf8").split("\n")) if (l) done.add(JSON.parse(l).page);
  const first = await get(1); if (!first) return console.log("STOPPED:", stopped);
  const pages = Math.ceil(first.total / 4);
  const out = fs.createWriteStream(OUT, { flags: "a" });
  if (!done.has(1)) out.write(JSON.stringify({ page: 1, total: first.total, rows: first.rows }) + "\n");
  console.log(`total ${first.total} codes, ${pages} pages`);
  let next = 2, n = 0;
  async function worker() {
    while (next <= pages && !stopped) {
      const p = next++; if (done.has(p)) continue;
      const r = await get(p); if (!r) break;
      out.write(JSON.stringify({ page: p, total: r.total, rows: r.rows }) + "\n");
      if (++n % 100 === 0) console.log(`${n} pages`);
      await sleep(500);
    }
  }
  await Promise.all([worker(), worker()]);
  out.end();
  console.log(stopped ? `STOPPED: ${stopped}` : `DONE ${pages} pages`);
})();
