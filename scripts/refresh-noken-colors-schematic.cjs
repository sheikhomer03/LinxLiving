/**
 * Refresh Noken colour swatches + Technical information schematic.
 *
 * Source: https://www.noken.com/en/products
 * For each Noken product PDP:
 *   - scrape colour siblings (name, swatch icon, product image)
 *   - scrape Technical information explode PDF → schematicImage
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/refresh-noken-colors-schematic.cjs
 *
 * Options: LIMIT=20 CONCURRENCY=2 DRY_RUN=1 RESUME=1 SKIP_IMAGES=1
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

const BASE = "https://www.noken.com";
const BRAND_SLUG = "noken";
const CLOUDINARY_FOLDER = "linx-living/products/noken";
const PROGRESS = path.join(__dirname, "_tmp-noken-colors-schematic-progress.json");
const LOG = path.join(__dirname, "_tmp-noken-colors-schematic.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const RESUME = process.env.RESUME !== "0";
const ONLY_IDS = String(process.env.ONLY_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function log(...args) {
  const line = args.map(String).join(" ");
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function cleanText(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function http(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
      Referer: `${BASE}/en/products`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx], idx);
      }
    },
  );
  await Promise.all(runners);
}

function sapFromUrl(url) {
  const m = String(url || "").match(/(\d{6,})(?:\.html)?(?:[?#]|$)/);
  return m ? m[1] : "";
}

function catalogProductImage(sap) {
  if (!sap) return "";
  return `https://catalogos.porcelanosagrupo.com/recursos/img/high/${sap}.jpg`;
}

function parseColors(html) {
  const block =
    html.match(
      /<div class=["']colors[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<p class=["']h2|<div class=["']description)/i,
    ) || html.match(/<div class=["']colors[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const chunk = block ? block[1] || block[0] : html;
  const out = [];
  const seen = new Set();
  for (const m of chunk.matchAll(
    /<a href=["'](https:\/\/www\.noken\.com\/en\/products\/[^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>\s*<img[^>]+src=["']([^"']+)["']/gi,
  )) {
    const href = m[1];
    const name = cleanText(m[2]);
    const swatchImage = m[3];
    const sap = sapFromUrl(href);
    if (!name || !sap || seen.has(sap)) continue;
    seen.add(sap);
    out.push({
      name,
      href,
      swatchImage,
      sap,
      imageUrl: catalogProductImage(sap),
    });
  }
  return out;
}

function parseExplodePdf(html) {
  const iframe = html.match(
    /iframe[^>]+src=["']([^"']*(?:Explode|explode)[^"']*)["']/i,
  );
  if (iframe) {
    const src = iframe[1];
    const file = src.match(/[?&]file=([^&"']+)/i);
    if (file) return decodeURIComponent(file[1]);
    if (/\/recursos\/pdf\/explode\//i.test(src)) return src;
  }
  const direct = html.match(
    /(https?:\/\/[^"']*\/recursos\/pdf\/explode\/files\/[^"']+\.pdf)/i,
  );
  if (direct) return direct[1];
  const rel = html.match(/(\/recursos\/pdf\/explode\/files\/[^"']+\.pdf)/i);
  if (rel) return `${BASE}${rel[1]}`;
  return "";
}

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "*/*",
      Referer: `${BASE}/en`,
    },
  });
  if (!res.ok) throw new Error(`download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function uploadBuffer(buffer, publicId, opts = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: publicId.slice(0, 180),
        overwrite: true,
        resource_type: "image",
        ...opts,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = String(imageUrl || "").split("?")[0];
  if (!clean) return "";
  if (SKIP_IMAGES || DRY_RUN) return clean;
  const buffer = await downloadBuffer(clean);
  return uploadBuffer(buffer, publicId);
}

async function uploadExplodeSchematic(pdfUrl, sap) {
  if (!pdfUrl) return "";
  if (SKIP_IMAGES || DRY_RUN) return pdfUrl;
  try {
    // Cloudinary can render PDF page 1 as an image when uploaded as image.
    const result = await cloudinary.uploader.upload(pdfUrl, {
      folder: `${CLOUDINARY_FOLDER}/schematic`,
      public_id: `explode-${sap || "noken"}`.slice(0, 180),
      overwrite: true,
      resource_type: "image",
      format: "jpg",
      pages: true,
      transformation: [{ page: 1, format: "jpg", quality: "auto" }],
    });
    return result.secure_url || pdfUrl;
  } catch (e) {
    log(`  schematic upload fallback pdf url (${e.message})`);
    return pdfUrl;
  }
}

async function enrichFromPdp(sourceUrl, currentSap) {
  const html = await http(sourceUrl);
  const colorsRaw = parseColors(html);
  const explodePdf = parseExplodePdf(html);

  // Ensure current SAP is represented even if colors block is empty.
  if (!colorsRaw.length && currentSap) {
    colorsRaw.push({
      name: "Default",
      href: sourceUrl,
      swatchImage: "",
      sap: currentSap,
      imageUrl: catalogProductImage(currentSap),
    });
  }

  const colorOptions = [];
  for (const [i, c] of colorsRaw.entries()) {
    let imageUrl = c.imageUrl;
    let swatchImage = c.swatchImage;
    try {
      imageUrl = await uploadRemoteImage(
        c.imageUrl,
        `color-${c.sap || i}-product`,
      );
    } catch (e) {
      log(`  color image fail ${c.sap}: ${e.message}`);
    }
    if (c.swatchImage) {
      try {
        swatchImage = await uploadRemoteImage(
          c.swatchImage,
          `color-${c.sap || i}-swatch`,
        );
      } catch {
        /* keep remote swatch */
      }
    }
    colorOptions.push({
      name: c.name,
      swatchType: swatchImage ? "image" : "solid",
      colorValue: swatchImage ? "" : "#cccccc",
      swatchImage: swatchImage || "",
      imageUrl: imageUrl || c.imageUrl || "",
      sap: c.sap || "",
      sortOrder: i,
    });
  }

  const schematicImage = await uploadExplodeSchematic(
    explodePdf,
    currentSap || colorsRaw[0]?.sap || "",
  );

  return {
    colorOptions,
    colours: colorOptions.map((c) => c.name).filter(Boolean),
    schematicImage,
    explodePdf,
  };
}

async function main() {
  fs.writeFileSync(
    LOG,
    `Noken colors+schematic ${new Date().toISOString()}\n`,
  );
  const c = await connectMongo();
  const db = c.db;

  const brand = await db.collection("brands").findOne({
    $or: [{ slug: BRAND_SLUG }, { slug: /^noken$/i }],
  });
  if (!brand) throw new Error("Noken brand not found");

  const filter = ONLY_IDS.length
    ? {
        _id: {
          $in: ONLY_IDS.map((id) => new mongoose.Types.ObjectId(id)),
        },
      }
    : {
        $or: [{ brand: brand._id }, { "specs.source": "noken-scrape" }],
      };
  let products = await db
    .collection("products")
    .find(filter)
    .project({
      name: 1,
      specs: 1,
      schematicImage: 1,
      colorOptions: 1,
      images: 1,
    })
    .toArray();

  // Prefer brand-tagged products; drop accidental extras without sourceUrl
  products = products.filter(
    (p) =>
      String(p.specs?.source || "") === "noken-scrape" ||
      String(p.specs?.sourceUrl || "").includes("noken.com"),
  );

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
    `Noken colors+schematic total=${products.length} pending=${pending.length} concurrency=${CONCURRENCY} skipImages=${SKIP_IMAGES}${DRY_RUN ? " DRY" : ""}`,
  );

  let updated = 0;
  let failed = 0;
  const save = () =>
    fs.writeFileSync(
      PROGRESS,
      JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
    );

  await mapPool(pending, CONCURRENCY, async (p, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    const url = String(p.specs?.sourceUrl || "").trim();
    const sap = String(
      p.specs?.nokenSap || p.specs?.sku || p.specs?.productCode || "",
    ).trim();
    if (!url) {
      log(`${label} skip no sourceUrl ${p.name || p._id}`);
      done.add(String(p._id));
      return;
    }
    try {
      const live = await enrichFromPdp(url, sap);
      if (DRY_RUN) {
        log(
          `${label} [dry] ${sap || "?"} colors=${live.colorOptions.length} schematic=${live.schematicImage ? "yes" : "no"}`,
        );
      } else {
        const $set = {
          colorOptions: live.colorOptions,
          colours: live.colours,
          updatedAt: new Date(),
          "specs.nokenColorsRefreshedAt": new Date().toISOString(),
        };
        if (live.schematicImage) {
          $set.schematicImage = live.schematicImage;
          $set["specs.nokenExplodePdf"] = live.explodePdf || "";
        }
        await db.collection("products").updateOne({ _id: p._id }, { $set });
        log(
          `${label} ok ${sap || "?"} colors=${live.colorOptions.length} schematic=${live.schematicImage ? "1" : "0"}`,
        );
      }
      updated += 1;
      done.add(String(p._id));
      if (updated % 20 === 0) save();
      await delay(120);
    } catch (e) {
      failed += 1;
      log(`${label} FAIL ${url} ${e.message}`);
      await delay(400);
    }
  });

  save();
  log(`Done updated=${updated} failed=${failed}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
