/**
 * Repair Toasty gallery pairs whose Shopify copy is a different photograph.
 *
 * 183 shopifyImages pairs on 61 Toasty products pair an img.toasty.co.uk
 * source with a Shopify file of another picture: Toasty names every file
 * `<40-hex content hash>_<slug>` and Shopify keeps that name, so the hashes
 * on the two sides should match and here they do not (an earlier backfill
 * paired by position). The page already showed the wrong picture in those
 * slots; toasty-move-images-to-shopify then carried that copy into images[]
 * for 38 of them, so the right source survives only in its backups.
 *
 * For each such slot this uploads the right source (by bytes — Toasty refuses
 * Shopify's fetcher) as product media, then points exactly the fields that
 * held that source — images[i], the pair, variants[].imageUrl and
 * variants[].images[j] — at the new copy. Positions come from the original
 * document (earliest backup, else the live one). The wrongly paired media is
 * left on Shopify; nothing else changes.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/toasty-repair-mismatched-pairs.cjs           # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/toasty-repair-mismatched-pairs.cjs --write
 */
const path = require("path");
const fs = require("fs");
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
const WRITE = process.argv.includes("--write");
const BRAND_ID = "6aaebfcadd166462c4aaf549";
const DOMAIN = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
const API = `https://${DOMAIN}/admin/api/2025-07/graphql.json`;
const DIR = path.join(__dirname, "..", "image-audit", "toasty");
const STATE_FILE = path.join(DIR, "repair-state.json");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const say = (s = "") => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const hashOf = (u) => (String(u || "").match(/([0-9a-f]{40})/i) || [, ""])[1].toLowerCase();
/** img.toasty.co.uk URL for a Shopify copy named <hash>_<slug>_<uuid>.ext, or "". */
function toastyUrlFor(shopifyUrl) {
  if (!/cdn\.shopify\.com/.test(shopifyUrl)) return "";
  const file = shopifyUrl.split("?")[0].split("/").pop().replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.)/i, "");
  const h = hashOf(file);
  if (!h || !file.toLowerCase().startsWith(h)) return "";
  return `https://img.toasty.co.uk/products/${h[0]}/${h[1]}/${h[2]}/${h[3]}/${file}`;
}
const isToasty = (u) => /^https:\/\/(img|www)\.toasty\.co\.uk\//i.test(clean(u));

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
  return (await res.json()).access_token;
}
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
  const target = data.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([bytes], { type: mime }), filename);
  const up = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  if (!up.ok) throw new Error(`staged upload answered ${up.status}`);
  return target.resourceUrl;
}

async function createProductMedia(productId, source) {
  const data = await gql(
    `mutation($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) { media { id } mediaUserErrors { message } }
    }`,
    { productId, media: [{ originalSource: source, mediaContentType: "IMAGE" }] },
  );
  const r = data.productCreateMedia;
  if (r.mediaUserErrors?.length) throw new Error(r.mediaUserErrors.map((e) => e.message).join("; "));
  return r.media[0].id;
}

async function mediaStatus(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const data = await gql(`query($ids: [ID!]!) { nodes(ids: $ids) { ... on MediaImage { id fileStatus image { url } } } }`, { ids: batch });
    batch.forEach((id, k) => out.set(id, data.nodes[k] ? { status: data.nodes[k].fileStatus, url: data.nodes[k].image?.url || "" } : { status: "MISSING" }));
  }
  return out;
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
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
  const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state));

  // Original documents: the earliest backup of each product.
  const orig = new Map();
  for (const f of fs.readdirSync(DIR).filter((f) => f.startsWith("backup-")).sort()) {
    for (const line of fs.readFileSync(path.join(DIR, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const d = EJSON.parse(line);
      if (!orig.has(String(d._id))) orig.set(String(d._id), d);
    }
  }

  const conn = await connectMongo(process.env.MONGODB_URI);
  const col = conn.db.collection("products");
  const bid = new mongoose.Types.ObjectId(BRAND_ID);
  const lives = await col.find({ brand: { $in: [bid, BRAND_ID] } }).toArray();

  // Work: per product, every mismatched pair in the original document.
  const work = [];
  for (const live of lives) {
    const o = orig.get(String(live._id)) || live;
    const bad = (o.shopifyImages || [])
      .map((p, k) => ({ p, k }))
      .filter(({ p }) => clean(p.shopifyUrl) && /^https:\/\//.test(clean(p.sourceUrl)) && hashOf(p.sourceUrl) && hashOf(p.shopifyUrl) && hashOf(p.sourceUrl) !== hashOf(p.shopifyUrl));
    if (bad.length) work.push({ live, o, bad });
  }
  const slots = work.reduce((n, w) => n + w.bad.length, 0);
  const sources = [...new Set(work.flatMap((w) => w.bad.map(({ p }) => clean(p.sourceUrl))))];
  say(`${WRITE ? "WRITE" : "DRY RUN"}: ${work.length} products, ${slots} mismatched pairs, ${sources.length} distinct right sources`);

  // 1. Upload each right source once per product (media belongs to a product).
  let uploaded = 0;
  const jobs = [];
  for (const w of work) {
    for (const { p } of w.bad) {
      const key = `${w.live._id}|${clean(p.sourceUrl)}`;
      if (state[key]?.id || !WRITE || jobs.some((j) => j.key === key)) continue;
      delete state[key];
      jobs.push({ key, productId: w.live.shopifyProductId, source: clean(p.sourceUrl) });
    }
  }
  // Ten at a time; state is saved after each so a restart never repeats one.
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      while (jobs.length) {
        const j = jobs.shift();
        try {
          let staged;
          try {
            staged = await stageFromSource(j.source);
          } catch (e) {
            // An old Shopify copy that is gone: the same file is still at
            // Toasty under the path its hash spells out.
            const alt = toastyUrlFor(j.source);
            if (!alt) throw e;
            staged = await stageFromSource(alt);
          }
          state[j.key] = { id: await createProductMedia(j.productId, staged) };
          uploaded++;
        } catch (e) {
          state[j.key] = { error: String(e.message).slice(0, 160) };
        }
        save();
      }
    }),
  );
  if (WRITE) say(`uploaded ${uploaded} right images`);

  // 2. Wait for every upload to be READY.
  if (WRITE) {
    for (let round = 0; round < 20; round++) {
      const open = Object.entries(state).filter(([, s]) => s.id && !s.url);
      if (!open.length) break;
      const st = await mediaStatus(open.map(([, s]) => s.id));
      for (const [, s] of open) {
        const x = st.get(s.id);
        if (x?.status === "READY" && x.url) s.url = x.url;
        if (x?.status === "FAILED") s.error = "FAILED in Shopify";
      }
      save();
      if (Object.values(state).every((s) => s.url || s.error)) break;
      await sleep(5000);
    }
    const ready = Object.values(state).filter((s) => s.url).length;
    say(`ready ${ready}, failed ${Object.values(state).filter((s) => s.error).length}`);
  }

  // 3. Point exactly the slots that held each right source at its new copy.
  const backupFile = path.join(DIR, `backup-repair-${STAMP}.ejson.jsonl`);
  const v = { products: 0, written: 0, slotsFixed: 0, skipped: 0, ok: 0, unexpected: 0, hashWrong: 0, countsChanged: 0 };
  for (const w of work) {
    v.products++;
    const { live, o } = w;
    const fix = new Map(); // right source → { url, id }
    for (const { p } of w.bad) {
      const s = state[`${live._id}|${clean(p.sourceUrl)}`];
      if (s?.url && hashOf(s.url) === hashOf(p.sourceUrl)) fix.set(clean(p.sourceUrl), s);
    }
    if (!WRITE) {
      v.slotsFixed += w.bad.length;
      continue;
    }
    if (!fix.size) {
      v.skipped++;
      continue;
    }
    const changes = [];
    const images = [...(live.images || [])];
    (o.images || []).forEach((u, i) => {
      const f = fix.get(clean(u));
      if (f && i < images.length) {
        images[i] = f.url;
        changes.push(`images.${i}`);
      }
    });
    const pairs = (live.shopifyImages || []).map((p) => ({ ...p }));
    for (const { p, k } of w.bad) {
      const f = fix.get(clean(p.sourceUrl));
      if (!f || !pairs[k] || pairs[k].mediaId !== p.mediaId) continue; // the slot must still be that pair
      pairs[k] = { ...pairs[k], sourceUrl: f.url, shopifyUrl: f.url, mediaId: f.id };
      changes.push(`shopifyImages.${k}`);
      v.slotsFixed++;
    }
    const variants = (live.variants || []).map((lv, vi) => {
      const ov = (o.variants || [])[vi] || {};
      const nv = { ...lv };
      const fh = fix.get(clean(ov.imageUrl));
      if (fh) {
        nv.imageUrl = fh.url;
        changes.push(`variants.${vi}.imageUrl`);
      }
      if (Array.isArray(lv.images)) {
        nv.images = lv.images.map((u, j) => {
          const fg = fix.get(clean((ov.images || [])[j]));
          if (!fg) return u;
          changes.push(`variants.${vi}.images.${j}`);
          return fg.url;
        });
      }
      return nv;
    });

    fs.appendFileSync(backupFile, `${EJSON.stringify(live, { relaxed: false })}\n`);
    const set = { images, shopifyImages: pairs };
    if ("variants" in live) set.variants = variants;
    const res = await col.updateOne(
      { _id: live._id, images: live.images, shopifyImages: live.shopifyImages, ...("variants" in live ? { variants: live.variants } : {}) },
      { $set: set },
    );
    if (res.modifiedCount !== 1) {
      v.skipped++;
      continue;
    }
    v.written++;
    const a = await col.findOne({ _id: live._id });
    const fb = flat(live);
    const fa = flat(a);
    let bad = false;
    for (const k of new Set([...fb.keys(), ...fa.keys()])) {
      if (fb.get(k) === fa.get(k) || changes.some((c) => k === c || k.startsWith(`${c}.`))) continue;
      bad = true;
      say(`  UNEXPECTED ${live._id} ${k}`);
    }
    if (bad) v.unexpected++;
    // Every slot that originally held a right source now shows that very picture.
    (o.images || []).forEach((u, i) => {
      if (fix.has(clean(u)) && hashOf(a.images[i]) !== hashOf(u)) v.hashWrong++;
    });
    for (const { p, k } of w.bad) if (fix.has(clean(p.sourceUrl)) && hashOf(a.shopifyImages[k].shopifyUrl) !== hashOf(p.sourceUrl)) v.hashWrong++;
    if ((a.images || []).length !== (live.images || []).length || (a.shopifyImages || []).length !== (live.shopifyImages || []).length) v.countsChanged++;
    if (!bad) v.ok++;
  }
  say(JSON.stringify(v));
  if (WRITE) say(`backup: ${backupFile}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
