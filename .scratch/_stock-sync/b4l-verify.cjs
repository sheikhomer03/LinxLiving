// Bathroom4Less — independent, read-only verification of the out-of-stock plan.
// 1) classify every product of ours against the live listing; 2) re-check random samples page by page.
const fs = require("fs"), path = require("path"), dns = require("dns");
const ROOT = "/Users/niazig/Desktop/linxliving/LinxLiving";
const { env, sleep } = require(path.join(__dirname, "shopify-lib.cjs"));
const { MongoClient } = require(path.join(ROOT, "node_modules/mongodb"));
dns.setServers((env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()));
const ORIGIN = "https://www.bathroom4less.co.uk";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const handleOf = (u) => (String(u || "").match(/\/products\/([^/?#]+)/) || [])[1] || null;
const pick = (a, n) => [...a].sort(() => Math.random() - 0.5).slice(0, n);

(async () => {
  const live = new Map(); // handle -> Map(sku -> available)
  for (let page = 1; page < 100; page++) {
    const d = await (await fetch(`${ORIGIN}/products.json?limit=250&page=${page}`, { headers: { "user-agent": UA } })).json();
    if (!d.products.length) break;
    for (const p of d.products) live.set(p.handle, new Map(p.variants.map((v) => [String(v.sku || "").trim(), v.available])));
    await sleep(700);
  }
  const c = await new MongoClient(env.MONGODB_URI, { maxPoolSize: 2 }).connect();
  const b = await c.db().collection("brands").findOne({ slug: "bathroom4less" });
  const ours = await c.db().collection("products").find({ brand: b._id }).project({ name: 1, slug: 1, sourceUrl: 1, stock: 1, stockStatus: 1, isOutOfStock: 1, "variants.sku": 1, "variants.name": 1, "variants.available": 1 }).toArray();
  await c.close();

  const groups = { gone: [], allOut: [], partial: [], inStock: [], unmatched: [] };
  for (const p of ours) {
    const h = handleOf(p.sourceUrl), l = live.get(h);
    const ourOut = p.stockStatus === "out_of_stock" || p.variants.every((v) => v.available === false);
    const rec = { p, h, ourOut };
    if (!l) { groups.gone.push(rec); continue; }
    const st = p.variants.map((v) => l.get(String(v.sku || "").trim()));
    if (st.some((x) => x === undefined)) { groups.unmatched.push(rec); continue; }
    rec.sold = p.variants.filter((v, k) => !st[k]).map((v) => v.name || v.sku);
    if (st.every((x) => !x)) groups.allOut.push(rec); else if (st.some((x) => !x)) groups.partial.push(rec); else groups.inStock.push(rec);
  }
  const already = (g) => g.filter((r) => r.ourOut).length;
  console.log("\n=== 1. Breakdown of all", ours.length, "products (live listing:", live.size, "products) ===");
  console.log(`Gone from live (not listed)        : ${groups.gone.length}   — already out of stock in our DB: ${already(groups.gone)}`);
  console.log(`On live, every option sold out     : ${groups.allOut.length}   — already out of stock in our DB: ${already(groups.allOut)}`);
  console.log(`On live, some options sold out     : ${groups.partial.length}`);
  console.log(`On live, all in stock              : ${groups.inStock.length}   (left untouched)`);
  console.log(`Could not match SKUs (skipped)     : ${groups.unmatched.length}`);

  console.log("\n=== 2. Independent page-by-page re-check (random samples) ===");
  let ok = 0, bad = [];
  for (const r of pick(groups.gone, 40)) {
    const res = await fetch(`${ORIGIN}/products/${r.h}.js`, { headers: { "user-agent": UA } });
    if (res.status === 404) ok++; else bad.push(`gone? ${r.h} → HTTP ${res.status}`);
    await sleep(600);
  }
  console.log(`Gone sample: ${ok}/40 return 404 on their site`);
  let ok2 = 0, ok2page = 0;
  const sampleOut = [...pick(groups.allOut, 25), ...pick(groups.partial, 15)];
  for (const r of sampleOut) {
    const res = await fetch(`${ORIGIN}/products/${r.h}.js`, { headers: { "user-agent": UA } });
    if (res.status !== 200) { bad.push(`${r.h} → HTTP ${res.status}`); await sleep(600); continue; }
    const j = await res.json(); const m = new Map(j.variants.map((v) => [String(v.sku || "").trim(), v.available]));
    const agree = r.p.variants.every((v) => { const want = !r.sold.includes(v.name || v.sku); return m.get(String(v.sku || "").trim()) === want; });
    if (agree) ok2++; else bad.push(`mismatch ${r.h}`);
    const html = await (await fetch(`${ORIGIN}/products/${r.h}`, { headers: { "user-agent": UA } })).text();
    if (/sold out/i.test(html)) ok2page++;
    await sleep(800);
  }
  console.log(`Sold-out sample: ${ok2}/${sampleOut.length} agree option-by-option with the product's own page; ${ok2page}/${sampleOut.length} pages show "Sold out"`);
  if (bad.length) console.log("Disagreements:", bad.slice(0, 10));

  console.log("\n=== 3. Links to check yourself ===");
  const link = (r, tag) => console.log(`${tag} | ${r.p.name.slice(0, 70)}${r.sold && tag === "SOME OUT" ? " — sold out: " + r.sold.slice(0, 3).join(", ") : ""}\n   ours: https://www.linxsquare.co.uk/products/${r.p.slug}\n   live: ${ORIGIN}/products/${r.h}`);
  pick(groups.gone, 2).forEach((r) => link(r, "GONE (404)"));
  pick(groups.allOut, 3).forEach((r) => link(r, "ALL OUT"));
  pick(groups.partial, 2).forEach((r) => link(r, "SOME OUT"));
  pick(groups.inStock, 1).forEach((r) => link(r, "IN STOCK"));
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
