/**
 * Tiles Porcelain: move the last customer-visible supplier images to Shopify.
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
const BRAND_ID = "6ab4da49e5975c1dc71a7f97";
const DOMAIN = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const API = `https://${DOMAIN}/admin/api/2025-07/graphql.json`;
const DIR = path.join(__dirname, "..", "image-audit", "tilesporcelain");
const STATE_FILE = path.join(DIR, "state.json");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const say = (s = "") => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const isSupplier = (u) => /^https?:\/\/(www\.)?tilesporcelain\.co\.uk\//i.test(clean(u));
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
  const re = /^https?:\/\/(www\.)?tilesporcelain\.co\.uk\//i;
  const docs = await col
    .find(
      { brand: { $in: [brand, BRAND_ID] }, $or: [{ "variants.shopifyImages.shopifyUrl": re }, { "variants.shopifyImageUrl": re }] },
      { promoteValues: false },
    )
    .toArray();

  // Every visible supplier image, by path.
  const targets = [];
  for (const d of docs) {
    (d.variants || []).forEach((v, vi) => {
      (v.shopifyImages || []).forEach((p, k) => {
        if (isSupplier(p.shopifyUrl)) targets.push({ d, path: `variants.${vi}.shopifyImages.${k}`, kind: "pair", url: clean(p.shopifyUrl), pair: p });
      });
      if (isSupplier(v.shopifyImageUrl)) targets.push({ d, path: `variants.${vi}.shopifyImageUrl`, kind: "thumb", url: clean(v.shopifyImageUrl) });
    });
  }
  say(`${WRITE ? "WRITE" : "DRY RUN"}: ${targets.length} visible supplier images on ${docs.length} products`);

  // A durable Shopify copy per picture: an existing READY File with the same
  // filename, else a fresh upload by bytes.
  const byKey = new Map();
  for (const t of targets) if (!byKey.has(keyOf(t.url))) byKey.set(keyOf(t.url), t.url);
  const copies = new Map(); // key -> { url, id }
  const reuse = Object.values(state.files).filter((f) => f.url && f.id);
  for (const [key, url] of byKey) {
    const f = reuse.find((x) => sameFile(url, x.url));
    if (f && (await loadsAsImage(f.url))) copies.set(key, { url: f.url, id: f.id });
  }
  // Files already on Shopify with this filename (e.g. an earlier run's upload
  // that was still processing) are reused rather than uploaded again.
  for (const [key, url] of byKey) {
    if (copies.has(key)) continue;
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "").replace(/\.[a-z0-9]{3,4}$/i, "");
    const data = await gql(`query($q: String!) { files(first: 25, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { ... on MediaImage { id fileStatus image { url } } } } }`, { q: `filename:${name}` });
    const hit = (data.files.nodes || []).find((n) => n.id && n.fileStatus === "READY" && n.image?.url && sameFile(url, n.image.url));
    if (hit && (await loadsAsImage(hit.image.url))) {
      copies.set(key, { url: hit.image.url, id: hit.id });
      state.files[key] = state.files[key] || { source: url, id: hit.id, url: hit.image.url, staged: 1 };
    }
  }
  const toUpload = [...byKey].filter(([key]) => !copies.has(key));
  say(`  reusing ${copies.size} existing Files, uploading ${toUpload.length}`);
  if (!WRITE) {
    for (const t of targets) say(`  ${t.d._id} ${t.path} ${keyOf(t.url)} ${copies.has(keyOf(t.url)) ? "(File exists)" : "(needs upload)"}`);
    await mongoose.disconnect();
    return;
  }
  const pending = new Map();
  for (const [key, url] of toUpload) {
    try {
      pending.set(key, await uploadFile(url));
    } catch (e) {
      say(`  upload failed ${key}: ${String(e.message).slice(0, 120)} — left as is`);
    }
  }
  for (let round = 0; round < 60 && pending.size; round++) {
    await sleep(5000);
    const st = await fileStatus([...pending.values()]);
    for (const [key, id] of [...pending]) {
      const s = st.get(id);
      if (s.status === "READY" && s.url) {
        if (sameFile(byKey.get(key), s.url)) copies.set(key, { url: s.url, id });
        state.files[key] = { source: byKey.get(key), id, url: s.url, staged: 1 };
        pending.delete(key);
      } else if (s.status === "FAILED") {
        say(`  ${key} FAILED on Shopify — left as is`);
        pending.delete(key);
      }
    }
  }
  fs.writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state));
  fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);

  // Write per product: back up, set only the target paths, guarded on old values.
  const backupFile = path.join(DIR, `backup-visible-${STAMP}.ejson.jsonl`);
  const t = { products: 0, written: 0, images: 0, kept: 0, verified: 0, problems: [] };
  for (const d of docs) {
    const mine = targets.filter((x) => x.d === d);
    const set = {};
    const filter = { _id: d._id };
    const changed = [];
    for (const x of mine) {
      const c = copies.get(keyOf(x.url));
      if (!c || !sameFile(x.url, c.url) || !(await loadsAsImage(c.url))) {
        t.kept++;
        continue;
      }
      if (x.kind === "pair") {
        filter[`${x.path}.shopifyUrl`] = x.pair.shopifyUrl;
        set[`${x.path}.shopifyUrl`] = c.url;
        changed.push(`${x.path}.shopifyUrl`);
        if (isSupplier(x.pair.sourceUrl) && keyOf(x.pair.sourceUrl) === keyOf(x.url)) {
          filter[`${x.path}.sourceUrl`] = x.pair.sourceUrl;
          set[`${x.path}.sourceUrl`] = c.url;
          changed.push(`${x.path}.sourceUrl`);
        }
      } else {
        filter[x.path] = x.url;
        set[x.path] = c.url;
        changed.push(x.path);
      }
      t.images++;
    }
    t.products++;
    if (!changed.length) continue;
    fs.appendFileSync(backupFile, `${EJSON.stringify(d, { relaxed: false })}\n`);
    const res = await col.updateOne(filter, { $set: set });
    if (res.modifiedCount !== 1) {
      t.problems.push(`${d._id} not written (changed since read)`);
      continue;
    }
    t.written++;
    // Verify: only the planned paths differ.
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
