/**
 * Give every Better Bathrooms variant its own photo set, the way the PDP
 * expects: `variant.shopifyImages` = [{ sourceUrl, shopifyUrl, mediaId, position }],
 * all hosted in Shopify as media of the same product. Picking a colour / size
 * then leads the gallery with that variant's photographs.
 *
 * - Only products with specs.source = "bb-scrape" and more than one variant.
 * - The product gallery (`images` / `shopifyImages`) is left as it is.
 * - Photos already in Shopify are reused; only missing ones are uploaded.
 * - A product never exceeds Shopify's 250-media limit: the last photos of the
 *   largest sets are dropped first, each variant always keeps its lead photo.
 * - Media Shopify fails to process is deleted and left out of the set.
 *
 *   node scripts/bb-variant-images.cjs [--only=name] [--limit=N] [--concurrency=3]
 */
require("tsx/cjs");
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
require("dns").setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");
const { buildMediaInput, MAX_MEDIA_PER_PRODUCT, MEDIA_UPLOAD_CHUNK } = require("../src/lib/shopify/sync-media.ts");

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").slice(k.length + 3);
const ONLY = arg("only").toLowerCase();
const LIMIT = Number(arg("limit")) || Infinity;
const CONCURRENCY = Number(arg("concurrency")) || 3;
const WORK = path.join(__dirname, "../.scratch/betterbathrooms/work");
const LOG = path.join(WORK, "variant-images.log");
const DEAD = new Set(fs.existsSync(path.join(WORK, "dead-images.txt")) ? fs.readFileSync(path.join(WORK, "dead-images.txt"), "utf8").split("\n").map((s) => s.trim()).filter(Boolean) : []);
const log = (m) => { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDead = (u) => DEAD.has(decodeURI(String(u)).split("/").pop());

async function productMedia(productId) {
  const out = [];
  let after = null;
  do {
    const d = await shopifyAdminRequest(
      `query($id:ID!,$a:String){ product(id:$id){ media(first:100, after:$a){ pageInfo{ hasNextPage endCursor } nodes{ id status ... on MediaImage { image { url } } } } } }`,
      { id: productId, a: after },
    );
    const m = d.product?.media;
    out.push(...(m?.nodes || []));
    after = m?.pageInfo?.hasNextPage ? m.pageInfo.endCursor : null;
  } while (after);
  return out;
}

/** Trim the largest variant sets until the product fits Shopify's media limit. */
function fitSets(sets, already) {
  const budget = MAX_MEDIA_PER_PRODUCT;
  const uniq = () => new Set([...already, ...sets.flat()]).size;
  while (uniq() > budget) {
    const longest = sets.reduce((bi, s, i) => (s.length > sets[bi].length ? i : bi), 0);
    if (sets[longest].length <= 1) break;
    sets[longest] = sets[longest].slice(0, -1);
  }
  return sets;
}

async function processProduct(col, p) {
  const gallery = new Map((p.shopifyImages || []).filter((l) => l.mediaId).map((l) => [l.sourceUrl, l]));
  // variant photo sets, lead photo first (the one already attached as its variant image)
  let sets = p.variants.map((v) => {
    const own = (v.images || []).filter((u) => u && !isDead(u));
    const lead = v.imageUrl && !isDead(v.imageUrl) ? [v.imageUrl] : [];
    return [...new Set([...lead, ...own])];
  });
  sets = fitSets(sets, [...gallery.keys()]);

  // map every source we need to Shopify media: gallery links, variants' existing pairs, then upload the rest
  const bySource = new Map(gallery);
  for (const v of p.variants) {
    for (const l of v.shopifyImages || []) if (l.mediaId) bySource.set(l.sourceUrl, l);
    if (v.shopifyMediaId && v.imageUrl && !bySource.has(v.imageUrl)) bySource.set(v.imageUrl, { sourceUrl: v.imageUrl, shopifyUrl: v.shopifyImageUrl || "", mediaId: v.shopifyMediaId });
  }
  const missing = [...new Set(sets.flat())].filter((s) => !bySource.has(s));
  for (let i = 0; i < missing.length; i += MEDIA_UPLOAD_CHUNK) {
    const chunk = missing.slice(i, i + MEDIA_UPLOAD_CHUNK);
    const d = await shopifyAdminRequest(
      `mutation($pid:ID!,$m:[CreateMediaInput!]!){ productCreateMedia(productId:$pid, media:$m){ media{ id status } mediaUserErrors{ message } } }`,
      { pid: p.shopifyProductId, m: buildMediaInput(chunk) },
    );
    const errs = d.productCreateMedia.mediaUserErrors;
    if (errs.length) throw new Error("upload: " + errs.map((e) => e.message).join("; "));
    (d.productCreateMedia.media || []).forEach((node, j) => { if (node?.id) bySource.set(chunk[j], { sourceUrl: chunk[j], shopifyUrl: "", mediaId: node.id }); });
  }

  // wait for Shopify to process, then record CDN URLs; drop what failed
  let media = [];
  for (let round = 0; round < 12; round++) {
    media = await productMedia(p.shopifyProductId);
    const st = new Map(media.map((m) => [m.id, m.status]));
    const pending = [...bySource.values()].filter((l) => missing.includes(l.sourceUrl) && !["READY", "FAILED"].includes(st.get(l.mediaId)));
    if (!pending.length) break;
    await sleep(5000);
  }
  const byId = new Map(media.map((m) => [m.id, m]));
  const failed = [...bySource.values()].filter((l) => byId.get(l.mediaId)?.status === "FAILED" && missing.includes(l.sourceUrl));
  if (failed.length) {
    await shopifyAdminRequest(`mutation($pid:ID!,$m:[ID!]!){ productDeleteMedia(productId:$pid, mediaIds:$m){ mediaUserErrors{ message } } }`, { pid: p.shopifyProductId, m: failed.map((l) => l.mediaId) });
  }
  const urlOf = (l) => { const n = byId.get(l.mediaId); return n?.status === "READY" ? n.image?.url || "" : ""; };

  const variants = p.variants.map((v, i) => {
    const shopifyImages = sets[i]
      .map((src) => bySource.get(src))
      .filter((l) => l && byId.get(l.mediaId)?.status === "READY")
      .map((l, position) => ({ sourceUrl: l.sourceUrl, shopifyUrl: urlOf(l), mediaId: l.mediaId, position }));
    return { ...v, shopifyImages };
  });
  await col.updateOne({ _id: p._id }, { $set: { variants, updatedAt: new Date() } });
  const perVariant = variants.map((v) => v.shopifyImages.length);
  return { uploaded: missing.length - failed.length, failed: failed.length, min: Math.min(...perVariant), max: Math.max(...perVariant), media: media.length - failed.length };
}

(async () => {
  const c = new MongoClient(process.env.MONGODB_URL2);
  await c.connect();
  const col = c.db().collection("products");
  let rows = await col.find({ "specs.source": "bb-scrape", "variants.1": { $exists: true }, shopifyProductId: { $nin: [null, ""] } }).toArray();
  if (ONLY) rows = rows.filter((p) => p.name.toLowerCase().includes(ONLY));
  // resumable: skip products whose every variant already has a complete set
  rows = rows.filter((p) => p.variants.some((v) => !(v.shopifyImages || []).length || v.shopifyImages.some((l) => !l.shopifyUrl)));
  rows = rows.slice(0, LIMIT);
  log(`variant photo sets for ${rows.length} Better Bathrooms products`);
  let done = 0, ok = 0, bad = 0, uploaded = 0;
  const queue = [...rows];
  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      try {
        const r = await processProduct(col, p);
        ok++; uploaded += r.uploaded;
        log(`✓ ${p.name} — ${p.variants.length} variants, ${r.min}-${r.max} photos each, ${r.uploaded} uploaded${r.failed ? `, ${r.failed} failed+removed` : ""}, ${r.media} media total`);
      } catch (e) { bad++; log(`✗ ${p.name} — ${String(e.message || e).slice(0, 300)}`); }
      done++;
      if (done % 25 === 0) log(`progress ${done}/${rows.length} (ok ${ok}, failed ${bad}, uploaded ${uploaded})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`finished: ${ok} ok, ${bad} failed, ${uploaded} photos uploaded`);
  await c.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
