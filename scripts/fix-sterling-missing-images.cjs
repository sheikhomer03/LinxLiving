/**
 * Backfill missing Sterlingbuild product images (+ weak description/specs)
 * by re-scraping PDPs from sterlingbuild.co.uk via Jina → Cloudinary.
 *
 * Why images are missing: original import often saved the product with
 * sourceUrl/description but Cloudinary upload or gallery parse returned [].
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/fix-sterling-missing-images.cjs
 *
 * Options: DRY_RUN=1 LIMIT=10 CONCURRENCY=2 MAX_IMAGES=8
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

const BASE = "https://www.sterlingbuild.co.uk";
const CLOUDINARY_FOLDER = "linx-living/products/sterlingbuild";
const LOG = path.join(__dirname, "_tmp-sterling-missing-fix.log");
const PROGRESS = path.join(__dirname, "_tmp-sterling-missing-progress.json");

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 8));
const RESUME = process.env.RESUME === "1";

function log(...args) {
  const line = args.map(String).join(" ");
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(href) {
  if (!href) return null;
  try {
    return new URL(href, BASE).href.split("#")[0].split("?")[0];
  } catch {
    return null;
  }
}

function hasGoodImages(images) {
  return (images || []).some((i) => typeof i === "string" && i.trim());
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchViaJina(url) {
  const endpoint = `https://r.jina.ai/${url}`;
  const res = await fetch(endpoint, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "Mozilla/5.0 LinxLivingImporter/1.0",
    },
  });
  if (!res.ok) throw new Error(`Jina ${res.status} for ${url}`);
  return res.text();
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = String(imageUrl).split("?")[0];
  if (DRY_RUN) return clean;
  const result = await cloudinary.uploader.upload(clean, {
    folder: CLOUDINARY_FOLDER,
    public_id: String(publicId).slice(0, 180),
    overwrite: true,
    resource_type: "image",
  });
  return result.secure_url;
}

function extractCatalogImages(md) {
  const images = [];
  const push = (raw) => {
    let u = String(raw || "").replace(/&amp;/g, "&");
    // Magento sometimes returns relative /media/...
    if (u.startsWith("/media/")) u = BASE + u;
    const abs = absUrl(u);
    if (!abs) return;
    if (!/\/media\/catalog\/product\//i.test(abs)) return;
    if (/placeholder|swatch|icon|logo/i.test(abs)) return;
    const clean = abs.split("?")[0];
    if (!images.includes(clean)) images.push(clean);
  };
  for (const m of md.matchAll(
    /https?:\/\/(?:www\.)?sterlingbuild\.co\.uk\/media\/catalog\/product\/[^\s)"']+/gi,
  )) {
    push(m[0]);
  }
  for (const m of md.matchAll(/\/media\/catalog\/product\/[^\s)"']+/gi)) {
    push(m[0]);
  }
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    push(m[1]);
  }
  return images;
}

function extractProductDescription(md) {
  const junkPara =
    /Skip to Content|Add to Wishlist|Product Code|Markdown Content|URL Source|Title:|We use cookies|Customise Consent|Necessary cookies|Accept All/i;

  let raw = String(md || "");
  const start = raw.search(/Short Description|Product Highlights|Why Choose/i);
  if (start >= 0) raw = raw.slice(start);
  else {
    const paras = String(md || "")
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const prose = paras.find(
      (p) =>
        p.length > 120 &&
        !junkPara.test(p) &&
        !/^!\[/.test(p) &&
        !/^\|/.test(p),
    );
    raw = prose || "";
  }
  if (!raw) return "";

  const cut = raw.search(
    /More Information|From\s*£|Add to Wishlist|Add To Bag|Est\.?\s*delivery|You may also need|Qty\s*-|Choose product options|##\s*Products|We use cookies/i,
  );
  if (cut > 40) raw = raw.slice(0, cut);

  raw = raw
    .replace(/^Short Description\s*/i, "")
    .replace(/^Product Highlights\s*/i, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)"]*\)?/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/https?:\/\/\S+/g, " ");

  const out = cleanText(raw).slice(0, 4000);
  if (!out || out.length < 40 || junkPara.test(out)) return "";
  return out;
}

function parsePrice(text) {
  const raw = String(text || "").replace(/,/g, "");
  const fromPair = raw.match(
    /From\s*£\s*([\d]+(?:\.\d{1,2})?)\s*£\s*([\d]+(?:\.\d{1,2})?)/i,
  );
  if (fromPair) return Math.min(Number(fromPair[1]), Number(fromPair[2]));
  const fromOne = raw.match(/From\s*£\s*([\d]+(?:\.\d{1,2})?)/i);
  if (fromOne) return Number(fromOne[1]);
  const start = Math.max(0, raw.search(/Product Code|More Information/i));
  const endIdx = raw.search(/Add To Bag|You may also need|Est\. delivery/i);
  const slice =
    start >= 0
      ? raw.slice(start, endIdx > start ? endIdx : start + 4000)
      : raw;
  const nums = [...slice.matchAll(/£\s*([\d]+(?:\.\d{1,2})?)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 5);
  if (!nums.length) return 0;
  return Math.min(...nums);
}

function parsePdp(url, md) {
  const name =
    cleanText(
      ((md.match(/^Title:\s*(.+)$/m) || [])[1] || "").replace(
        /\s*\|\s*Sterlingbuild.*$/i,
        "",
      ),
    ) ||
    cleanText((md.match(/^#\s+(.+)$/m) || [])[1] || "");

  let sku = "";
  const skuMatch =
    md.match(/Product Code[:\s|*]*\*?\*?([A-Z0-9][A-Z0-9\-_./]*)/i) ||
    md.match(/\*\*Product Code:\*\*\s*([A-Z0-9][A-Z0-9\-_./]*)/i);
  if (skuMatch) sku = cleanText(skuMatch[1]);

  let description = extractProductDescription(md);
  if (!description || description.length < 40) {
    const paras = md
      .split(/\n\n+/)
      .map((p) =>
        cleanText(
          p
            .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
            .replace(/\[[^\]]*\]\([^)]+\)/g, " "),
        ),
      )
      .filter(
        (p) =>
          p.length > 80 &&
          !/^Title:|^URL Source:|^Markdown|Skip to Content|Add to Wishlist/i.test(
            p,
          ),
      );
    description = paras.slice(0, 2).join("\n\n");
  }

  const specs = {};
  for (const row of md.matchAll(
    /\|\s*\*?\*?([^|]+?)\*?\*?\s*\|\s*([^|]+?)\s*\|/g,
  )) {
    const k = cleanText(row[1]);
    const v = cleanText(row[2]);
    if (!k || !v || /^-+$/.test(k) || /^-+$/.test(v)) continue;
    if (/more information|attribute/i.test(k)) continue;
    if (k.length > 60 || v.length > 200) continue;
    specs[k] = v;
  }

  return {
    url,
    name,
    sku,
    price: parsePrice(md),
    description: (description || "").slice(0, 20000),
    specs,
    images: extractCatalogImages(md).slice(0, MAX_IMAGES),
  };
}

async function resolveUrl(product) {
  const src = product.specs?.sourceUrl;
  if (src && /sterlingbuild\.co\.uk/i.test(src)) {
    return absUrl(src);
  }

  // Try Magento catalog search
  const q = encodeURIComponent(product.name.slice(0, 80));
  try {
    const md = await fetchViaJina(
      `${BASE}/catalogsearch/result/?q=${q}`,
    );
    const links = [
      ...md.matchAll(
        /\]\((https:\/\/www\.sterlingbuild\.co\.uk\/[a-z0-9][a-z0-9\-/]+)\)/gi,
      ),
    ]
      .map((m) => absUrl(m[1]))
      .filter(
        (u) =>
          u &&
          !/\/(catalogsearch|customer|checkout|wishlist|contact|faq|info|media|static)\b/i.test(
            u,
          ) &&
          u.replace(BASE, "").split("/").filter(Boolean).length === 1,
      );
    if (links[0]) return links[0];
  } catch {
    /* ignore */
  }

  // Guess slug from name
  const guess = `${BASE}/${slugify(product.name)}/`;
  return guess;
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

async function main() {
  fs.writeFileSync(
    LOG,
    `Sterling missing image fix ${new Date().toISOString()}\n`,
  );
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
  const brand = await db.collection("brands").findOne({ slug: "sterlingbuild" });
  if (!brand) throw new Error("Sterlingbuild brand not found");

  let products = await db
    .collection("products")
    .find({ brand: brand._id })
    .toArray();
  products = products.filter((p) => !hasGoodImages(p.images));
  if (LIMIT > 0) products = products.slice(0, LIMIT);

  let done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []);
    } catch {
      /* ignore */
    }
  }

  const pending = products.filter((p) => !done.has(String(p._id)));
  log(
    `Fixing ${pending.length} products missing images (of ${products.length})${DRY_RUN ? " DRY" : ""}`,
  );

  let updated = 0;
  let noImages = 0;
  let failed = 0;
  const save = () =>
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );

  await mapPool(pending, CONCURRENCY, async (p, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    try {
      const url = await resolveUrl(p);
      log(`${label} scrape ${url}`);
      const md = await fetchViaJina(url);
      const parsed = parsePdp(url, md);

      const handle =
        slugify(url.replace(BASE, "").replace(/\//g, "")) ||
        slugify(p.name) ||
        String(p._id);

      const uploaded = [];
      for (let i = 0; i < parsed.images.length; i++) {
        try {
          const cloud = await uploadRemoteImage(
            parsed.images[i],
            `fix-${handle}-${i + 1}`,
          );
          if (cloud) uploaded.push(cloud);
        } catch (e) {
          log(`${label} img fail: ${e.message}`);
        }
      }

      if (!uploaded.length) {
        noImages += 1;
        log(`${label} NO IMAGES on PDP: ${p.name}`);
        done.add(String(p._id));
        await delay(400);
        return;
      }

      const set = {
        images: uploaded,
        updatedAt: new Date(),
        "specs.sourceUrl": url,
        "specs.source": p.specs?.source || "sterlingbuild-scrape",
      };
      if (parsed.sku) {
        set["specs.sku"] = parsed.sku;
        set["specs.sterlingSku"] = parsed.sku;
      }
      if (parsed.description && parsed.description.length > (p.description || "").length) {
        set.description = parsed.description;
      }
      if (parsed.price > 0 && (!p.price || p.price < 5 || p.price === 3)) {
        set.price = parsed.price;
      }
      for (const [k, v] of Object.entries(parsed.specs || {})) {
        set[`specs.${k}`] = v;
      }

      if (!DRY_RUN) {
        await db.collection("products").updateOne({ _id: p._id }, { $set: set });
      }
      updated += 1;
      done.add(String(p._id));
      log(
        `${label} ok ${p.name.slice(0, 60)} imgs=${uploaded.length} price=${parsed.price || p.price}`,
      );
      if (updated % 10 === 0) save();
      await delay(350);
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${p.name.slice(0, 50)} ${e.message}`);
      await delay(700);
    }
  });

  save();
  log(
    `\nDone. updated=${updated} noImagesOnSite=${noImages} failed=${failed}`,
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
