// Read-only: check every Noken product's noken.com page (specs.sourceUrl): 200 = still listed, 404 = removed.
//   node .scratch/_stock-sync/nk-snapshot.cjs → .scratch/noken/pages-<date>.jsonl (resumable)
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const OUT = path.join(ROOT, `.scratch/noken/pages-${new Date().toISOString().slice(0, 10)}.jsonl`);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
let stopped = null;
async function get(url) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" }).catch(() => null);
    if (!r) { await sleep(8000 * (a + 1)); continue; }
    if (r.status === 429 || r.status === 403) { stopped = `HTTP ${r.status} on ${url}`; return null; }
    if (r.status >= 500) { await sleep(8000 * (a + 1)); continue; }
    const h = await r.text();
    const title = (h.match(/<title>([^<]*)/) || [])[1] || "";
    if (/captcha|are you human/i.test(h) && !/Noken/.test(title)) { stopped = `bot check on ${url}`; return null; }
    return { status: r.status, finalUrl: r.url, title: title.trim().slice(0, 120) };
  }
  stopped = `network errors on ${url} (resume later)`; return null;
}
(async () => {
  const c = new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }); await c.connect();
  const ps = await c.db().collection("products").find({ brand: new ObjectId("6a6b9d78a00dad2200fa2fd0") }).project({ "specs.sourceUrl": 1 }).toArray(); await c.close();
  const urls = [...new Set(ps.map((p) => p.specs && p.specs.sourceUrl).filter(Boolean))];
  const done = new Set(); if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, "utf8").split("\n")) if (l) done.add(JSON.parse(l).url);
  const todo = urls.filter((u) => !done.has(u)); const out = fs.createWriteStream(OUT, { flags: "a" });
  console.log(`${urls.length} unique pages, ${todo.length} to check`);
  let i = 0, n = 0;
  async function worker() { while (i < todo.length && !stopped) { const u = todo[i++]; const r = await get(u); if (!r) break; out.write(JSON.stringify({ url: u, ...r }) + "\n"); if (++n % 200 === 0) console.log(`${n} checked`); await sleep(500); } }
  await Promise.all([worker(), worker()]); out.end();
  console.log(stopped ? `STOPPED: ${stopped}` : `DONE ${n}`);
})();
