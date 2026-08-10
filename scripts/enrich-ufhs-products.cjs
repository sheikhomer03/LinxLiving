/**
 * Full re-scrape The Under Floor Heating products from live PDPs:
 * - Gallery (images + YouTube / mp4)
 * - Shopify options / variants (Wattage + Coverage etc.)
 * - Coverage, nested Globo options, Do the Job Right tools
 * - Description, name, vendor, tags, price, availability
 * - PDF / file downloads → public/the-under-floor-heating/downloads/
 * - Measure My Room flag
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/enrich-ufhs-products.cjs
 *   FORCE=1          — re-scrape every product (ignore enrichedAt)
 *   LIMIT=20 CONCURRENCY=2 DRY_RUN=1
 *   UFHS_ONLY_HANDLE=prowarm-electric-underfloor-heating-mat-kit
 *   RESUME=1 CONCURRENCY=1 REQUEST_GAP_MS=400 SKIP_IMAGES=1
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

const BASE = "https://www.theunderfloorheatingstore.com";
const BRAND_SLUG = "the-under-floor-heating";
const CLOUDINARY_FOLDER = "linx-living/products/the-under-floor-heating";
const PUBLIC_DIR = path.join(
  __dirname,
  "..",
  "public",
  "the-under-floor-heating",
);
const LOG = path.join(__dirname, "_tmp-ufhs-enrich.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const FORCE = process.env.FORCE === "1";
const RESUME = !FORCE && process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const ONLY_HANDLE = String(
  process.env.UFHS_ONLY_HANDLE || process.env.ONLY_HANDLE || "",
).trim();
const REQUEST_GAP_MS = Math.max(0, Number(process.env.REQUEST_GAP_MS || 250));
const MAX_RETRIES = Math.max(1, Number(process.env.MAX_RETRIES || 8));

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, init = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxUfhsEnrich/1.1",
          Accept: init.headers?.Accept || "*/*",
          ...(init.headers || {}),
        },
      });
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get("retry-after") || 0);
        const wait =
          (retryAfter > 0 ? retryAfter * 1000 : 1500 * attempt * attempt) +
          Math.floor(Math.random() * 500);
        log(`rate-limit ${res.status} attempt=${attempt}/${MAX_RETRIES} wait=${wait}ms ${url}`);
        await delay(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (/HTTP 404/.test(String(e.message))) throw e;
      if (attempt >= MAX_RETRIES) break;
      const wait = 800 * attempt * attempt;
      log(`fetch retry attempt=${attempt}/${MAX_RETRIES} wait=${wait}ms ${e.message}`);
      await delay(wait);
    }
  }
  throw lastErr || new Error(`Failed ${url}`);
}

async function fetchText(url) {
  const res = await fetchWithRetry(url);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json" },
  });
  return res.json();
}

function absUrl(src) {
  if (!src) return "";
  if (/^https?:/i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  return `${BASE}${src.startsWith("/") ? "" : "/"}${src}`;
}

function ensurePublicDir(...parts) {
  const dir = path.join(PUBLIC_DIR, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = absUrl(imageUrl).split("?")[0];
  if (!clean) return "";
  if (SKIP_IMAGES || DRY_RUN) return clean;
  if (/youtube\.com|youtu\.be/i.test(clean) || /^youtube:/i.test(clean)) {
    return clean;
  }
  try {
    const result = await cloudinary.uploader.upload(clean, {
      folder: CLOUDINARY_FOLDER,
      public_id: String(publicId).slice(0, 180),
      overwrite: FORCE,
      invalidate: FORCE,
      resource_type: "image",
    });
    return result.secure_url || clean;
  } catch {
    return clean;
  }
}

async function downloadFileToPublic(fileUrl, handle, fileName) {
  let clean = absUrl(fileUrl);
  if (!clean) return "";
  clean = clean.split("?")[0];
  const ext = path.extname(clean).toLowerCase() || ".pdf";
  const base =
    slugify(path.parse(fileName || path.basename(clean)).name) || "file";
  const safe = `${base}${ext}`;
  const dir = ensurePublicDir("downloads", slugify(handle) || "misc");
  const dest = path.join(dir, safe);
  const publicPath = `/the-under-floor-heating/downloads/${slugify(handle) || "misc"}/${safe}`;
  if (DRY_RUN) return publicPath;
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0 && !FORCE) {
    return publicPath;
  }
  try {
    const res = await fetchWithRetry(clean);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return publicPath;
  } catch (e) {
    log(`file download fail ${clean}: ${e.message}`);
    return "";
  }
}

function extractPdfLinks(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(
    /<a[^>]+href=["']([^"']+\.pdf[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    let href = absUrl(m[1]);
    href = href.split("?")[0];
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const name =
      String(m[2] || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim() || path.basename(href);
    out.push({ href, name });
  }
  // also bare hrefs in JSON / src
  for (const m of String(html || "").matchAll(
    /https?:\/\/[^"'\\\s>]+\.pdf/gi,
  )) {
    const href = m[0].split("?")[0];
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, name: path.basename(href) });
  }
  return out;
}

async function uploadNestedImages(fields, handle, prefix = "opt") {
  const out = [];
  for (let i = 0; i < (fields || []).length; i++) {
    const f = fields[i];
    const choices = [];
    for (let j = 0; j < (f.choices || []).length; j++) {
      const c = f.choices[j];
      let imageUrl = c.imageUrl || "";
      if (imageUrl && !/^youtube:/i.test(imageUrl)) {
        imageUrl = await uploadRemoteImage(
          imageUrl,
          `${handle}-${prefix}-${i}-${j}`,
        );
      }
      const nested = await uploadNestedImages(
        c.nested || [],
        handle,
        `${prefix}-${i}-${j}`,
      );
      choices.push({ ...c, imageUrl, nested });
    }
    out.push({ ...f, choices });
  }
  return out;
}

function extractGpoOptionsMap(html) {
  const map = {};
  const re = /GPOConfigs\.options\[(\d+)\]\s*=\s*/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    const start = m.index + m[0].length;
    if (html[start] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = start; j < html.length; j++) {
      const ch = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            map[id] = JSON.parse(html.slice(start, j + 1));
          } catch {
            /* skip */
          }
          break;
        }
      }
    }
  }
  return map;
}

function choiceImage(c) {
  if (!c || typeof c !== "object") return "";
  if (c.asset_name) {
    return `https://www.theunderfloorheatingstore.com/cdn/shop/files/${c.asset_name}`;
  }
  return (
    c.image ||
    c.img ||
    c.src ||
    c.swatch ||
    c.thumbnail ||
    c.image_url ||
    (typeof c.image_src === "string" ? c.image_src : "") ||
    c?.image?.src ||
    c?.value?.src ||
    ""
  );
}

function simplifyElements(elements) {
  const out = [];
  for (const [i, el] of (elements || []).entries()) {
    if (!el || typeof el !== "object") continue;
    const type = String(el.type || "");
    if (/^(spacing|paragraph|html|modal|icon)$/i.test(type)) continue;
    const label = String(el.label || el.label_en || el.name || "").trim();
    if (!label && type !== "group") continue;

    const childElements = Array.isArray(el.elements) ? el.elements : [];
    const rawChoices =
      el.option_values ||
      el.options ||
      el.values ||
      el.swatches ||
      el.items ||
      el.list ||
      [];
    const choices = [];
    for (const c of rawChoices) {
      if (typeof c === "string") {
        if (!c.trim()) continue;
        choices.push({
          label: c.trim(),
          value: c.trim(),
          imageUrl: "",
          priceAdjustment: 0,
          helptext: "",
          nested: [],
        });
        continue;
      }
      if (!c || typeof c !== "object") continue;
      const cLabel = String(
        c.value_en ||
          c.value ||
          c.label ||
          c.label_en ||
          c.name ||
          c.title ||
          "",
      ).trim();
      if (!cLabel || /^\d+$/.test(cLabel)) {
        // name is sometimes a numeric asset id — prefer value fields already tried
        if (!String(c.value_en || c.value || "").trim()) continue;
      }
      const labelFinal = String(c.value_en || c.value || cLabel).trim();
      if (!labelFinal) continue;
      const price =
        Number(
          c.variant_price ??
            c.price ??
            c.price_adjustment ??
            c.amount ??
            c.addon_price ??
            0,
        ) || 0;
      // Globo pennies only when clearly integer pennies (no decimal, large)
      const priceAdjustment =
        Number.isInteger(price) && price > 200 ? Math.round(price) / 100 : price;
      const img =
        choiceImage(c) ||
        c?.image?.src ||
        c?.img_url ||
        (Array.isArray(c.images) ? c.images[0] : "") ||
        "";
      choices.push({
        label: labelFinal,
        value: String(c.value ?? c.id ?? labelFinal),
        imageUrl: absUrl(String(img || "")),
        priceAdjustment,
        helptext: String(c.helptext || c.helptext_en || "").trim(),
        nested: simplifyElements(c.elements || c.children || []),
      });
    }

    if (type === "group" && childElements.length) {
      out.push(...simplifyElements(childElements));
      continue;
    }

    out.push({
      id: String(el.id || `field-${i}`),
      label: label || "Options",
      helptext: String(el.helptext || el.helptext_en || "").trim(),
      type: type || "image-swatches",
      required: Boolean(el.required),
      sortOrder: i,
      choices,
    });
  }
  // Globo often repeats the same conditional field (e.g. 4× "Accessory Kit").
  const seen = new Set();
  return out.filter((field) => {
    const sig = `${String(field.label || "")
      .trim()
      .toLowerCase()}::${(field.choices || [])
      .map((c) => `${c.label}|${c.priceAdjustment || 0}`)
      .join("||")}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

function pickBestGpoSet(map, productId, handle) {
  const idStr = String(productId || "");
  const matching = [];
  for (const [setId, obj] of Object.entries(map)) {
    const raw = JSON.stringify(obj);
    if (
      (idStr && raw.includes(idStr)) ||
      (handle && raw.includes(handle))
    ) {
      matching.push({ setId, obj, raw });
    }
  }
  if (!matching.length) return null;
  matching.sort((a, b) => {
    const score = (x) =>
      (/Do the Job Right/i.test(x.raw) ? 1000 : 0) +
      (/Thermostat/i.test(x.raw) ? 100 : 0) +
      x.raw.length;
    return score(b) - score(a);
  });
  return matching[0];
}

function extractDoTheJob(fields) {
  for (const field of fields || []) {
    if (/do the job right|tools and testing/i.test(field.label || "")) {
      return {
        label: field.label,
        helptext: field.helptext || "",
        items: (field.choices || []).map((c, i) => ({
          name: c.label,
          imageUrl: c.imageUrl || "",
          priceAdjustment: c.priceAdjustment || 0,
          description: c.helptext || "",
          sortOrder: i,
        })),
      };
    }
    for (const choice of field.choices || []) {
      const nested = extractDoTheJob(choice.nested || []);
      if (nested) return nested;
    }
  }
  return null;
}

function stripDoTheJob(fields) {
  return (fields || [])
    .filter((f) => !/do the job right|tools and testing/i.test(f.label || ""))
    .map((f) => ({
      ...f,
      choices: (f.choices || []).map((c) => ({
        ...c,
        nested: stripDoTheJob(c.nested || []),
      })),
    }));
}

function buildGallery(productJs) {
  const urls = [];
  const media = productJs.media || [];
  if (media.length) {
    for (const m of media) {
      if (m.media_type === "external_video" && m.host === "youtube" && m.external_id) {
        urls.push(`youtube:${m.external_id}`);
        continue;
      }
      if (m.media_type === "video") {
        const src = (m.sources || []).find((s) => /mp4/i.test(s.format || s.url || ""))?.url
          || (m.sources || [])[0]?.url;
        if (src) urls.push(src);
        continue;
      }
      const src = m.src || m.preview_image?.src;
      if (src) urls.push(absUrl(src));
    }
  } else {
    for (const img of productJs.images || []) {
      const src = typeof img === "string" ? img : img.src;
      if (src) urls.push(absUrl(src));
    }
  }
  // de-dupe preserve order
  const seen = new Set();
  return urls.filter((u) => {
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function main() {
  if (RESUME) {
    fs.appendFileSync(LOG, `\nUFHS enrich RESUME ${new Date().toISOString()}\n`);
  } else {
    fs.writeFileSync(LOG, `UFHS enrich ${new Date().toISOString()}\n`);
  }
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: BRAND_SLUG });
  if (!brand) throw new Error("Brand not found");

  const filter = {
    brand: brand._id,
    ...(ONLY_HANDLE
      ? { "specs.ufhsHandle": ONLY_HANDLE }
      : { "specs.ufhsHandle": { $exists: true, $ne: "" } }),
    ...(RESUME && !ONLY_HANDLE
      ? {
          $or: [
            { "specs.enrichedAt": { $exists: false } },
            { "specs.enrichedAt": null },
            { "specs.enrichedAt": "" },
          ],
        }
      : {}),
  };
  let products = await db.collection("products").find(filter).toArray();
  if (LIMIT > 0) products = products.slice(0, LIMIT);
  ensurePublicDir("downloads");
  log(
    `Enriching ${products.length} products concurrency=${CONCURRENCY} force=${FORCE ? 1 : 0} resume=${RESUME ? 1 : 0} gap=${REQUEST_GAP_MS}ms`,
  );

  let ok = 0;
  let fail = 0;

  await mapPool(products, CONCURRENCY, async (product, idx) => {
    const handle = String(product.specs?.ufhsHandle || "").trim();
    const label = `[${idx + 1}/${products.length}]`;
    if (!handle) {
      log(`${label} skip no handle ${product.name}`);
      return;
    }
    try {
      // Sequential fetches reduce burst 429s vs Promise.all
      const productJs = await fetchJson(`${BASE}/products/${handle}.js`);
      await delay(REQUEST_GAP_MS);
      const html = await fetchText(`${BASE}/products/${handle}`);
      await delay(REQUEST_GAP_MS);

      const galleryRemote = buildGallery(productJs);
      const gallery = [];
      for (let i = 0; i < galleryRemote.length; i++) {
        const src = galleryRemote[i];
        if (/^youtube:/i.test(src) || /\.mp4(\?|$)/i.test(src)) {
          gallery.push(src);
        } else {
          gallery.push(await uploadRemoteImage(src, `${handle}-g${i + 1}`));
        }
      }

      const shopifyOptions = (productJs.options || [])
        .map((o, i) => {
          if (typeof o === "string") {
            return { name: o, position: i + 1, values: [] };
          }
          return {
            name: String(o.name || "").trim(),
            position: Number(o.position) || i + 1,
            values: (o.values || []).map((v) => String(v)),
          };
        })
        .filter((o) => o.name && !/^title$/i.test(o.name));

      // Fill option values from variants when missing
      for (const axis of shopifyOptions) {
        if (axis.values.length) continue;
        const set = new Set();
        for (const v of productJs.variants || []) {
          const val =
            axis.position === 1
              ? v.option1
              : axis.position === 2
                ? v.option2
                : v.option3;
          if (val) set.add(String(val));
        }
        axis.values = [...set];
      }

      const variants = (productJs.variants || []).map((v) => ({
        name: String(v.title || v.name || "").trim(),
        sku: String(v.sku || "").trim(),
        option1: String(v.option1 || "").trim(),
        option2: String(v.option2 || "").trim(),
        option3: String(v.option3 || "").trim(),
        price: Number(v.price) > 0 ? Math.round(Number(v.price)) / 100 : 0,
        available: v.available !== false,
        imageUrl: "",
        options: {
          ...(v.option1 ? { [shopifyOptions[0]?.name || "option1"]: v.option1 } : {}),
          ...(v.option2 ? { [shopifyOptions[1]?.name || "option2"]: v.option2 } : {}),
          ...(v.option3 ? { [shopifyOptions[2]?.name || "option3"]: v.option3 } : {}),
        },
        isDefault: false,
      }));
      if (variants[0]) variants[0].isDefault = true;

      const coverageAxis = shopifyOptions.find((o) =>
        /coverage/i.test(o.name),
      );
      const coverage = coverageAxis
        ? {
            label: coverageAxis.name || "Coverage",
            helptext: "",
            values: coverageAxis.values.map((name, i) => ({
              name,
              imageUrl: "",
              priceAdjustment: 0,
              sku: "",
              sortOrder: i,
            })),
          }
        : { label: "Coverage", helptext: "", values: [] };

      const gpoMap = extractGpoOptionsMap(html);
      const best = pickBestGpoSet(gpoMap, productJs.id, handle);
      let nestedOptions = [];
      let doTheJobRight = {
        label: "Do the Job Right - Tools and Testing Equipment",
        helptext: "",
        items: [],
      };
      if (best?.obj) {
        nestedOptions = simplifyElements(best.obj.elements || []);
        const job = extractDoTheJob(nestedOptions);
        if (job) {
          doTheJobRight = job;
          nestedOptions = stripDoTheJob(nestedOptions);
        }
      }
      nestedOptions = await uploadNestedImages(nestedOptions, handle, "gpo");
      if (doTheJobRight.items?.length) {
        for (let ti = 0; ti < doTheJobRight.items.length; ti++) {
          const item = doTheJobRight.items[ti];
          if (item.imageUrl) {
            item.imageUrl = await uploadRemoteImage(
              item.imageUrl,
              `${handle}-tool-${ti + 1}`,
            );
          }
        }
      }

      const description =
        String(productJs.description || "")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .trim() || product.description;

      const price =
        variants.find((v) => v.available && v.price > 0)?.price ||
        variants[0]?.price ||
        product.price;

      const compareAt =
        Number(productJs.compare_at_price) > 0
          ? Math.round(Number(productJs.compare_at_price)) / 100
          : null;

      const hasMeasureMyRoom =
        /Measure My Room|room-calc-modal-app|rmc-open/i.test(html);

      const tags = Array.isArray(productJs.tags)
        ? productJs.tags.map(String)
        : String(productJs.tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);

      // PDFs → public folder + schema downloads / guides / brochures
      const pdfLinks = extractPdfLinks(html);
      const downloads = [];
      const installationMaintenanceGuides = [];
      const brochures = [];
      for (const f of pdfLinks.slice(0, 20)) {
        const local = await downloadFileToPublic(f.href, handle, f.name);
        if (!local) continue;
        const title = f.name.replace(/\.pdf$/i, "").trim() || "Download";
        const isInstall = /install|guide|manual|instruction/i.test(title + f.href);
        const isBrochure = /brochure|catalogue|catalog|range/i.test(
          title + f.href,
        );
        downloads.push({
          title,
          url: local,
          type: isInstall ? "install" : "pdf",
        });
        if (isInstall) {
          installationMaintenanceGuides.push({ name: title, url: local });
        } else if (isBrochure) {
          brochures.push({ name: title, url: local });
        } else {
          installationMaintenanceGuides.push({ name: title, url: local });
        }
      }

      const videos = gallery.filter(
        (u) => /^youtube:/i.test(u) || /\.mp4(\?|$)/i.test(u),
      );
      const available = productJs.available !== false;
      const stock = available
        ? Math.max(Number(product.stock) || 0, 25)
        : 0;

      const specs = {
        ...(product.specs || {}),
        ufhsHandle: handle,
        ufhsId: productJs.id,
        sourceUrl: `${BASE}/products/${handle}`,
        vendorBrand: productJs.vendor || product.specs?.vendorBrand || "",
        productType: productJs.type || "",
        tags: tags.slice(0, 60),
        gpoSetId: best?.setId || "",
        galleryHasVideo: videos.length > 0,
        hasMeasureMyRoom,
        shopifyCompareAt: compareAt,
        available,
        priceMin:
          Number(productJs.price_min) > 0
            ? Math.round(Number(productJs.price_min)) / 100
            : price,
        priceMax:
          Number(productJs.price_max) > 0
            ? Math.round(Number(productJs.price_max)) / 100
            : price,
        enrichedAt: new Date().toISOString(),
        fullParityAt: new Date().toISOString(),
      };

      const $set = {
        name: String(productJs.title || product.name).trim() || product.name,
        description: description.slice(0, 50000),
        tagline: String(productJs.vendor || product.tagline || "").trim(),
        price,
        images: gallery.length ? gallery : product.images,
        videos,
        shopifyOptions,
        variants,
        coverage,
        nestedOptions,
        doTheJobRight,
        downloads,
        installationMaintenanceGuides,
        brochures,
        keywords: tags.slice(0, 40),
        stock,
        stockStatus: available ? "in_stock" : "out_of_stock",
        isOutOfStock: !available,
        stockAvailabilityText: available ? "In stock" : "Out of stock",
        specs,
        showSpecs: true,
        updatedAt: new Date(),
        priceSyncedAt: new Date(),
        stockSyncedAt: new Date(),
      };

      log(
        `${label} ${DRY_RUN ? "[dry] " : ""}${$set.name} opts=${shopifyOptions.map((o) => o.name).join("+") || "-"} vars=${variants.length} media=${gallery.length} nested=${nestedOptions.length} tools=${doTheJobRight.items.length} files=${downloads.length} measure=${hasMeasureMyRoom ? 1 : 0} gpo=${best?.setId || "-"}`,
      );

      if (!DRY_RUN) {
        await db.collection("products").updateOne({ _id: product._id }, { $set });
      }
      ok++;
    } catch (e) {
      fail++;
      log(`${label} ✗ ${handle}: ${e.message}`);
    }
  });

  log(`Done. ok=${ok} fail=${fail}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
