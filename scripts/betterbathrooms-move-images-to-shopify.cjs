/**
 * Serve every Better Bathrooms image from Shopify and drop the supplier URLs.
 *
 * Better Bathrooms (secondary cluster) stores www.betterbathrooms.com URLs in
 * images[], shopifyImages[].sourceUrl, variants[].imageUrl, variants[].images[]
 * and variants[].shopifyImages[].sourceUrl. Nearly all of them already have a
 * Shopify copy recorded in a pairing; ~4,000 variant-gallery images were never
 * mirrored and are not shown on the site (variant galleries render Shopify only).
 *
 * Phases, resumable from image-audit/betterbathrooms/state.json:
 *
 *   plan     report the work; touches nothing
 *   upload   send unmirrored variant-gallery images to Shopify Files. No Mongo writes.
 *   collect  read back URLs; FAILED uploads are re-sent from their bytes
 *   apply    per product: back up, swap every supplier URL for its verified
 *            Shopify copy, verify against the backup. Dry run unless --write.
 *            --shard=i/n splits the products across parallel processes.
 *
 * Files, not product media, for the new variant images: the product sync
 * (reconcileProductMedia) keeps only media named by images[] + variant
 * imageUrl and deletes the rest on the next sync. Files are never touched.
 *
 * Swap rather than delete: the sync matches media by sourceUrl, so with the
 * Shopify URL in both images[] and the pair's sourceUrl it keeps every file.
 * Variant imageUrl takes the product pair's URL for the same file, which is
 * what the sync matches it against.
 *
 * An image without a verified Shopify copy keeps its supplier URL.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/betterbathrooms-move-images-to-shopify.cjs plan
 *   … upload | collect | apply [--write] [--limit=5] [--only=<id>] [--shard=0/4]
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

// The local resolver intermittently fails (ENOTFOUND) while public DNS
// answers; fall back to it so a lookup blip does not fail an upload.
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
const CONCURRENCY = Number(arg("concurrency", 6));
const MAX_ATTEMPTS = 3;

const BRAND_ID = "6ab7b2c25a35f689d8457179";
const DOMAIN = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const API = `https://${DOMAIN}/admin/api/2025-07/graphql.json`;
const DIR = path.join(__dirname, "..", "image-audit", "betterbathrooms");
const STATE_FILE = path.join(DIR, "state.json");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const say = (s = "") => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const isShopify = (u) => /^https:\/\/cdn\.shopify\.com\//i.test(clean(u));
const isSupplier = (u) => /^https:\/\/www\.betterbathrooms\.com\//i.test(clean(u));
const bare = (u) => clean(u).split("?")[0];

// ---------- state ----------

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { files: {} };
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
  const conn = await connectMongo(process.env.MONGODB_URL2);
  return conn.db.collection("products");
}

function brandFilter() {
  const id = new mongoose.Types.ObjectId(BRAND_ID);
  const f = { brand: { $in: [id, BRAND_ID] }, shopifyProductId: { $nin: [null, ""] } };
  if (ONLY) f._id = new mongoose.Types.ObjectId(ONLY);
  return f;
}

/** Variant-gallery images with no Shopify copy anywhere on the product. */
function unlinkedVariantImages(doc) {
  const linked = new Set();
  for (const p of doc.shopifyImages || []) if (clean(p.shopifyUrl)) linked.add(clean(p.sourceUrl));
  for (const v of doc.variants || []) {
    for (const p of v.shopifyImages || []) if (clean(p.shopifyUrl)) linked.add(clean(p.sourceUrl));
    if (clean(v.shopifyImageUrl) && clean(v.imageUrl)) linked.add(clean(v.imageUrl));
  }
  const out = new Set();
  for (const v of doc.variants || []) for (const u of v.images || []) if (isSupplier(u) && !linked.has(clean(u))) out.add(clean(u));
  return [...out];
}

// ---------- phases ----------

async function plan() {
  const col = await openProducts();
  let products = 0, needWork = 0, gallery = 0, vHero = 0, vGallery = 0;
  const upload = new Set();
  for await (const d of col.find(brandFilter()).project({ images: 1, shopifyImages: 1, variants: 1 })) {
    products++;
    let any = false;
    for (const u of d.images || []) if (isSupplier(u)) (gallery++, (any = true));
    for (const v of d.variants || []) {
      if (isSupplier(v.imageUrl)) (vHero++, (any = true));
      for (const u of v.images || []) if (isSupplier(u)) (vGallery++, (any = true));
    }
    unlinkedVariantImages(d).forEach((u) => upload.add(u));
    if (any) needWork++;
  }
  say(`products: ${products} (${needWork} hold supplier URLs)`);
  say(`  gallery images to swap: ${gallery}`);
  say(`  variant main images to swap: ${vHero}`);
  say(`  variant gallery entries to swap: ${vGallery}`);
  say(`  unmirrored variant images to upload to Shopify Files: ${upload.size}`);
  await mongoose.disconnect();
}

async function upload() {
  const state = loadState();
  const col = await openProducts();
  const all = new Set();
  for await (const d of col.find(brandFilter()).project({ images: 1, shopifyImages: 1, variants: 1 }).limit(LIMIT === Infinity ? 0 : LIMIT)) {
    unlinkedVariantImages(d).forEach((u) => all.add(u));
  }
  await mongoose.disconnect();
  const todo = [...all].filter((u) => !state.files[u]);
  say(`files to send: ${todo.length} (${all.size - todo.length} already sent)`);
  let sent = 0;
  for (let i = 0; i < todo.length; i += 25) {
    const chunk = todo.slice(i, i + 25);
    try {
      const ids = await createFiles(chunk);
      chunk.forEach((u, k) => (state.files[u] = { id: ids[k] }));
      sent += chunk.length;
    } catch (e) {
      say(`  chunk failed: ${String(e.message).slice(0, 160)}`);
    }
    saveState(state);
    if ((i / 25) % 20 === 19) say(`  sent ${sent}/${todo.length}`);
  }
  say(`upload done: ${sent} files sent`);
}

async function collect() {
  const state = loadState();
  const report = () => {
    const f = Object.values(state.files);
    say(`  files: ${f.filter((x) => x.url).length}/${f.length} ready, ${f.filter((x) => x.gaveUp).length} gave up`);
  };
  for (let round = 1; round <= 8; round++) {
    const open = Object.entries(state.files).filter(([, f]) => !f.url && !f.gaveUp);
    if (!open.length) break;
    say(`round ${round}: ${open.length} files not ready`);
    const status = await mediaStatus(open.map(([, f]) => f.id).filter(Boolean));
    const failed = [];
    let processing = 0;
    for (const [u, f] of open) {
      const s = f.id ? status.get(f.id) : { status: "MISSING" };
      if (s?.status === "READY" && s.url) f.url = s.url;
      else if (s?.status === "FAILED" || s?.status === "MISSING") failed.push([u, f, s.status]);
      else processing++;
    }
    saveState(state);
    report();
    say(`  ${failed.length} failed → re-uploading by bytes, ${processing} still processing`);
    let resent = 0, gaveUp = 0, done = 0;
    const queue = [...failed];
    const worker = async () => {
      while (queue.length) {
        const [u, f, st] = queue.shift();
        try {
          if (f.id && st === "FAILED") await deleteFiles([f.id]);
          f.id = "";
          f.staged = (f.staged || 0) + 1;
          if (f.staged > MAX_ATTEMPTS) {
            f.gaveUp = true;
            gaveUp++;
          } else {
            [f.id] = await createFiles([await stageFromSource(u)]);
            resent++;
          }
        } catch (e) {
          f.lastError = String(e.message).slice(0, 160);
        }
        if (++done % 100 === 0) {
          saveState(state);
          say(`  re-uploaded ${done}/${failed.length}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    saveState(state);
    say(`  round ${round} done: re-uploaded ${resent}, gave up ${gaveUp}`);
    if (!processing && !failed.length) break;
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

/** What a variant gallery shows: Shopify images only (ProductSection's shopifyOnly). */
const shownVariantGallery = (v) => gallery(v.images, v.shopifyImages).filter(isShopify);

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
function buildUpdate(doc, files, live, loads) {
  const ok = (p) => {
    const shop = clean(p?.shopifyUrl);
    if (!shop || !loads.get(shop)) return false;
    if (!p.mediaId) return true;
    const m = live.get(p.mediaId);
    return Boolean(m && m.status === "READY" && bare(m.url) === bare(shop));
  };
  // Product pairs: the copy the sync manages for images[] and variant imageUrl.
  const productMap = new Map();
  for (const p of doc.shopifyImages || []) if (isSupplier(p.sourceUrl) && ok(p)) productMap.set(clean(p.sourceUrl), clean(p.shopifyUrl));

  const changes = [];
  const counts = { gallery: 0, variantHero: 0, variantGallery: 0, newVariantImages: 0, kept: 0 };

  const images = (doc.images || []).map((u, i) => {
    const to = productMap.get(clean(u));
    if (!to) {
      if (isSupplier(u)) counts.kept++;
      return u;
    }
    changes.push(`images.${i}`);
    counts.gallery++;
    return to;
  });
  const pairs = (doc.shopifyImages || []).map((p, i) => {
    const to = productMap.get(clean(p.sourceUrl));
    if (!to || clean(p.shopifyUrl) !== to) return { ...p };
    changes.push(`shopifyImages.${i}.sourceUrl`);
    return { ...p, sourceUrl: to };
  });

  const variants = (doc.variants || []).map((v, vi) => {
    const nv = { ...v };
    // Hero: the product pair's copy (what the sync matches), else the variant's own.
    const hero = clean(v.imageUrl);
    if (isSupplier(hero)) {
      const own = clean(v.shopifyImageUrl) && loads.get(clean(v.shopifyImageUrl)) ? clean(v.shopifyImageUrl) : "";
      const to = productMap.get(hero) || own;
      if (to) {
        nv.imageUrl = to;
        changes.push(`variants.${vi}.imageUrl`);
        counts.variantHero++;
      } else counts.kept++;
    }
    // Gallery: the variant's own pair, else the product pair, else an uploaded file.
    const vmap = new Map();
    for (const p of v.shopifyImages || []) if (isSupplier(p.sourceUrl) && ok(p)) vmap.set(clean(p.sourceUrl), clean(p.shopifyUrl));
    if ("images" in v) {
      const added = [];
      nv.images = (v.images || []).map((u, i) => {
        const src = clean(u);
        if (!isSupplier(src)) return u;
        let to = vmap.get(src) || productMap.get(src);
        if (!to && files[src]?.url && loads.get(files[src].url)) {
          to = files[src].url;
          added.push({ sourceUrl: to, shopifyUrl: to, mediaId: "", position: i });
          counts.newVariantImages++;
        }
        if (!to) {
          counts.kept++;
          return u;
        }
        changes.push(`variants.${vi}.images.${i}`);
        counts.variantGallery++;
        return to;
      });
      if ("shopifyImages" in v || added.length) {
        const vp = (v.shopifyImages || []).map((p, i) => {
          const to = vmap.get(clean(p.sourceUrl));
          if (!to) return { ...p };
          changes.push(`variants.${vi}.shopifyImages.${i}.sourceUrl`);
          return { ...p, sourceUrl: to };
        });
        added.forEach((a, k) => changes.push(`variants.${vi}.shopifyImages.${vp.length + k}`));
        nv.shopifyImages = [...vp, ...added];
      }
    }
    return nv;
  });
  return { images, pairs, variants, changes, counts };
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

/** before is an in-order subsequence of after. */
function keepsOrder(before, after) {
  let j = 0;
  for (const x of after) if (x === before[j]) j++;
  return j === before.length;
}

async function apply() {
  const state = loadState();
  const col = await openProducts();
  const supplier = /^https:\/\/www\.betterbathrooms\.com\//;
  const pending = {
    ...brandFilter(),
    $or: [{ images: supplier }, { "variants.imageUrl": supplier }, { "variants.images": supplier }],
  };
  let ids = (await col.find(pending).project({ _id: 1 }).sort({ _id: 1 }).toArray())
    .map((d) => d._id)
    .filter((_, k) => k % SHARDS === SHARD);
  if (LIMIT !== Infinity) ids = ids.slice(0, LIMIT);
  say(`${WRITE ? "WRITE" : "DRY RUN"}: ${ids.length} products (shard ${SHARD}/${SHARDS})`);
  fs.mkdirSync(DIR, { recursive: true });
  const backupFile = path.join(DIR, `backup-${STAMP}-shard${SHARD}of${SHARDS}.ejson.jsonl`);

  const totals = { products: 0, written: 0, gallery: 0, variantHero: 0, variantGallery: 0, newVariantImages: 0, kept: 0, skipped: {}, verify: { ok: 0, unexpected: 0, countsChanged: 0, galleryChanged: 0, variantGalleryLost: 0, syncWorse: 0, notWritten: 0 } };
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
      for (const u of unlinkedVariantImages(d)) if (state.files[u]?.url) urls.add(state.files[u].url);
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
          const live = media.get(d.shopifyProductId) || new Map();
          const u = buildUpdate(d, state.files, live, loads);
          if (!u.changes.length) {
            skip("nothing verifiable to change");
            continue;
          }
          const next = { ...d, images: u.images, shopifyImages: u.pairs, variants: u.variants };
          if (JSON.stringify(gallery(d.images, d.shopifyImages)) !== JSON.stringify(gallery(next.images, next.shopifyImages))) {
            skip("product gallery would change");
            continue;
          }
          const lost = (d.variants || []).some((v, vi) => !keepsOrder(shownVariantGallery(v), shownVariantGallery(next.variants[vi])));
          if (lost) {
            skip("a variant gallery would lose or reorder an image");
            continue;
          }
          const sb = simulateSync(d, live);
          const sa = simulateSync(next, live);
          const linkedIds = new Set(u.pairs.map((p) => p.mediaId).filter(Boolean));
          if (sa.remove.some((id) => linkedIds.has(id) || !sb.remove.includes(id)) || sa.upload.length > sb.upload.length) {
            skip("sync would delete or upload more after the swap");
            continue;
          }
          for (const k of ["gallery", "variantHero", "variantGallery", "newVariantImages", "kept"]) totals[k] += u.counts[k];
          if (!WRITE) continue;

          fs.appendFileSync(backupFile, `${EJSON.stringify(d, { relaxed: false })}\n`);
          const res = await col.updateOne(
            { _id: d._id, images: d.images, shopifyImages: d.shopifyImages, ...("variants" in d ? { variants: d.variants } : {}) },
            { $set: { images: u.images, shopifyImages: u.pairs, ...("variants" in d ? { variants: u.variants } : {}) } },
          );
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
          const sizes = (x) => JSON.stringify([x.images?.length, x.shopifyImages?.length, x.variants?.length, ...(x.variants || []).map((v) => v.images?.length)]);
          if (sizes(a) !== sizes(d)) totals.verify.countsChanged++;
          if (JSON.stringify(gallery(a.images, a.shopifyImages)) !== JSON.stringify(gallery(d.images, d.shopifyImages))) totals.verify.galleryChanged++;
          if ((d.variants || []).some((v, vi) => !keepsOrder(shownVariantGallery(v), shownVariantGallery(a.variants[vi])))) totals.verify.variantGalleryLost++;
          const s2 = simulateSync(a, live);
          if (s2.remove.some((id) => linkedIds.has(id) || !sb.remove.includes(id)) || s2.upload.length > sb.upload.length) totals.verify.syncWorse++;
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
