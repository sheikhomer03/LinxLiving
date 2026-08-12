/**
 * Re-scrape FULL image galleries for every Cortizo product and replace images[].
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/refresh-cortizo-images.cjs
 *   RESUME=1 CONCURRENCY=2
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

const sharp = require("sharp");
const { v2: cloudinary } = require("cloudinary");
const { connectMongo } = require("./mongo-connect.cjs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BASE = "https://www.cortizo.com";
const CLOUDINARY_FOLDER = "linx-living/products/cortizo";
const CHECKPOINT = path.join(__dirname, "_tmp-cortizo-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-cortizo-img-refresh-progress.json");
const LOG = path.join(__dirname, "_tmp-cortizo-img-refresh.log");

const RESUME = process.env.RESUME === "1";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 40));

const SKIP_IMG =
  /logo|favicon|sprite|icon|avatar|placeholder|data:image|svg\+xml|spinner|tracking|pixel|1x1|dwg_|memoria|linea_|bim_p|term_|acus_|aire_|agua_|viento_|seg_icon|herr_icon|drenaje|accesibilidad|_icon|\/recursos\/cortizofrontend/i;

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () => run()),
  );
}

function absUrl(href, base = BASE) {
  try {
    return new URL(String(href || "").replace(/:443/, "").replace(/&amp;/g, "&"), base)
      .href;
  } catch {
    return null;
  }
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
      Referer: `${BASE}/en/sistemas/familias`,
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchBuffer(url, retries = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          Accept: "image/*,*/*",
          Referer: `${BASE}/en/sistemas/familias`,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("text/html")) throw new Error("not an image (html)");
      return buf;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(500 * attempt);
    }
  }
  throw lastErr;
}

async function uploadImage(buf, publicId) {
  let out = buf;
  if (buf.length > 400_000) {
    out = await sharp(buf)
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: String(publicId).slice(0, 180),
        overwrite: true,
        invalidate: true,
        resource_type: "image",
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(out);
  });
}

function extractGallery(html, pageUrl, thumbUrl) {
  const baseHref = (
    (html.match(/<base[^>]+href=["']([^"']+)["']/i) || [])[1] || ""
  ).replace(/:443/, "");
  const base = baseHref || pageUrl;

  const seen = new Set();
  const urls = [];
  const add = (raw) => {
    if (!raw) return;
    let u = absUrl(raw, base);
    if (!u) return;
    u = u.replace(/-p-\d+(?=\.(?:jpe?g|png|webp))/i, "");
    if (SKIP_IMG.test(u)) return;
    if (!/\.(jpe?g|png|webp)(?:\?|$)/i.test(u)) return;
    const isInline = /\/ficheros\/sistemasinline\//i.test(u);
    const isLanding = /\/ficheros\/sistemas\/landing\//i.test(u);
    if (!isInline && !isLanding) return;
    const key = u.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(u);
  };

  for (const m of html.matchAll(
    /(?:src|data-src)=["'](images\/[^"']+\.(?:jpe?g|png|webp))["']/gi,
  )) {
    add(m[1]);
  }
  for (const m of html.matchAll(/srcset=["']([^"']+)["']/gi)) {
    const parts = m[1].split(",").map((s) => s.trim().split(/\s+/)[0]);
    const last = parts[parts.length - 1];
    if (last) add(last);
  }
  for (const m of html.matchAll(
    /(?:src|data-src|href)=["']([^"']*\/ficheros\/sistemasinline\/[^"']+\.(?:jpe?g|png|webp))["']/gi,
  )) {
    add(m[1]);
  }
  if (!urls.length && thumbUrl) add(thumbUrl);
  return urls.slice(0, MAX_IMAGES);
}

(async () => {
  fs.writeFileSync(LOG, `Cortizo image refresh ${new Date().toISOString()}\n`);
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("Missing Cloudinary credentials");
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = require("mongoose").connection.db;
  const brand = await db.collection("brands").findOne({ slug: "cortizo" });
  if (!brand) throw new Error("Cortizo brand not found");

  // Prefer checkpoint URLs (full catalogue), fall back to Mongo sourceUrl
  let work = [];
  if (fs.existsSync(CHECKPOINT)) {
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    work = (cp.products || []).map((p) => ({
      url: p.url,
      slug: p.slug,
      productId: p.productId,
      thumbUrl: p.thumbUrl || "",
    }));
  }
  if (!work.length) {
    const products = await db
      .collection("products")
      .find({ brand: brand._id })
      .project({ slug: 1, specs: 1 })
      .toArray();
    work = products
      .filter((p) => p.specs?.sourceUrl)
      .map((p) => ({
        url: p.specs.sourceUrl,
        slug: p.slug || p.specs.cortizoHandle,
        productId: p.specs.cortizoProductId,
        thumbUrl: "",
      }));
  }

  let done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []);
    } catch {
      /* ignore */
    }
  }
  const saveProgress = () =>
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );

  const pending = work.filter((w) => !done.has(w.slug || w.productId));
  log(
    `Refreshing galleries for ${pending.length} products (done=${done.size}, concurrency=${CONCURRENCY}, maxImages=${MAX_IMAGES})`,
  );

  let ok = 0;
  let failed = 0;
  let totalFound = 0;
  let totalUploaded = 0;

  await mapPool(pending, CONCURRENCY, async (meta, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    const key = meta.slug || meta.productId;
    try {
      await sleep(300);
      const html = await fetchHtml(meta.url);
      const found = extractGallery(html, meta.url, meta.thumbUrl);
      totalFound += found.length;

      const uploaded = [];
      for (let i = 0; i < found.length; i++) {
        try {
          const buf = await fetchBuffer(found[i]);
          if (buf.length < 5_000) {
            log(`${label} skip tiny ${found[i]}`);
            continue;
          }
          const up = await uploadImage(buf, `${meta.slug}-g${i + 1}`);
          uploaded.push(up.secure_url);
        } catch (e) {
          log(`${label} img fail ${i + 1}/${found.length}: ${e.message}`);
        }
      }
      totalUploaded += uploaded.length;

      if (!uploaded.length) {
        failed += 1;
        log(`${label} FAIL ${meta.slug}: 0 images uploaded (found=${found.length})`);
        return;
      }

      const existing = await db.collection("products").findOne({
        brand: brand._id,
        $or: [
          { "specs.cortizoHandle": meta.slug },
          { "specs.cortizoProductId": meta.productId },
          { slug: meta.slug },
        ],
      });
      if (!existing) {
        failed += 1;
        log(`${label} FAIL ${meta.slug}: product not in Mongo`);
        return;
      }

      await db.collection("products").updateOne(
        { _id: existing._id, brand: brand._id },
        {
          $set: {
            images: uploaded,
            updatedAt: new Date(),
            "specs.galleryRefreshedAt": new Date().toISOString(),
            "specs.gallerySourceCount": found.length,
          },
        },
      );

      ok += 1;
      done.add(key);
      if (ok % 3 === 0) saveProgress();
      log(
        `${label} ok ${meta.slug} found=${found.length} uploaded=${uploaded.length} (was ${(existing.images || []).length})`,
      );
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${key}: ${e.message}`);
    }
  });

  saveProgress();
  log(
    `\nDone. ok=${ok} failed=${failed} totalFound=${totalFound} totalUploaded=${totalUploaded}`,
  );
  await require("mongoose").disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
