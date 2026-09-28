/**
 * Check every Better Bathrooms product in DB2 against Shopify. Read-only.
 *
 * Per product: linked, DRAFT, vendor "Better Bathrooms", option axes and
 * values equal, every variant present by SKU at the DB2 price with stock 500
 * and its own image attached, no empty image links.
 *
 *   node scripts/bb-verify.cjs [--limit=N]
 * Writes .scratch/betterbathrooms/work/bb-verify.json
 */
require("tsx/cjs");
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
const dns = require("dns");
dns.setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

const EXPECT = (process.argv.find((a) => a.startsWith("--status=")) || "--status=DRAFT").slice(9);
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").slice(8)) || Infinity;
const OUT = path.join(__dirname, "../.scratch/betterbathrooms/work/bb-verify.json");
const norm = (s) => String(s ?? "").trim().toLowerCase();
const DEAD_FILE = path.join(__dirname, "../.scratch/betterbathrooms/work/dead-images.txt");
const DEAD = new Set(fs.existsSync(DEAD_FILE) ? fs.readFileSync(DEAD_FILE, "utf8").split("\n").map((x) => x.trim()).filter(Boolean) : []);
const isDead = (u) => DEAD.has(decodeURI(String(u)).split("/").pop());

async function main() {
  const client = new MongoClient(process.env.MONGODB_URL2);
  await client.connect();
  const rows = (await client.db().collection("products").find({ "specs.source": "bb-scrape" }).toArray()).slice(0, LIMIT);
  const problems = [];
  const add = (p, issue) => problems.push({ id: String(p._id), name: p.name, issue });
  let checked = 0, variantsChecked = 0;

  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const linked = batch.filter((p) => p.shopifyProductId);
    for (const p of batch) if (!p.shopifyProductId) add(p, "not linked to Shopify");
    if (!linked.length) continue;
    const data = await shopifyAdminRequest(
      `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id status vendor options{ name values }
        media(first:250){ nodes{ id status } }
        variants(first:100){ nodes{ id sku price inventoryQuantity image{ url } } } } } }`,
      { ids: linked.map((p) => p.shopifyProductId) },
    );
    const byId = new Map((data.nodes || []).filter(Boolean).map((n) => [n.id, n]));
    for (const p of linked) {
      checked++;
      const s = byId.get(p.shopifyProductId);
      if (!s) { add(p, "Shopify product id not found"); continue; }
      if (s.status !== EXPECT) add(p, `status ${s.status}, expected ${EXPECT}`);
      if (s.vendor !== "Better Bathrooms") add(p, `vendor "${s.vendor}"`);
      const multi = (p.variants || []).length > 1;
      if (multi) {
        const want = (p.shopifyOptions || []).map((o) => `${norm(o.name)}=${o.values.map(norm).sort().join(",")}`).sort().join(" | ");
        const got = (s.options || []).map((o) => `${norm(o.name)}=${o.values.map(norm).sort().join(",")}`).sort().join(" | ");
        if (want !== got) add(p, `options differ — DB2 [${want}] vs Shopify [${got}]`);
      }
      const bySku = new Map(s.variants.nodes.map((v) => [v.sku, v]));
      if (s.variants.nodes.length !== (p.variants || []).length) add(p, `${s.variants.nodes.length} Shopify variants vs ${(p.variants || []).length} in DB2`);
      for (const v of p.variants || []) {
        variantsChecked++;
        const sv = bySku.get(v.sku) || s.variants.nodes.find((n) => n.id === v.shopifyVariantId);
        if (!sv) { add(p, `variant ${v.sku} missing in Shopify`); continue; }
        if (v.shopifyVariantId !== sv.id) add(p, `variant ${v.sku} GID not saved in DB2`);
        if (Math.abs(Number(sv.price) - Number(v.price)) > 0.005) add(p, `variant ${v.sku} price £${sv.price} vs £${v.price}`);
        if (sv.inventoryQuantity !== 500) add(p, `variant ${v.sku} stock ${sv.inventoryQuantity}`);
        if (multi && !sv.image?.url) add(p, `variant ${v.sku} has no image`);
      }
      // every gallery image is in Shopify and finished processing
      const media = new Map(s.media.nodes.map((m) => [m.id, m.status]));
      const notReady = s.media.nodes.filter((m) => m.status !== "READY");
      if (notReady.length) add(p, `${notReady.length} Shopify media not READY (${[...new Set(notReady.map((m) => m.status))].join(",")})`);
      const unpaired = (p.shopifyImages || []).filter((im) => !media.has(im.mediaId));
      if (unpaired.length) add(p, `${unpaired.length} DB2 image pairings point at missing Shopify media`);
      if ((p.images || []).length > (p.shopifyImages || []).length) add(p, `${p.images.length - p.shopifyImages.length} gallery images never uploaded`);
      for (const v of p.variants || []) if (v.shopifyMediaId && !media.has(v.shopifyMediaId)) add(p, `variant ${v.sku} image points at missing media`);
      // every variant carries its full photo set, hosted and processed in Shopify
      if (multi) {
        const want = (v) => [...new Set([v.imageUrl, ...(v.images || [])].filter((u) => u && !isDead(u)))];
        const capped = new Set([...(p.images || []), ...p.variants.flatMap(want)]).size > 250;
        for (const v of p.variants) {
          const got = v.shopifyImages || [];
          if (!got.length) { add(p, `variant ${v.sku} has no photo set`); continue; }
          if (got.some((l) => !String(l.shopifyUrl || "").startsWith("https://cdn.shopify.com"))) add(p, `variant ${v.sku} photo without Shopify URL`);
          if (got.some((l) => media.get(l.mediaId) !== "READY")) add(p, `variant ${v.sku} photo not READY in Shopify`);
          const missingPhotos = want(v).filter((u) => !got.some((l) => l.sourceUrl === u));
          if (missingPhotos.length && !capped) add(p, `variant ${v.sku} missing ${missingPhotos.length} of its photos`);
          if (got[0]?.sourceUrl !== want(v)[0]) add(p, `variant ${v.sku} photo set does not lead with its main photo`);
        }
      }
      if (!(p.shopifyImages || []).length) add(p, "no Shopify images recorded");
      if ((p.shopifyImages || []).some((im) => !im.shopifyUrl)) add(p, "empty Shopify image URL");
    }
    process.stdout.write(`\r${Math.min(i + 20, rows.length)}/${rows.length}`);
  }
  const summary = { products: rows.length, checked, variantsChecked, productsWithProblems: new Set(problems.map((x) => x.id)).size, problems: problems.length };
  fs.writeFileSync(OUT, JSON.stringify({ summary, problems }, null, 1));
  console.log("\n" + JSON.stringify(summary, null, 1));
  const kinds = {};
  for (const x of problems) { const k = x.issue.replace(/[\d.£]+|".*?"|\[.*?\]|\S+\/\S+/g, "…"); kinds[k] = (kinds[k] || 0) + 1; }
  console.log(kinds);
  await client.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
