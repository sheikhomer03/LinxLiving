/**
 * Total Tiles: move the last customer-visible supplier images to Shopify.
 * (Copy of tilesporcelain-fix-visible.cjs.) Names here are generic ("4.png"),
 * so a picture is identified by its exact source URL: its File is uploaded from
 * that URL's own bytes, and every field holding that exact URL on the product
 * (pair sourceUrl/shopifyUrl, images[], variant imageUrl/shopifyImageUrl) is
 * replaced with the File URL one-for-one.
 *
 * Only two kinds of field are touched — the ones the page renders directly:
 *   variants[].shopifyImages[].shopifyUrl  (a "fake" pair: supplier URL as the copy)
 *   variants[].shopifyImageUrl            (the option thumbnail)
 * Each picture is uploaded to Shopify Files by its bytes (or an existing READY
 * File with the same filename is reused), then exactly those paths are set,
 * guarded on their old values. A fake pair's sourceUrl moves with it. Every
 * product is backed up first and verified after.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/tilesporcelain-fix-visible.cjs [--write]
 */
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p, quiet: true });
}

const { EJSON } = mongoose.mongo.BSON;
const WRITE = process.argv.includes("--write");
const BRAND_ID = "6ab3bcf2cdb5ecac624e19d8";
const DOMAIN = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const API = `https://${DOMAIN}/admin/api/2025-07/graphql.json`;
const DIR = path.join(__dirname, "..", "image-audit", "totaltiles");
const STATE_FILE = path.join(DIR, "state.json");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const say = (s = "") => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const isSupplier = (u) => /^https?:\/\/(www\.)?totaltiles\.co\.uk\//i.test(clean(u));
const isShopify = (u) => /^https:\/\/cdn\.shopify\.com\//i.test(clean(u));
/** Filename stem, without Shopify's clash uuid — the picture's identity. */
const keyOf = (u) =>
  decodeURIComponent(clean(u).split("?")[0].split("/").pop() || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{3,4}$/, "")
    .replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "");

let token = null;
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
  const body = await res.json();
  if (!body.access_token) throw new Error("Shopify token request failed");
  return body.access_token;
}

/** Mutations are not retried after a timeout (could duplicate); queries are. */
async function gql(query, variables, attempt = 0) {
  const isMutation = /^\s*mutation/.test(query);
  let answered = false;
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.json();
    answered = true;
    if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 300));
    return body.data;
  } catch (e) {
    if (attempt >= 5 || (isMutation && !answered)) throw e;
    await sleep(2000 * 2 ** attempt);
    return gql(query, variables, attempt + 1);
  }
}

async function loadsAsImage(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
      const type = (res.headers.get("content-type") || "").split(";")[0];
      if (res.ok && type.startsWith("image/")) return true;
      if (res.ok || res.status === 404 || res.status === 410) return false;
    } catch {
      /* retry */
    }
    await sleep(1000 * 2 ** attempt);
  }
  return false;
}

/** Upload a picture's bytes to Shopify Files; returns the new File id. */
async function uploadFile(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`source answered ${res.status}`);
  const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!mime.startsWith("image/")) throw new Error(`source is ${mime}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const filename = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image.jpg");
  const staged = await gql(
    `mutation($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } }
    }`,
    { input: [{ resource: "IMAGE", filename, mimeType: mime, httpMethod: "POST", fileSize: String(bytes.length) }] },
  );
  const r = staged.stagedUploadsCreate;
  if (r.userErrors?.length) throw new Error(r.userErrors.map((e) => e.message).join("; "));
  const target = r.stagedTargets[0];
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([bytes], { type: mime }), filename);
  const up = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  if (!up.ok) throw new Error(`staged upload answered ${up.status}`);
  const created = await gql(
    `mutation($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id } userErrors { message } } }`,
    { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE" }] },
  );
  const c = created.fileCreate;
  if (c.userErrors?.length) throw new Error(c.userErrors.map((e) => e.message).join("; "));
  return c.files[0].id;
}

async function fileStatus(ids) {
  const data = await gql(`query($ids: [ID!]!) { nodes(ids: $ids) { ... on MediaImage { id fileStatus image { url } } } }`, { ids });
  const out = new Map();
  ids.forEach((id, k) => {
    const n = data.nodes[k];
    out.set(id, n && n.id ? { status: n.fileStatus, url: n.image?.url || "" } : { status: "MISSING", url: "" });
  });
  return out;
}

/**
 * Exact match of a Shopify file to a source: same name, or the same name plus
 * Shopify's clash uuid — which shares the separator when the source name ends
 * in "_" ("cot09gp05_4_.jpg" → "cot09gp05_4_<uuid>.jpg"). "cot09gp05_4.jpg"
 * is a different file and does not match.
 */
const nameOf = (u) => decodeURIComponent(clean(u).split("?")[0].split("/").pop() || "").toLowerCase().replace(/\.[a-z0-9]{3,4}$/, "");
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
function sameFile(src, shopify) {
  const s = nameOf(src);
  const n = nameOf(shopify);
  if (!s || s.length < 4) return false;
  if (n === s) return true;
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc}${s.endsWith("_") ? "" : "_"}${UUID}$`).test(n);
}

(async () => {
  token = await shopifyToken();
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const conn = await connectMongo(process.env.MONGODB_URL2);
  const col = conn.db.collection("products");
  const brand = new mongoose.Types.ObjectId(BRAND_ID);
  const re = /^https?:\/\/(www\.)?totaltiles\.co\.uk\//i;
  const docs = await col
    .find(
      { brand: { $in: [brand, BRAND_ID] }, $or: [{ "shopifyImages.shopifyUrl": re }, { "variants.shopifyImages.shopifyUrl": re }, { "variants.shopifyImageUrl": re }] },
      { promoteValues: false },
    )
    .toArray();

  // Every exact supplier URL the page shows directly on these products.
  const visible = new Map(); // product id -> Set(url)
  for (const d of docs) {
    const set = new Set();
    for (const p of d.shopifyImages || []) if (isSupplier(p.shopifyUrl)) set.add(clean(p.shopifyUrl));
    for (const v of d.variants || []) {
      for (const p of v.shopifyImages || []) if (isSupplier(p.shopifyUrl)) set.add(clean(p.shopifyUrl));
      if (isSupplier(v.shopifyImageUrl)) set.add(clean(v.shopifyImageUrl));
    }
    if (set.size) visible.set(String(d._id), set);
  }
  const allUrls = [...new Set([...visible.values()].flatMap((s) => [...s]))];
  say(`${WRITE ? "WRITE" : "DRY RUN"}: ${allUrls.length} visible supplier images on ${visible.size} products`);

  // One File per exact URL, from that URL's own bytes.
  const copies = new Map(); // exact url -> { url, id }
  for (const u of allUrls) {
    const f = state.files[u];
    if (f?.url && f.id && (await loadsAsImage(f.url))) copies.set(u, { url: f.url, id: f.id });
  }
  const toUpload = allUrls.filter((u) => !copies.has(u));
  say(`  reusing ${copies.size} Files uploaded from these exact URLs, uploading ${toUpload.length}`);
  if (!WRITE) {
    for (const [id, set] of visible) for (const u of set) say(`  ${id} ${u.split("/").pop()} ${copies.has(u) ? "(File exists)" : "(needs upload)"}`);
    await mongoose.disconnect();
    return;
  }
  const pending = new Map();
  for (const u of toUpload) {
    try {
      pending.set(u, await uploadFile(u));
    } catch (e) {
      say(`  upload failed ${u.split("/").pop()}: ${String(e.message).slice(0, 120)} — left as is`);
    }
  }
  for (let round = 0; round < 60 && pending.size; round++) {
    await sleep(5000);
    const st = await fileStatus([...pending.values()]);
    for (const [u, id] of [...pending]) {
      const x = st.get(id);
      if (x.status === "READY" && x.url) {
        copies.set(u, { url: x.url, id });
        state.files[u] = { source: u, from: u, id, url: x.url, staged: 1, exact: true };
        pending.delete(u);
      } else if (x.status === "FAILED") {
        say(`  ${u.split("/").pop()} FAILED on Shopify — left as is`);
        pending.delete(u);
      }
    }
  }
  for (const [u] of pending) say(`  ${u.split("/").pop()} still processing — left as is`);
  fs.writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state));
  fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);

  // Per product: replace each exact URL with its File everywhere it appears in
  // the image fields, one-for-one. Guarded on every old value; verified after.
  const backupFile = path.join(DIR, `backup-visible-${STAMP}.ejson.jsonl`);
  const t = { products: 0, written: 0, fieldsChanged: 0, verified: 0, problems: [] };
  for (const d of docs) {
    const set = visible.get(String(d._id));
    if (!set) continue;
    t.products++;
    const swap = new Map();
    for (const u of set) {
      const c = copies.get(u);
      if (c && (await loadsAsImage(c.url))) swap.set(u, c.url);
    }
    if (!swap.size) continue;
    const filter = { _id: d._id };
    const upd = {};
    const changed = [];
    const at = (p, old) => {
      const to = swap.get(clean(old));
      if (!to) return;
      filter[p] = old;
      upd[p] = to;
      changed.push(p);
    };
    (Array.isArray(d.images) ? d.images : []).forEach((u, i) => at(`images.${i}`, u));
    (d.shopifyImages || []).forEach((p, k) => {
      at(`shopifyImages.${k}.sourceUrl`, p.sourceUrl);
      at(`shopifyImages.${k}.shopifyUrl`, p.shopifyUrl);
    });
    (d.variants || []).forEach((v, vi) => {
      at(`variants.${vi}.imageUrl`, v.imageUrl);
      at(`variants.${vi}.shopifyImageUrl`, v.shopifyImageUrl);
      (Array.isArray(v.images) ? v.images : []).forEach((u, i) => at(`variants.${vi}.images.${i}`, u));
      (v.shopifyImages || []).forEach((p, k) => {
        at(`variants.${vi}.shopifyImages.${k}.sourceUrl`, p.sourceUrl);
        at(`variants.${vi}.shopifyImages.${k}.shopifyUrl`, p.shopifyUrl);
      });
    });
    fs.appendFileSync(backupFile, `${EJSON.stringify(d, { relaxed: false })}\n`);
    const res = await col.updateOne(filter, { $set: upd });
    if (res.modifiedCount !== 1) {
      t.problems.push(`${d._id} not written (changed since read)`);
      continue;
    }
    t.written++;
    t.fieldsChanged += changed.length;
    const after = await col.findOne({ _id: d._id }, { promoteValues: false });
    const flat = (doc) => {
      const out = new Map();
      const walk = (n, p) => {
        if (Array.isArray(n)) {
          out.set(`${p}.#len`, String(n.length));
          return n.forEach((v, i) => walk(v, `${p}.${i}`));
        }
        if (n && typeof n === "object" && !n._bsontype && !(n instanceof Date)) {
          out.set(`${p}.#keys`, Object.keys(n).join(","));
          return Object.keys(n).forEach((k) => walk(n[k], p ? `${p}.${k}` : k));
        }
        out.set(p, EJSON.stringify(n === undefined ? null : n, { relaxed: false }));
      };
      walk(doc, "");
      return out;
    };
    const fb = flat(d);
    const fa = flat(after);
    const bad = [...new Set([...fb.keys(), ...fa.keys()])].filter((k) => fb.get(k) !== fa.get(k) && !changed.includes(k));
    if (bad.length) t.problems.push(`${d._id} unexpected: ${bad.slice(0, 3).join(", ")}`);
    else t.verified++;
  }
  say(`backup: ${backupFile}`);
  say(JSON.stringify(t, null, 1));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
