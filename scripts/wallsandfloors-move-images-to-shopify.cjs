/**
 * Serve every Walls and Floors image from Shopify and drop the supplier URLs.
 *
 * Walls and Floors (secondary cluster) holds m2.wallsandfloors.co.uk URLs in
 * images[] and the pairings. Most pairs point at a real Shopify copy; 473
 * product pairs and 473 variant pairs (and 60 variants' shopifyImageUrl) are
 * fake — their "Shopify" URL is the supplier URL itself, with no media — so
 * those pictures still load from the supplier (and variant galleries, which
 * render Shopify only, skip them).
 *
 * Same phases and safety as toasty-move-images-to-shopify.cjs: upload the
 * sources behind fake links as product media, collect (bytes fallback), then
 * apply per product with backup, guarded write and verification. A fake pair
 * is refilled in place with the real copy; every supplier URL with a verified
 * Shopify copy is swapped for it.
 */
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p, quiet: true });
}

// The local resolver intermittently fails (ENOTFOUND) while public DNS answers.
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
const PHASE = process.argv[2] || "plan";
const arg = (n, d = "") =>
  (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=") || d;
const WRITE = process.argv.includes("--write");
const LIMIT = Number(arg("limit", 0)) || Infinity;
const ONLY = arg("only");
const [SHARD, SHARDS] = arg("shard", "0/1").split("/").map(Number);
const CONCURRENCY = Number(arg("concurrency", 4));
const MAX_ATTEMPTS = 3;

const BRAND_ID = "6ab3b87e53747b87fb83871d";
const MONGO_URI = () => process.env.MONGODB_URL2;
const DOMAIN = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const API = `https://${DOMAIN}/admin/api/2025-07/graphql.json`;
const DIR = path.join(__dirname, "..", "image-audit", "wallsandfloors");
const STATE_FILE = path.join(DIR, "state.json");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const say = (s = "") => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const isShopify = (u) => /^https:\/\/cdn\.shopify\.com\//i.test(clean(u));
const isSupplier = (u) => /^https:\/\/(m2|www)\.wallsandfloors\.co\.uk\/.+\.(jpe?g|png|webp|gif)(\?|$)/i.test(clean(u));
const bare = (u) => clean(u).split("?")[0];
const hashOf = (u) => (String(u || "").match(/([0-9a-f]{40})/i) || [, ""])[1].toLowerCase();

// ---------- state ----------

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { products: {}, files: {} };
  }
}
function saveState(state) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state));
  fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
}

// ---------- Shopify ----------

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

/** Mutations retry only when Shopify answered (nothing executed), never after a timeout. */
async function gql(query, variables, attempt = 0) {
  const isMutation = /^\s*mutation/.test(query);
  let answered = false;
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(180_000),
    });
    if (res.status === 401 && attempt < 5) {
      token = await shopifyToken();
      return gql(query, variables, attempt + 1);
    }
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

async function createProductMedia(productId, sources, alt) {
  const data = await gql(
    `mutation($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) { media { id } mediaUserErrors { message } }
    }`,
    { productId, media: sources.map((u) => ({ originalSource: u, mediaContentType: "IMAGE", alt })) },
  );
  const r = data.productCreateMedia;
  if (r.mediaUserErrors?.length) throw new Error(r.mediaUserErrors.map((e) => e.message).join("; "));
  if ((r.media || []).length !== sources.length) throw new Error("Shopify returned a different number of media");
  return r.media.map((m) => m.id);
}

async function deleteProductMedia(productId, mediaIds) {
  const data = await gql(
    `mutation($productId: ID!, $mediaIds: [ID!]!) {
      productDeleteMedia(productId: $productId, mediaIds: $mediaIds) { mediaUserErrors { message } }
    }`,
    { productId, mediaIds },
  );
  const errs = data.productDeleteMedia.mediaUserErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
}

async function createFiles(sources) {
  const data = await gql(
    `mutation($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id } userErrors { message } } }`,
    { files: sources.map((u) => ({ originalSource: u, contentType: "IMAGE" })) },
  );
  const r = data.fileCreate;
  if (r.userErrors?.length) throw new Error(r.userErrors.map((e) => e.message).join("; "));
  if ((r.files || []).length !== sources.length) throw new Error("Shopify returned a different number of files");
  return r.files.map((f) => f.id);
}

async function deleteFiles(ids) {
  await gql(`mutation($ids: [ID!]!) { fileDelete(fileIds: $ids) { userErrors { message } } }`, { ids });
}

/** Download here and push through a staged upload, so Shopify never fetches the supplier. */
async function stageFromSource(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`source answered ${res.status}`);
  const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!mime.startsWith("image/")) throw new Error(`source is ${mime}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const filename = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image.jpg");
  const data = await gql(
    `mutation($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } }
    }`,
    { input: [{ resource: "IMAGE", filename, mimeType: mime, httpMethod: "POST", fileSize: String(bytes.length) }] },
  );
  const r = data.stagedUploadsCreate;
  if (r.userErrors?.length) throw new Error(r.userErrors.map((e) => e.message).join("; "));
  const target = r.stagedTargets[0];
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([bytes], { type: mime }), filename);
  const up = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  if (!up.ok) throw new Error(`staged upload answered ${up.status}`);
  return target.resourceUrl;
}

/**
 * stageFromSource for many images in one round trip: one stagedUploadsCreate
 * for the batch, then each file POSTed to its own target. Per-image calls were
 * Shopify-bound at ~2/s; batching takes the API out of the critical path.
 * Returns resourceUrl per input, or "" where that image failed.
 */
async function stageMany(urls) {
  const got = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) return null;
        const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
        if (!mime.startsWith("image/")) return null;
        const bytes = Buffer.from(await res.arrayBuffer());
        const filename = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image.jpg");
        return { mime, bytes, filename };
      } catch {
        return null;
      }
    }),
  );
  const ok = got.map((g, i) => (g ? i : -1)).filter((i) => i >= 0);
  const out = urls.map(() => "");
  if (!ok.length) return out;
  const data = await gql(
    `mutation($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } }
    }`,
    { input: ok.map((i) => ({ resource: "IMAGE", filename: got[i].filename, mimeType: got[i].mime, httpMethod: "POST", fileSize: String(got[i].bytes.length) })) },
  );
  const targets = data.stagedUploadsCreate.stagedTargets || [];
  await Promise.all(
    ok.map(async (i, k) => {
      const t = targets[k];
      if (!t) return;
      const form = new FormData();
      for (const p of t.parameters) form.append(p.name, p.value);
      form.append("file", new Blob([got[i].bytes], { type: got[i].mime }), got[i].filename);
      try {
        const up = await fetch(t.url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
        if (up.ok) out[i] = t.resourceUrl;
      } catch {
        /* left empty: retried next round */
      }
    }),
  );
  return out;
}

async function mediaStatus(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const data = await gql(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on MediaImage { id fileStatus image { url } } } }`,
      { ids: batch },
    );
    batch.forEach((id, k) => {
      const n = data.nodes[k];
      out.set(id, n ? { status: n.fileStatus, url: n.image?.url || "" } : { status: "MISSING", url: "" });
    });
  }
  return out;
}

async function productMedia(productIds) {
  const out = new Map();
  for (let i = 0; i < productIds.length; i += 5) {
    const ids = productIds.slice(i, i + 5);
    const data = await gql(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id
        media(first: 250) { nodes { id status ... on MediaImage { image { url } } } } } } }`,
      { ids },
    );
    ids.forEach((id, k) => {
      const m = new Map();
      for (const n of data.nodes[k]?.media?.nodes || []) m.set(n.id, { status: n.status, url: n.image?.url || "" });
      out.set(id, m);
    });
  }
  return out;
}

async function loadsAsImage(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
      if (res.ok && (res.headers.get("content-type") || "").startsWith("image/")) return true;
      if (res.status < 500) return false;
    } catch {
      /* retry once */
    }
  }
  return false;
}

// ---------- Mongo ----------

async function openProducts() {
  const conn = await connectMongo(MONGO_URI());
  return conn.db.collection("products");
}

function brandFilter() {
  const id = new mongoose.Types.ObjectId(BRAND_ID);
  const f = { brand: { $in: [id, BRAND_ID] }, shopifyProductId: { $nin: [null, ""] } };
  if (ONLY) f._id = new mongoose.Types.ObjectId(ONLY);
  return f;
}

/** What this product still needs uploaded. */
/** Shopify URLs found dead (404) during upload; their pairs count as unlinked. */
const DEAD = new Set();
function workFor(doc) {
  const linked = new Set();
  for (const p of doc.shopifyImages || []) if (isShopify(p.shopifyUrl) && !DEAD.has(clean(p.shopifyUrl))) linked.add(clean(p.sourceUrl));
  const gallery = (doc.images || []).map(clean).filter((u) => isSupplier(u) && !linked.has(u));
  const galleryUp = new Set(gallery);
  const files = new Set();
  for (const v of doc.variants || []) {
    for (const p of v.shopifyImages || []) if (isShopify(p.shopifyUrl)) linked.add(clean(p.sourceUrl));
    const hero = clean(v.imageUrl);
    if (isSupplier(hero) && !linked.has(hero) && !isShopify(v.shopifyImageUrl) && !galleryUp.has(hero)) files.add(hero);
    for (const u of v.images || []) if (isSupplier(u) && !linked.has(clean(u)) && !galleryUp.has(clean(u))) files.add(clean(u));
    for (const p of v.shopifyImages || []) if (isSupplier(p.sourceUrl) && !isShopify(p.shopifyUrl) && !galleryUp.has(clean(p.sourceUrl))) files.add(clean(p.sourceUrl));
  }
  for (const u of doc.technicalDrawings || []) if (isSupplier(u)) files.add(clean(u));
  return { gallery: [...new Set(gallery)], files: [...files] };
}

// ---------- phases ----------

async function plan() {
  const col = await openProducts();
  let products = 0, gallery = 0, onProducts = 0;
  const files = new Set();
  const swap = { images: 0, variantHero: 0, variantGallery: 0, drawings: 0 };
  for await (const d of col.find(brandFilter())) {
    products++;
    const w = workFor(d);
    gallery += w.gallery.length;
    if (w.gallery.length) onProducts++;
    w.files.forEach((u) => files.add(u));
    swap.images += (d.images || []).filter(isSupplier).length;
    for (const v of d.variants || []) {
      if (isSupplier(v.imageUrl)) swap.variantHero++;
      swap.variantGallery += (v.images || []).filter(isSupplier).length;
    }
    swap.drawings += (d.technicalDrawings || []).filter(isSupplier).length;
  }
  say(`products: ${products}`);
  say(`  gallery images to upload as product media: ${gallery} (on ${onProducts} products)`);
  say(`  files to upload (variant images + drawings): ${files.size}`);
  say(`  supplier URLs to swap: ${JSON.stringify(swap)}`);
  await mongoose.disconnect();
}

async function upload() {
  const state = loadState();
  const col = await openProducts();
  const docs = await col.find(brandFilter()).limit(LIMIT === Infinity ? 0 : LIMIT).toArray();
  await mongoose.disconnect();
  // Pairs whose Shopify copy is gone would otherwise count as mirrored.
  const check = [...new Set(docs.flatMap((d) => (d.shopifyImages || []).filter((p) => isShopify(p.shopifyUrl) && isSupplier(p.sourceUrl)).map((p) => clean(p.shopifyUrl))))];
  for (let i = 0; i < check.length; i += 64) {
    await Promise.all(check.slice(i, i + 64).map(async (u) => { if (!(await loadsAsImage(u))) DEAD.add(u); }));
  }
  say(`dead Shopify copies found: ${DEAD.size}`);

  const fileUrls = new Set();
  for (const d of docs) workFor(d).files.forEach((u) => fileUrls.add(u));
  const todoFiles = [...fileUrls].filter((u) => !state.files[u]);
  say(`files to send: ${todoFiles.length}`);
  for (let i = 0; i < todoFiles.length; i += 25) {
    const chunk = todoFiles.slice(i, i + 25);
    try {
      const ids = await createFiles(chunk);
      chunk.forEach((u, k) => (state.files[u] = { id: ids[k] }));
    } catch (e) {
      say(`  file chunk failed: ${String(e.message).slice(0, 160)}`);
    }
    saveState(state);
    if ((i / 25) % 40 === 39) say(`  files sent ${Math.min(i + 25, todoFiles.length)}/${todoFiles.length}`);
  }

  // Anything not yet uploaded for a product, whether or not it was visited before.
  const queue = docs
    .map((d) => ({ d, w: workFor(d) }))
    .filter(({ d, w }) => {
      const done = new Set((state.products[String(d._id)]?.media || []).map((m) => m.source));
      return w.gallery.some((u) => !done.has(u));
    });
  say(`products with gallery uploads: ${queue.length}`);
  let done = 0, sent = 0;
  const worker = async () => {
    while (queue.length) {
      const { d, w } = queue.shift();
      const id = String(d._id);
      const entry = state.products[id] || { productId: d.shopifyProductId, media: [] };
      const already = new Set(entry.media.map((m) => m.source));
      const todo = w.gallery.filter((u) => !already.has(u));
      try {
        for (let i = 0; i < todo.length; i += 10) {
          const chunk = todo.slice(i, i + 10);
          const ids = await createProductMedia(d.shopifyProductId, chunk, String(d.name || "").slice(0, 120));
          chunk.forEach((u, k) => entry.media.push({ source: u, id: ids[k] }));
          sent += chunk.length;
          state.products[id] = entry;
          saveState(state);
        }
        entry.sent = true;
      } catch (e) {
        entry.error = String(e.message).slice(0, 200);
      }
      state.products[id] = entry;
      saveState(state);
      if (++done % 20 === 0) say(`  gallery: ${done} products, ${sent} images sent`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  say(`upload done: ${todoFiles.length} files, ${sent} gallery images`);
}

async function collect() {
  const state = loadState();
  const media = () => Object.values(state.products).flatMap((p) => p.media.map((m) => ({ p, m })));
  const report = () => {
    const m = media().map((x) => x.m);
    const f = Object.values(state.files);
    say(`  gallery media: ${m.filter((x) => x.url).length}/${m.length} ready, ${m.filter((x) => x.gaveUp).length} gave up | files: ${f.filter((x) => x.url).length}/${f.length} ready, ${f.filter((x) => x.gaveUp).length} gave up`);
  };
  for (let round = 1; round <= 8; round++) {
    const openM = media().filter(({ m }) => !m.url && !m.gaveUp);
    const openF = Object.entries(state.files).filter(([, f]) => !f.url && !f.gaveUp);
    if (!openM.length && !openF.length) break;
    say(`round ${round}: ${openM.length} media, ${openF.length} files not ready`);
    const status = await mediaStatus([...openM.map(({ m }) => m.id), ...openF.map(([, f]) => f.id)].filter(Boolean));
    const failedM = [], failedF = [];
    let processing = 0;
    for (const x of openM) {
      const s = x.m.id ? status.get(x.m.id) : { status: "MISSING" };
      if (s?.status === "READY" && s.url) x.m.url = s.url;
      else if (s?.status === "FAILED" || s?.status === "MISSING") failedM.push({ ...x, st: s.status });
      else processing++;
    }
    for (const [u, f] of openF) {
      const s = f.id ? status.get(f.id) : { status: "MISSING" };
      if (s?.status === "READY" && s.url) f.url = s.url;
      else if (s?.status === "FAILED" || s?.status === "MISSING") failedF.push({ u, f, st: s.status });
      else processing++;
    }
    saveState(state);
    report();
    say(`  ${failedM.length + failedF.length} failed → re-uploading by bytes, ${processing} still processing`);
    let resent = 0, gaveUp = 0;
    const jobs = [
      ...failedM.map((x) => async () => {
        if (x.m.id && x.st === "FAILED") await deleteProductMedia(x.p.productId, [x.m.id]);
        x.m.id = "";
        x.m.staged = (x.m.staged || 0) + 1;
        if (x.m.staged > MAX_ATTEMPTS) return (x.m.gaveUp = true), gaveUp++;
        [x.m.id] = await createProductMedia(x.p.productId, [await stageFromSource(x.m.source)], "");
        resent++;
      }),
    ];
    for (const x of failedF) {
      jobs.push(async () => {
        if (x.f.id && x.st === "FAILED") await deleteFiles([x.f.id]);
        x.f.id = "";
        x.f.staged = (x.f.staged || 0) + 1;
        if (x.f.staged > MAX_ATTEMPTS) return (x.f.gaveUp = true), gaveUp++;
        [x.f.id] = await createFiles([await stageFromSource(x.u)]);
        resent++;
      });
    }
    let done = 0;
    const worker = async () => {
      while (jobs.length) {
        const job = jobs.shift();
        try {
          await job();
        } catch (e) {
          /* recorded below via the next round's status */
        }
        // Saved after every job: an id Shopify returned must never be forgotten.
        saveState(state);
        if (++done % 200 === 0) say(`  re-uploaded ${done}/${failedM.length + failedF.length}`);
      }
    };
    await Promise.all(Array.from({ length: Number(arg("workers", 12)) }, worker));
    saveState(state);
    say(`  round ${round} done: re-uploaded ${resent}, gave up ${gaveUp}`);
    if (!processing && !failedM.length && !failedF.length) break;
    await sleep(15_000);
  }
  say("\nfinal:");
  report();
}

/** Same as resolveGalleryImages in src/lib/productImage.ts. */
function gallery(images, pairs) {
  const stored = (images || []).filter((s) => typeof s === "string" && s.trim());
  const linked = (pairs || []).filter((p) => p && clean(p.shopifyUrl));
  if (!linked.length) return stored;
  const out = [];
  const claimed = new Set();
  for (const p of [...linked].sort((a, b) => (+a.position || 0) - (+b.position || 0))) {
    out.push(clean(p.shopifyUrl));
    if (clean(p.sourceUrl)) claimed.add(clean(p.sourceUrl));
  }
  for (const s of stored) if (!claimed.has(s) && !out.includes(s)) out.push(s);
  return out;
}
const shownVariantGallery = (v) => gallery(v.images, v.shopifyImages).filter(isShopify);
/** Same pictures, none lost, none doubled (a newly linked image takes its proper place). */
const sameSet = (a, b) => a.length === b.length && new Set(b).size === b.length && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
function keepsOrder(before, after) {
  let j = 0;
  for (const x of after) if (x === before[j]) j++;
  return j === before.length;
}

/** reconcileProductMedia's decision for this document against live media. */
function simulateSync(doc, live) {
  const stored = (doc.images || []).map(clean).filter(Boolean);
  const galleryUrls = stored.length
    ? stored
    : [...(doc.shopifyImages || [])].sort((a, b) => (+a.position || 0) - (+b.position || 0)).map((p) => clean(p.sourceUrl || p.shopifyUrl));
  const wanted = [...new Set([...galleryUrls, ...(doc.variants || []).map((v) => clean(v.imageUrl))].filter((u) => /^https?:\/\//i.test(u)))];
  const usable = new Set([...live].filter(([, m]) => m.status !== "FAILED").map(([id]) => id));
  const bySource = new Map();
  for (const l of doc.shopifyImages || []) {
    if (clean(l.sourceUrl) && l.mediaId && usable.has(l.mediaId)) bySource.set(clean(l.sourceUrl), l);
  }
  const keep = new Set(wanted.map((s) => bySource.get(s)?.mediaId).filter(Boolean));
  for (const v of doc.variants || []) for (const p of v.shopifyImages || []) if (p.mediaId) keep.add(p.mediaId);
  return { upload: wanted.filter((s) => !bySource.has(s)), remove: [...live.keys()].filter((id) => !keep.has(id)) };
}

function buildUpdate(doc, entry, files, live, loads) {
  const verified = (p) => {
    const shop = clean(p?.shopifyUrl);
    if (!isShopify(shop) || !loads.get(shop)) return false;
    // Toasty files carry a 40-hex content hash that survives into the Shopify
    // name; a pair whose two sides disagree points at a different picture.
    const hs = hashOf(p.sourceUrl);
    const hd = hashOf(shop);
    if (hs && hd && hs !== hd) return false;
    if (!p.mediaId) return true;
    const m = live.get(p.mediaId);
    return Boolean(m && m.status === "READY" && bare(m.url) === bare(shop));
  };
  const fileUrl = (u) => (files[u]?.url && loads.get(files[u].url) ? files[u].url : "");
  const productMediaIdFor = (url) => (doc.shopifyImages || []).find((p) => clean(p.shopifyUrl) === url)?.mediaId || "";
  const fresh = new Map(
    (entry?.media || [])
      .filter((m) => m.url && m.id && live.get(m.id)?.status === "READY" && loads.get(m.url))
      .map((m) => [m.source, m]),
  );

  const changes = [];
  const replaced = new Map();
  const counts = { gallery: 0, galleryNew: 0, variantHero: 0, variantGallery: 0, drawings: 0, kept: 0 };

  // Gallery: existing verified pair, else a freshly uploaded media.
  const pairs = (doc.shopifyImages || []).map((p) => ({ ...p }));
  const pairBySource = new Map(pairs.map((p, i) => [clean(p.sourceUrl), i]));
  const productMap = new Map();
  const freshId = new Map(); // fresh Shopify URL → its media id
  for (const p of pairs) if (isSupplier(p.sourceUrl) && verified(p)) productMap.set(clean(p.sourceUrl), clean(p.shopifyUrl));

  const images = (doc.images || []).map((u, i) => {
    const src = clean(u);
    if (!isSupplier(src)) return u;
    // A pair with no media id is invisible to the sync; a fresh upload of the
    // same file, attached as product media, replaces it.
    const k0 = pairBySource.get(src);
    const preferFresh = fresh.has(src) && k0 !== undefined && !pairs[k0].mediaId;
    let to = preferFresh ? undefined : productMap.get(src);
    if (to) {
      const k = pairBySource.get(src);
      pairs[k] = { ...pairs[k], sourceUrl: to };
      changes.push(`shopifyImages.${k}.sourceUrl`);
      counts.gallery++;
    } else if (fresh.has(src)) {
      const m = fresh.get(src);
      to = m.url;
      const k = pairBySource.get(src);
      if (k !== undefined && (preferFresh || !isShopify(pairs[k].shopifyUrl) || !loads.get(clean(pairs[k].shopifyUrl)))) {
        // A fake, dead or media-less pair: refill it in place with the fresh copy
        // (the page showed the old copy in this slot, so record that it moved).
        if (isShopify(pairs[k].shopifyUrl)) replaced.set(clean(pairs[k].shopifyUrl), to);
        pairs[k] = { ...pairs[k], sourceUrl: to, shopifyUrl: to, mediaId: m.id };
        changes.push(`shopifyImages.${k}`);
      } else if (k === undefined) {
        pairs.push({ sourceUrl: to, shopifyUrl: to, mediaId: m.id, position: i });
        changes.push(`shopifyImages.${pairs.length - 1}`);
      } else {
        counts.kept++;
        return u;
      }
      productMap.set(src, to);
      freshId.set(to, m.id);
      counts.galleryNew++;
    } else {
      counts.kept++;
      return u;
    }
    replaced.set(src, to);
    changes.push(`images.${i}`);
    return to;
  });
  // Pairs whose supplier source no longer appears in images[] or any variant
  // (images[] already holds the Shopify URL): the sync matches by sourceUrl, so
  // name the pair's own verified Shopify URL, which is what images[] holds.
  {
    const referenced = new Set([...images.map(clean), ...(doc.variants || []).flatMap((v) => [clean(v.imageUrl), ...(v.images || []).map(clean)])]);
    pairs.forEach((p, k) => {
      const src = clean(p.sourceUrl);
      if (!isSupplier(src) || referenced.has(src) || !verified(p)) return;
      pairs[k] = { ...p, sourceUrl: clean(p.shopifyUrl) };
      changes.push(`shopifyImages.${k}.sourceUrl`);
      counts.gallery++;
    });
  }
  // Pairs whose source is not in images[] (variant images the sync mirrored).
  pairs.forEach((p, k) => {
    const src = clean(p.sourceUrl);
    if (isSupplier(src) && productMap.get(src) === clean(p.shopifyUrl)) {
      pairs[k] = { ...p, sourceUrl: productMap.get(src) };
      changes.push(`shopifyImages.${k}.sourceUrl`);
    }
  });

  const variants = (doc.variants || []).map((v, vi) => {
    const nv = { ...v };
    const hero = clean(v.imageUrl);
    if (isSupplier(hero)) {
      let own = "";
      if (isShopify(v.shopifyImageUrl) && loads.get(clean(v.shopifyImageUrl))) {
        const m = v.shopifyMediaId ? live.get(v.shopifyMediaId) : null;
        if (!v.shopifyMediaId || (m && m.status === "READY")) own = clean(v.shopifyImageUrl);
      }
      const to = productMap.get(hero) || own || fileUrl(hero);
      if (to) {
        nv.imageUrl = to;
        changes.push(`variants.${vi}.imageUrl`);
        counts.variantHero++;
        // A pair for this very file with an empty sourceUrl matches nothing in
        // the sync, so its media would be deleted; naming the URL keeps it.
        pairs.forEach((p, k) => {
          if (!clean(p.sourceUrl) && clean(p.shopifyUrl) === to) {
            pairs[k] = { ...p, sourceUrl: to };
            changes.push(`shopifyImages.${k}.sourceUrl`);
          }
        });
      } else counts.kept++;
    }
    // A fake shopifyImageUrl (the supplier URL) becomes the real copy of the hero.
    if (clean(v.shopifyImageUrl) && !isShopify(v.shopifyImageUrl) && isShopify(nv.imageUrl)) {
      nv.shopifyImageUrl = nv.imageUrl;
      changes.push(`variants.${vi}.shopifyImageUrl`);
    }
    if (!("images" in v) && (v.shopifyImages || []).length) {
      // Variant galleries held only as pairings: verified pairs swap their
      // source; fake ones are refilled with the product's copy of the file.
      nv.shopifyImages = v.shopifyImages.map((p, i) => {
        const src = clean(p.sourceUrl);
        if (!isSupplier(src)) return { ...p };
        if (verified(p)) {
          changes.push(`variants.${vi}.shopifyImages.${i}.sourceUrl`);
          counts.variantGallery++;
          return { ...p, sourceUrl: clean(p.shopifyUrl) };
        }
        const to = productMap.get(src) || fileUrl(src);
        if (!to) {
          counts.kept++;
          return { ...p };
        }
        changes.push(`variants.${vi}.shopifyImages.${i}`);
        counts.variantGallery++;
        return { ...p, sourceUrl: to, shopifyUrl: to, mediaId: freshId.get(to) || productMediaIdFor(to) };
      });
    }
    if ("images" in v) {
      const vmap = new Map();
      for (const p of v.shopifyImages || []) if (isSupplier(p.sourceUrl) && verified(p)) vmap.set(clean(p.sourceUrl), clean(p.shopifyUrl));
      // Variants with pairs keep their order through new pairs; without, the stored order is the order.
      const hasPairs = (v.shopifyImages || []).length > 0;
      const added = [];
      nv.images = (v.images || []).map((u, i) => {
        const src = clean(u);
        if (!isSupplier(src)) return u;
        let to = vmap.get(src) || productMap.get(src);
        if (!to && fileUrl(src)) {
          to = fileUrl(src);
          if (hasPairs) added.push({ sourceUrl: to, shopifyUrl: to, mediaId: "", position: i });
        }
        if (!to) {
          counts.kept++;
          return u;
        }
        changes.push(`variants.${vi}.images.${i}`);
        counts.variantGallery++;
        return to;
      });
      if (hasPairs) {
        const vp = (v.shopifyImages || []).map((p, i) => {
          const to = vmap.get(clean(p.sourceUrl));
          if (!to) return { ...p };
          changes.push(`variants.${vi}.shopifyImages.${i}.sourceUrl`);
          return { ...p, sourceUrl: to };
        });
        added.forEach((_, k) => changes.push(`variants.${vi}.shopifyImages.${vp.length + k}`));
        nv.shopifyImages = [...vp, ...added];
      }
    }
    return nv;
  });

  let drawings;
  if (Array.isArray(doc.technicalDrawings)) {
    drawings = doc.technicalDrawings.map((u, i) => {
      if (!isSupplier(u)) return u;
      const to = fileUrl(clean(u));
      if (!to) {
        counts.kept++;
        return u;
      }
      changes.push(`technicalDrawings.${i}`);
      counts.drawings++;
      return to;
    });
  }
  return { images, pairs, variants, drawings, changes, replaced, counts };
}

function flat(doc) {
  const out = new Map();
  const walk = (n, p) => {
    if (Array.isArray(n)) return n.forEach((v, i) => walk(v, `${p}.${i}`));
    if (n && typeof n === "object" && !n._bsontype && !(n instanceof Date)) {
      return Object.keys(n).forEach((k) => walk(n[k], p ? `${p}.${k}` : k));
    }
    out.set(p, EJSON.stringify(n === undefined ? null : n, { relaxed: false }));
  };
  walk(doc, "");
  return out;
}

async function apply() {
  const state = loadState();
  const col = await openProducts();
  const supplier = /^https:\/\/(m2|www)\.wallsandfloors\.co\.uk\/.+\.(jpe?g|png|webp|gif)/i;
  const pending = {
    ...brandFilter(),
    $or: [{ images: supplier }, { "variants.imageUrl": supplier }, { "variants.images": supplier }, { technicalDrawings: supplier }, { "shopifyImages.sourceUrl": supplier }, { "variants.shopifyImages.sourceUrl": supplier }],
  };
  let ids = (await col.find(pending).project({ _id: 1 }).sort({ _id: 1 }).toArray()).map((d) => d._id).filter((_, k) => k % SHARDS === SHARD);
  if (LIMIT !== Infinity) {
    const fresh = ids.filter((id) => state.products[String(id)]?.media?.length);
    ids = [...new Set([...fresh, ...ids])].slice(0, LIMIT);
  }
  say(`${WRITE ? "WRITE" : "DRY RUN"}: ${ids.length} products (shard ${SHARD}/${SHARDS})`);
  fs.mkdirSync(DIR, { recursive: true });
  const backupFile = path.join(DIR, `backup-${STAMP}-shard${SHARD}of${SHARDS}.ejson.jsonl`);

  const totals = { products: 0, written: 0, gallery: 0, galleryNew: 0, variantHero: 0, variantGallery: 0, drawings: 0, kept: 0, skipped: {}, verify: { ok: 0, unexpected: 0, countsChanged: 0, galleryChanged: 0, variantGalleryLost: 0, syncWorse: 0, notWritten: 0 } };
  const skip = (why) => (totals.skipped[why] = (totals.skipped[why] || 0) + 1);
  const loads = new Map();

  for (let i = 0; i < ids.length; i += 20) {
    const docs = await col.find({ _id: { $in: ids.slice(i, i + 20) } }).toArray();
    const media = await productMedia([...new Set(docs.map((d) => d.shopifyProductId))]);
    const urls = new Set();
    for (const d of docs) {
      for (const p of d.shopifyImages || []) if (clean(p.shopifyUrl)) urls.add(clean(p.shopifyUrl));
      for (const v of d.variants || []) {
        if (clean(v.shopifyImageUrl)) urls.add(clean(v.shopifyImageUrl));
        for (const p of v.shopifyImages || []) if (clean(p.shopifyUrl)) urls.add(clean(p.shopifyUrl));
      }
      for (const m of state.products[String(d._id)]?.media || []) if (m.url) urls.add(m.url);
      for (const u of workFor(d).files) if (state.files[u]?.url) urls.add(state.files[u].url);
    }
    const list = [...urls].filter((u) => !loads.has(u));
    for (let k = 0; k < list.length; k += 64) {
      await Promise.all(list.slice(k, k + 64).map(async (u) => loads.set(u, await loadsAsImage(u))));
    }

    const queue = [...docs];
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (queue.length) {
          const d = queue.shift();
          totals.products++;
          const entry = state.products[String(d._id)];
          if (entry?.media?.some((m) => !m.url && !m.gaveUp)) {
            skip("uploads still processing — run collect");
            continue;
          }
          const live = media.get(d.shopifyProductId) || new Map();
          const u = buildUpdate(d, entry, state.files, live, loads);
          if (!u.changes.length) {
            skip("nothing verifiable to change");
            continue;
          }
          const next = { ...d, images: u.images, shopifyImages: u.pairs, variants: u.variants };
          const mapped = gallery(d.images, d.shopifyImages).map((x) => u.replaced.get(clean(x)) || x);
          if (!sameSet(mapped, gallery(next.images, next.shopifyImages))) {
            skip("product gallery would change");
            continue;
          }
          if ((d.variants || []).some((v, vi) => !keepsOrder(shownVariantGallery(v), shownVariantGallery(next.variants[vi])))) {
            skip("a variant gallery would lose or reorder an image");
            continue;
          }
          const sb = simulateSync(d, live);
          const sa = simulateSync(next, live);
          const linkedIds = new Set(u.pairs.map((p) => p.mediaId).filter(Boolean));
          if (sa.remove.some((id) => !sb.remove.includes(id)) || sa.upload.length > sb.upload.length) {
            skip("sync would delete or upload more after the swap");
            if (process.argv.includes("--debug")) {
              const newUp = sa.upload.filter((x) => !sb.upload.includes(x));
              const newRm = sa.remove.filter((x) => !sb.remove.includes(x));
              say(`  DEBUG ${d._id} upload ${sb.upload.length}→${sa.upload.length} new:${JSON.stringify(newUp.slice(0, 3))} remove ${sb.remove.length}→${sa.remove.length} newOrLinked:${JSON.stringify(newRm.slice(0, 3))}`);
            }
            continue;
          }
          for (const k of ["gallery", "galleryNew", "variantHero", "variantGallery", "drawings", "kept"]) totals[k] += u.counts[k];
          if (!WRITE) continue;

          fs.appendFileSync(backupFile, `${EJSON.stringify(d, { relaxed: false })}\n`);
          const set = { images: u.images, shopifyImages: u.pairs };
          if ("variants" in d) set.variants = u.variants;
          if (u.drawings) set.technicalDrawings = u.drawings;
          const filter = { _id: d._id, images: d.images, shopifyImages: d.shopifyImages };
          if ("variants" in d) filter.variants = d.variants;
          if (u.drawings) filter.technicalDrawings = d.technicalDrawings;
          const res = await col.updateOne(filter, { $set: set });
          if (res.modifiedCount !== 1) {
            totals.verify.notWritten++;
            continue;
          }
          totals.written++;

          const a = await col.findOne({ _id: d._id });
          const fb = flat(d);
          const fa = flat(a);
          const allowed = (p) => u.changes.some((c) => p === c || p.startsWith(`${c}.`));
          let bad = false;
          for (const k of new Set([...fb.keys(), ...fa.keys()])) {
            if (fb.get(k) === fa.get(k) || allowed(k)) continue;
            bad = true;
            say(`  UNEXPECTED ${d._id} ${k}`);
          }
          if (bad) totals.verify.unexpected++;
          const sizes = (x) => JSON.stringify([x.images?.length, x.variants?.length, x.technicalDrawings?.length, ...(x.variants || []).map((v) => v.images?.length)]);
          if (sizes(a) !== sizes(d) || (a.shopifyImages || []).length < (d.shopifyImages || []).length) totals.verify.countsChanged++;
          if (!sameSet(mapped, gallery(a.images, a.shopifyImages))) totals.verify.galleryChanged++;
          if ((d.variants || []).some((v, vi) => !keepsOrder(shownVariantGallery(v), shownVariantGallery(a.variants[vi])))) totals.verify.variantGalleryLost++;
          const s2 = simulateSync(a, live);
          if (s2.remove.some((id) => !sb.remove.includes(id)) || s2.upload.length > sb.upload.length) totals.verify.syncWorse++;
          if (!bad) totals.verify.ok++;
        }
      }),
    );
    say(`  ${Math.min(i + 20, ids.length)}/${ids.length}  written ${totals.written}  skipped ${JSON.stringify(totals.skipped)}  verify ${JSON.stringify(totals.verify)}`);
  }
  if (WRITE) say(`backup: ${backupFile}`);
  say(JSON.stringify(totals, null, 1));
  await mongoose.disconnect();
}

(async () => {
  token = await shopifyToken();
  if (PHASE === "plan") await plan();
  else if (PHASE === "upload") await upload();
  else if (PHASE === "collect") await collect();
  else if (PHASE === "apply") await apply();
  else throw new Error(`unknown phase ${PHASE}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
