/**
 * Retry image scrape for Noken + Likewise Floors products missing images.
 * Uploads to Cloudinary only (no hotlinks).
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-missing-images-noken-likewise.cjs
 *
 * Options: BRAND=noken|likewisefloors|all  CONCURRENCY=2  DRY_RUN=1  LIMIT=0
 */
const path = require("path");
const fs = require("fs");
const dns = require("dns");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 6));
const BRAND_FILTER = (process.env.BRAND || "all").toLowerCase();
const LOG = path.join(__dirname, "_tmp-fix-noken-likewise-images.log");

function log(...args) {
  const line = args.map(String).join(" ");
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function hasGoodImages(images) {
  // Prefer Cloudinary — Shopify CDN-only galleries count as missing for storefront
  return (images || []).some(
    (i) =>
      typeof i === "string" &&
      i.trim() &&
      /cloudinary\.com/i.test(i),
  );
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function cleanText(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "*/*",
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchViaJina(url) {
  return fetchText(`https://r.jina.ai/${url}`, { Accept: "text/plain" });
}

async function downloadBuffer(imageUrl, referer) {
  const res = await fetch(imageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: referer || "https://www.noken.com/en",
    },
  });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("empty image");
  return buffer;
}

function uploadBuffer(buffer, folder, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: String(publicId).slice(0, 180),
        overwrite: true,
        resource_type: "image",
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

async function uploadImage(imageUrl, folder, publicId, referer) {
  const clean = String(imageUrl).split("?")[0];
  if (DRY_RUN) return clean;
  try {
    // Prefer remote URL upload first (faster)
    const result = await cloudinary.uploader.upload(clean, {
      folder,
      public_id: String(publicId).slice(0, 180),
      overwrite: true,
      resource_type: "image",
    });
    return result.secure_url;
  } catch {
    const buf = await downloadBuffer(clean, referer);
    return uploadBuffer(buf, folder, publicId);
  }
}

function extractNokenImages(html, sap) {
  const found = [];
  const push = (u) => {
    const url = String(u || "").split("?")[0];
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (/favicon|garantias|categoria_|noken\.jpg|icon-/i.test(url)) return;
    if (!found.includes(url)) found.push(url);
  };
  for (const m of html.matchAll(
    /https:\/\/catalogos\.porcelanosagrupo\.com\/recursos\/(?:img|amb)\/high\/[^"'\\\s]+/gi,
  )) {
    push(m[0]);
  }
  if (sap) {
    push(`https://catalogos.porcelanosagrupo.com/recursos/img/high/${sap}.jpg`);
    push(`https://catalogos.porcelanosagrupo.com/recursos/amb/high/${sap}.jpg`);
  }
  return found;
}

function extractLikewiseImages(mdOrHtml) {
  const found = [];
  const push = (u) => {
    const url = String(u || "").split("?")[0];
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (/logo|svg|favicon|likewise_light|likewise-logo/i.test(url)) return;
    if (!/uploads\.likewisefloors\.co\.uk|wp-content\/uploads/i.test(url)) return;
    if (!found.includes(url)) found.push(url);
  };
  for (const m of String(mdOrHtml).matchAll(
    /https:\/\/uploads\.likewisefloors\.co\.uk\/uploads\/[^\s)"']+/gi,
  )) {
    push(m[0]);
  }
  for (const m of String(mdOrHtml).matchAll(
    /https:\/\/likewisefloors\.com\/wp-content\/uploads\/[^\s)"']+/gi,
  )) {
    push(m[0]);
  }
  return found;
}

async function resolveLikewiseImages(product) {
  const url =
    product.specs?.sourceUrl ||
    (product.specs?.likewiseSlug
      ? `https://likewisefloors.com/product/${product.specs.likewiseSlug}/`
      : "");
  const slug =
    product.specs?.likewiseSlug ||
    (url.match(/\/product\/([^/]+)/) || [])[1] ||
    "";

  const images = [];

  // 1) Jina markdown
  if (url) {
    try {
      const md = await fetchViaJina(url);
      for (const img of extractLikewiseImages(md)) images.push(img);
    } catch (e) {
      log(`  jina fail: ${e.message}`);
    }
  }

  // 2) Direct HTML
  if (!images.length && url) {
    try {
      const html = await fetchText(url);
      for (const img of extractLikewiseImages(html)) images.push(img);
    } catch (e) {
      log(`  direct fail: ${e.message}`);
    }
  }

  // 3) WooCommerce store API + media
  if (!images.length && slug) {
    try {
      const data = await fetch(
        `https://likewisefloors.com/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`,
      ).then((r) => r.json());
      const item = Array.isArray(data) ? data[0] : null;
      for (const img of item?.images || []) {
        if (img.src) images.push(String(img.src).split("?")[0]);
      }
      if (item?.id) {
        try {
          const media = await fetch(
            `https://likewisefloors.com/wp-json/wp/v2/media?parent=${item.id}&per_page=10`,
          ).then((r) => r.json());
          for (const m of media || []) {
            const src = m.source_url || m.guid?.rendered;
            if (src) images.push(String(src).split("?")[0]);
          }
        } catch {
          /* ignore */
        }
      }
      // featured media from wp/v2 product
      try {
        const posts = await fetch(
          `https://likewisefloors.com/wp-json/wp/v2/product?slug=${encodeURIComponent(slug)}`,
        ).then((r) => r.json());
        const post = Array.isArray(posts) ? posts[0] : null;
        if (post?.featured_media && post.featured_media > 0) {
          const media = await fetch(
            `https://likewisefloors.com/wp-json/wp/v2/media/${post.featured_media}`,
          ).then((r) => r.json());
          if (media?.source_url) images.push(String(media.source_url).split("?")[0]);
        }
        // yoast / content images
        if (post?.content?.rendered) {
          for (const img of extractLikewiseImages(post.content.rendered)) {
            images.push(img);
          }
        }
        if (post?.yoast_head) {
          for (const img of extractLikewiseImages(post.yoast_head)) {
            images.push(img);
          }
        }
      } catch {
        /* ignore */
      }
    } catch (e) {
      log(`  store api fail: ${e.message}`);
    }
  }

  return [...new Set(images)].slice(0, MAX_IMAGES);
}

async function resolveNokenImages(product) {
  const sap = product.specs?.nokenSap || product.specs?.sku || product.specs?.productCode || "";
  const url = product.specs?.sourceUrl || "";
  const images = [];

  if (url) {
    try {
      const html = await fetchText(url, {
        "Accept-Language": "en-GB,en;q=0.9",
        Referer: "https://www.noken.com/en",
      });
      for (const img of extractNokenImages(html, sap)) images.push(img);
    } catch (e) {
      log(`  noken pdp fail: ${e.message}`);
    }
  }

  if (sap) {
    const candidates = [
      `https://catalogos.porcelanosagrupo.com/recursos/img/high/${sap}.jpg`,
      `https://catalogos.porcelanosagrupo.com/recursos/amb/high/${sap}.jpg`,
      `https://catalogos.porcelanosagrupo.com/recursos/img/high/${sap}.png`,
    ];
    for (const c of candidates) {
      if (!images.includes(c)) images.push(c);
    }
  }

  // Validate candidates quickly (HEAD/GET) — keep ones that download
  const valid = [];
  for (const img of images) {
    if (valid.length >= MAX_IMAGES) break;
    try {
      const res = await fetch(img, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://www.noken.com/en",
          Accept: "image/*,*/*;q=0.8",
        },
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 500) valid.push(img);
      }
    } catch {
      /* skip */
    }
  }
  return valid.slice(0, MAX_IMAGES);
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
}

async function fixBrand(db, slug) {
  const brand = await db.collection("brands").findOne({ slug });
  if (!brand) {
    log(`Brand not found: ${slug}`);
    return { updated: 0, failed: 0, stillMissing: 0 };
  }

  let products = await db.collection("products").find({ brand: brand._id }).toArray();
  products = products.filter((p) => !hasGoodImages(p.images));
  if (LIMIT > 0) products = products.slice(0, LIMIT);

  const folder =
    slug === "noken"
      ? "linx-living/products/noken"
      : "linx-living/products/likewisefloors";
  const referer =
    slug === "noken" ? "https://www.noken.com/en" : "https://likewisefloors.com/";

  log(`\n${slug}: fixing ${products.length} products missing images`);

  let updated = 0;
  let failed = 0;
  let stillMissing = 0;

  await mapPool(products, CONCURRENCY, async (p, idx) => {
    const label = `[${slug} ${idx + 1}/${products.length}]`;
    try {
      log(`${label} ${ (p.name || "").slice(0, 60) }`);
      const candidates =
        slug === "noken"
          ? await resolveNokenImages(p)
          : await resolveLikewiseImages(p);

      if (!candidates.length) {
        stillMissing += 1;
        log(`${label} NO SOURCE IMAGES`);
        return;
      }

      const handle =
        slugify(p.specs?.likewiseSlug || p.specs?.sku || p.specs?.nokenSap || p.name) ||
        String(p._id);
      const uploaded = [];
      for (let i = 0; i < candidates.length; i++) {
        try {
          const url = await uploadImage(
            candidates[i],
            folder,
            `fix-${handle}-${i + 1}`,
            referer,
          );
          if (url) uploaded.push(url);
        } catch (e) {
          log(`${label} upload fail: ${e.message}`);
        }
      }

      if (!uploaded.length) {
        stillMissing += 1;
        log(`${label} UPLOAD FAILED`);
        return;
      }

      if (!DRY_RUN) {
        await db.collection("products").updateOne(
          { _id: p._id },
          { $set: { images: uploaded, updatedAt: new Date() } },
        );
      }
      updated += 1;
      log(`${label} ok imgs=${uploaded.length}`);
      await delay(120);
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${e.message}`);
      await delay(300);
    }
  });

  return { updated, failed, stillMissing };
}

async function main() {
  fs.writeFileSync(LOG, `Fix missing images ${new Date().toISOString()}\n`);
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (
    !DRY_RUN &&
    (!process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET)
  ) {
    throw new Error("Missing Cloudinary credentials");
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const brands =
    BRAND_FILTER === "noken"
      ? ["noken"]
      : BRAND_FILTER === "likewisefloors"
        ? ["likewisefloors"]
        : ["noken", "likewisefloors"];

  const summary = {};
  for (const slug of brands) {
    summary[slug] = await fixBrand(db, slug);
  }

  log(`\nDone ${JSON.stringify(summary)}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
