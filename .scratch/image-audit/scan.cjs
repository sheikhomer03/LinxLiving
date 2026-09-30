/**
 * Read-only image audit of every product in DB1 + DB2 (no writes anywhere but
 * this folder). For each product:
 *   - does its first image load (HTTP 200, image/*)?
 *   - if not: which of its other images / variant images load, and does the
 *     ORIGINAL supplier photo recorded in shopifyImages[].sourceUrl still load?
 * Writes .scratch/image-audit/results.jsonl (one line per product with a problem)
 * and summary.json. Resumable by product id.
 */
const path = require("path");
const ROOT = path.join(__dirname, "../..");
require(path.join(ROOT, "node_modules/dotenv")).config({ path: path.join(ROOT, ".env.local"), quiet: true });
require("dns").setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const { MongoClient } = require(path.join(ROOT, "node_modules/mongodb"));
const OUT = path.join(__dirname, "results.jsonl");
const DONE = path.join(__dirname, "done.txt");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const cache = new Map();

async function loads(u) {
  if (!u || !/^https?:\/\//.test(u)) return false;
  if (cache.has(u)) return cache.get(u);
  const p = (async () => {
    for (let t = 0; t < 2; t++) {
      try {
        let r = await fetch(u, { method: "HEAD", headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
        if (r.status === 405 || r.status === 403) r = await fetch(u, { headers: { "user-agent": UA, range: "bytes=0-0" }, signal: AbortSignal.timeout(15000) });
        if (r.status === 404 || r.status === 410) return false;
        if (r.ok || r.status === 206) return /^image\//.test(r.headers.get("content-type") || "") || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(u);
      } catch {}
    }
    return false;
  })();
  cache.set(u, p);
  return p;
}

(async () => {
  const done = new Set(fs.existsSync(DONE) ? fs.readFileSync(DONE, "utf8").split("\n").filter(Boolean) : []);
  const out = fs.createWriteStream(OUT, { flags: "a" });
  const doneOut = fs.createWriteStream(DONE, { flags: "a" });
  const summary = { checked: 0, ok: 0, broken: 0, fixableFromOtherImage: 0, fixableFromSupplier: 0, noImageAtAll: 0, bySource: {} };
  for (const [db, uri] of [["DB1", process.env.MONGODB_URI], ["DB2", process.env.MONGODB_URL2]]) {
    const c = await MongoClient.connect(uri);
    const docs = await c.db().collection("products").find({}, { projection: { name: 1, images: 1, shopifyImages: 1, "variants.imageUrl": 1, "variants.images": 1, category: 1, price: 1, "specs.source": 1, shopifyProductId: 1 } }).toArray();
    await c.close();
    const todo = docs.filter((d) => !done.has(`${db}:${d._id}`));
    log(`${db}: ${docs.length} products, ${todo.length} to check`);
    let i = 0;
    await Promise.all(Array.from({ length: 48 }, async () => {
      while (i < todo.length) {
        const d = todo[i++];
        const src = d.specs?.source || "(none)";
        const bs = (summary.bySource[`${db} ${src}`] = summary.bySource[`${db} ${src}`] || { checked: 0, broken: 0, fixable: 0, none: 0 });
        const first = (d.images || [])[0];
        const ok = await loads(first);
        summary.checked++; bs.checked++;
        if (ok) summary.ok++;
        else {
          summary.broken++; bs.broken++;
          const others = [...new Set([...(d.images || []).slice(1), ...(d.variants || []).flatMap((v) => [v.imageUrl, ...(v.images || [])])].filter(Boolean))];
          const goodOthers = [];
          for (const u of others.slice(0, 12)) if (await loads(u)) goodOthers.push(u);
          const supplier = [...new Set((d.shopifyImages || []).map((x) => x.sourceUrl).filter(Boolean))];
          const goodSupplier = [];
          for (const u of supplier.slice(0, 12)) if (await loads(u)) goodSupplier.push(u);
          const kind = goodOthers.length ? "other-image" : goodSupplier.length ? "supplier" : "none";
          if (kind === "other-image") summary.fixableFromOtherImage++;
          else if (kind === "supplier") summary.fixableFromSupplier++;
          else summary.noImageAtAll++;
          if (kind === "none") bs.none++; else bs.fixable++;
          out.write(JSON.stringify({ db, id: String(d._id), name: d.name, source: src, category: d.category || "", price: d.price, shopifyProductId: d.shopifyProductId || null, firstImage: first || null, kind, goodOthers, goodSupplier, supplierCount: supplier.length }) + "\n");
        }
        doneOut.write(`${db}:${d._id}\n`);
        if (summary.checked % 2000 === 0) log(`checked ${summary.checked} · broken ${summary.broken} (fixable ${summary.fixableFromOtherImage + summary.fixableFromSupplier}, none ${summary.noImageAtAll})`);
      }
    }));
  }
  fs.writeFileSync(path.join(__dirname, "summary.json"), JSON.stringify(summary, null, 1));
  log(`DONE ${JSON.stringify({ checked: summary.checked, ok: summary.ok, broken: summary.broken, fixableFromOtherImage: summary.fixableFromOtherImage, fixableFromSupplier: summary.fixableFromSupplier, noImageAtAll: summary.noImageAtAll })}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
