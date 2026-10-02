/**
 * Replace source image URLs with their Shopify copy, where Shopify holds it.
 *
 * Scoped to the products link-ready-shopify-images.cjs updated (read from its
 * backup files). On those products every gallery entry whose Shopify copy is
 * linked and verified has its source URL swapped for the Shopify URL in every
 * field that carries it: images[], shopifyImages[].sourceUrl, variants[].imageUrl,
 * variants[].shopifyImageUrl, variants[].images[] and
 * variants[].shopifyImages[].sourceUrl.
 *
 * Swapped rather than deleted, because the Shopify sync (reconcileProductMedia)
 * keeps only media whose sourceUrl is still listed in images[] + variant
 * imageUrl: dropping the source URL would make the next sync delete the
 * Shopify copy. With the Shopify URL on both sides the sync matches every
 * file to the media it already has, and neither uploads nor deletes.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/replace-linked-source-urls.cjs           # dry run
 *   node --require ./scripts/mongo-dns.cjs scripts/replace-linked-source-urls.cjs --write
 */
const path = require("path");
const fs = require("fs");
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
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const bare = (u) => clean(u).split("?")[0];
const json = (v) => JSON.parse(JSON.stringify(v));

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

async function productMedia(token, productIds) {
  const out = new Map();
  const query = `query P($ids:[ID!]!){nodes(ids:$ids){... on Product{id
    media(first:250){nodes{id status ... on MediaImage{image{url}}}}}}}`;
  for (let i = 0; i < productIds.length; i += 10) {
    const ids = productIds.slice(i, i + 10);
    let data;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query, variables: { ids } }),
      });
      const body = await res.json();
      if (!body.errors) {
        data = body.data;
        break;
      }
      if (attempt === 3) throw new Error(JSON.stringify(body.errors).slice(0, 300));
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    ids.forEach((id, k) => {
      const media = new Map();
      for (const m of data.nodes[k]?.media?.nodes || []) {
        media.set(m.id, { status: m.status, url: m.image?.url || "" });
      }
      out.set(id, media);
    });
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

/** Stored URL → Shopify copy, as buildShopifyFallbackMap builds it. */
function deliveredMap(doc) {
  const map = new Map();
  for (const p of doc.shopifyImages || []) {
    const shop = clean(p.shopifyUrl);
    if (!shop) continue;
    map.set(clean(p.sourceUrl) || shop, shop);
    map.set(shop, shop);
  }
  return map;
}

/** What the page delivers: product gallery plus each variant's gallery and hero. */
function delivered(doc) {
  const map = deliveredMap(doc);
  const via = (u) => map.get(clean(u)) || clean(u);
  return JSON.stringify({
    product: gallery(doc.images, doc.shopifyImages),
    variants: (doc.variants || []).map((v) => ({
      gallery: gallery(v.images, v.shopifyImages).map(via),
      hero: via(clean(v.shopifyImageUrl) || clean(v.imageUrl)),
    })),
  });
}

/**
 * What reconcileProductMedia would do on the next sync: sources it would
 * upload afresh, and live media it would delete.
 */
function simulateSync(doc, live) {
  const wanted = [
    ...new Set(
      [...(doc.images || []), ...(doc.variants || []).map((v) => v.imageUrl || "")]
        .map(clean)
        .filter((u) => /^https?:\/\//i.test(u) && !/\/video\/upload\/|\.(mp4|mov|webm|m4v|avi)(\?|$)/i.test(u)),
    ),
  ];
  const usable = new Set([...live].filter(([, m]) => m.status !== "FAILED").map(([id]) => id));
  const bySource = new Map();
  for (const l of doc.shopifyImages || []) {
    if (clean(l.sourceUrl) && l.mediaId && usable.has(l.mediaId)) bySource.set(clean(l.sourceUrl), l);
  }
  const keep = new Set(wanted.map((s) => bySource.get(s)?.mediaId).filter(Boolean));
  return {
    upload: wanted.filter((s) => !bySource.has(s)),
    remove: [...live.keys()].filter((id) => !keep.has(id)),
  };
}

/** Build the swap for one product, or explain why it is skipped. */
function planFor(doc, live, loads) {
  const map = new Map(); // product-level: source → Shopify URL
  for (const p of doc.shopifyImages || []) {
    const src = clean(p.sourceUrl);
    const shop = clean(p.shopifyUrl);
    if (!src || !shop || src === shop) continue;
    const m = live.get(p.mediaId);
    if (!m || m.status !== "READY" || bare(m.url) !== bare(shop)) return { skip: "product media not READY / URL differs in Shopify" };
    if (!loads.get(shop)) return { skip: "Shopify URL does not load" };
    map.set(src, shop);
  }
  if (!map.size) return { skip: "nothing linked to swap" };

  const next = json(doc);
  const changes = [];
  const swap = (obj, key, to, where) => {
    changes.push({ where, from: obj[key], to });
    obj[key] = to;
  };

  next.images = (next.images || []).map((u, i) => {
    const to = map.get(clean(u));
    if (!to) return u;
    changes.push({ where: `images.${i}`, from: u, to });
    return to;
  });
  if (new Set(next.images.map(clean)).size !== new Set((doc.images || []).map(clean)).size) {
    return { skip: "swap would create a duplicate in images[]" };
  }
  (next.shopifyImages || []).forEach((p, i) => {
    const to = map.get(clean(p.sourceUrl));
    if (to && clean(p.shopifyUrl) === to) swap(p, "sourceUrl", to, `shopifyImages.${i}.sourceUrl`);
  });

  for (const [vi, v] of (next.variants || []).entries()) {
    if (map.has(clean(v.imageUrl))) swap(v, "imageUrl", map.get(clean(v.imageUrl)), `variants.${vi}.imageUrl`);
    if (map.has(clean(v.shopifyImageUrl))) {
      swap(v, "shopifyImageUrl", map.get(clean(v.shopifyImageUrl)), `variants.${vi}.shopifyImageUrl`);
    }
    // A variant's own gallery pairs each source with its own Shopify copy; a
    // pair still waiting for one takes the product's verified copy of the same
    // file as its source, and keeps its empty shopifyUrl so nothing new shows.
    const vmap = new Map();
    for (const p of v.shopifyImages || []) {
      const src = clean(p.sourceUrl);
      const shop = clean(p.shopifyUrl);
      if (!map.has(src)) continue;
      if (!shop) vmap.set(src, map.get(src));
      else if (loads.get(shop)) vmap.set(src, shop);
      else return { skip: "variant Shopify URL does not load" };
    }
    // Variant gallery entries with no pair of their own are rendered through
    // the product's pairing, so they take the product's Shopify URL.
    v.images = (v.images || []).map((u, i) => {
      const to = vmap.get(clean(u)) || map.get(clean(u));
      if (!to) return u;
      changes.push({ where: `variants.${vi}.images.${i}`, from: u, to });
      return to;
    });
    if (new Set(v.images.map(clean)).size !== new Set((doc.variants[vi].images || []).map(clean)).size) {
      return { skip: "swap would create a duplicate in a variant gallery" };
    }
    (v.shopifyImages || []).forEach((p, i) => {
      const to = vmap.get(clean(p.sourceUrl));
      if (to) swap(p, "sourceUrl", to, `variants.${vi}.shopifyImages.${i}.sourceUrl`);
    });
  }
  return { next, changes, swapped: [...map.keys()] };
}

/** Every string path in a plain JSON document. */
function strings(node, p = "", out = new Map()) {
  if (typeof node === "string") out.set(p, node);
  else if (Array.isArray(node)) node.forEach((v, i) => strings(v, `${p}.${i}`, out));
  else if (node && typeof node === "object") for (const k of Object.keys(node)) strings(node[k], p ? `${p}.${k}` : k, out);
  else out.set(p, node);
  return out;
}

async function run(label, uri, token, summary) {
  const backup = fs.readdirSync(OUT_DIR).find((f) => f.startsWith(`backup-link-shopify-images-${label}-`));
  const ids = JSON.parse(fs.readFileSync(path.join(OUT_DIR, backup), "utf8")).map(
    (d) => new mongoose.Types.ObjectId(d._id),
  );
  const conn = await connectMongo(uri);
  const col = conn.db.collection("products");
  const docs = await col.find({ _id: { $in: ids } }).toArray();
  say(`\n[${label}] ${docs.length} products in scope`);

  const media = await productMedia(token, [...new Set(docs.map((d) => d.shopifyProductId))]);
  const urls = new Set();
  for (const d of docs) {
    for (const p of d.shopifyImages || []) if (clean(p.shopifyUrl)) urls.add(clean(p.shopifyUrl));
    for (const v of d.variants || []) for (const p of v.shopifyImages || []) if (clean(p.shopifyUrl)) urls.add(clean(p.shopifyUrl));
  }
  const loads = new Map();
  const list = [...urls];
  for (let i = 0; i < list.length; i += 32) {
    await Promise.all(list.slice(i, i + 32).map(async (u) => loads.set(u, await loadsAsImage(u))));
  }
  say(`  Shopify URLs checked: ${list.length}, loading: ${[...loads.values()].filter(Boolean).length}`);

  const plans = [];
  const skipped = new Map();
  for (const d of docs) {
    const live = media.get(d.shopifyProductId) || new Map();
    const plan = planFor(d, live, loads);
    if (plan.skip) {
      skipped.set(plan.skip, (skipped.get(plan.skip) || 0) + 1);
      continue;
    }
    const before = simulateSync(json(d), live);
    const after = simulateSync(plan.next, live);
    if (after.upload.length > before.upload.length || after.remove.length > before.remove.length) {
      skipped.set("sync would upload or delete more after the swap", (skipped.get("sync would upload or delete more after the swap") || 0) + 1);
      continue;
    }
    if (delivered(json(d)) !== delivered(plan.next)) {
      skipped.set("rendered gallery would change", (skipped.get("rendered gallery would change") || 0) + 1);
      continue;
    }
    plans.push({ doc: d, ...plan, live });
  }

  const fieldCounts = new Map();
  for (const p of plans) for (const c of p.changes) {
    const k = c.where.replace(/\.\d+/g, "[]");
    fieldCounts.set(k, (fieldCounts.get(k) || 0) + 1);
  }
  const sourceCount = plans.reduce((n, p) => n + p.swapped.length, 0);
  say(`  products to update: ${plans.length}, source URLs replaced: ${sourceCount}`);
  for (const [k, n] of fieldCounts) say(`    ${k.padEnd(36)} ${n}`);
  for (const [why, n] of skipped) say(`  skipped ${n} products: ${why}`);
  const entry = { label, products: plans.length, sourceUrls: sourceCount, fields: Object.fromEntries(fieldCounts), skipped: Object.fromEntries(skipped) };
  summary.push(entry);

  if (!WRITE || !plans.length) {
    await mongoose.disconnect();
    return;
  }

  const backupFile = path.join(OUT_DIR, `backup-replace-source-urls-${label}-${STAMP}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(plans.map((p) => p.doc)));
  say(`  backup: ${backupFile}`);

  // Each update only lands if the fields it rewrites are still exactly as read.
  // Values are rebuilt from the original documents so ObjectIds, dates and key
  // order survive; only the URL strings are taken from the plan.
  const keepKey = (orig, key, value) => (key in orig ? { [key]: value } : {});
  const ops = plans.map(({ doc, next }) => ({
    updateOne: {
      filter: {
        _id: doc._id,
        images: doc.images,
        shopifyImages: doc.shopifyImages,
        ...("variants" in doc ? { variants: doc.variants } : {}),
      },
      update: {
        $set: {
          images: next.images,
          shopifyImages: doc.shopifyImages.map((o, k) => ({ ...o, sourceUrl: next.shopifyImages[k].sourceUrl })),
          ...("variants" in doc ? { variants: (doc.variants || []).map((o, vi) => {
            const nv = next.variants[vi];
            return {
              ...o,
              ...keepKey(o, "imageUrl", nv.imageUrl),
              ...keepKey(o, "shopifyImageUrl", nv.shopifyImageUrl),
              ...keepKey(o, "images", nv.images),
              ...(o.shopifyImages
                ? { shopifyImages: o.shopifyImages.map((x, k) => ({ ...x, sourceUrl: nv.shopifyImages[k].sourceUrl })) }
                : {}),
            };
          }) } : {}),
        },
      },
    },
  }));
  const res = await col.bulkWrite(ops, { ordered: false });
  say(`  written: matched ${res.matchedCount}, modified ${res.modifiedCount}`);

  // ---- verify against the backup ----
  const after = new Map(
    (await col.find({ _id: { $in: plans.map((p) => p.doc._id) } }).toArray()).map((d) => [String(d._id), d]),
  );
  const v = { unexpected: 0, lengthChanged: 0, galleryChanged: 0, galleryDup: 0, syncWorse: 0, sourceLeft: 0, ok: 0 };
  for (const p of plans) {
    const a = after.get(String(p.doc._id));
    const sb = strings(json(p.doc));
    const sa = strings(json(a));
    const allowed = new Map(p.changes.map((c) => [c.where, c.to]));
    let bad = false;
    for (const k of new Set([...sb.keys(), ...sa.keys()])) {
      if (sb.get(k) === sa.get(k)) continue;
      if (allowed.get(k) === sa.get(k)) continue;
      bad = true;
      say(`    UNEXPECTED ${p.doc._id} ${k}: ${String(sb.get(k)).slice(0, 60)} → ${String(sa.get(k)).slice(0, 60)}`);
    }
    if (bad) v.unexpected++;
    const lens = (d) => JSON.stringify([d.images?.length, d.shopifyImages?.length, d.variants?.length, ...(d.variants || []).map((x) => [x.images?.length, x.shopifyImages?.length])]);
    if (lens(p.doc) !== lens(a)) v.lengthChanged++;
    const ga = gallery(a.images, a.shopifyImages);
    if (delivered(json(p.doc)) !== delivered(json(a))) v.galleryChanged++;
    if (new Set(ga).size !== ga.length) v.galleryDup++;
    const sb2 = simulateSync(json(p.doc), p.live);
    const sa2 = simulateSync(json(a), p.live);
    if (sa2.upload.length > sb2.upload.length || sa2.remove.length > sb2.remove.length) v.syncWorse++;
    const text = JSON.stringify(a);
    if (p.swapped.some((s) => text.includes(JSON.stringify(s)))) v.sourceLeft++;
    if (!bad) v.ok++;
  }
  say(`  verify: ${JSON.stringify(v)}`);
  entry.written = res.modifiedCount;
  entry.verify = v;
  await mongoose.disconnect();
}

(async () => {
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
