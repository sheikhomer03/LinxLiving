/**
 * Swap Noken's catalogos.porcelanosagrupo.com image URLs for their Shopify copies.
 *
 * Noken (primary cluster) has no images[]: the gallery lives only in the
 * shopifyImages pairing. 6,977 pairs carry a Porcelanosa sourceUrl with a real,
 * verified Shopify copy (the numeric file id matches on both sides), and every
 * variant's imageUrl is a Porcelanosa URL. This writes the Shopify URL into
 * pair.sourceUrl and variant.imageUrl, so nothing references the supplier and
 * the sync (which matches by sourceUrl) keeps every file.
 *
 * Left exactly as they are: the 1,787 pairs (335 pictures) whose Shopify media
 * was deleted and whose source now 404s, and 11 variant images with no copy
 * anywhere — nothing remains to point them at.
 *
 * Five variant images with no pair here have a verified copy on another Noken
 * product; that copy is used (same file, same Porcelanosa id).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/noken-move-images-to-shopify.cjs [--write] [--limit=5] [--shard=0/4]
 */
const path = require("path");
const fs = require("fs");
const util = require("util");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p, quiet: true });
}
{
  const dns = require("dns");
  const { Agent, setGlobalDispatcher } = require("undici");
  const resolver = new dns.promises.Resolver();
  resolver.setServers(["8.8.8.8", "1.1.1.1"]);
  const lookup = (host, opts, cb) =>
    dns.lookup(host, opts, (err, address, family) => {
      if (!err) return cb(null, address, family);
      resolver
        .resolve4(host)
        .then((a) => (opts?.all ? cb(null, a.map((x) => ({ address: x, family: 4 }))) : cb(null, a[0], 4)))
        .catch(() => cb(err));
    });
  setGlobalDispatcher(new Agent({ connect: { lookup } }));
}

const { EJSON } = mongoose.mongo.BSON;
const arg = (n, d = "") => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=") || d;
const WRITE = process.argv.includes("--write");
const LIMIT = Number(arg("limit", 0)) || Infinity;
const [SHARD, SHARDS] = arg("shard", "0/1").split("/").map(Number);
const BRAND_ID = "6a6b9d78a00dad2200fa2fd0";
const DOMAIN = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const API = `https://${DOMAIN}/admin/api/2025-07/graphql.json`;
const DIR = path.join(__dirname, "..", "image-audit", "noken");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const say = (s = "") => process.stdout.write(`${s}\n`);
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const isShopify = (u) => /^https:\/\/cdn\.shopify\.com\//i.test(clean(u));
const isSupplier = (u) => /^https?:\/\/catalogos\.porcelanosagrupo\.com\//i.test(clean(u));
const bare = (u) => clean(u).split("?")[0];
/** Porcelanosa names files by a numeric id that Shopify keeps in its filename. */
const fileId = (u) => (bare(u).split("/").pop().match(/^(\d{6,})/) || [, ""])[1];

let token = null;
async function shopifyToken() {
  const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET }),
  });
  return (await res.json()).access_token;
}
async function gql(query, variables, attempt = 0) {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.json();
    if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 300));
    return body.data;
  } catch (e) {
    if (attempt >= 5) throw e;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    return gql(query, variables, attempt + 1);
  }
}
async function productMedia(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 5) {
    const batch = ids.slice(i, i + 5);
    const d = await gql(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id media(first: 250) { nodes { id status ... on MediaImage { image { url } } } } } } }`,
      { ids: batch },
    );
    batch.forEach((id, k) => {
      const m = new Map();
      for (const n of d.nodes[k]?.media?.nodes || []) m.set(n.id, { status: n.status, url: n.image?.url || "" });
      out.set(id, m);
    });
  }
  return out;
}
async function loadsAsImage(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
      if (res.ok && (res.headers.get("content-type") || "").startsWith("image/")) return true;
      if (res.status < 500 && res.status !== 404) return false;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** resolveGalleryImages for a product with no images[] (src/lib/productImage.ts). */
function gallery(pairs) {
  return (pairs || [])
    .filter((p) => clean(p.shopifyUrl))
    .sort((a, b) => (+a.position || 0) - (+b.position || 0))
    .map((p) => clean(p.shopifyUrl));
}
/** The sync's decision (gallerySourcesFor + protectedMediaIds): uploads and deletions. */
function simulateSync(doc, live) {
  const gal = [...(doc.shopifyImages || [])].sort((a, b) => (+a.position || 0) - (+b.position || 0)).map((p) => clean(p.sourceUrl || p.shopifyUrl));
  const wanted = [...new Set([...gal, ...(doc.variants || []).map((v) => clean(v.imageUrl))].filter((u) => /^https?:\/\//.test(u)))];
  const usable = new Set([...live].filter(([, m]) => m.status !== "FAILED").map(([id]) => id));
  const bySource = new Map();
  for (const l of doc.shopifyImages || []) if (clean(l.sourceUrl) && l.mediaId && usable.has(l.mediaId)) bySource.set(clean(l.sourceUrl), l);
  const keep = new Set(wanted.map((s) => bySource.get(s)?.mediaId).filter(Boolean));
  for (const v of doc.variants || []) for (const p of v.shopifyImages || []) if (p.mediaId) keep.add(p.mediaId);
  return { upload: wanted.filter((s) => !bySource.has(s)), remove: [...live.keys()].filter((id) => !keep.has(id)) };
}
function flat(doc) {
  const out = new Map();
  const walk = (n, p) => {
    if (Array.isArray(n)) return n.forEach((v, i) => walk(v, `${p}.${i}`));
    if (n && typeof n === "object" && !n._bsontype && !(n instanceof Date)) return Object.keys(n).forEach((k) => walk(n[k], p ? `${p}.${k}` : k));
    out.set(p, EJSON.stringify(n === undefined ? null : n, { relaxed: false }));
  };
  walk(doc, "");
  return out;
}

(async () => {
  token = await shopifyToken();
  fs.mkdirSync(DIR, { recursive: true });
  const conn = await connectMongo(process.env.MONGODB_URI);
  const col = conn.db.collection("products");
  const bid = new mongoose.Types.ObjectId(BRAND_ID);

  // Verified copies of each Porcelanosa file anywhere in Noken (for variants with no pair of their own).
  const crossCopy = new Map();
  for (const d of await col.find({ brand: { $in: [bid, BRAND_ID] } }).project({ shopifyImages: 1 }).toArray()) {
    for (const p of d.shopifyImages || []) {
      if (isSupplier(p.sourceUrl) && isShopify(p.shopifyUrl) && fileId(p.sourceUrl) === fileId(p.shopifyUrl) && !crossCopy.has(clean(p.sourceUrl))) crossCopy.set(clean(p.sourceUrl), clean(p.shopifyUrl));
    }
  }

  const filter = {
    brand: { $in: [bid, BRAND_ID] },
    shopifyProductId: { $nin: [null, ""] },
    $or: [{ "shopifyImages.sourceUrl": /porcelanosagrupo/ }, { "variants.imageUrl": /porcelanosagrupo/ }],
  };
  let ids = (await col.find(filter).project({ _id: 1 }).sort({ _id: 1 }).toArray()).map((d) => d._id).filter((_, k) => k % SHARDS === SHARD);
  if (LIMIT !== Infinity) ids = ids.slice(0, LIMIT);
  say(`${WRITE ? "WRITE" : "DRY RUN"}: ${ids.length} products (shard ${SHARD}/${SHARDS})`);
  const backupFile = path.join(DIR, `backup-${STAMP}-shard${SHARD}of${SHARDS}.ejson.jsonl`);

  const T = { products: 0, written: 0, pairs: 0, variants: 0, variantsFromOtherProduct: 0, keptDead: 0, skipped: {}, verify: { ok: 0, unexpected: 0, countsChanged: 0, galleryChanged: 0, syncWorse: 0, notLoading: 0, notWritten: 0 } };
  const skip = (w) => (T.skipped[w] = (T.skipped[w] || 0) + 1);
  const loads = new Map();

  for (let i = 0; i < ids.length; i += 20) {
    const docs = await col.find({ _id: { $in: ids.slice(i, i + 20) } }).toArray();
    const media = await productMedia([...new Set(docs.map((d) => d.shopifyProductId))]);
    const urls = new Set();
    for (const d of docs) {
      for (const p of d.shopifyImages || []) if (isShopify(p.shopifyUrl)) urls.add(clean(p.shopifyUrl));
      for (const v of d.variants || []) if (crossCopy.has(clean(v.imageUrl))) urls.add(crossCopy.get(clean(v.imageUrl)));
    }
    const list = [...urls].filter((u) => !loads.has(u));
    for (let k = 0; k < list.length; k += 64) await Promise.all(list.slice(k, k + 64).map(async (u) => loads.set(u, await loadsAsImage(u))));

    const queue = [...docs];
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (queue.length) {
          const d = queue.shift();
          T.products++;
          const live = media.get(d.shopifyProductId) || new Map();
          const changes = [];
          const map = new Map();
          let pairs = 0, vars = 0, cross = 0, dead = 0;

          const nextPairs = (d.shopifyImages || []).map((p, k) => {
            const src = clean(p.sourceUrl);
            const shop = clean(p.shopifyUrl);
            if (!isSupplier(src)) return { ...p };
            const m = p.mediaId ? live.get(p.mediaId) : null;
            const ok = isShopify(shop) && loads.get(shop) && fileId(src) === fileId(shop) && m && m.status === "READY" && bare(m.url) === bare(shop);
            if (!ok) {
              dead++;
              return { ...p };
            }
            map.set(src, shop);
            changes.push(`shopifyImages.${k}.sourceUrl`);
            pairs++;
            return { ...p, sourceUrl: shop };
          });
          const nextVariants = (d.variants || []).map((v, vi) => {
            const src = clean(v.imageUrl);
            if (!isSupplier(src)) return { ...v };
            let to = map.get(src);
            if (!to && crossCopy.has(src) && loads.get(crossCopy.get(src))) {
              to = crossCopy.get(src);
              cross++;
            }
            if (!to) {
              dead++;
              return { ...v };
            }
            changes.push(`variants.${vi}.imageUrl`);
            vars++;
            const nv = { ...v, imageUrl: to };
            if (!isShopify(v.shopifyImageUrl)) {
              nv.shopifyImageUrl = to;
              changes.push(`variants.${vi}.shopifyImageUrl`);
            }
            return nv;
          });
          if (!changes.length) {
            skip("nothing verifiable to change");
            continue;
          }
          const next = { ...d, shopifyImages: nextPairs, variants: nextVariants };
          if (JSON.stringify(gallery(d.shopifyImages)) !== JSON.stringify(gallery(nextPairs))) {
            skip("gallery would change");
            continue;
          }
          const sb = simulateSync(d, live);
          const sa = simulateSync(next, live);
          if (sa.remove.some((id) => !sb.remove.includes(id)) || sa.upload.length > sb.upload.length) {
            skip("sync would delete or upload more");
            continue;
          }
          T.pairs += pairs;
          T.variants += vars;
          T.variantsFromOtherProduct += cross;
          T.keptDead += dead;
          if (!WRITE) continue;

          fs.appendFileSync(backupFile, `${EJSON.stringify(d, { relaxed: false })}\n`);
          const res = await col.updateOne(
            { _id: d._id, shopifyImages: d.shopifyImages, variants: d.variants },
            { $set: { shopifyImages: nextPairs, variants: nextVariants } },
          );
          if (res.modifiedCount !== 1) {
            T.verify.notWritten++;
            continue;
          }
          T.written++;
          const a = await col.findOne({ _id: d._id });
          const fb = flat(d);
          const fa = flat(a);
          let bad = false;
          for (const k of new Set([...fb.keys(), ...fa.keys()])) {
            if (fb.get(k) === fa.get(k) || changes.includes(k)) continue;
            bad = true;
            say(`  UNEXPECTED ${d._id} ${k}`);
          }
          if (bad) T.verify.unexpected++;
          if ((a.shopifyImages || []).length !== (d.shopifyImages || []).length || (a.variants || []).length !== (d.variants || []).length) T.verify.countsChanged++;
          if (JSON.stringify(gallery(a.shopifyImages)) !== JSON.stringify(gallery(d.shopifyImages))) T.verify.galleryChanged++;
          const s2 = simulateSync(a, live);
          if (s2.remove.some((id) => !sb.remove.includes(id)) || s2.upload.length > sb.upload.length) T.verify.syncWorse++;
          const written = [...(a.shopifyImages || []).map((p) => p.sourceUrl), ...(a.variants || []).map((v) => v.imageUrl)].filter(isShopify);
          if (written.some((u) => loads.get(clean(u)) === false)) T.verify.notLoading++;
          if (!bad) T.verify.ok++;
        }
      }),
    );
    say(`  ${Math.min(i + 20, ids.length)}/${ids.length}  written ${T.written}  skipped ${JSON.stringify(T.skipped)}  verify ${JSON.stringify(T.verify)}`);
  }
  if (WRITE) say(`backup: ${backupFile}`);
  say(JSON.stringify(T, null, 1));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
