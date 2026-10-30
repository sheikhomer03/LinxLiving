// Read-only: snapshot Better Bathrooms live availability for every product/variant we hold.
// One request per product page (ProductGroup.hasVariant gives sku → availability for the whole group),
// plus the variant's own page for any of our SKUs the group doesn't list. Resumable (skips URLs already saved).
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { env, sleep } = require(path.join(ROOT, ".scratch/_stock-sync/shopify-lib.cjs"));
const { MongoClient, ObjectId } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const OUT = path.join(ROOT, ".scratch/betterbathrooms/stock-2026-10-30.jsonl");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BRAND = new ObjectId("6ab7b2c25a35f689d8457179");

function parse(html) {
  const dl = (k) => { const m = html.match(new RegExp(`'${k}'\\s*:\\s*'([^']*)'`)); return m ? m[1] : null; };
  const out = { pageSku: dl("id"), stockStatus: dl("stockStatus"), discontinued: dl("discontinued"), group: null, productAvail: null };
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    for (const it of j["@graph"] || [j]) {
      if (it["@type"] === "ProductGroup") out.group = (it.hasVariant || []).map((v) => [v.sku, (v.offers || {}).availability || null]);
      if (it["@type"] === "Product" && it.offers && it.offers.availability) out.productAvail = it.offers.availability;
    }
  }
  return out;
}

let stopped = null;
async function get(url) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-GB" }, redirect: "follow" }).catch(() => null);
    if (!r || r.status >= 500) { await sleep(10000 * (a + 1)); continue; }
    if (r.status === 429 || r.status === 403) { stopped = `HTTP ${r.status} on ${url}`; return null; }
    const html = await r.text();
    if (/captcha|verifying your connection|are you (a )?human/i.test(html) && !/schema\.org/.test(html)) { stopped = `bot check on ${url}`; return null; }
    return { status: r.status, finalUrl: r.url, ...(r.status === 200 ? parse(html) : {}) };
  }
  stopped = `network errors on ${url} (resume later)`; return null;
}

(async () => {
  const c2 = new MongoClient(env.MONGODB_URL2, { maxPoolSize: 2 });
  await c2.connect();
  const ps = await c2.db().collection("products").find({ brand: BRAND }).project({ sourceUrl: 1, "variants.sku": 1, "variants.sourceUrl": 1 }).toArray();
  await c2.close();
  const done = new Set(), saved = new Map();
  if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, "utf8").split("\n")) if (l) { const o = JSON.parse(l); done.add(o.url); saved.set(o.url, o); }
  const out = fs.createWriteStream(OUT, { flags: "a" });
  const save = (o) => { done.add(o.url); out.write(JSON.stringify(o) + "\n"); };
  const todo = ps.filter((p) => p.sourceUrl);
  let i = 0, n = 0;
  async function worker() {
    while (i < todo.length && !stopped) {
      const p = todo[i++];
      let page = done.has(p.sourceUrl) ? saved.get(p.sourceUrl) : await get(p.sourceUrl);
      if (stopped) break;
      if (page && !done.has(p.sourceUrl)) save({ url: p.sourceUrl, productId: String(p._id), ...page });
      // our SKUs not listed in this page's group → fetch that variant's own page
      const groupSkus = new Set(((page && page.group) || []).map((g) => g[0]).concat(page && page.pageSku ? [page.pageSku] : []));
      for (const v of p.variants || []) {
        if (!v.sourceUrl || done.has(v.sourceUrl) || (page && groupSkus.has(v.sku))) continue;
        const vp = await get(v.sourceUrl); if (stopped) break;
        if (vp) save({ url: v.sourceUrl, productId: String(p._id), ...vp });
        await sleep(100);
      }
      if (++n % 100 === 0) console.log(`${n}/${todo.length} products, ${done.size} pages`);
      await sleep(100);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  out.end();
  console.log(stopped ? `STOPPED: ${stopped}` : `DONE ${n}/${todo.length} products, ${done.size} pages`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
