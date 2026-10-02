/**
 * Write back Shopify CDN URLs for gallery images Shopify already holds.
 *
 * Some `shopifyImages` entries carry a `mediaId` but an empty `shopifyUrl`:
 * the upload succeeded, the URL was never saved, and the storefront falls back
 * to the supplier's original. This fills in `shopifyImages.$.shopifyUrl` for
 * those entries only — `images`, `sourceUrl`, `mediaId`, `position` and every
 * other field are left as they are.
 *
 * An entry is written only when all of these hold:
 *   - its MediaImage is READY in Shopify with an image URL
 *   - that media is attached to this product's own Shopify product
 *   - the URL loads as an image
 *   - the URL is not already used by another entry on the product
 *   - the entry is still empty in the live document at write time
 *
 * Full documents are backed up first; after writing, every document is re-read
 * and compared with its backup so that nothing but those URLs has changed.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/link-ready-shopify-images.cjs           # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/link-ready-shopify-images.cjs --write
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

const WRITE = process.argv.includes("--write");
const DOMAIN = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const API = `https://${DOMAIN}/admin/api/2024-10/graphql.json`;
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.join(__dirname, "..", "image-audit");

const say = (s = "") => process.stdout.write(`${s}\n`);
const empty = (v) => v == null || String(v).trim() === "";

async function shopifyToken() {
  const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("Shopify token request failed");
  return json.access_token;
}

async function gql(token, query, variables) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (!json.errors) return json.data;
    if (attempt === 3) throw new Error(JSON.stringify(json.errors).slice(0, 300));
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

/** Every MediaImage on each Shopify product: id → { status, url }. */
async function productMedia(token, productIds) {
  const out = new Map();
  const query = `query P($ids:[ID!]!){nodes(ids:$ids){... on Product{id
    media(first:250){nodes{id ... on MediaImage{status image{url}}}}}}}`;
  for (let i = 0; i < productIds.length; i += 10) {
    const ids = productIds.slice(i, i + 10);
    const data = await gql(token, query, { ids });
    ids.forEach((id, k) => {
      const media = new Map();
      for (const m of data.nodes[k]?.media?.nodes || []) {
        media.set(m.id, { status: m.status, url: m.image?.url || "" });
      }
      out.set(id, media);
    });
    say(`  Shopify products read ${Math.min(i + 10, productIds.length)}/${productIds.length}`);
  }
  return out;
}

async function loadsAsImage(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
      const type = res.headers.get("content-type") || "";
      if (res.ok && type.startsWith("image/")) return true;
      if (res.status < 500) return false;
    } catch {
      /* retry once */
    }
  }
  return false;
}

/** Collect candidates from one catalogue, verify them, and optionally write. */
async function run(label, uri, token, summary) {
  const conn = await connectMongo(uri);
  const col = conn.db.collection("products");

  const docs = await col
    .find({
      shopifyProductId: { $nin: [null, ""] },
      shopifyImages: {
        $elemMatch: { mediaId: { $nin: [null, ""] }, shopifyUrl: { $in: ["", null] } },
      },
    })
    .toArray();
  say(`\n[${label}] ${docs.length} products have an entry with a mediaId but no shopifyUrl`);

  const media = await productMedia(token, [...new Set(docs.map((d) => d.shopifyProductId))]);

  const plan = [];
  const skipped = new Map();
  const skip = (why) => skipped.set(why, (skipped.get(why) || 0) + 1);

  for (const d of docs) {
    const onShopify = media.get(d.shopifyProductId) || new Map();
    const taken = new Set((d.shopifyImages || []).map((p) => p.shopifyUrl).filter(Boolean));
    for (const p of d.shopifyImages || []) {
      if (empty(p.mediaId) || !empty(p.shopifyUrl)) continue;
      const m = onShopify.get(p.mediaId);
      if (!m) {
        skip("media not on this Shopify product (deleted or elsewhere)");
        continue;
      }
      if (m.status !== "READY" || !m.url) {
        skip(`media status ${m.status}`);
        continue;
      }
      if (taken.has(m.url)) {
        skip("URL already used by another entry");
        continue;
      }
      taken.add(m.url);
      plan.push({ _id: d._id, name: d.name, mediaId: p.mediaId, sourceUrl: p.sourceUrl, url: m.url });
    }
  }

  // Confirm each URL really serves an image before trusting it.
  const ok = new Map();
  const urls = [...new Set(plan.map((x) => x.url))];
  for (let i = 0; i < urls.length; i += 32) {
    await Promise.all(urls.slice(i, i + 32).map(async (u) => ok.set(u, await loadsAsImage(u))));
  }
  const verified = plan.filter((x) => {
    if (ok.get(x.url)) return true;
    skip("Shopify URL does not load as an image");
    return false;
  });

  const productIds = [...new Set(verified.map((x) => String(x._id)))];
  say(`  ready to link: ${verified.length} images on ${productIds.length} products`);
  for (const [why, n] of skipped) say(`  skipped ${n}: ${why}`);
  summary.push({ label, images: verified.length, products: productIds.length, skipped: Object.fromEntries(skipped) });

  if (!WRITE || !verified.length) {
    await mongoose.disconnect();
    return;
  }

  // Back up whole documents before touching anything.
  const before = docs.filter((d) => productIds.includes(String(d._id)));
  const backupFile = path.join(OUT_DIR, `backup-link-shopify-images-${label}-${STAMP}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(before));
  say(`  backup: ${backupFile}`);

  const ops = verified.map((x) => ({
    updateOne: {
      filter: { _id: x._id },
      update: { $set: { "shopifyImages.$[e].shopifyUrl": x.url } },
      arrayFilters: [
        {
          "e.mediaId": x.mediaId,
          ...(empty(x.sourceUrl) ? {} : { "e.sourceUrl": x.sourceUrl }),
          "e.shopifyUrl": { $in: ["", null] },
        },
      ],
    },
  }));
  const res = await col.bulkWrite(ops, { ordered: false });
  say(`  written: matched ${res.matchedCount}, modified ${res.modifiedCount}`);

  // Re-read and prove only the intended shopifyUrl values changed.
  const expected = new Map(verified.map((x) => [`${x._id}|${x.mediaId}`, x.url]));
  const after = await col.find({ _id: { $in: before.map((d) => d._id) } }).toArray();
  const afterById = new Map(after.map((d) => [String(d._id), d]));
  let problems = 0;
  let linked = 0;
  for (const b of before) {
    const a = afterById.get(String(b._id));
    // Compared as JSON: structuredClone strips ObjectId's prototype, so a
    // strict deep-equal on BSON values reports every document as changed.
    const patched = JSON.parse(JSON.stringify(b));
    for (const p of patched.shopifyImages) {
      const url = expected.get(`${b._id}|${p.mediaId}`);
      if (url && empty(p.shopifyUrl)) p.shopifyUrl = url;
    }
    if (!a || !util.isDeepStrictEqual(patched, JSON.parse(JSON.stringify(a)))) {
      problems++;
      say(`  MISMATCH ${b._id} ${b.name}`);
    }
    for (const p of a?.shopifyImages || []) if (expected.get(`${b._id}|${p.mediaId}`) === p.shopifyUrl) linked++;
    if ((a?.images || []).length !== (b.images || []).length) problems++;
    if ((a?.shopifyImages || []).length !== (b.shopifyImages || []).length) problems++;
  }
  say(`  verify: ${after.length}/${before.length} products re-read, ${linked} URLs in place, ${problems} problems`);
  summary.at(-1).written = res.modifiedCount;
  summary.at(-1).verifyProblems = problems;
  await mongoose.disconnect();
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  say(WRITE ? "MODE: WRITE" : "MODE: DRY RUN (nothing is written)");
  const token = await shopifyToken();
  const summary = [];
  await run("DB1", process.env.MONGODB_URI, token, summary);
  await run("DB2", process.env.MONGODB_URL2, token, summary);
  say(`\n${JSON.stringify(summary, null, 1)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
