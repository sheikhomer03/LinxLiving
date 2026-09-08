/**
 * Replace the blurry GPID artwork on The Under Floor Heating products.
 *
 * Their PDP gallery renders around 1000px wide, but a slice of the catalogue
 * arrives at 450x300 and is upscaled into a visible blur. The small file is
 * not our doing: theunderfloorheatingstore.com serves that size as the
 * original, so Cloudinary and Shopify both faithfully mirror a thumbnail.
 *
 * Those products come off a shared distributor feed — their filenames are
 * GPID_<id>_IMG_<nn> — and City Plumbing sells the same lines off the same
 * feed with the same filenames, but keeps the full 1000x1000 master in its
 * DAM. The GPID code is a exact join key, so no name matching is involved:
 * find the City Plumbing listing, read the DAM token for our GPID, take the
 * master.
 *
 * The DAM path carries a per-asset token that only appears in their catalogue,
 * so the tokens come from the SearchSpring API the storefront itself queries.
 * Requesting the token URL with no width/height gives the master.
 *
 * Replacement runs the same road the images originally took — Cloudinary under
 * the existing public id, then Shopify media, then Mongo — so nothing else has
 * to learn a new URL.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-low-res-gpid-images.cjs
 *   DRY=1        report what would be replaced, change nothing
 *   MIN_EDGE=900 treat a longest side under this as blurry
 *   LIMIT=5      stop after N products
 *   ONLY=<mongo product id>
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const fs = require("fs");
const mongoose = require("mongoose");
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
const UFHS = "https://www.theunderfloorheatingstore.com";
const SEARCHSPRING = "https://8t85bv.a.searchspring.io/api/search/search.json";
const SITE_ID = "8t85bv";
const BRAND_SLUG = "the-under-floor-heating";

const DRY = process.env.DRY === "1";
const MIN_EDGE = Number(process.env.MIN_EDGE || 900);
const LIMIT = Number(process.env.LIMIT || 0);
const ONLY = process.env.ONLY || "";
const REPORT = path.join(__dirname, "low-res-gpid-fix-report.json");
const ROLLBACK = path.join(
  __dirname,
  `rollback-lowres-gpid-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read pixel size out of the JPEG/PNG header rather than decoding the file. */
function imageSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50)
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return { w: 0, h: 0 };
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** GPID_1500074815_IMG_00 — the distributor's own asset name, our join key. */
const GPID_RE = /GPID_\d+_IMG_\d+/i;
const gpidOf = (url) => (String(url).match(GPID_RE) || [""])[0].toUpperCase();

/**
 * What the supplier currently serves for a handle: the gallery in order, with
 * the size Shopify recorded, so we only touch what is actually too small.
 */
async function supplierGallery(handle) {
  const j = await getJson(`${UFHS}/products/${handle}.json`);
  return (j.product?.images || []).map((i) => ({
    src: String(i.src || "").split("?")[0],
    w: i.width,
    h: i.height,
  }));
}

/**
 * SearchSpring is what cityplumbing.co.uk queries; its rows carry DAM tokens.
 *
 * Our product names carry a sizing tail their catalogue does not
 * ("… 600mm X 600mm X 9mm - Pack Of 3 - Covers 1.08m2" against their
 * "… 600x600mm Pk/3"), and feeding the whole string in buries the match. The
 * range name alone is what identifies the line, so query the leading words and
 * shorten until a row comes back carrying one of the GPID codes we want.
 */
async function damTokensFor(title, wanted) {
  const words = String(title)
    .replace(/&amp;|&/g, " ")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");

  let tokens = new Map();
  for (const take of [6, 3]) {
    const q = words.slice(0, take).join(" ");
    if (!q) continue;
    const url =
      `${SEARCHSPRING}?siteId=${SITE_ID}&resultsFormat=native&resultsPerPage=48` +
      `&q=${encodeURIComponent(q)}`;
    let j;
    try {
      j = await getJson(url, { Referer: "https://www.cityplumbing.co.uk/" });
    } catch {
      continue;
    }
    tokens = new Map();
    for (const r of j.results || []) {
      const links = [
        r.imageUrl,
        r.secureImageUrl,
        ...String(r.additional_image_link || "").split(","),
      ];
      for (const raw of links) {
        const u = String(raw || "").replace(/&amp;/g, "&").split("?")[0];
        const m = /dam\.cityplumbing\.co\.uk\/private\/([a-z0-9]+)\/(GPID_\d+_IMG_\d+)/i.exec(u);
        if (m)
          tokens.set(
            m[2].toUpperCase(),
            `https://dam.cityplumbing.co.uk/private/${m[1]}/${m[2]}.jpeg`,
          );
      }
    }
    if (wanted.some((c) => tokens.has(c))) break;
  }
  return tokens;
}

async function fetchImage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "image/*", Referer: "https://www.cityplumbing.co.uk/" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { w, h } = imageSize(buf);
  return { buf, w, h };
}

/** The public id the original upload used, so every stored URL keeps working. */
function publicIdOf(url) {
  const m = /res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:[^/]+\/)*?v\d+\/(.+)$/.exec(
    String(url || ""),
  );
  return m ? m[1].replace(/\.[a-z0-9]+$/i, "") : "";
}

function uploadBuffer(buf, publicId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { public_id: publicId, overwrite: true, invalidate: true, resource_type: "image" },
        (err, res) => (err ? reject(err) : resolve(res)),
      )
      .end(buf);
  });
}

/* ------------------------------ Shopify ------------------------------ */

async function shopifyToken() {
  const staticToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
  if (staticToken) return staticToken;
  const res = await fetch(
    `https://${shopifyDomain()}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    },
  );
  const json = await res.json();
  if (!json.access_token) throw new Error(`Shopify token failed: ${JSON.stringify(json).slice(0, 200)}`);
  return json.access_token;
}

const shopifyDomain = () =>
  String(process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

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

/**
 * Shopify caches the bytes it fetched, so re-pointing at the same Cloudinary
 * URL would keep serving the old thumbnail. The media has to be dropped and
 * recreated; a cache-busting query keeps their fetcher from reusing it.
 */
async function replaceShopifyMedia(token, productId, jobs) {
  const del = await shopifyGql(
    token,
    `mutation ($id: ID!, $ids: [ID!]!) {
       productDeleteMedia(productId: $id, mediaIds: $ids) {
         deletedMediaIds
         mediaUserErrors { message }
       }
     }`,
    { id: productId, ids: jobs.map((j) => j.mediaId).filter(Boolean) },
  );
  const delErrs = del.productDeleteMedia?.mediaUserErrors || [];
  if (delErrs.length) throw new Error(delErrs.map((e) => e.message).join("; "));

  const created = await shopifyGql(
    token,
    `mutation ($id: ID!, $media: [CreateMediaInput!]!) {
       productCreateMedia(productId: $id, media: $media) {
         media { ... on MediaImage { id image { url } } }
         mediaUserErrors { message }
       }
     }`,
    {
      id: productId,
      media: jobs.map((j) => ({
        originalSource: `${j.cloudinaryUrl}${j.cloudinaryUrl.includes("?") ? "&" : "?"}v=${Date.now()}`,
        mediaContentType: "IMAGE",
        alt: j.alt || "",
      })),
    },
  );
  const errs = created.productCreateMedia?.mediaUserErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
  const media = created.productCreateMedia?.media || [];

  // Shopify fetches the file after answering, so `image.url` comes back null
  // on creation. The stored URL keeps working either way — their `?v=` is a
  // cache-buster, not a content selector — but harvesting the settled URL
  // keeps the stored version string honest and nudges caches along.
  const pending = media.map((m) => m.id).filter(Boolean);
  for (let attempt = 1; attempt <= 6 && pending.length; attempt++) {
    await delay(1500 * attempt);
    const back = await shopifyGql(
      token,
      `query ($ids: [ID!]!) {
         nodes(ids: $ids) { ... on MediaImage { id fileStatus image { url } } }
       }`,
      { ids: pending },
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

/* -------------------------------- main -------------------------------- */

async function main() {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error(`Brand "${BRAND_SLUG}" not found`);

  const query = { brand: brand._id };
  if (ONLY) query._id = new (require("mongodb").ObjectId)(ONLY);
  const products = await db
    .collection("products")
    .find(query, { projection: { name: 1, images: 1, shopifyImages: 1, shopifyProductId: 1, specs: 1 } })
    .toArray();
  console.log(`${products.length} ${BRAND_SLUG} product(s) in Mongo\n`);

  // The supplier handle is not stored, so match Cloudinary public ids — the
  // enrich script built them as `<handle>-g<n>`.
  const handleOf = (p) => {
    for (const u of p.images || []) {
      const id = publicIdOf(u).split("/").pop() || "";
      const m = /^(.*)-g\d+$/.exec(id);
      if (m) return m[1];
    }
    return "";
  };

  const token = DRY ? "" : await shopifyToken();
  const report = [];
  const rollback = [];
  let scanned = 0;
  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of products) {
    if (LIMIT && fixed >= LIMIT) break;
    const handle = handleOf(p);
    if (!handle) continue;
    scanned++;

    let gallery;
    try {
      gallery = await supplierGallery(handle);
    } catch {
      continue;
    }
    // Only the small ones, and only the ones we can key on a GPID code.
    const blurry = gallery
      .map((g, i) => ({ ...g, index: i }))
      .filter((g) => Math.max(g.w, g.h) < MIN_EDGE && GPID_RE.test(g.src));
    if (!blurry.length) continue;

    let tokens;
    try {
      tokens = await damTokensFor(p.name, [...new Set(blurry.map((b) => gpidOf(b.src)))]);
    } catch (e) {
      failed++;
      report.push({ id: String(p._id), name: p.name, error: `searchspring: ${e.message}` });
      continue;
    }

    const jobs = [];
    for (const b of blurry) {
      const code = gpidOf(b.src);
      const dam = tokens.get(code);
      if (!dam) continue;
      const storedUrl = (p.images || [])[b.index] || "";
      const publicId = publicIdOf(storedUrl);
      if (!publicId) continue;
      try {
        const got = await fetchImage(dam);
        // Only worth the churn if the master is genuinely bigger.
        if (Math.max(got.w, got.h) <= Math.max(b.w, b.h)) continue;
        const shopifyRow = (p.shopifyImages || []).find((s) => s.sourceUrl === storedUrl);
        jobs.push({
          index: b.index,
          code,
          dam,
          publicId,
          storedUrl,
          buf: got.buf,
          from: `${b.w}x${b.h}`,
          to: `${got.w}x${got.h}`,
          mediaId: shopifyRow?.mediaId || "",
          alt: p.name,
        });
      } catch (e) {
        report.push({ id: String(p._id), name: p.name, code, error: `dam: ${e.message}` });
      }
    }

    if (!jobs.length) {
      skipped++;
      continue;
    }

    console.log(`${p.name.slice(0, 70)}`);
    for (const j of jobs) console.log(`   ${j.code}  ${j.from} → ${j.to}`);

    if (DRY) {
      report.push({
        id: String(p._id),
        name: p.name,
        handle,
        replacements: jobs.map((j) => ({ code: j.code, from: j.from, to: j.to, dam: j.dam })),
      });
      fixed++;
      continue;
    }

    try {
      const images = [...(p.images || [])];
      const shopifyImages = (p.shopifyImages || []).map((s) => ({ ...s }));

      // withShopifyOptionImages() renders `images` by looking each entry up in
      // the shopifyImages map and DROPS anything unmatched, so a new Cloudinary
      // URL without its paired row would delete the shot from the gallery
      // rather than sharpen it. Only replace what we can repair on both sides.
      const pairedBefore = new Set((p.shopifyImages || []).map((s) => s.sourceUrl));
      const usable = String(p.shopifyProductId || "").startsWith("gid://shopify/Product/")
        ? jobs.filter((j) => j.mediaId && pairedBefore.has(j.storedUrl))
        : [];
      if (!usable.length) {
        skipped++;
        console.log("   skipped — no Shopify media row to repoint");
        continue;
      }

      // Cloudinary keeps the public id, so only the version in the URL moves on.
      for (const j of usable) {
        const up = await uploadBuffer(j.buf, j.publicId);
        j.cloudinaryUrl = up.secure_url;
        images[j.index] = up.secure_url;
      }

      const media = await replaceShopifyMedia(token, p.shopifyProductId, usable);
      usable.forEach((j, i) => {
        const row = shopifyImages.find((s) => s.sourceUrl === j.storedUrl);
        if (!row) return;
        rollback.push({
          productId: String(p._id),
          sourceUrl: row.sourceUrl,
          shopifyUrl: row.shopifyUrl,
          mediaId: row.mediaId,
        });
        row.sourceUrl = j.cloudinaryUrl;
        row.mediaId = media[i]?.id || row.mediaId;
        row.shopifyUrl = media[i]?.image?.url || row.shopifyUrl;
      });

      // Belt and braces: the gallery must not come out of this shorter than it
      // went in. Count how many entries the renderer could resolve before and
      // after; anything less means we would have blanked a shot.
      const isVideo = (u) => /^youtube:/i.test(String(u));
      const countPaired = (list, pairs) => {
        const keys = new Set(pairs.map((s) => s.sourceUrl));
        return list.filter((u) => isVideo(u) || keys.has(u)).length;
      };
      const before = countPaired(p.images || [], p.shopifyImages || []);
      const after = countPaired(images, shopifyImages);
      if (after < before)
        throw new Error(`refusing to write — gallery would drop from ${before} to ${after}`);

      await db.collection("products").updateOne(
        { _id: p._id },
        { $set: { images, shopifyImages, imagesResharpenedAt: new Date() } },
      );
      fixed++;
      report.push({
        id: String(p._id),
        name: p.name,
        handle,
        replacements: jobs.map((j) => ({ code: j.code, from: j.from, to: j.to, url: j.cloudinaryUrl })),
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
    `\nScanned ${scanned}, ${DRY ? "would fix" : "fixed"} ${fixed}, ` +
      `nothing better available for ${skipped}, failed ${failed}`,
  );
  console.log(`Report written to scripts/${path.basename(REPORT)}`);
  if (rollback.length) console.log(`Rollback written to scripts/${path.basename(ROLLBACK)}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
