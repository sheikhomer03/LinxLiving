/**
 * Re-link 4 Tile Mountain products whose pairs name media no longer on the product.
 *
 * These were re-synced to Shopify at some point: the product holds a fresh set
 * of media, but shopifyImages still carries the old (deleted) media ids and
 * their CDN URLs. Each gallery image is matched to the product's current media
 * by file name (unique match only); an image with no current copy is uploaded
 * from Tile Mountain as product media. Then images[i] and its pair point at
 * that copy. Backup first; only images and shopifyImages change.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/tilemountain-relink-4.cjs [--write]
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
const { EJSON } = mongoose.mongo.BSON;
const WRITE = process.argv.includes("--write");
const IDS = ["6aabf11fef4d49fd99f1e15a", "6aabf11def4d49fd99f1e158", "6aabf110ef4d49fd99f1e142", "6aabf10aef4d49fd99f1e13a"];
const DOMAIN = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const API = `https://${DOMAIN}/admin/api/2025-07/graphql.json`;
const DIR = path.join(__dirname, "..", "image-audit", "tilemountain");
const say = (s = "") => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (u) =>
  String(u || "").split("?")[0].split("/").pop()
    .replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.)/i, "")
    .replace(/\.(jpe?g|png|webp|gif)$/i, "").toLowerCase();
const isSupplier = (u) => /tilemountain\.co\.uk/.test(String(u || ""));

let token;
async function gql(query, variables) {
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query, variables }) });
      const b = await r.json();
      if (!b.errors) return b.data;
      if (/^\s*mutation/.test(query)) throw new Error(JSON.stringify(b.errors));
    } catch (e) {
      if (/^\s*mutation/.test(query)) throw e;
    }
    await sleep(2000 * (a + 1));
  }
  throw new Error("query failed");
}
const media = async (pid) => (await gql(`query($id:ID!){product(id:$id){media(first:250){nodes{id status ... on MediaImage{image{url}}}}}}`, { id: pid })).product.media.nodes;
const loads = async (u) => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { method: "HEAD" });
      if (r.ok && (r.headers.get("content-type") || "").startsWith("image/")) return true;
    } catch {}
  }
  return false;
};

(async () => {
  token = (await (await fetch(`https://${DOMAIN}/admin/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET }) })).json()).access_token;
  const conn = await connectMongo(process.env.MONGODB_URL2);
  const col = conn.db.collection("products");
  const backup = path.join(DIR, `backup-relink4-${new Date().toISOString().replace(/[:.]/g, "-")}.ejson.jsonl`);

  for (const id of IDS) {
    const d = await col.findOne({ _id: new mongoose.Types.ObjectId(id) });
    let live = (await media(d.shopifyProductId)).filter((n) => n.status === "READY" && n.image?.url);
    const byBase = new Map();
    for (const n of live) byBase.set(base(n.image.url), (byBase.get(base(n.image.url)) || []).concat(n));

    // Upload any image with no current copy.
    const missing = d.images.filter((u) => isSupplier(u) && (byBase.get(base(u)) || []).length !== 1);
    if (missing.length && WRITE) {
      const r = await gql(
        `mutation($p:ID!,$m:[CreateMediaInput!]!){productCreateMedia(productId:$p,media:$m){media{id} mediaUserErrors{message}}}`,
        { p: d.shopifyProductId, m: missing.map((u) => ({ originalSource: u, mediaContentType: "IMAGE" })) },
      );
      const created = r.productCreateMedia.media.map((m) => m.id);
      for (let i = 0; i < 20; i++) {
        await sleep(3000);
        live = (await media(d.shopifyProductId)).filter((n) => n.status === "READY" && n.image?.url);
        if (created.every((cid) => live.some((n) => n.id === cid))) break;
      }
      byBase.clear();
      for (const n of live) byBase.set(base(n.image.url), (byBase.get(base(n.image.url)) || []).concat(n));
    }

    const images = [...d.images];
    const pairs = d.shopifyImages.map((p) => ({ ...p }));
    let linked = 0, kept = 0;
    for (let i = 0; i < images.length; i++) {
      const src = images[i];
      if (!isSupplier(src)) continue;
      const hits = byBase.get(base(src)) || [];
      const k = pairs.findIndex((p) => p.sourceUrl === src);
      if (hits.length !== 1 || k < 0 || !(await loads(hits[0].image.url))) {
        kept++;
        continue;
      }
      const url = hits[0].image.url;
      images[i] = url;
      pairs[k] = { ...pairs[k], sourceUrl: url, shopifyUrl: url, mediaId: hits[0].id };
      linked++;
    }
    say(`${d.name.slice(0, 50)} | to upload ${missing.length} | linked ${linked} | kept ${kept}`);
    if (!WRITE || !linked) continue;

    fs.appendFileSync(backup, `${EJSON.stringify(d, { relaxed: false })}\n`);
    const res = await col.updateOne({ _id: d._id, images: d.images, shopifyImages: d.shopifyImages }, { $set: { images, shopifyImages: pairs } });
    const a = await col.findOne({ _id: d._id });
    const strip = (x) => {
      const y = JSON.parse(EJSON.stringify(x, { relaxed: false }));
      delete y.images;
      delete y.shopifyImages;
      return y;
    };
    const liveIds = new Set(live.map((n) => n.id));
    const ok =
      res.modifiedCount === 1 &&
      util.isDeepStrictEqual(strip(a), strip(d)) &&
      a.images.length === d.images.length &&
      a.shopifyImages.length === d.shopifyImages.length &&
      a.shopifyImages.filter((p) => !isSupplier(p.sourceUrl)).every((p) => liveIds.has(p.mediaId));
    say(`   written & verified: ${ok}`);
  }
  if (WRITE) say(`backup: ${backup}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
