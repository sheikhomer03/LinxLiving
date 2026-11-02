// Spectra — READ-ONLY check against spectratileandhome.com (run from your own terminal; this session can't reach the site).
// Writes .scratch/spectra/check-<date>.json; changes nothing in the DB or Shopify.
//   cd ~/Desktop/linxliving/LinxLiving && node .scratch/_stock-sync/spectra-check.cjs
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { env } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const ORIGIN = "https://spectratileandhome.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const live = new Map();
  for (let p = 1; p < 20; p++) {
    const r = await fetch(`${ORIGIN}/products.json?limit=250&page=${p}`, { headers: { "user-agent": UA } });
    if (!r.ok) { console.log("products.json HTTP", r.status); break; }
    const t = await r.text(); if (/captcha|Verifying your connection/i.test(t)) { console.log("BOT CHECK — stopping"); return; }
    const d = JSON.parse(t); if (!d.products.length) break;
    d.products.forEach((x) => live.set(x.handle, { avail: x.variants.some((v) => v.available), bySku: Object.fromEntries(x.variants.filter((v) => v.sku).map((v) => [String(v.sku).trim(), v.available])) }));
    await sleep(900);
  }
  const c = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }).connect();
  const b = await c.db().collection("brands").findOne({ slug: "spectra" });
  const ps = await c.db().collection("products").find({ brand: b._id }).project({ name: 1, slug: 1, "specs.sourceUrl": 1, "variants.sku": 1 }).toArray();
  await c.close();
  const rows = [];
  for (const p of ps) {
    const u = p.specs?.sourceUrl || ""; const h = (u.match(/\/products\/([^/?#]+)/) || [])[1];
    let l = live.get(h), how = "listing";
    if (!l && h) { const r = await fetch(`${ORIGIN}/products/${h}.js`, { headers: { "user-agent": UA } }); how = "page " + r.status; if (r.status === 200) { const j = await r.json(); l = { avail: j.available, bySku: Object.fromEntries(j.variants.filter((v) => v.sku).map((v) => [String(v.sku).trim(), v.available])) }; } await sleep(700); }
    rows.push({ id: String(p._id), name: p.name, slug: p.slug, url: u, how, live: !h ? "NO URL" : l ? (l.avail ? "IN" : "OUT") : "GONE",
      options: (p.variants || []).map((v) => ({ sku: v.sku, live: l ? l.bySku[String(v.sku || "").trim()] ?? "NOT FOUND" : false })) });
  }
  fs.mkdirSync(path.join(ROOT, ".scratch/spectra"), { recursive: true });
  const out = path.join(ROOT, `.scratch/spectra/check-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify(rows, null, 1));
  const s = {}; rows.forEach((r) => (s[r.live] = (s[r.live] || 0) + 1));
  console.log("live products", live.size, "| ours", rows.length, s, "| options out:", rows.reduce((a, r) => a + r.options.filter((o) => o.live === false).length, 0));
  console.log("saved", out, "— tell Claude 'spectra check done'");
})().catch((e) => { console.error("ERR", e.cause?.code || e.message); process.exit(1); });
