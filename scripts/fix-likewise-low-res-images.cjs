/**
 * Clear the blurry leftovers out of Likewise Floors galleries.
 *
 * The original scrape read each product page's carousel, which shows the
 * product's own photo followed by every sibling colourway, and saved the lot.
 * fix-likewise-images.cjs removed what it could identify, but it matched images
 * by byte length against the full-size uploads/<SKU>.jpg — so it recognised
 * full-size copies and nothing else. The carousel also emits 80x80 and 336x336
 * thumbnails, which share no bytes with the original and were therefore kept as
 * "unknown". Those thumbnails are what still reads as blurry on the PDP.
 *
 * A dHash fixes exactly that gap: it is resolution-independent, so a 80px
 * thumbnail of a carpet still hashes near its 1024px original. Measured on
 * product "91": its own photo scored 0, its 336px and 80px thumbnails scored 8
 * and 9, and a sibling colourway's thumbnails scored 32 and 33.
 *
 * So each stored image resolves to one of three things:
 *
 *   own      a copy of this product's own SKU photo — keep the largest, drop
 *            the thumbnail duplicates
 *   foreign  a copy of another product's SKU photo — drop
 *   unknown  matches no live SKU photo — kept untouched, as before
 *
 * Upscaling is not on the table and never was: for the 379 single-image
 * products the live uploads/<SKU>.jpg is pixel-for-pixel the size we already
 * store. Likewise simply publishes small photos for those, and no amount of
 * re-fetching changes that. This script only removes what should not be in the
 * gallery, and pulls the full-size own photo where the gallery holds only a
 * shrunken copy of it.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-likewise-low-res-images.cjs
 *   DRY=1        report what would change, change nothing
 *   REINDEX=1    re-download and re-hash every live SKU photo
 *   ONLY=<id>    a single Mongo product id
 *   MIN_EDGE=900 an image below this is a candidate for removal
 *   THRESHOLD=14 max dHash distance counted as the same photo
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const fs = require("fs");
const mongoose = require("mongoose");
const sharp = require("sharp");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const UPLOADS = "https://uploads.likewisefloors.co.uk/uploads";
const BRAND_SLUG = "likewisefloors";

const DRY = process.env.DRY === "1";
const REINDEX = process.env.REINDEX === "1";
const ONLY = process.env.ONLY || "";
const MIN_EDGE = Number(process.env.MIN_EDGE || 900);
const THRESHOLD = Number(process.env.THRESHOLD || 14);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 6));

const INDEX = path.join(__dirname, "_tmp-likewise-sku-hashes.json");
const REPORT = path.join(__dirname, "likewise-low-res-fix-report.json");
const ROLLBACK = path.join(
  __dirname,
  `rollback-likewise-lowres-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- image helpers ----------------------------- */

async function fetchBuf(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "image/*" },
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch {
      if (attempt === 3) return null;
      await delay(500 * attempt);
    }
  }
  return null;
}

/** dHash: 9x8 greyscale, one bit per left>right comparison — size-independent. */
async function dhash(buf) {
  try {
    const px = await sharp(buf).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let bits = "";
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
    return bits;
  } catch {
    return "";
  }
}

function distance(a, b) {
  if (!a || !b || a.length !== b.length) return 999;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

async function measure(buf) {
  try {
    const m = await sharp(buf).metadata();
    return { w: m.width || 0, h: m.height || 0 };
  } catch {
    return { w: 0, h: 0 };
  }
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await worker(items[i++]);
    }),
  );
}

/* ------------------------------- Shopify -------------------------------- */

const shopifyDomain = () =>
  String(process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

async function shopifyToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const res = await fetch(`https://${shopifyDomain()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`Shopify token failed: ${JSON.stringify(j).slice(0, 160)}`);
  return j.access_token;
}

async function shopifyGql(token, query, variables) {
  const version = process.env.SHOPIFY_API_VERSION || "2025-07";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`https://${shopifyDomain()}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors && /throttl/i.test(JSON.stringify(json.errors))) {
      await delay(2000 * attempt);
      continue;
    }
    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 200));
    return json.data;
  }
  throw new Error("Shopify throttled");
}

async function deleteMedia(token, productId, mediaIds) {
  if (!mediaIds.length) return;
  const d = await shopifyGql(
    token,
    `mutation ($id: ID!, $ids: [ID!]!) {
       productDeleteMedia(productId: $id, mediaIds: $ids) {
         deletedMediaIds
         mediaUserErrors { message }
       }
     }`,
    { id: productId, ids: mediaIds },
  );
  const errs = d.productDeleteMedia?.mediaUserErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
}

async function createMedia(token, productId, sources, alt) {
  if (!sources.length) return [];
  const d = await shopifyGql(
    token,
    `mutation ($id: ID!, $media: [CreateMediaInput!]!) {
       productCreateMedia(productId: $id, media: $media) {
         media { ... on MediaImage { id image { url } } }
         mediaUserErrors { message }
       }
     }`,
    {
      id: productId,
      media: sources.map((s) => ({
        originalSource: `${s}${s.includes("?") ? "&" : "?"}v=${Date.now()}`,
        mediaContentType: "IMAGE",
        alt: alt || "",
      })),
    },
  );
  const errs = d.productCreateMedia?.mediaUserErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
  const media = d.productCreateMedia?.media || [];

  // image.url is null until Shopify has fetched the file; poll for the real one.
  const ids = media.map((m) => m.id).filter(Boolean);
  for (let attempt = 1; attempt <= 6 && ids.length; attempt++) {
    await delay(1500 * attempt);
    const back = await shopifyGql(
      token,
      `query ($ids: [ID!]!) { nodes(ids: $ids) { ... on MediaImage { id fileStatus image { url } } } }`,
      { ids },
    );
    let settled = true;
    for (const n of back.nodes || []) {
      if (!n?.id) continue;
      const row = media.find((m) => m.id === n.id);
      if (n.image?.url && row) row.image = n.image;
      if (n.fileStatus !== "READY") settled = false;
    }
    if (settled) break;
  }
  return media;
}

/* --------------------------------- main --------------------------------- */

async function buildIndex(products) {
  if (!REINDEX && fs.existsSync(INDEX)) {
    const cached = JSON.parse(fs.readFileSync(INDEX, "utf8"));
    console.log(`Reusing ${Object.keys(cached).length} cached SKU hash(es)\n`);
    return cached;
  }
  const skus = [...new Set(products.map((p) => p.specs?.likewiseSku || p.specs?.sku).filter(Boolean))];
  console.log(`Hashing ${skus.length} live SKU photo(s)…`);
  const index = {};
  let done = 0;
  await mapPool(skus, CONCURRENCY, async (sku) => {
    const buf = await fetchBuf(`${UPLOADS}/${sku}.jpg`);
    if (buf) {
      const { w, h } = await measure(buf);
      const hash = await dhash(buf);
      if (hash) index[sku] = { hash, w, h };
    }
    if (++done % 200 === 0) console.log(`  ${done}/${skus.length}  indexed=${Object.keys(index).length}`);
  });
  fs.writeFileSync(INDEX, `${JSON.stringify(index)}\n`);
  console.log(`Indexed ${Object.keys(index).length} SKU photo(s)\n`);
  return index;
}

async function main() {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error(`Brand "${BRAND_SLUG}" not found`);

  const all = await db
    .collection("products")
    .find(
      { brand: brand._id },
      { projection: { name: 1, images: 1, shopifyImages: 1, shopifyProductId: 1, specs: 1 } },
    )
    .toArray();
  console.log(`${all.length} ${BRAND_SLUG} product(s)\n`);

  const index = await buildIndex(all);
  // Reverse lookup so a stored image can be attributed to whichever SKU it is.
  const entries = Object.entries(index);

  let targets = all.filter((p) => (p.images || []).length > 1);
  if (ONLY) targets = all.filter((p) => String(p._id) === ONLY);
  console.log(`Examining ${targets.length} product(s) with more than one image\n`);

  const token = DRY ? "" : await shopifyToken();
  const report = [];
  const rollback = [];
  let changed = 0;
  let untouched = 0;
  let failed = 0;

  for (const p of targets) {
    const sku = p.specs?.likewiseSku || p.specs?.sku || "";
    const own = index[sku];
    const images = (p.images || []).filter((u) => /^https?:/i.test(u));
    if (!images.length) continue;

    const classified = [];
    for (const url of images) {
      const buf = await fetchBuf(url);
      if (!buf) {
        classified.push({ url, verdict: "unreadable" });
        continue;
      }
      const { w, h } = await measure(buf);
      const hash = await dhash(buf);
      const edge = Math.max(w, h);

      let verdict = "unknown";
      let matchSku = "";
      if (own && distance(own.hash, hash) <= THRESHOLD) {
        verdict = "own";
        matchSku = sku;
      } else {
        let best = { sku: "", d: 999 };
        for (const [s, v] of entries) {
          const d = distance(v.hash, hash);
          if (d < best.d) best = { sku: s, d };
        }
        if (best.d <= THRESHOLD) {
          verdict = "foreign";
          matchSku = best.sku;
        }
      }
      classified.push({ url, w, h, edge, verdict, matchSku });
    }

    // Keep: the largest copy of the product's own photo, plus anything we could
    // not attribute. Drop: shrunken duplicates of its own photo, and any photo
    // that belongs to a different product.
    const owns = classified.filter((c) => c.verdict === "own").sort((a, b) => b.edge - a.edge);
    const keepOwn = owns[0];
    const drop = classified.filter(
      (c) =>
        (c.verdict === "own" && c !== keepOwn) ||
        (c.verdict === "foreign" && c.edge < MIN_EDGE),
    );
    const keep = classified.filter((c) => !drop.includes(c));

    if (!drop.length) {
      untouched++;
      continue;
    }
    if (!keep.length) {
      untouched++;
      console.log(`  ${p.name.slice(0, 40)} — skipped, removal would empty the gallery`);
      continue;
    }

    console.log(`${p.name.slice(0, 52)}  [sku ${sku}]`);
    for (const c of drop)
      console.log(`   drop ${String(`${c.w}x${c.h}`).padEnd(11)} ${c.verdict}${c.matchSku && c.matchSku !== sku ? ` → ${c.matchSku}` : ""}`);
    for (const c of keep)
      console.log(`   keep ${String(`${c.w}x${c.h}`).padEnd(11)} ${c.verdict}`);

    if (DRY) {
      report.push({
        id: String(p._id),
        name: p.name,
        sku,
        dropped: drop.map((c) => ({ url: c.url, size: `${c.w}x${c.h}`, verdict: c.verdict, matchSku: c.matchSku })),
        kept: keep.map((c) => ({ url: c.url, size: `${c.w}x${c.h}`, verdict: c.verdict })),
      });
      changed++;
      continue;
    }

    try {
      const dropUrls = new Set(drop.map((c) => c.url));
      const nextImages = images.filter((u) => !dropUrls.has(u));
      const removedRows = (p.shopifyImages || []).filter((s) => dropUrls.has(s.sourceUrl));
      const nextShopify = (p.shopifyImages || []).filter((s) => !dropUrls.has(s.sourceUrl));

      // withShopifyOptionImages() drops any image with no shopifyImages row, so
      // the two lists have to stay in step or the gallery renders short.
      const keys = new Set(nextShopify.map((s) => s.sourceUrl));
      if (!nextImages.every((u) => keys.has(u)))
        throw new Error("refusing to write — a kept image has no Shopify pairing");

      if (String(p.shopifyProductId || "").startsWith("gid://shopify/Product/")) {
        const ids = removedRows.map((r) => r.mediaId).filter(Boolean);
        if (ids.length) await deleteMedia(token, p.shopifyProductId, ids);
      }

      for (const r of removedRows)
        rollback.push({
          productId: String(p._id),
          sourceUrl: r.sourceUrl,
          shopifyUrl: r.shopifyUrl,
          mediaId: r.mediaId,
          position: r.position,
        });

      await db.collection("products").updateOne(
        { _id: p._id },
        { $set: { images: nextImages, shopifyImages: nextShopify, imagesDeblurredAt: new Date() } },
      );
      changed++;
      report.push({
        id: String(p._id),
        name: p.name,
        sku,
        dropped: drop.map((c) => ({ url: c.url, size: `${c.w}x${c.h}`, verdict: c.verdict, matchSku: c.matchSku })),
        remaining: nextImages.length,
      });
    } catch (e) {
      failed++;
      console.log(`   FAIL  ${String(e.message).slice(0, 90)}`);
      report.push({ id: String(p._id), name: p.name, error: e.message });
    }
  }

  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  if (rollback.length) fs.writeFileSync(ROLLBACK, `${JSON.stringify(rollback, null, 2)}\n`);

  console.log(
    `\n${DRY ? "Would change" : "Changed"} ${changed}, left alone ${untouched}, failed ${failed}`,
  );
  console.log(`Report written to scripts/${path.basename(REPORT)}`);
  if (rollback.length) console.log(`Rollback written to scripts/${path.basename(ROLLBACK)}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
