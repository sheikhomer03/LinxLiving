// PORCELANOSA product finder: which of our products' pages no longer exist (302 → /en/error.html or 404/410).
// Read-only. Resumable → .scratch/porcelanosa/pages.jsonl
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const OUT = path.join(ROOT, ".scratch/porcelanosa/pages.jsonl");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
(async () => {
  const c = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }).connect();
  const b = await c.db().collection("brands").findOne({ slug: "porcelanosagrupo" });
  const ps = await c.db().collection("products").find({ brand: b._id }).project({ "specs.sourceUrl": 1 }).toArray();
  await c.close();
  const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).url) : []);
  const urls = [...new Set(ps.map((p) => p.specs?.sourceUrl).filter(Boolean))].filter((u) => !done.has(u));
  console.log(`${new Date().toISOString()} to check: ${urls.length} (already ${done.size})`);
  let i = 0, n = 0;
  const worker = async () => {
    while (i < urls.length) {
      const u = urls[i++]; let rec = { url: u };
      for (let a = 0; a < 5; a++) {
        try {
          const r = await fetch(u, { headers: { "user-agent": UA }, redirect: "manual" });
          r.body?.cancel?.();
          if (r.status === 429 || r.status >= 500) { await sleep(20000 * (a + 1)); continue; }
          rec = { url: u, status: r.status, location: r.headers.get("location") || "" };
          break;
        } catch (e) { rec = { url: u, error: e.cause?.code || e.message }; await sleep(5000 * (a + 1)); }
      }
      fs.appendFileSync(OUT, JSON.stringify(rec) + "\n");
      if (++n % 250 === 0) console.log(`${new Date().toISOString()} ${n}/${urls.length}`);
      await sleep(300);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`${new Date().toISOString()} DONE ${n}`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
