/**
 * Move every Tap Warehouse image onto Shopify and drop the supplier URLs.
 *
 * Tap Warehouse (secondary cluster) stores img.tapwarehouse.com URLs in
 * `images`, `variants[].imageUrl` and `variants[].swatchUrl`. Most gallery
 * images were mirrored and paired in `shopifyImages`; the rest never reached
 * Shopify (a 12-image cap, and 502s from the supplier's CDN under load).
 *
 * Phases, each resumable from image-audit/tapwarehouse/state.json:
 *
 *   plan     report the work; touches nothing
 *   upload   send unmirrored gallery images to the product's media, and
 *            variant images / swatches to Shopify Files. Writes nothing to Mongo.
 *   collect  read back URLs; FAILED uploads are deleted and re-sent (3 tries)
 *   apply    per product: back up, then swap each source URL for its Shopify
 *            copy (images[], shopifyImages, variant imageUrl / swatchUrl),
 *            then verify against the backup. Dry run unless --write.
 *
 * Why Files for variant images and swatches: the product sync
 * (reconcileProductMedia) keeps only media named by images[] + variant
 * imageUrl, so anything else attached to the product is deleted on the next
 * sync. Files are not product media and the sync never touches them.
 *
 * Why swap rather than delete: that same sync matches media by sourceUrl, so
 * a source URL removed from images[] would make it delete the Shopify copy.
 * With the Shopify URL in both images[] and the pair's sourceUrl, it keeps
 * every file and uploads nothing.
 *
 * An image that does not reach Shopify keeps its supplier URL; nothing is
 * dropped. Broken entries such as "https://img.tapwarehouse.com/products?w=…"
 * (no file in the path) are left exactly as they are.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/tapwarehouse-move-images-to-shopify.cjs plan
 *   … upload   [--limit=5] [--only=<id>]
 *   … collect
 *   … apply    [--write] [--limit=5] [--only=<id>]
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

/**
 * The local router's DNS started answering SERVFAIL for img.tapwarehouse.com
 * mid-run while public resolvers still answered. fetch() uses the system
 * resolver, so fall back to public DNS when it fails.
 */
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
const PHASE = process.argv[2] || "plan";
const arg = (n, d = "") =>
  (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=") || d;
const WRITE = process.argv.includes("--write");
const LIMIT = Number(arg("limit", 0)) || Infinity;
const ONLY = arg("only");
const CONCURRENCY = Number(arg("concurrency", 3));
/** --shard=i/n: this process handles every n-th product, starting at i. */
const [SHARD, SHARDS] = arg("shard", "0/1").split("/").map(Number);
const CHUNK = 10;
const MAX_ATTEMPTS = 3;

const BRAND_ID = "6aad6ac07120f8ddd7388bef";
const DOMAIN = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const API = `https://${DOMAIN}/admin/api/2025-07/graphql.json`;
const DIR = path.join(__dirname, "..", "image-audit", "tapwarehouse");
const STATE_FILE = path.join(DIR, "state.json");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const say = (s = "") => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const isShopify = (u) => /^https:\/\/cdn\.shopify\.com\//i.test(clean(u));
/** A supplier URL that names an actual file (not ".../products?w=1600…"). */
const isUploadable = (u) => /^https:\/\/img\.tapwarehouse\.com\/.+\/[^/?]+\.[a-z0-9]{3,4}(\?|$)/i.test(clean(u));
/**
 * Tap Warehouse no longer serves /images/VariantPreviewImage/… (every one is a
 * 500), but the same file is still at /products/… under the same hash path.
 */
const uploadSourceFor = (u) => clean(u).replace("/images/VariantPreviewImage/", "/products/");
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
    if (attempt >= 5 || (isMutation && !answered)) throw e;
    await sleep(2000 * 2 ** attempt);
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

/** Every media node on each Shopify product: id → { status, url }. */
async function productMedia(productIds) {
  const out = new Map();
  for (let i = 0; i < productIds.length; i += 10) {
    const ids = productIds.slice(i, i + 10);
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
  const conn = await connectMongo(process.env.MONGODB_URL2);
  return conn.db.collection("products");
}

function brandFilter() {
  const id = new mongoose.Types.ObjectId(BRAND_ID);
  const f = { brand: { $in: [id, BRAND_ID] }, shopifyProductId: { $nin: [null, ""] } };
  if (ONLY) f._id = new mongoose.Types.ObjectId(ONLY);
  return f;
}

/** The work one product needs, from its current document. */
function workFor(doc) {
  const linked = new Set((doc.shopifyImages || []).filter((p) => clean(p.shopifyUrl)).map((p) => clean(p.sourceUrl)));
  const gallery = [...new Set((doc.images || []).map(clean))];
  const toUpload = gallery.filter((u) => !isShopify(u) && !linked.has(u) && isUploadable(u));
  const broken = gallery.filter((u) => !isShopify(u) && !linked.has(u) && !isUploadable(u));
  const galleryHashes = new Set(gallery.filter((u) => isUploadable(u) || isShopify(u)).map(hashOf).filter(Boolean));
  const files = [];
  for (const v of doc.variants || []) {
    const img = clean(v.imageUrl);
    if (img && !isShopify(img) && isUploadable(img) && !(hashOf(img) && galleryHashes.has(hashOf(img)))) files.push(img);
    // Swatches are not collected: every swatch URL is a 500 on both of Tap
    // Warehouse's paths, so there is nothing to copy and they are left as is.
  }
  return { toUpload, broken, files: [...new Set(files)] };
}

// ---------- phases ----------

async function plan() {
  const col = await openProducts();
  let products = 0, needUpload = 0, gallery = 0, broken = 0, swapOnly = 0;
  const files = new Set();
  for await (const d of col.find(brandFilter()).project({ images: 1, shopifyImages: 1, variants: 1 })) {
    products++;
    const w = workFor(d);
    gallery += w.toUpload.length;
    broken += w.broken.length;
    if (w.toUpload.length) needUpload++;
    else swapOnly++;
    w.files.forEach((u) => files.add(u));
  }
  const swatches = 0;
  say(`products: ${products}`);
  say(`  gallery images to upload as product media: ${gallery} (on ${needUpload} products)`);
  say(`  products already fully mirrored (swap only): ${swapOnly}`);
  say(`  broken gallery entries left as they are: ${broken}`);
  say(`  files to upload to Shopify Files: ${files.size} (${swatches} swatches, ${files.size - swatches} variant images)`);
  await mongoose.disconnect();
}

async function upload() {
  const state = loadState();
  const col = await openProducts();
  const docs = await col
    .find(brandFilter())
    .project({ name: 1, images: 1, shopifyImages: 1, variants: 1, shopifyProductId: 1 })
    .toArray();
  await mongoose.disconnect();

  // A pilot (--limit / --only) sends only its own products' files.
  const pilot = LIMIT !== Infinity || ONLY;
  const pilotDocs = docs
    .filter((d) => workFor(d).toUpload.length || workFor(d).files.length)
    .slice(0, LIMIT === Infinity ? undefined : LIMIT);

  // Files first: few, and shared across products.
  const fileUrls = new Set();
  for (const d of pilot ? pilotDocs : docs) workFor(d).files.forEach((u) => fileUrls.add(u));
  const pendingFiles = [...fileUrls].filter((u) => !state.files[u]);
  say(`files to send: ${pendingFiles.length} (${fileUrls.size - pendingFiles.length} already sent)`);
  for (let i = 0; i < pendingFiles.length; i += CHUNK) {
    const chunk = pendingFiles.slice(i, i + CHUNK);
    try {
      const ids = await createFiles(chunk.map(uploadSourceFor));
      chunk.forEach((u, k) => (state.files[u] = { id: ids[k], attempts: 1 }));
    } catch (e) {
      say(`  file chunk failed: ${e.message.slice(0, 160)}`);
    }
    saveState(state);
    await sleep(600);
  }

  const queue = (pilot ? pilotDocs : docs)
    .map((d) => ({ d, w: workFor(d) }))
    .filter(({ d, w }) => w.toUpload.length && !state.products[String(d._id)]?.sent);
  const totalImages = queue.reduce((n, q) => n + q.w.toUpload.length, 0);
  say(`products to send: ${queue.length}, gallery images: ${totalImages}`);

  let done = 0, sent = 0, failed = 0;
  const started = Date.now();
  const worker = async () => {
    while (queue.length) {
      const { d, w } = queue.shift();
      const id = String(d._id);
      const entry = state.products[id] || { productId: d.shopifyProductId, media: [] };
      const already = new Set(entry.media.map((m) => m.source));
      const todo = w.toUpload.filter((u) => !already.has(u));
      try {
        for (let i = 0; i < todo.length; i += CHUNK) {
          const chunk = todo.slice(i, i + CHUNK);
          const ids = await createProductMedia(d.shopifyProductId, chunk, String(d.name || "").slice(0, 120));
          chunk.forEach((u, k) => entry.media.push({ source: u, id: ids[k], attempts: 1 }));
          sent += chunk.length;
          state.products[id] = entry;
          saveState(state);
        }
        entry.sent = true;
      } catch (e) {
        failed++;
        entry.error = String(e.message).slice(0, 200);
        say(`  FAIL ${d.name?.slice(0, 40)}: ${entry.error}`);
      }
      state.products[id] = entry;
      saveState(state);
      if (++done % 25 === 0) {
        const rate = sent / ((Date.now() - started) / 1000);
        say(`  ${done}/${done + queue.length} products, ${sent}/${totalImages} images sent, ${failed} failed, ~${Math.round((totalImages - sent) / Math.max(rate, 0.01) / 60)}m left`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  say(`upload done: ${sent} images sent on ${done} products, ${failed} products with an error`);
}

/**
 * Upload a supplier image by its bytes rather than its URL.
 *
 * Tap Warehouse started answering Shopify's fetcher with 403 Forbidden partway
 * through the run, while still serving the same files to us. So a failed image
 * is downloaded here and pushed through a staged upload; Shopify then reads it
 * from its own storage and never contacts the supplier.
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
  token = token || (await shopifyToken());
  const state = loadState();
  const media = () => Object.entries(state.products).flatMap(([pid, p]) => p.media.map((m) => ({ pid, p, m })));
  const report = () => {
    const all = media().map((x) => x.m);
    const files = Object.values(state.files);
    say(`  media: ${all.filter((m) => m.url).length}/${all.length} ready, ${all.filter((m) => m.gaveUp).length} gave up | files: ${files.filter((f) => f.url).length}/${files.length} ready, ${files.filter((f) => f.gaveUp).length} gave up`);
  };

  for (let round = 1; round <= 8; round++) {
    const open = media().filter(({ m }) => !m.url && !m.gaveUp);
    const openFiles = Object.entries(state.files).filter(([, f]) => !f.url && !f.gaveUp);
    if (!open.length && !openFiles.length) break;
    say(`round ${round}: ${open.length} media and ${openFiles.length} files not ready yet`);

    const status = await mediaStatus([...open.map(({ m }) => m.id), ...openFiles.map(([, f]) => f.id)].filter(Boolean));
    const failed = [];
    let processing = 0;
    for (const x of open) {
      const s = x.m.id ? status.get(x.m.id) : { status: "MISSING" };
      if (s?.status === "READY" && s.url) x.m.url = s.url;
      else if (s?.status === "FAILED" || s?.status === "MISSING") failed.push(x);
      else processing++;
    }
    const failedFiles = [];
    for (const [u, f] of openFiles) {
      const s = f.id ? status.get(f.id) : { status: "MISSING" };
      if (s?.status === "READY" && s.url) f.url = s.url;
      else if (s?.status === "FAILED" || s?.status === "MISSING") failedFiles.push([u, f, s?.status]);
      else processing++;
    }
    saveState(state);
    report();
    say(`  ${failed.length + failedFiles.length} failed → re-uploading by bytes, ${processing} still processing`);

    // Re-upload failed images from their bytes, a few products at a time.
    const byProduct = new Map();
    for (const x of failed) {
      if (!byProduct.has(x.pid)) byProduct.set(x.pid, []);
      byProduct.get(x.pid).push(x);
    }
    const queue = [...byProduct.entries()];
    let done = 0, resent = 0, gaveUp = 0;
    const worker = async () => {
      while (queue.length) {
        const [pid, items] = queue.shift();
        const p = items[0].p;
        // Remove only media this script created and Shopify marked FAILED.
        const dead = items.filter(({ m }) => m.id && status.get(m.id)?.status === "FAILED").map(({ m }) => m.id);
        try {
          if (dead.length) await deleteProductMedia(p.productId, dead);
          items.forEach(({ m }) => (m.id = ""));
        } catch (e) {
          say(`  could not delete failed media on ${pid}: ${String(e.message).slice(0, 120)}`);
          continue;
        }
        for (const { m } of items) {
          m.staged = (m.staged || 0) + 1;
          if (m.staged > MAX_ATTEMPTS) {
            m.gaveUp = true;
            gaveUp++;
            continue;
          }
          try {
            const resourceUrl = await stageFromSource(m.source);
            const [id] = await createProductMedia(p.productId, [resourceUrl], "");
            m.id = id;
            resent++;
          } catch (e) {
            m.lastError = String(e.message).slice(0, 160);
          }
        }
        saveState(state);
        if (++done % 25 === 0) say(`  re-uploaded on ${done}/${byProduct.size} products (${resent} images, ${gaveUp} gave up)`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    for (const [u, f, st] of failedFiles) {
      try {
        if (f.id && st === "FAILED") await deleteFiles([f.id]);
        f.id = "";
        f.staged = (f.staged || 0) + 1;
        if (f.staged > MAX_ATTEMPTS) {
          f.gaveUp = true;
          gaveUp++;
          continue;
        }
        const resourceUrl = await stageFromSource(uploadSourceFor(u));
        [f.id] = await createFiles([resourceUrl]);
        resent++;
      } catch (e) {
        f.lastError = String(e.message).slice(0, 160);
      }
      saveState(state);
    }
    say(`  round ${round} done: re-uploaded ${resent}, gave up ${gaveUp}`);
    if (!processing && !resent && !failed.length && !failedFiles.length) break;
    await sleep(30_000);
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

/** reconcileProductMedia's decision for this document against live media. */
function simulateSync(doc, live) {
  const wanted = [
    ...new Set(
      [...(doc.images || []), ...(doc.variants || []).map((v) => v.imageUrl || "")]
        .map(clean)
        .filter((u) => /^https?:\/\//i.test(u)),
    ),
  ];
  const usable = new Set([...live].filter(([, m]) => m.status !== "FAILED").map(([id]) => id));
  const bySource = new Map();
  for (const l of doc.shopifyImages || []) {
    if (clean(l.sourceUrl) && l.mediaId && usable.has(l.mediaId)) bySource.set(clean(l.sourceUrl), l);
  }
  const keep = new Set(wanted.map((s) => bySource.get(s)?.mediaId).filter(Boolean));
  return { upload: wanted.filter((s) => !bySource.has(s)), remove: [...live.keys()].filter((id) => !keep.has(id)) };
}

/** Build the new images / shopifyImages / variants for one product. */
function buildUpdate(doc, entry, files, live, loads) {
  const fromState = new Map((entry?.media || []).filter((m) => m.url).map((m) => [m.source, m]));
  const images = [...(doc.images || [])];
  const pairs = (doc.shopifyImages || []).map((p) => ({ ...p }));
  const pairBySource = new Map(pairs.map((p) => [clean(p.sourceUrl), p]));
  const changes = [];
  let swapped = 0, added = 0, kept = 0;

  images.forEach((u, i) => {
    const src = clean(u);
    if (isShopify(src)) return;
    const existing = pairBySource.get(src);
    if (existing && clean(existing.shopifyUrl)) {
      const m = live.get(existing.mediaId);
      if (!m || m.status !== "READY" || !loads.get(clean(existing.shopifyUrl))) {
        kept++;
        return;
      }
      const to = clean(existing.shopifyUrl);
      images[i] = to;
      existing.sourceUrl = to;
      changes.push(`images.${i}`, `shopifyImages.${pairs.indexOf(existing)}.sourceUrl`);
      swapped++;
      return;
    }
    const fresh = fromState.get(src);
    if (fresh && live.get(fresh.id)?.status === "READY" && loads.get(fresh.url) && !existing) {
      images[i] = fresh.url;
      pairs.push({ sourceUrl: fresh.url, shopifyUrl: fresh.url, mediaId: fresh.id, position: i });
      changes.push(`images.${i}`, `shopifyImages.${pairs.length - 1}`);
      added++;
      return;
    }
    kept++;
  });

  // Variant images: the gallery's Shopify copy of the same picture, else the
  // file uploaded for it. Swatches: their uploaded file.
  const byHash = new Map();
  images.forEach((u) => {
    if (isShopify(u)) {
      const p = pairs.find((x) => clean(x.shopifyUrl) === clean(u));
      const original = (doc.images || [])[images.indexOf(u)];
      const h = hashOf(original);
      if (p && h && !byHash.has(h)) byHash.set(h, clean(u));
    }
  });
  const variants = (doc.variants || []).map((v) => ({ ...v }));
  let variantImages = 0, swatches = 0;
  variants.forEach((v, vi) => {
    const img = clean(v.imageUrl);
    if (img && !isShopify(img)) {
      const to = byHash.get(hashOf(img)) || (files[img]?.url && loads.get(files[img].url) ? files[img].url : "");
      if (to) {
        v.imageUrl = to;
        changes.push(`variants.${vi}.imageUrl`);
        variantImages++;
      }
    }
  });

  return { images, pairs, variants, changes, counts: { swapped, added, kept, variantImages, swatches } };
}

/** Flatten a document to path → canonical EJSON value, for exact comparison. */
function flat(doc) {
  const out = new Map();
  const walk = (n, p) => {
    if (Array.isArray(n)) return n.forEach((v, i) => walk(v, `${p}.${i}`));
    if (n && typeof n === "object" && !(n._bsontype) && !(n instanceof Date)) {
      return Object.keys(n).forEach((k) => walk(n[k], p ? `${p}.${k}` : k));
    }
    out.set(p, EJSON.stringify(n === undefined ? null : n, { relaxed: false }));
  };
  walk(doc, "");
  return out;
}

async function apply() {
  token = token || (await shopifyToken());
  const state = loadState();
  const col = await openProducts();
  // Only products that still hold a supplier URL somewhere they could lose it.
  const pending = {
    ...brandFilter(),
    $or: [{ images: /^https:\/\/img\.tapwarehouse\.com\// }, { "variants.imageUrl": /^https:\/\/img\.tapwarehouse\.com\// }],
  };
  let ids = (await col.find(pending).project({ _id: 1 }).sort({ _id: 1 }).toArray())
    .map((d) => d._id)
    .filter((_, k) => k % SHARDS === SHARD);
  if (LIMIT !== Infinity) {
    // A pilot takes products that exercise every path: fresh uploads first.
    const fresh = ids.filter((id) => state.products[String(id)]?.media?.length);
    ids = [...new Set([...fresh, ...ids])].slice(0, LIMIT);
  }
  say(`${WRITE ? "WRITE" : "DRY RUN"}: ${ids.length} products`);
  fs.mkdirSync(DIR, { recursive: true });
  const backupFile = path.join(DIR, `backup-${STAMP}-shard${SHARD}of${SHARDS}.ejson.jsonl`);

  const totals = { products: 0, written: 0, swapped: 0, added: 0, kept: 0, variantImages: 0, swatches: 0, skipped: {}, verify: { ok: 0, unexpected: 0, galleryChanged: 0, syncWorse: 0, notLoading: 0, notWritten: 0 } };
  const skip = (why) => (totals.skipped[why] = (totals.skipped[why] || 0) + 1);

  // URL checks are cached for the whole run; re-checking the same files for
  // every batch was most of the time spent.
  const loads = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const docs = await col.find({ _id: { $in: ids.slice(i, i + 40) } }).toArray();
    const media = await productMedia([...new Set(docs.map((d) => d.shopifyProductId))]);
    const urls = new Set();
    for (const d of docs) {
      for (const p of d.shopifyImages || []) if (clean(p.shopifyUrl)) urls.add(clean(p.shopifyUrl));
      for (const m of state.products[String(d._id)]?.media || []) if (m.url) urls.add(m.url);
    }
    for (const f of Object.values(state.files)) if (f.url) urls.add(f.url);
    const list = [...urls].filter((u) => !loads.has(u));
    for (let k = 0; k < list.length; k += 64) {
      await Promise.all(list.slice(k, k + 64).map(async (u) => loads.set(u, await loadsAsImage(u))));
    }

    // Products in a batch are independent; eight at a time.
    const queue = [...docs];
    await Promise.all(Array.from({ length: 8 }, async () => { while (queue.length) await (async (d) => {
      totals.products++;
      const entry = state.products[String(d._id)];
      if (entry?.media?.some((m) => !m.url && !m.gaveUp)) {
        skip("uploads still processing — run collect");
        return;
      }
      const live = media.get(d.shopifyProductId) || new Map();
      const u = buildUpdate(d, entry, state.files, live, loads);
      if (!u.changes.length) {
        skip("nothing to change");
        return;
      }
      // The page must show the same pictures, in the same order.
      const before = gallery(d.images, d.shopifyImages);
      const after = gallery(u.images, u.pairs);
      if (after.length !== before.length) {
        skip("gallery size would change");
        return;
      }
      const sb = simulateSync(d, live);
      const sa = simulateSync({ ...d, images: u.images, shopifyImages: u.pairs, variants: u.variants }, live);
      const linkedIds = new Set(u.pairs.map((p) => p.mediaId).filter(Boolean));
      if (sa.remove.some((id) => linkedIds.has(id)) || sa.remove.some((id) => !sb.remove.includes(id))) {
        skip("sync would delete linked media after the swap");
        return;
      }
      if (sa.upload.length > sb.upload.length) {
        skip("sync would upload more after the swap");
        return;
      }
      for (const k of Object.keys(u.counts)) totals[k] += u.counts[k];
      if (!WRITE) return;

      fs.appendFileSync(backupFile, `${EJSON.stringify(d, { relaxed: false })}\n`);
      const res = await col.updateOne(
        { _id: d._id, images: d.images, shopifyImages: d.shopifyImages, ...("variants" in d ? { variants: d.variants } : {}) },
        { $set: { images: u.images, shopifyImages: u.pairs, ...("variants" in d ? { variants: u.variants } : {}) } },
      );
      if (res.modifiedCount !== 1) {
        totals.verify.notWritten++;
        return;
      }
      totals.written++;

      // Verify: only the planned paths differ; everything else is identical.
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
      const ga = gallery(a.images, a.shopifyImages);
      if (ga.length !== before.length || new Set(ga).size !== ga.length) totals.verify.galleryChanged++;
      const s2 = simulateSync(a, live);
      const kept = new Set((a.shopifyImages || []).map((p) => p.mediaId).filter(Boolean));
      if (s2.remove.some((id) => kept.has(id)) || s2.upload.length > sb.upload.length) totals.verify.syncWorse++;
      if (ga.some((x) => isShopify(x) && loads.get(x) !== true)) totals.verify.notLoading++;
      if (!bad) totals.verify.ok++;
    })(queue.shift()); }));
    say(`  ${Math.min(i + 40, ids.length)}/${ids.length}  written ${totals.written}  skipped ${JSON.stringify(totals.skipped)}  verify ${JSON.stringify(totals.verify)}`);
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
