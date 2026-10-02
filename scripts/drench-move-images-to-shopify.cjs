/**
 * Move every Drench image onto Shopify and drop the supplier (img.drench.co.uk) URLs.
 *
 * Drench (secondary cluster) has almost no `images` field: the main gallery is
 * the product's `shopifyImages` pairs, and each finish has its own gallery in
 * `variants[].images` + `variants[].shopifyImages` (pair position = index in
 * `images`). Most files are already on Shopify and only the supplier URL is
 * left to replace; ~1.6k variant images were never mirrored at all.
 *
 * Phases, each resumable from image-audit/drench/state.json:
 *
 *   plan     report the work; touches nothing
 *   upload   send unmirrored images: `images[]` entries to the product's media,
 *            everything else (variant galleries, variant hero images, swatches)
 *            to Shopify Files. Writes nothing to Mongo.
 *   collect  read back URLs; FAILED uploads are deleted and re-sent by bytes (3 tries)
 *   apply    per product: back up, swap each supplier URL for its Shopify copy,
 *            then verify against the backup. Dry run unless --write.
 *
 * Sync safety (src/lib/shopify/sync-media.ts reconcileProductMedia): the sync
 * keeps only media whose sourceUrl in the PRODUCT's `shopifyImages` is named
 * by `images[]` or `variants[].imageUrl`, and deletes the rest. So a
 * product-level source URL is swapped everywhere at once — the pair's
 * sourceUrl, `images[]` and every variant `imageUrl` holding it — and variant
 * gallery images go to Files, never product media. Variant `shopifyImages` are
 * not read by the sync at all. Every product is checked with a simulated
 * reconcile: the swap may not make it delete or upload anything more.
 *
 * An image whose Shopify copy is not READY, does not load, or does not carry the
 * source's content hash keeps its supplier URL; nothing is dropped.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/drench-move-images-to-shopify.cjs plan
 *   … upload   [--limit=5] [--only=<id>,<id>]
 *   … collect
 *   … apply    [--write] [--limit=5] [--only=<id>,<id>]
 */
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p, quiet: true });
}

const { EJSON, Int32 } = mongoose.mongo.BSON;
const PHASE = process.argv[2] || "plan";
const arg = (n, d = "") =>
  (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=") || d;
const WRITE = process.argv.includes("--write");
const LIMIT = Number(arg("limit", 0)) || Infinity;
const ONLY = arg("only").split(",").map((s) => s.trim()).filter(Boolean);
const CONCURRENCY = Number(arg("concurrency", 3));
const CHUNK = 10;
const MAX_ATTEMPTS = 3;

const BRAND_ID = "6aa9099e8b8dba35250c3855";
const DOMAIN = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const API = `https://${DOMAIN}/admin/api/2025-07/graphql.json`;
const DIR = path.join(__dirname, "..", "image-audit", "drench");
const STATE_FILE = path.join(DIR, "state.json");
/** --shard=i/n: this process takes every n-th product, offset i (parallel runs). */
const [SHARD_I, SHARD_N] = (arg("shard", "0/1").split("/").map(Number));
const STAMP = new Date().toISOString().replace(/[:.]/g, "-") + (SHARD_N > 1 ? `-shard${SHARD_I}of${SHARD_N}` : "");

const say = (s = "") => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const isShopify = (u) => /^https:\/\/cdn\.shopify\.com\//i.test(clean(u));
const isSupplier = (u) => /^https?:\/\/img\.drench\.co\.uk\//i.test(clean(u));
const hashOf = (u) => (String(u || "").match(/([0-9a-f]{40})/i) || [, ""])[1].toLowerCase();
/** The same picture: equal hash when the source carries one. */
const sameFile = (src, shopify) => !hashOf(src) || hashOf(src) === hashOf(shopify);
/** Key Files by content hash, so one picture used by many variants goes up once. */
const fileKey = (u) => hashOf(u) || clean(u);
/** Other paths Drench serves the same hash from, tried when the stored one is dead. */
const alternatesFor = (u) => {
  const s = clean(u);
  const out = [s];
  const m = s.match(/^(https?:\/\/img\.drench\.co\.uk)\/images\/[^/]+\/(.+)$/i);
  if (m) out.push(`${m[1]}/products/${m[2]}`);
  return [...new Set(out)];
};

// ---------- state ----------

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { products: {}, files: {}, dead: {} };
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

/**
 * Queries retry on any failure. Mutations retry only when Shopify answered
 * with an error (throttled, nothing executed): retrying after a timeout could
 * create the same media twice.
 */
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
    if (attempt >= 6 || (isMutation && !answered)) throw e;
    await sleep(2000 * 2 ** Math.min(attempt, 4));
    return gql(query, variables, attempt + 1);
  }
}

async function createProductMedia(productId, urls, alt) {
  const data = await gql(
    `mutation($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        mediaUserErrors { field message }
      }
    }`,
    { productId, media: urls.map((u) => ({ originalSource: u, mediaContentType: "IMAGE", alt })) },
  );
  const r = data.productCreateMedia;
  if (r.mediaUserErrors?.length) throw new Error(r.mediaUserErrors.map((e) => e.message).join("; "));
  if ((r.media || []).length !== urls.length) throw new Error("Shopify returned a different number of media");
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

async function createFiles(urls) {
  const data = await gql(
    `mutation($files: [FileCreateInput!]!) {
      fileCreate(files: $files) { files { id } userErrors { field message } }
    }`,
    { files: urls.map((u) => ({ originalSource: u, contentType: "IMAGE" })) },
  );
  const r = data.fileCreate;
  if (r.userErrors?.length) throw new Error(r.userErrors.map((e) => e.message).join("; "));
  if ((r.files || []).length !== urls.length) throw new Error("Shopify returned a different number of files");
  return r.files.map((f) => f.id);
}

async function deleteFiles(fileIds) {
  await gql(`mutation($ids: [ID!]!) { fileDelete(fileIds: $ids) { userErrors { message } } }`, { ids: fileIds });
}

/** id → { status, url } for MediaImage nodes (product media or Files). */
async function mediaStatus(ids) {
  const out = new Map();
  const list = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100);
    const data = await gql(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on MediaImage { id fileStatus image { url } } } }`,
      { ids: batch },
    );
    batch.forEach((id, k) => {
      const n = data.nodes[k];
      out.set(id, n && n.id ? { status: n.fileStatus, url: n.image?.url || "" } : { status: "MISSING", url: "" });
    });
  }
  return out;
}

/** Every media node on each Shopify product: productId → (mediaId → { status, url }). */
async function productMedia(docs) {
  const out = new Map();
  const want = new Map();
  for (const d of docs) {
    const n = (d.shopifyImages || []).length + (d.variants || []).length + 20;
    want.set(d.shopifyProductId, Math.max(want.get(d.shopifyProductId) || 0, Math.min(250, n)));
  }
  const ids = [...want.keys()].filter(Boolean);
  // Keep each query's requested connection size modest.
  let i = 0;
  while (i < ids.length) {
    const batch = [];
    let size = 0;
    while (i < ids.length && (batch.length === 0 || size + want.get(ids[i]) <= 500)) {
      size += want.get(ids[i]);
      batch.push(ids[i++]);
    }
    const first = Math.max(...batch.map((id) => want.get(id)));
    const data = await gql(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id
        media(first: ${first}) { nodes { id status ... on MediaImage { image { url } } } } } } }`,
      { ids: batch },
    );
    batch.forEach((id, k) => {
      const m = new Map();
      for (const n of data.nodes[k]?.media?.nodes || []) m.set(n.id, { status: n.status, url: n.image?.url || "" });
      out.set(id, data.nodes[k] ? m : null);
    });
  }
  return out;
}

async function headImage(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
      const type = (res.headers.get("content-type") || "").split(";")[0];
      if (res.ok && type.startsWith("image/")) return { ok: true, status: res.status };
      if (res.status < 500) return { ok: false, status: res.status };
      if (attempt) return { ok: false, status: res.status };
    } catch (e) {
      if (attempt) return { ok: false, status: "ERR" };
    }
    await sleep(1500);
  }
  return { ok: false, status: "ERR" };
}

async function checkLoads(urls, loads, width = 64) {
  const list = [...new Set(urls)].filter((u) => !loads.has(u));
  for (let k = 0; k < list.length; k += width) {
    await Promise.all(list.slice(k, k + width).map(async (u) => loads.set(u, (await headImage(u)).ok)));
  }
}

// ---------- Mongo ----------

async function openProducts() {
  const conn = await connectMongo(process.env.MONGODB_URL2);
  return conn.db.collection("products");
}

function brandFilter() {
  const id = new mongoose.Types.ObjectId(BRAND_ID);
  const f = { brand: { $in: [id, BRAND_ID] }, shopifyProductId: { $nin: [null, ""] } };
  if (ONLY.length) f._id = { $in: ONLY.map((x) => new mongoose.Types.ObjectId(x)) };
  return f;
}

/** Raw read: Int32 / Double stay wrapped so they are written back as the same BSON type. */
const RAW = { promoteValues: false };
const PROJECT = { name: 1, images: 1, shopifyImages: 1, variants: 1, shopifyProductId: 1 };

// ---------- live view of one batch ----------

/**
 * Everything the decisions need from Shopify for a set of documents:
 * the media on each product, and the status of every recorded mediaId that is
 * not on its product (a File, or something deleted).
 */
async function liveView(docs) {
  const media = await productMedia(docs);
  const off = [];
  for (const d of docs) {
    const live = media.get(d.shopifyProductId) || new Map();
    for (const p of d.shopifyImages || []) if (p.mediaId && !live.has(p.mediaId)) off.push(p.mediaId);
    for (const v of d.variants || []) for (const p of v.shopifyImages || []) if (p.mediaId && !live.has(p.mediaId)) off.push(p.mediaId);
  }
  const nodes = await mediaStatus(off);
  return { media, nodes };
}

/** Status of a recorded mediaId for this product: on-product media first, else the node. */
function statusOf(view, d, mediaId) {
  if (!mediaId) return { status: "NONE", url: "", onProduct: false };
  const live = view.media.get(d.shopifyProductId);
  if (live?.has(mediaId)) return { ...live.get(mediaId), onProduct: true };
  return { ...(view.nodes.get(mediaId) || { status: "MISSING", url: "" }), onProduct: false };
}

// ---------- decisions ----------

/**
 * The work one product needs, from its document and the live view.
 * `loads` (optional) adds the "Shopify copy actually loads" test.
 */
function analyse(d, view, loads) {
  const ok = (url, st, src, needProduct) =>
    clean(url) &&
    isShopify(url) &&
    st.status === "READY" &&
    (!needProduct || st.onProduct) &&
    sameFile(src, url) &&
    (!loads || loads.get(clean(url)) === true);

  // Product-level source → Shopify URL, only through a pair whose media is on this product.
  const productSwap = new Map();
  const productBlocked = new Map();
  for (const p of d.shopifyImages || []) {
    const src = clean(p.sourceUrl);
    if (!isSupplier(src)) continue;
    const st = statusOf(view, d, p.mediaId);
    // READY on this product, or a READY File: either is a durable copy, and
    // the sync treats media off the product the same before and after.
    if (ok(p.shopifyUrl, st, src, false)) {
      if (!productSwap.has(src)) productSwap.set(src, { to: clean(p.shopifyUrl), mediaId: p.mediaId });
    } else {
      productBlocked.set(src, !clean(p.shopifyUrl) ? "pair has no shopifyUrl" : st.status !== "READY" ? `media ${st.status}` : !sameFile(src, p.shopifyUrl) ? "hash mismatch" : "shopify url does not load");
    }
  }
  // A source held by two pairs that disagree is left alone.
  for (const p of d.shopifyImages || []) {
    const src = clean(p.sourceUrl);
    if (productSwap.has(src) && productBlocked.has(src)) productSwap.delete(src);
  }

  // Any usable variant pair for a source: used for variant imageUrl not in product pairs.
  const variantPairBySource = new Map();
  for (const v of d.variants || []) {
    for (const p of v.shopifyImages || []) {
      const src = clean(p.sourceUrl);
      if (!isSupplier(src) || variantPairBySource.has(src)) continue;
      if (ok(p.shopifyUrl, statusOf(view, d, p.mediaId), src, false)) variantPairBySource.set(src, clean(p.shopifyUrl));
    }
  }

  const productMediaUploads = []; // images[] entries with no pair at all
  const fileUploads = []; // supplier URLs needing a Shopify File
  for (const u of d.images || []) {
    const src = clean(u);
    if (isSupplier(src) && !productSwap.has(src) && !productBlocked.has(src)) productMediaUploads.push(src);
  }
  const variantGallery = { paired: 0, needFile: 0, relink: 0 };
  for (const v of d.variants || []) {
    const pairs = v.shopifyImages || [];
    for (const u of v.images || []) {
      const src = clean(u);
      if (!isSupplier(src)) continue;
      const mine = pairs.filter((p) => clean(p.sourceUrl) === src);
      if (mine.length && mine.every((p) => ok(p.shopifyUrl, statusOf(view, d, p.mediaId), src, false))) {
        variantGallery.paired++;
        continue;
      }
      fileUploads.push(src);
      if (mine.length) variantGallery.relink++;
      else variantGallery.needFile++;
    }
    const img = clean(v.imageUrl);
    if (isSupplier(img) && !productSwap.has(img) && !variantPairBySource.has(img)) fileUploads.push(img);
    if (isSupplier(v.swatchUrl)) fileUploads.push(clean(v.swatchUrl));
  }
  return {
    productSwap,
    productBlocked,
    variantPairBySource,
    productMediaUploads: [...new Set(productMediaUploads)],
    fileUploads: [...new Set(fileUploads)],
    variantGallery,
  };
}

// ---------- phases ----------

/** Products whose image fields still hold a supplier URL — everything else is done. */
function pendingFilter() {
  const re = /^https?:\/\/img\.drench\.co\.uk\//i;
  return {
    ...brandFilter(),
    $or: [
      { images: re },
      { "shopifyImages.sourceUrl": re },
      { "variants.imageUrl": re },
      { "variants.swatchUrl": re },
      { "variants.images": re },
      { "variants.shopifyImages.sourceUrl": re },
    ],
  };
}

async function eachBatch(col, size, fn, full = false) {
  const filter = process.argv.includes("--pending") ? pendingFilter() : brandFilter();
  let ids = (await col.find(filter).project({ _id: 1 }).sort({ _id: 1 }).toArray()).map((d) => d._id);
  if (LIMIT !== Infinity) ids = ids.slice(0, LIMIT);
  if (SHARD_N > 1) ids = ids.filter((_, k) => k % SHARD_N === SHARD_I);
  for (let i = 0; i < ids.length; i += size) {
    const cursor = col.find({ _id: { $in: ids.slice(i, i + size) } }, RAW);
    const docs = await (full ? cursor : cursor.project(PROJECT)).toArray();
    await fn(docs, i + docs.length, ids.length);
  }
}

async function plan() {
  const col = await openProducts();
  const t = { products: 0, productSwap: 0, productBlocked: {}, variantImageUrlViaVariantPair: 0, productMediaUploads: 0, variantPaired: 0, variantNeedFile: 0, variantRelink: 0, swatches: 0 };
  const files = new Map();
  const productsWithWork = new Set();
  const planOut = {};
  await eachBatch(col, 25, async (docs, n, total) => {
    const view = await liveView(docs);
    for (const d of docs) {
      t.products++;
      const a = analyse(d, view);
      t.productSwap += a.productSwap.size;
      for (const why of a.productBlocked.values()) t.productBlocked[why] = (t.productBlocked[why] || 0) + 1;
      t.variantImageUrlViaVariantPair += (d.variants || []).filter((v) => isSupplier(v.imageUrl) && !a.productSwap.has(clean(v.imageUrl)) && a.variantPairBySource.has(clean(v.imageUrl))).length;
      t.productMediaUploads += a.productMediaUploads.length;
      t.variantPaired += a.variantGallery.paired;
      t.variantNeedFile += a.variantGallery.needFile;
      t.variantRelink += a.variantGallery.relink;
      t.swatches += (d.variants || []).filter((v) => isSupplier(v.swatchUrl)).length;
      for (const u of a.fileUploads) if (!files.has(fileKey(u))) files.set(fileKey(u), u);
      if (a.fileUploads.length || a.productMediaUploads.length) {
        productsWithWork.add(String(d._id));
        planOut[String(d._id)] = { files: a.fileUploads, media: a.productMediaUploads };
      }
    }
    if (n % 500 < 25 || n === total) say(`  ${n}/${total} products read`);
  });
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, "plan.json"), JSON.stringify({ at: STAMP, totals: t, uploads: planOut }, null, 1));
  say(JSON.stringify(t, null, 1));
  say(`unique Files to upload (by content hash): ${files.size}`);
  say(`products needing uploads: ${productsWithWork.size}`);
  await mongoose.disconnect();
}

/** Find a URL that serves the image: the stored one, else an alternate path with the same hash. */
async function liveSourceFor(u, state) {
  if (state.dead[u]?.alt) return state.dead[u].alt;
  const tried = [];
  for (const cand of alternatesFor(u)) {
    const r = await headImage(cand);
    tried.push(`${r.status}`);
    if (r.ok) {
      if (cand !== u) state.dead[u] = { status: tried[0], alt: cand };
      return cand;
    }
  }
  state.dead[u] = { status: tried.join("/"), alt: "" };
  return "";
}

async function upload() {
  const state = loadState();
  const col = await openProducts();
  const work = [];
  await eachBatch(col, 25, async (docs) => {
    const view = await liveView(docs);
    for (const d of docs) {
      const a = analyse(d, view);
      if (a.fileUploads.length || a.productMediaUploads.length) work.push({ d: { _id: d._id, name: d.name, shopifyProductId: d.shopifyProductId }, a });
    }
  });
  await mongoose.disconnect();

  // Files first, once per content hash.
  const pending = new Map();
  for (const { a } of work) for (const u of a.fileUploads) if (!state.files[fileKey(u)] && !pending.has(fileKey(u))) pending.set(fileKey(u), u);
  say(`files to send: ${pending.size}; products with product-media uploads: ${work.filter((w) => w.a.productMediaUploads.length).length}`);

  // Resolve a serving URL for each (dead ones are recorded and skipped).
  const queue = [...pending.entries()];
  const resolved = [];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const [key, u] = queue.shift();
        const src = await liveSourceFor(u, state);
        if (src) resolved.push([key, u, src]);
      }
    }),
  );
  saveState(state);
  say(`  sources serving: ${resolved.length}, dead: ${pending.size - resolved.length}`);

  let sent = 0;
  const chunks = [];
  for (let i = 0; i < resolved.length; i += CHUNK) chunks.push(resolved.slice(i, i + CHUNK));
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (chunks.length) {
        const chunk = chunks.shift();
        try {
          const ids = await createFiles(chunk.map(([, , src]) => src));
          chunk.forEach(([key, u, src], k) => (state.files[key] = { source: u, from: src, id: ids[k], attempts: 1 }));
          sent += chunk.length;
        } catch (e) {
          say(`  file chunk failed: ${String(e.message).slice(0, 160)}`);
        }
        saveState(state);
        if (sent && sent % 100 === 0) say(`  ${sent}/${resolved.length} files sent`);
        await sleep(400);
      }
    }),
  );
  say(`  files sent: ${sent}`);

  for (const { d, a } of work) {
    if (!a.productMediaUploads.length) continue;
    const id = String(d._id);
    const entry = state.products[id] || { productId: d.shopifyProductId, media: [] };
    const already = new Set(entry.media.map((m) => m.source));
    const todo = [];
    for (const u of a.productMediaUploads) {
      if (already.has(u)) continue;
      const src = await liveSourceFor(u, state);
      if (src) todo.push([u, src]);
    }
    try {
      for (let i = 0; i < todo.length; i += CHUNK) {
        const chunk = todo.slice(i, i + CHUNK);
        const ids = await createProductMedia(d.shopifyProductId, chunk.map(([, s]) => s), String(d.name || "").slice(0, 120));
        chunk.forEach(([u, s], k) => entry.media.push({ source: u, from: s, id: ids[k], attempts: 1 }));
        state.products[id] = entry;
        saveState(state);
      }
    } catch (e) {
      entry.error = String(e.message).slice(0, 200);
      say(`  FAIL ${id}: ${entry.error}`);
    }
    state.products[id] = entry;
    saveState(state);
  }
  say("upload done");
}

/**
 * Upload a supplier image by its bytes rather than its URL, for when the
 * supplier refuses Shopify's fetcher. Shopify then reads it from its own storage.
 */
async function stageFromSource(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`source answered ${res.status}`);
  const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!mime.startsWith("image/")) throw new Error(`source is ${mime}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const filename = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image.jpg");
  const data = await gql(
    `mutation($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { message }
      }
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

async function collect() {
  const state = loadState();
  const media = () => Object.entries(state.products).flatMap(([pid, p]) => p.media.map((m) => ({ pid, p, m })));
  const report = () => {
    const all = media().map((x) => x.m);
    const files = Object.values(state.files);
    say(`  media: ${all.filter((m) => m.url).length}/${all.length} ready, ${all.filter((m) => m.gaveUp).length} gave up | files: ${files.filter((f) => f.url).length}/${files.length} ready, ${files.filter((f) => f.gaveUp).length} gave up`);
  };

  for (let round = 1; round <= 10; round++) {
    const open = media().filter(({ m }) => !m.url && !m.gaveUp);
    const openFiles = Object.values(state.files).filter((f) => !f.url && !f.gaveUp);
    if (!open.length && !openFiles.length) break;
    say(`round ${round}: ${open.length} media and ${openFiles.length} files not ready yet`);

    const status = await mediaStatus([...open.map(({ m }) => m.id), ...openFiles.map((f) => f.id)]);
    const failed = [];
    const failedFiles = [];
    let processing = 0;
    for (const x of open) {
      const s = x.m.id ? status.get(x.m.id) : { status: "MISSING" };
      if (s?.status === "READY" && s.url) x.m.url = s.url;
      else if (s?.status === "FAILED" || s?.status === "MISSING") failed.push([x, s.status]);
      else processing++;
    }
    for (const f of openFiles) {
      const s = f.id ? status.get(f.id) : { status: "MISSING" };
      if (s?.status === "READY" && s.url) f.url = s.url;
      else if (s?.status === "FAILED" || s?.status === "MISSING") failedFiles.push([f, s.status]);
      else processing++;
    }
    saveState(state);
    report();
    say(`  ${failed.length + failedFiles.length} failed → re-uploading by bytes, ${processing} still processing`);

    let resent = 0, gaveUp = 0;
    for (const [{ p, m }, st] of failed) {
      try {
        // Remove only media this script created and Shopify marked FAILED.
        if (m.id && st === "FAILED") await deleteProductMedia(p.productId, [m.id]);
        m.id = "";
        m.staged = (m.staged || 0) + 1;
        if (m.staged > MAX_ATTEMPTS) {
          m.gaveUp = true;
          gaveUp++;
        } else {
          const resourceUrl = await stageFromSource(m.from || m.source);
          [m.id] = await createProductMedia(p.productId, [resourceUrl], "");
          resent++;
        }
      } catch (e) {
        m.lastError = String(e.message).slice(0, 160);
      }
      saveState(state);
    }

    const queue = [...failedFiles];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length) {
          const [f, st] = queue.shift();
          try {
            if (f.id && st === "FAILED") await deleteFiles([f.id]);
            f.id = "";
            f.staged = (f.staged || 0) + 1;
            if (f.staged > MAX_ATTEMPTS) {
              f.gaveUp = true;
              gaveUp++;
              continue;
            }
            const resourceUrl = await stageFromSource(f.from || f.source);
            [f.id] = await createFiles([resourceUrl]);
            resent++;
          } catch (e) {
            f.lastError = String(e.message).slice(0, 160);
          }
          saveState(state);
          if ((resent + gaveUp) % 50 === 0 && resent + gaveUp) say(`  re-sent ${resent}, gave up ${gaveUp}`);
        }
      }),
    );
    say(`  round ${round} done: re-uploaded ${resent}, gave up ${gaveUp}`);
    if (!processing && !resent && !failed.length && !failedFiles.length) break;
    await sleep(30_000);
  }
  say("\nfinal:");
  report();
}

// ---------- the storefront, simulated ----------

/** buildShopifyFallbackMap in src/lib/productImage.ts. */
function fallbackMap(pairs) {
  const map = {};
  for (const p of pairs || []) {
    const shopify = clean(p?.shopifyUrl);
    const source = clean(p?.sourceUrl) || shopify;
    if (!shopify) continue;
    map[source] = shopify;
    map[shopify] = shopify;
  }
  return map;
}

/** resolveGalleryImages in src/lib/productImage.ts. */
function gallery(images, pairs) {
  const stored = (images || []).filter((s) => typeof s === "string" && s.trim());
  const linked = (pairs || []).filter((p) => p && clean(p.shopifyUrl));
  if (!linked.length) return stored;
  const out = [];
  const claimed = new Set();
  for (const p of [...linked].sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))) {
    out.push(clean(p.shopifyUrl));
    if (clean(p.sourceUrl)) claimed.add(clean(p.sourceUrl));
  }
  for (const s of stored) if (!claimed.has(s) && !out.includes(s)) out.push(s);
  return out;
}

const isVideo = (u) => /^(youtube|vimeo):/i.test(u) || /youtube\.com|youtu\.be|vimeo\.com|\.(mp4|mov|webm|m4v)(\?|$)/i.test(u);

/** The PDP gallery for a chosen variant: galleryImages in ProductSection. */
function variantGallery(doc, v) {
  const fb = fallbackMap([...(doc.shopifyImages || []), ...(doc.variants || []).flatMap((x) => x.shopifyImages || [])]);
  const only = (list) => list.map((s) => (isVideo(s) ? s : fb[s] || "")).filter(Boolean);
  const base = doc.images || [];
  const mirrored = [...(v.shopifyImages || [])]
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
    .map((p) => clean(p.shopifyUrl))
    .filter(Boolean);
  if (mirrored.length) return only([...mirrored, ...base.filter((s) => !mirrored.includes(s))]);
  const img = clean(v.imageUrl);
  if (!img) return only(base);
  return only([img, ...base.filter((s, i, arr) => s !== img && arr.indexOf(s) === i)]);
}

/** A variant's option image: withShopifyOptionImages in productImage.ts. */
function optionImage(doc, v) {
  return clean(v.shopifyImageUrl) || fallbackMap(doc.shopifyImages)[clean(v.imageUrl)] || "";
}

/** Same picture on screen: identical, or a supplier URL now shown from Shopify with the same hash. */
const sameShown = (a, b) => a === b || (isShopify(b) && !!hashOf(a) && hashOf(a) === hashOf(b));

/** reconcileProductMedia's decision for this document against live media. */
function simulateSync(doc, live) {
  const wanted = [
    ...new Set(
      [...(doc.images || []), ...(doc.variants || []).map((v) => v.imageUrl || "")]
        .map(clean)
        .filter((u) => /^https?:\/\//i.test(u) && !/\/video\/upload\//i.test(u) && !/\.(mp4|mov|webm|m4v|avi)(\?|$)/i.test(u)),
    ),
  ];
  const usable = new Set([...live].filter(([, m]) => m.status !== "FAILED").map(([id]) => id));
  const bySource = new Map();
  for (const l of doc.shopifyImages || []) {
    if (clean(l.sourceUrl) && l.mediaId && usable.has(l.mediaId)) bySource.set(clean(l.sourceUrl), l);
  }
  if (!bySource.size && usable.size && usable.size === wanted.length) {
    // Positional adoption: nothing is deleted or uploaded.
    return { upload: [], remove: [] };
  }
  const keep = new Set(wanted.map((s) => bySource.get(s)?.mediaId).filter(Boolean));
  return { upload: wanted.filter((s) => !bySource.has(s)), remove: [...live.keys()].filter((id) => !keep.has(id)) };
}

// ---------- the rewrite ----------

/** A new pair shaped like its siblings (same keys, same order). */
function newPair(template, url, mediaId, position) {
  const fields = { sourceUrl: url, shopifyUrl: url, mediaId, position: new Int32(position) };
  const keys = template ? Object.keys(template) : Object.keys(fields);
  const out = {};
  for (const k of keys) out[k] = k in fields ? fields[k] : template[k];
  return out;
}

/** Build the new images / shopifyImages / variants for one product. */
function buildUpdate(d, a, entry, files, loads) {
  const changes = [];
  const counts = { productSwapped: 0, productAdded: 0, variantImageUrl: 0, variantGallerySwapped: 0, variantGalleryRelinked: 0, variantGalleryAdded: 0, swatches: 0, keptSupplier: 0 };
  const fileFor = (u) => {
    const f = files[fileKey(u)];
    return f?.url && f.id && sameFile(u, f.url) && loads.get(f.url) === true ? f : null;
  };

  // Product-level sources: pairs, images[] and variant imageUrl move together.
  const pairs = "shopifyImages" in d ? d.shopifyImages.map((p) => ({ ...p })) : undefined;
  (pairs || []).forEach((p, i) => {
    const s = a.productSwap.get(clean(p.sourceUrl));
    if (!s) return;
    p.sourceUrl = s.to;
    changes.push(`shopifyImages.${i}.sourceUrl`);
    counts.productSwapped++;
  });
  // A pair whose media was deleted (the CDN URL may linger as an orphan) is
  // relinked to the File uploaded for the same picture, so the pair and every
  // variant imageUrl that names it keep matching.
  const relinked = new Map();
  (pairs || []).forEach((p, i) => {
    const src = clean(p.sourceUrl);
    if (!isSupplier(src) || !a.productBlocked.has(src)) return;
    // A hidden pair (no shopifyUrl) for a picture the gallery already shows
    // is a duplicate; linking it would add a repeated frame. Left as is.
    if (!clean(p.shopifyUrl) && pairs.some((q) => q !== p && clean(q.shopifyUrl) && hashOf(q.shopifyUrl) === hashOf(src))) return;
    const f = fileFor(src);
    if (!f) return;
    p.sourceUrl = f.url;
    p.shopifyUrl = f.url;
    p.mediaId = f.id;
    changes.push(`shopifyImages.${i}.sourceUrl`, `shopifyImages.${i}.shopifyUrl`, `shopifyImages.${i}.mediaId`);
    relinked.set(src, f.url);
    counts.productRelinked = (counts.productRelinked || 0) + 1;
  });
  // A pair already on Shopify whose copy no longer loads (404): point it at
  // the File uploaded for the same picture.
  (pairs || []).forEach((p, i) => {
    const src = clean(p.sourceUrl);
    const url = clean(p.shopifyUrl);
    if (isSupplier(src) || !isShopify(url) || loads.get(url) !== false) return;
    const f = fileFor(url);
    if (!f || f.url === url) return;
    p.sourceUrl = f.url;
    p.shopifyUrl = f.url;
    p.mediaId = f.id;
    changes.push(`shopifyImages.${i}.sourceUrl`, `shopifyImages.${i}.shopifyUrl`, `shopifyImages.${i}.mediaId`);
    if (src) relinked.set(src, f.url);
    counts.productRelinked = (counts.productRelinked || 0) + 1;
  });
  const images = "images" in d ? [...(d.images || [])] : undefined;
  const fresh = new Map((entry?.media || []).filter((m) => m.url && m.id).map((m) => [m.source, m]));
  (images || []).forEach((u, i) => {
    const src = clean(u);
    if (relinked.has(src)) {
      images[i] = relinked.get(src);
      changes.push(`images.${i}`);
      return;
    }
    if (!isSupplier(src)) return;
    const s = a.productSwap.get(src);
    if (s) {
      images[i] = s.to;
      changes.push(`images.${i}`);
      return;
    }
    const m = fresh.get(src);
    if (m && loads.get(m.url) === true && sameFile(src, m.url) && pairs && !pairs.some((p) => clean(p.sourceUrl) === src)) {
      images[i] = m.url;
      if (!pairs.some((p) => clean(p.sourceUrl) === m.url)) {
        pairs.push(newPair(pairs[0], m.url, m.id, i));
        changes.push(`shopifyImages.${pairs.length - 1}`);
        counts.productAdded++;
      }
      changes.push(`images.${i}`);
      return;
    }
    counts.keptSupplier++;
  });

  const variants = "variants" in d ? (d.variants || []).map((v) => ({ ...v })) : undefined;
  (variants || []).forEach((v, vi) => {
    const img = clean(v.imageUrl);
    if (!isSupplier(img) && relinked.has(img)) {
      v.imageUrl = relinked.get(img);
      changes.push(`variants.${vi}.imageUrl`);
      counts.variantImageUrl++;
    } else if (isSupplier(img)) {
      // Moves with its product pair when it has one; otherwise its own copy.
      const to =
        a.productSwap.get(img)?.to ||
        relinked.get(img) ||
        (a.productBlocked.has(img) ? "" : a.variantPairBySource.get(img) || fileFor(img)?.url || "");
      if (to) {
        v.imageUrl = to;
        changes.push(`variants.${vi}.imageUrl`);
        counts.variantImageUrl++;
      } else counts.keptSupplier++;
    }
    if (isSupplier(v.swatchUrl)) {
      const f = fileFor(v.swatchUrl);
      if (f) {
        v.swatchUrl = f.url;
        changes.push(`variants.${vi}.swatchUrl`);
        counts.swatches++;
      } else counts.keptSupplier++;
    }
    if (!Array.isArray(v.images)) return;
    const vPairs = Array.isArray(v.shopifyImages) ? v.shopifyImages.map((p) => ({ ...p })) : null;
    const vImages = [...v.images];
    let touched = false;
    (vPairs || []).forEach((p, k) => {
      const src = clean(p.sourceUrl);
      const url = clean(p.shopifyUrl);
      if (isSupplier(src) || !isShopify(url) || loads.get(url) !== false) return;
      const f = fileFor(url);
      if (!f || f.url === url) return;
      vImages.forEach((x, i) => {
        if (clean(x) === src) {
          vImages[i] = f.url;
          changes.push(`variants.${vi}.images.${i}`);
        }
      });
      p.sourceUrl = f.url;
      p.shopifyUrl = f.url;
      p.mediaId = f.id;
      changes.push(`variants.${vi}.shopifyImages.${k}.sourceUrl`, `variants.${vi}.shopifyImages.${k}.shopifyUrl`, `variants.${vi}.shopifyImages.${k}.mediaId`);
      counts.variantGalleryRelinked++;
      touched = true;
    });
    if (!vImages.some(isSupplier)) {
      if (touched) {
        v.images = vImages;
        v.shopifyImages = vPairs;
      }
      return;
    }
    const pairState = (src) =>
      (vPairs || [])
        .map((p, k) => ({ p, k }))
        .filter(({ p }) => clean(p.sourceUrl) === src);
    const done = new Set();
    vImages.forEach((u, i) => {
      const src = clean(u);
      if (!isSupplier(src)) return;
      const mine = pairState(src);
      const usable = mine.length && mine.every(({ p }) => a.pairOk(p, src));
      if (usable) {
        // Swap: the picture is already on Shopify.
        const to = clean(mine[0].p.shopifyUrl);
        if (mine.some(({ p }) => clean(p.shopifyUrl) !== to)) {
          counts.keptSupplier++;
          return;
        }
        vImages[i] = to;
        changes.push(`variants.${vi}.images.${i}`);
        if (!done.has(src)) {
          for (const { p, k } of mine) {
            p.sourceUrl = to;
            changes.push(`variants.${vi}.shopifyImages.${k}.sourceUrl`);
          }
          done.add(src);
          counts.variantGallerySwapped++;
        }
        return;
      }
      const f = fileFor(src);
      if (!f || !vPairs) {
        counts.keptSupplier++;
        return;
      }
      vImages[i] = f.url;
      changes.push(`variants.${vi}.images.${i}`);
      if (done.has(src)) return;
      done.add(src);
      if (mine.length) {
        // Relink: the recorded Shopify copy is gone or broken; point at the File.
        for (const { p, k } of mine) {
          p.sourceUrl = f.url;
          p.shopifyUrl = f.url;
          p.mediaId = f.id;
          changes.push(`variants.${vi}.shopifyImages.${k}.sourceUrl`, `variants.${vi}.shopifyImages.${k}.shopifyUrl`, `variants.${vi}.shopifyImages.${k}.mediaId`);
        }
        counts.variantGalleryRelinked++;
      } else {
        vPairs.push(newPair(vPairs[0], f.url, f.id, i));
        changes.push(`variants.${vi}.shopifyImages.${vPairs.length - 1}`);
        counts.variantGalleryAdded++;
      }
    });
    v.images = vImages;
    if (vPairs) v.shopifyImages = vPairs;
  });

  return { images, pairs, variants, changes, counts };
}

/** Flatten a document to path → canonical EJSON value, for exact comparison. */
function flat(doc) {
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
}

/** Every rendering check: main gallery, each variant gallery, each option image. */
function renderCheck(before, after, addedByVariant, dedupedVariants = []) {
  const problems = [];
  const gb = gallery(before.images, before.shopifyImages);
  const ga = gallery(after.images, after.shopifyImages);
  {
    let j = 0;
    let stray = 0;
    for (const u of ga) {
      if (j < gb.length && sameShown(gb[j], u)) j++;
      else if (!addedByVariant.newUrls?.has(u)) stray++;
    }
    if (j !== gb.length || stray) problems.push("main gallery changed");
  }
  // A repeat is allowed only where the gallery already showed that picture
  // (same hash) at least as often — two broken copies of one photo relinked to
  // its single File.
  {
    const count = (list) => list.reduce((m, u) => m.set(hashOf(u) || u, (m.get(hashOf(u) || u) || 0) + 1), new Map());
    const cb = count(gb);
    const ca = count(ga);
    const dupes = ga.filter((u, i) => ga.indexOf(u) !== i);
    if (dupes.some((u) => (ca.get(hashOf(u) || u) || 0) > (cb.get(hashOf(u) || u) || 0))) problems.push("main gallery has duplicates");
  }
  (before.variants || []).forEach((vb, vi) => {
    const va = after.variants[vi];
    const shownBefore = variantGallery(before, vb);
    const x = variantGallery(after, va);
    // Today a supplier URL in images[] does not match the variant's Shopify copy,
    // so the same photo shows twice; once swapped it matches and the repeat
    // drops out. That — and only that — is allowed: compare against the
    // before-gallery with repeated pictures removed (first occurrence kept).
    const seen = new Set();
    const b = shownBefore.filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });
    if (b.length !== shownBefore.length) dedupedVariants.push(vi);
    const added = addedByVariant.get(vi) || 0;
    // Earlier pictures stay, in order; only newly linked ones are added.
    // Pictures this run newly linked may appear; everything else must match
    // the old gallery picture for picture, in order.
    let j = 0;
    let stray = 0;
    let extra = 0;
    for (const u of x) {
      if (j < b.length && sameShown(b[j], u)) j++;
      else if (addedByVariant.newUrls?.has(u)) extra++;
      else stray++;
    }
    if (j !== b.length || stray || extra < added)
      problems.push(`variant ${vi} gallery changed (${b.length}→${x.length}, +${added} expected)`);
    if (new Set(x).size !== x.length) problems.push(`variant ${vi} gallery has duplicates`);
    {
      const ob = optionImage(before, vb);
      const oa = optionImage(after, va);
      // A blank thumbnail may gain a picture this run linked; nothing else.
      if (!sameShown(ob, oa) && !(ob === "" && addedByVariant.newUrls?.has(oa))) problems.push(`variant ${vi} option image changed`);
    }
  });
  return problems;
}

async function apply() {
  const state = loadState();
  const col = await openProducts();
  say(`${WRITE ? "WRITE" : "DRY RUN"}${ONLY.length ? ` only ${ONLY.length}` : ""}${LIMIT !== Infinity ? ` limit ${LIMIT}` : ""}`);
  fs.mkdirSync(DIR, { recursive: true });
  const backupFile = path.join(DIR, `backup-${STAMP}.ejson.jsonl`);
  const written = [];
  const leftFile = path.join(DIR, `left-on-supplier-${STAMP}.jsonl`);

  const totals = { products: 0, written: 0, counts: {}, skipped: {}, verify: { ok: 0, unexpected: 0, render: 0, syncWorse: 0, notLoading: 0, supplierLeft: 0, notWritten: 0 } };
  const skip = (why) => (totals.skipped[why] = (totals.skipped[why] || 0) + 1);
  const fileUrls = Object.values(state.files).map((f) => f.url).filter(Boolean);
  const loads = new Map();
  await checkLoads(fileUrls, loads);

  await eachBatch(col, 25, async (docs, n, total) => {
    const view = await liveView(docs);
    const urls = [];
    for (const d of docs) {
      for (const p of d.shopifyImages || []) if (clean(p.shopifyUrl)) urls.push(clean(p.shopifyUrl));
      for (const v of d.variants || []) for (const p of v.shopifyImages || []) if (clean(p.shopifyUrl)) urls.push(clean(p.shopifyUrl));
      for (const m of state.products[String(d._id)]?.media || []) if (m.url) urls.push(m.url);
    }
    await checkLoads(urls, loads);

    for (const d of docs) {
      totals.products++;
      const id = String(d._id);
      const entry = state.products[id];
      if (entry?.media?.some((m) => !m.url && !m.gaveUp)) {
        skip("uploads still processing — run collect");
        continue;
      }
      const a = analyse(d, view, loads);
      a.pairOk = (p, src) =>
        isShopify(p.shopifyUrl) &&
        statusOf(view, d, p.mediaId).status === "READY" &&
        sameFile(src, p.shopifyUrl) &&
        loads.get(clean(p.shopifyUrl)) === true;
      const u = buildUpdate(d, a, entry, state.files, loads);
      if (!u.changes.length) {
        skip("nothing to change");
        continue;
      }
      const next = { ...d };
      if (u.images) next.images = u.images;
      if (u.pairs) next.shopifyImages = u.pairs;
      if (u.variants) next.variants = u.variants;

      const addedByVariant = new Map();
      for (const c of u.changes) {
        const m = c.match(/^variants\.(\d+)\.shopifyImages\.(\d+)$/);
        if (m) addedByVariant.set(+m[1], (addedByVariant.get(+m[1]) || 0) + 1);
      }
      addedByVariant.newUrls = new Set();
      for (const c of u.changes) {
        let m = c.match(/^variants\.(\d+)\.shopifyImages\.(\d+)$/);
        if (m) addedByVariant.newUrls.add(clean(next.variants[+m[1]].shopifyImages[+m[2]].shopifyUrl));
        m = c.match(/^shopifyImages\.(\d+)(\.shopifyUrl)?$/);
        if (m) addedByVariant.newUrls.add(clean(next.shopifyImages[+m[1]].shopifyUrl));
        m = c.match(/^variants\.(\d+)\.shopifyImages\.(\d+)\.shopifyUrl$/);
        if (m) addedByVariant.newUrls.add(clean(next.variants[+m[1]].shopifyImages[+m[2]].shopifyUrl));
      }
      const deduped = [];
      const problems = renderCheck(d, next, addedByVariant, deduped);
      if (deduped.length && !problems.length) {
        totals.dedupedProducts = (totals.dedupedProducts || 0) + 1;
        fs.appendFileSync(path.join(DIR, `deduped-${STAMP}.jsonl`), `${JSON.stringify({ id, variants: deduped })}\n`);
      }
      if (problems.length) {
        fs.appendFileSync(path.join(DIR, `skipped-${STAMP}.jsonl`), `${JSON.stringify({ id, problems })}\n`);
        skip(`render would change: ${problems[0].replace(/\d+/g, "N")}`);
        continue;
      }
      const live = view.media.get(d.shopifyProductId) || new Map();
      const sb = simulateSync(d, live);
      const sa = simulateSync(next, live);
      const before = new Set(sb.remove);
      if (sa.remove.some((x) => !before.has(x)) || sa.upload.length > sb.upload.length) {
        skip("sync would delete or upload more after the swap");
        continue;
      }
      for (const [k, v] of Object.entries(u.counts)) totals.counts[k] = (totals.counts[k] || 0) + v;
      if (!WRITE) continue;

      fs.appendFileSync(backupFile, `${EJSON.stringify(d, { relaxed: false })}\n`);
      const filter = { _id: d._id };
      const set = {};
      for (const k of ["images", "shopifyImages", "variants"]) {
        if (!(k in d)) continue;
        filter[k] = d[k];
        set[k] = next[k];
      }
      const res = await col.updateOne(filter, { $set: set });
      if (res.modifiedCount !== 1) {
        totals.verify.notWritten++;
        continue;
      }
      totals.written++;
      written.push(id);

      // Verify against the backup.
      const after = await col.findOne({ _id: d._id }, RAW);
      const fb = flat(d);
      const fa = flat(after);
      const allowed = (p) =>
        u.changes.some((c) => p === c || p.startsWith(`${c}.`)) ||
        // A variant that gained pairs: its pair list's length.
        (/^variants\.(\d+)\.shopifyImages\.#len$/.test(p) && addedByVariant.has(+p.split(".")[1])) ||
        (p === "shopifyImages.#len" && u.changes.some((c) => /^shopifyImages\.\d+$/.test(c)));
      let bad = false;
      for (const k of new Set([...fb.keys(), ...fa.keys()])) {
        if (fb.get(k) === fa.get(k) || allowed(k)) continue;
        bad = true;
        say(`  UNEXPECTED ${id} ${k}`);
      }
      // No array may lose entries.
      for (const [k, v] of fb) if (k.endsWith(".#len") && Number(fa.get(k)) < Number(v)) bad = true;
      if (bad) totals.verify.unexpected++;
      const ap = renderCheck(d, after, addedByVariant);
      if (ap.length) {
        totals.verify.render++;
        say(`  RENDER ${id} ${ap.join("; ")}`);
      }
      const s2 = simulateSync(after, live);
      if (s2.remove.some((x) => !before.has(x)) || s2.upload.length > sb.upload.length) totals.verify.syncWorse++;
      const shown = [gallery(after.images, after.shopifyImages), ...(after.variants || []).map((v) => variantGallery(after, v))].flat();
      if (shown.some((x) => isShopify(x) && loads.get(x) === false)) totals.verify.notLoading++;
      // A source we swapped must not remain anywhere in the image fields.
      const swappedFrom = new Set([...a.productSwap.keys()]);
      const remaining = [
        ...(after.images || []),
        ...(after.shopifyImages || []).map((p) => clean(p.sourceUrl)),
        ...(after.variants || []).flatMap((v) => [v.imageUrl, v.swatchUrl, ...(v.images || []), ...(v.shopifyImages || []).map((p) => p.sourceUrl)]),
      ].map(clean);
      const left = remaining.filter(isSupplier);
      if (left.some((x) => swappedFrom.has(x))) totals.verify.supplierLeft++;
      if (left.length) fs.appendFileSync(leftFile, `${JSON.stringify({ id, left: [...new Set(left)] })}\n`);
      if (!bad && !ap.length) totals.verify.ok++;
    }
    say(`  ${n}/${total}  written ${totals.written}  skipped ${JSON.stringify(totals.skipped)}  verify ${JSON.stringify(totals.verify)}`);
  }, true);
  if (WRITE) {
    say(`backup: ${backupFile}`);
    fs.writeFileSync(path.join(DIR, `written-${STAMP}.json`), JSON.stringify(written));
  }
  say(JSON.stringify(totals, null, 1));
  await mongoose.disconnect();
}

/**
 * Re-check every product written by any apply run against its original backup:
 * only image paths changed, nothing got shorter, every changed value is the
 * same picture on Shopify, the page renders the same, the sync does no more
 * than before, and the URLs shown load.
 */
async function verifyAll() {
  const originals = new Map();
  for (const f of fs.readdirSync(DIR).filter((n) => /^backup-.*\.ejson\.jsonl$/.test(n)).sort()) {
    for (const line of fs.readFileSync(path.join(DIR, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let d;
      try {
        d = EJSON.parse(line, { relaxed: false });
      } catch {
        continue; // a line still being written by a running apply
      }
      if (!originals.has(String(d._id))) originals.set(String(d._id), d); // earliest = true original
    }
  }
  say(`products with a backup: ${originals.size}`);
  const col = await openProducts();
  const IMAGE_PATH = /^(images|shopifyImages)(\.|$)|^variants\.\d+\.(images|shopifyImages|imageUrl|swatchUrl)(\.|$)/;
  const t = { checked: 0, ok: 0, missing: 0, nonImagePath: 0, shrunk: 0, notSamePicture: 0, render: 0, syncWorse: 0, newlyBroken: 0, preBroken: 0 };
  const problems = [];
  const preBroken = [];
  const ids = [...originals.keys()].sort().filter((id, k) => (SHARD_N <= 1 || k % SHARD_N === SHARD_I) && (!ONLY.length || ONLY.includes(id)));
  const loads = new Map();
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const docs = await col.find({ _id: { $in: batch.map((x) => new mongoose.Types.ObjectId(x)) } }, RAW).toArray();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    const view = await liveView(docs);
    const urls = [];
    for (const id of batch) {
      for (const d of [originals.get(id), byId.get(id)].filter(Boolean)) {
        for (const p of d.shopifyImages || []) urls.push(clean(p.shopifyUrl));
        for (const v of d.variants || []) for (const p of v.shopifyImages || []) urls.push(clean(p.shopifyUrl));
      }
    }
    await checkLoads(urls.filter(isShopify), loads);
    for (const id of batch) {
      t.checked++;
      const b = originals.get(id);
      const a = byId.get(id);
      const bad = [];
      if (!a) {
        t.missing++;
        problems.push({ id, bad: ["document missing"] });
        continue;
      }
      const fb = flat(b);
      const fa = flat(a);
      for (const k of new Set([...fb.keys(), ...fa.keys()])) {
        if (fb.get(k) === fa.get(k)) continue;
        if (!IMAGE_PATH.test(k)) { t.nonImagePath++; bad.push(`non-image path ${k}`); continue; }
        if (k.endsWith(".#len")) { if (Number(fa.get(k)) < Number(fb.get(k) || 0)) { t.shrunk++; bad.push(`shrunk ${k}`); } continue; }
        if (k.endsWith(".#keys") || !fb.has(k)) continue; // a newly added pair
        if (/\.mediaId$/.test(k) || /\.position$/.test(k)) continue; // relink; checked through its URLs
        const was = JSON.parse(fb.get(k));
        const now = JSON.parse(fa.get(k));
        if (!(isShopify(now) && (isSupplier(was) || isShopify(was)) && hashOf(was) && hashOf(was) === hashOf(now))) {
          t.notSamePicture++;
          bad.push(`not the same picture ${k}`);
        }
      }
      // Render: pictures newly linked may appear; nothing else may change.
      const beforeUrls = new Set([...(b.shopifyImages || []), ...(b.variants || []).flatMap((v) => v.shopifyImages || [])].map((p) => clean(p.shopifyUrl)));
      const added = new Map();
      added.newUrls = new Set();
      for (const p of a.shopifyImages || []) if (!beforeUrls.has(clean(p.shopifyUrl))) added.newUrls.add(clean(p.shopifyUrl));
      (a.variants || []).forEach((v, vi) => {
        const n = (v.shopifyImages || []).length - ((b.variants || [])[vi]?.shopifyImages || []).length;
        if (n > 0) added.set(vi, n);
        for (const p of v.shopifyImages || []) if (!beforeUrls.has(clean(p.shopifyUrl))) added.newUrls.add(clean(p.shopifyUrl));
      });
      const rp = renderCheck(b, a, added);
      if (rp.length) { t.render++; bad.push(...rp.slice(0, 3)); }
      const live = view.media.get(a.shopifyProductId) || new Map();
      const sb = simulateSync(b, live);
      const sa = simulateSync(a, live);
      const rb = new Set(sb.remove);
      if (sa.remove.some((x) => !rb.has(x)) || sa.upload.length > sb.upload.length) { t.syncWorse++; bad.push("sync would do more"); }
      const shown = [gallery(a.images, a.shopifyImages), ...(a.variants || []).map((v) => variantGallery(a, v))].flat().filter(isShopify);
      const shownBefore = new Set([gallery(b.images, b.shopifyImages), ...(b.variants || []).map((v) => variantGallery(b, v))].flat());
      const broken = [...new Set(shown.filter((u) => loads.get(u) === false))];
      const newly = broken.filter((u) => !shownBefore.has(u));
      if (newly.length) { t.newlyBroken++; bad.push(`newly broken ${newly[0]}`); }
      if (broken.length - newly.length) { t.preBroken++; preBroken.push({ id, urls: broken.filter((u) => shownBefore.has(u)) }); }
      if (bad.length) problems.push({ id, bad });
      else t.ok++;
    }
    if ((i / 25) % 20 === 0) say(`  ${Math.min(i + 25, ids.length)}/${ids.length} ${JSON.stringify(t)}`);
  }
  fs.writeFileSync(path.join(DIR, `verify-${STAMP}.json`), JSON.stringify({ totals: t, problems, preBroken }, null, 1));
  say(JSON.stringify(t, null, 1));
  say(`report: ${path.join(DIR, `verify-${STAMP}.json`)}`);
  await mongoose.disconnect();
}

/**
 * Upload a File for every picture still not durably on Shopify: supplier URLs
 * left in image fields (pending products), and Shopify copies that 404 (from
 * the verify reports). Sent by bytes straight away — Drench refuses Shopify's
 * fetcher. Then waits for READY via collect().
 */
async function fixup() {
  const state = loadState();
  const col = await openProducts();
  const need = new Map(); // fileKey -> candidate source URLs
  const add = (key, url) => {
    if (!key) return;
    const f = state.files[key];
    if (f?.url && !f.broken) return;
    if (!need.has(key)) need.set(key, new Set());
    if (url) need.get(key).add(url);
  };
  for await (const d of col.find(pendingFilter()).project(PROJECT)) {
    const urls = [
      ...(d.images || []),
      ...(d.shopifyImages || []).map((p) => p.sourceUrl),
      ...(d.variants || []).flatMap((v) => [v.imageUrl, v.swatchUrl, ...(v.images || []), ...(v.shopifyImages || []).map((p) => p.sourceUrl)]),
    ].map(clean).filter(isSupplier);
    for (const u of urls) if (!state.dead[u] || state.dead[u].alt) add(fileKey(u), u);
  }
  // Shopify copies that 404, from every verify report.
  const brokenHashes = new Set();
  for (const f of fs.readdirSync(DIR).filter((n) => /^verify-.*\.json$/.test(n))) {
    for (const p of JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")).preBroken || []) for (const u of p.urls) brokenHashes.add(hashOf(u));
  }
  // Supplier URLs for those hashes: from the backups, else rebuilt from the Shopify filename.
  if (brokenHashes.size) {
    const found = new Map();
    for (const f of fs.readdirSync(DIR).filter((n) => /^backup-.*\.jsonl$/.test(n))) {
      const txt = fs.readFileSync(path.join(DIR, f), "utf8");
      for (const m of txt.matchAll(/https?:\/\/img\.drench\.co\.uk\/[^"\s]*?([0-9a-f]{40})[^"\s]*/gi)) {
        const h = m[1].toLowerCase();
        if (brokenHashes.has(h) && !found.has(h)) found.set(h, m[0]);
      }
    }
    for (const h of brokenHashes) {
      if (state.files[h]?.url && !state.files[h].broken) {
        const ok = await headImage(state.files[h].url);
        if (ok.ok) continue;
        state.files[h].broken = true;
      }
      add(h, found.get(h) || "");
    }
  }
  await mongoose.disconnect();
  say(`pictures needing a File: ${need.size}`);

  // Resolve a serving supplier URL for each.
  const jobs = [];
  for (const [key, cands] of need) {
    let src = "";
    for (const c of cands) {
      src = await liveSourceFor(c, state);
      if (src) break;
    }
    if (!src && /^[0-9a-f]{40}$/.test(key)) {
      // Rebuild from the hash: Drench serves /products/a/b/c/d/<hash>_<name>.
      for (const c of cands) {
        const name = c.split("/").pop();
        const guess = `https://img.drench.co.uk/products/${key[0]}/${key[1]}/${key[2]}/${key[3]}/${name}`;
        if ((await headImage(guess)).ok) { src = guess; break; }
      }
    }
    if (src) jobs.push([key, [...cands][0] || src, src]);
    else say(`  no serving source for ${key}`);
  }
  saveState(state);
  say(`  sources serving: ${jobs.length}/${need.size}`);

  let sent = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (jobs.length) {
        const [key, source, from] = jobs.shift();
        try {
          const resourceUrl = await stageFromSource(from);
          const [id] = await createFiles([resourceUrl]);
          state.files[key] = { source, from, id, attempts: 1, staged: 1 };
          sent++;
        } catch (e) {
          say(`  upload failed ${key}: ${String(e.message).slice(0, 120)}`);
        }
        saveState(state);
      }
    }),
  );
  say(`  files sent by bytes: ${sent}`);
  await sleep(15_000);
  await collect();
}

(async () => {
  token = await shopifyToken();
  if (PHASE === "plan") await plan();
  else if (PHASE === "upload") await upload();
  else if (PHASE === "collect") await collect();
  else if (PHASE === "apply") await apply();
  else if (PHASE === "verify") await verifyAll();
  else if (PHASE === "fixup") await fixup();
  else throw new Error(`unknown phase ${PHASE}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
