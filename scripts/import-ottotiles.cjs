/**
 * Scrape https://www.ottotiles.co.uk → Living Mongo + Cloudinary
 *
 * Creates brand "Otto Tiles", category/subcategory menus (brand-scoped),
 * and products with galleries, specs, Delivery / How It's Made /
 * Product and Sample Orders / Installation & Maintenance Guides / Usage.
 *
 * Usage:
 *   node --require ./scripts/mongo-dns.cjs scripts/import-ottotiles.cjs
 *
 * Options:
 *   DRY_RUN=1 LIMIT=20 CONCURRENCY=2 SKIP_IMAGES=1 RESUME=1 DISCOVER_ONLY=1
 *   CALC_ONLY=1  — refresh tilesPerBox / tilesPerSqm / sample / lead time / size
 *                  on existing Otto products (no image re-upload)
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

const BASE = "https://www.ottotiles.co.uk";
const BRAND_SLUG = "otto-tiles";
const BRAND_NAME = "Otto Tiles";
const SOURCE_TAG = "ottotiles-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/otto-tiles";
const CHECKPOINT = path.join(__dirname, "_tmp-otto-urls.json");
const PROGRESS = path.join(__dirname, "_tmp-otto-progress.json");
const LOG = path.join(__dirname, "_tmp-otto-import.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const DISCOVER_ONLY = process.env.DISCOVER_ONLY === "1";
const REMAP_ONLY = process.env.REMAP_ONLY === "1";
const CALC_ONLY = process.env.CALC_ONLY === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 12));
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 25);

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Otto mega-menu — matches https://www.ottotiles.co.uk/ nav groups.
 * Brand-scoped like Fakro (own menu row per brand).
 *
 * Signature Collection → 4 subs: Cement / Zellige / Ceramic / Marble
 * Encaustic Cement   → 3 subs: All Cement / Patterned / Plain
 * (Leaves under those groups are nested menus; product.subCategory = group slug.)
 */
const MENU_TREE = [
  {
    name: "Signature Collection",
    slug: "signature-collection",
    children: [
      {
        name: "Cement",
        slug: "cement",
        children: [
          { name: "Kismet", handle: "signature-kismet-collection" },
          { name: "Stripes", handle: "cement-signature-stripes" },
          { name: "Sunny", handle: "sunny-collection" },
          { name: "Starry", handle: "starry-night-collection" },
        ],
      },
      {
        name: "Zellige",
        slug: "zellige",
        children: [
          { name: "Mediterranean", handle: "marrakesh-tiles" },
          { name: "Patterned", handle: "patterned-zellige-tiles" },
          { name: "Mosaics", handle: "signature-mosaic-zellige-tiles" },
          { name: "Kit Kat", handle: "kit-kat-zellige-tiles" },
        ],
      },
      {
        name: "Ceramic",
        slug: "ceramic",
        children: [
          { name: "Stoneform", handle: "ceramic-stoneform-tiles" },
          { name: "Urban Earth", handle: "ceramic-urban-earth-tiles" },
          { name: "Masona", handle: "ceramic-masona-tiles" },
          { name: "Echoes", handle: "ceramic-echoes-tiles" },
          { name: "Artisan Matt", handle: "ceramic-artisan-matt-tiles" },
          { name: "Piazza", handle: "ceramic-piazza-tiles" },
        ],
      },
      {
        name: "Marble",
        slug: "marble",
        handle: "signature-marble-collection-tiles",
        children: [],
      },
    ],
  },
  {
    name: "Encaustic Cement",
    slug: "encaustic-cement",
    children: [
      {
        name: "All Cement",
        slug: "all-cement",
        handle: "cement-tiles",
        children: [],
      },
      {
        name: "Patterned",
        slug: "patterned",
        handle: "patterned-cement-tiles",
        children: [
          { name: "Kismet", handle: "signature-kismet-collection" },
          { name: "Geometric", handle: "geometric-cement-tiles" },
          { name: "Victorian", handle: "victorian-tiles" },
          { name: "Hex", handle: "hex-patterned-cement-tiles" },
        ],
      },
      {
        name: "Plain",
        slug: "plain",
        handle: "plain-tiles",
        children: [
          { name: "Square", handle: "square-plain-cement-tiles" },
          { name: "Herringbone", handle: "herringbone-tiles" },
          { name: "Hex", handle: "hexagon-tiles" },
        ],
      },
    ],
  },
  {
    name: "Zellige & Bejmat",
    slug: "zellige-and-bejmat",
    children: [
      {
        name: "All Zellige & Bejmat",
        slug: "all-zellige-and-bejmat",
        handle: "zellige-and-bejmat-tiles",
        children: [],
      },
      {
        name: "Plain",
        slug: "plain",
        handle: "plain-zellige-and-bejmat-tiles",
        children: [],
      },
      {
        name: "Patterned",
        slug: "patterned",
        handle: "patterned-zellige-tiles",
        children: [],
      },
      {
        name: "Mosaics",
        slug: "mosaics",
        handle: "signature-mosaic-zellige-tiles",
        children: [],
      },
    ],
  },
  {
    name: "Ceramic",
    slug: "ceramic",
    children: [
      {
        name: "All Ceramic",
        slug: "all-ceramic",
        handle: "ceramic-tiles",
        children: [],
      },
      {
        name: "Terrena",
        slug: "terrena",
        handle: "ceramic-terrena-collection",
        children: [
          { name: "Square", handle: "ceramic-square-tiles" },
          { name: "Rectangle", handle: "ceramic-rectangle-tiles" },
        ],
      },
      {
        name: "Turkish",
        slug: "turkish",
        handle: "turkish-tiles",
        children: [],
      },
      {
        name: "Fish Scale",
        slug: "fish-scale",
        handle: "fish-scale-tiles",
        children: [],
      },
    ],
  },
  {
    name: "Marble",
    slug: "marble",
    children: [
      {
        name: "Signature",
        slug: "signature",
        handle: "signature-marble-collection-tiles",
        children: [],
      },
    ],
  },
  {
    name: "Terrazzo",
    slug: "terrazzo",
    children: [
      {
        name: "All Terrazzo",
        slug: "all-terrazzo",
        handle: "terrazzo-tiles",
        children: [],
      },
      {
        name: "Premium",
        slug: "premium",
        handle: "premium-terrazzo-tiles",
        children: [],
      },
      {
        name: "Exclusive",
        slug: "exclusive",
        handle: "exclusive-terrazzo-tiles",
        children: [],
      },
      {
        name: "Artisan",
        slug: "artisan",
        handle: "artisan-terrazzo-tiles",
        children: [],
      },
    ],
  },
];

/** Flatten leaf handles → { top, group, leaf, handle } for product mapping. */
function flattenMenuLeaves() {
  const rows = [];
  for (const top of MENU_TREE) {
    for (const group of top.children || []) {
      const groupSlug = group.slug || slugify(group.name);
      const leaves = group.children || [];
      if (group.handle) {
        rows.push({
          topSlug: top.slug,
          topName: top.name,
          groupSlug,
          groupName: group.name,
          leafSlug: groupSlug,
          leafName: group.name,
          handle: group.handle,
          depth: "group",
        });
      }
      for (const leaf of leaves) {
        if (!leaf.handle) continue;
        rows.push({
          topSlug: top.slug,
          topName: top.name,
          groupSlug,
          groupName: group.name,
          leafSlug: leaf.slug || slugify(leaf.name),
          leafName: leaf.name,
          handle: leaf.handle,
          depth: "leaf",
        });
      }
    }
  }
  return rows;
}

/**
 * Prefer Signature Collection leaves, then specific Encaustic/Zellige leaves,
 * then broad "all" collections last.
 */
const HANDLE_PRIORITY = (() => {
  const leaves = flattenMenuLeaves();
  const signature = leaves.filter((r) => r.topSlug === "signature-collection");
  const otherLeaf = leaves.filter(
    (r) => r.topSlug !== "signature-collection" && r.depth === "leaf",
  );
  const otherGroup = leaves.filter(
    (r) => r.topSlug !== "signature-collection" && r.depth === "group",
  );
  const order = [];
  const seen = new Set();
  for (const row of [...signature, ...otherLeaf, ...otherGroup]) {
    if (seen.has(row.handle + "::" + row.topSlug)) continue;
    seen.add(row.handle + "::" + row.topSlug);
    order.push(row);
  }
  return order;
})();

/** Temporary / alternate top-level slugs to deactivate (not in MENU_TREE). */
const OBSOLETE_TOP_SLUGS = ["kit-kat-zellige"];

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/&#822[01];|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/ol>|<\/ul>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function absUrl(url) {
  let u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("//")) u = "https:" + u;
  if (u.startsWith("/")) u = BASE + u;
  return u.split("?")[0];
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxLivingOttoImporter/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 LinxLivingOttoImporter/1.0",
      Accept: "*/*",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function uploadRemoteImage(imageUrl, publicId) {
  const clean = absUrl(imageUrl);
  if (!clean || !/^https?:\/\//i.test(clean)) return "";
  if (SKIP_IMAGES || DRY_RUN) return clean;
  const result = await cloudinary.uploader.upload(clean, {
    folder: CLOUDINARY_FOLDER,
    public_id: String(publicId).slice(0, 180),
    overwrite: true,
    resource_type: "image",
  });
  return result.secure_url;
}

async function uploadRemoteFile(fileUrl, publicId) {
  const clean = String(fileUrl || "").split("?")[0];
  if (!clean || !/^https?:\/\//i.test(clean)) return "";
  if (SKIP_IMAGES || DRY_RUN) return clean;
  const result = await cloudinary.uploader.upload(clean, {
    folder: `${CLOUDINARY_FOLDER}/guides`,
    public_id: String(publicId).slice(0, 180),
    overwrite: true,
    resource_type: "raw",
  });
  return result.secure_url;
}

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: BRAND_SLUG });
  const now = new Date();
  if (!brand) {
    const insert = {
      name: BRAND_NAME,
      slug: BRAND_SLUG,
      order: 75,
      isActive: true,
      image: "",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      brand = { ...insert, _id: "dry-brand" };
      log("[dry] create brand", BRAND_NAME);
    } else {
      const r = await brands.insertOne(insert);
      brand = { ...insert, _id: r.insertedId };
      log(`Created brand ${BRAND_NAME} (${brand._id})`);
    }
  } else {
    log(`Using brand ${brand.name} (${brand._id})`);
    if (!DRY_RUN) {
      await brands.updateOne(
        { _id: brand._id },
        { $set: { isActive: true, name: BRAND_NAME, updatedAt: now } },
      );
    }
  }
  return brand;
}

async function ensureMenu(db, { name, slug, parent, brandId, order, image }) {
  const menus = db.collection("menus");
  // CRITICAL: always scope by brand — never reuse another brand's same-name
  // category (Fakro "Pitched Roof Windows" pattern).
  if (!brandId) {
    throw new Error("ensureMenu requires brandId (brand-scoped menus only)");
  }
  const query = parent
    ? { slug, parent, brand: brandId }
    : { slug, parent: null, brand: brandId };
  let menu = DRY_RUN ? null : await menus.findOne(query);
  const now = new Date();
  if (!menu) {
    const insert = {
      name,
      slug,
      parent: parent || null,
      brand: brandId,
      order: order ?? 0,
      isActive: true,
      image: image || "",
      level: parent ? "subcategory" : "category",
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      menu = { ...insert, _id: `dry-${slug}` };
    } else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
      log(`+ menu ${parent ? "sub" : "cat"} ${name} [otto brand-scoped]`);
    }
  } else if (!DRY_RUN) {
    const set = {
      name,
      brand: brandId,
      isActive: true,
      updatedAt: now,
      order: order ?? menu.order,
    };
    if (image && (!menu.image || process.env.FORCE_MENU_IMAGE === "1")) {
      set.image = image;
    }
    await menus.updateOne({ _id: menu._id }, { $set: set });
    menu = { ...menu, ...set };
  }
  return menu;
}

async function deactivateObsoleteOttoMenus(db, brandId) {
  if (DRY_RUN || !brandId) return;
  const menus = db.collection("menus");
  const r = await menus.updateMany(
    {
      brand: brandId,
      parent: null,
      slug: { $in: OBSOLETE_TOP_SLUGS },
    },
    { $set: { isActive: false, updatedAt: new Date() } },
  );
  if (r.modifiedCount) {
    log(`Deactivated obsolete Otto top menus: ${r.modifiedCount}`);
  }
  // Also deactivate their children
  const obsoleteParents = await menus
    .find({ brand: brandId, slug: { $in: OBSOLETE_TOP_SLUGS } })
    .project({ _id: 1 })
    .toArray();
  const ids = obsoleteParents.map((m) => m._id);
  if (ids.length) {
    const c = await menus.updateMany(
      { brand: brandId, parent: { $in: ids } },
      { $set: { isActive: false, updatedAt: new Date() } },
    );
    if (c.modifiedCount) {
      log(`Deactivated obsolete Otto sub menus: ${c.modifiedCount}`);
    }
  }
}

async function fetchAllShopifyProducts() {
  const out = [];
  for (let page = 1; page <= 30; page++) {
    const j = await fetchJson(
      `${BASE}/products.json?limit=250&page=${page}`,
    );
    const rows = j.products || [];
    out.push(...rows);
    log(`Shopify products page ${page}: +${rows.length} (total ${out.length})`);
    if (rows.length < 250) break;
    await delay(150);
  }
  return out;
}

async function buildHandleToCollections() {
  /** @type {Map<string, Set<string>>} */
  const map = new Map();
  const handles = new Set();
  for (const cat of MENU_TREE) {
    for (const child of cat.children) handles.add(child.handle);
  }

  for (const handle of handles) {
    try {
      for (let page = 1; page <= 20; page++) {
        const j = await fetchJson(
          `${BASE}/collections/${handle}/products.json?limit=250&page=${page}`,
        );
        const rows = j.products || [];
        for (const p of rows) {
          if (!map.has(p.handle)) map.set(p.handle, new Set());
          map.get(p.handle).add(handle);
        }
        if (rows.length < 250) break;
        await delay(80);
      }
      log(`Mapped collection ${handle}`);
    } catch (e) {
      log(`collection map warn ${handle}:`, e.message);
    }
  }
  return map;
}

function resolveCategory(shopifyProduct, collectionHandles) {
  const set = collectionHandles || new Set();
  for (const row of HANDLE_PRIORITY) {
    if (!set.has(row.handle)) continue;
    return {
      categorySlug: row.topSlug,
      categoryName: row.topName,
      // UI subcategory = Otto nav group (Cement / Patterned / Terrena …)
      subSlug: row.groupSlug,
      subName: row.groupName,
      leafSlug: row.leafSlug,
      leafName: row.leafName,
      collectionHandle: row.handle,
    };
  }

  // Fallback from product_type / title
  const type = String(shopifyProduct?.product_type || "").toLowerCase();
  const title = String(
    shopifyProduct?.title || shopifyProduct?.handle || "",
  ).toLowerCase();
  if (/kit\s*kat|kit-kat/.test(type) || /kit\s*kat|kit-kat/.test(title)) {
    return {
      categorySlug: "signature-collection",
      categoryName: "Signature Collection",
      subSlug: "zellige",
      subName: "Zellige",
      leafSlug: "kit-kat",
      leafName: "Kit Kat",
      collectionHandle: "kit-kat-zellige-tiles",
    };
  }
  if (/terrazzo/.test(type) || /terrazzo/.test(title)) {
    return {
      categorySlug: "terrazzo",
      categoryName: "Terrazzo",
      subSlug: "all-terrazzo",
      subName: "All Terrazzo",
      collectionHandle: "terrazzo-tiles",
    };
  }
  if (/cement|encaustic/.test(type)) {
    return {
      categorySlug: "encaustic-cement",
      categoryName: "Encaustic Cement",
      subSlug: "all-cement",
      subName: "All Cement",
      collectionHandle: "cement-tiles",
    };
  }
  if (/zellige|bejmat/.test(type) || /bejmat|zellige/.test(title)) {
    return {
      categorySlug: "zellige-and-bejmat",
      categoryName: "Zellige & Bejmat",
      subSlug: "all-zellige-and-bejmat",
      subName: "All Zellige & Bejmat",
      collectionHandle: "zellige-and-bejmat-tiles",
    };
  }
  if (/ceramic|porcelain/.test(type)) {
    return {
      categorySlug: "ceramic",
      categoryName: "Ceramic",
      subSlug: "all-ceramic",
      subName: "All Ceramic",
      collectionHandle: "ceramic-tiles",
    };
  }
  if (/marble/.test(type)) {
    return {
      categorySlug: "marble",
      categoryName: "Marble",
      subSlug: "signature",
      subName: "Signature",
      collectionHandle: "signature-marble-collection-tiles",
    };
  }
  return {
    categorySlug: "signature-collection",
    categoryName: "Signature Collection",
    subSlug: "",
    subName: "",
    collectionHandle: "",
  };
}

function extractAccordionHtml(html, title) {
  const needle = `>${title}</span>`;
  const i = html.indexOf(needle);
  if (i < 0) return "";
  const after = html.slice(i);
  const contentStart = after.search(/accordion__content/);
  if (contentStart < 0) return "";
  const chunk = after.slice(contentStart, contentStart + 20000);
  const end = chunk.search(/<\/details>/i);
  return chunk.slice(0, end > 0 ? end : chunk.length);
}

function extractRichText(accordionHtml) {
  const m = accordionHtml.match(
    /metafield-rich_text_field">([\s\S]*?)<\/div>\s*<\/div>/i,
  );
  if (m) return cleanText(m[1]);
  const pad = accordionHtml.match(
    /<div style="padding:\s*1rem">([\s\S]*?)<\/div>\s*<\/div>/i,
  );
  return pad ? cleanText(pad[1]) : cleanText(accordionHtml);
}

function extractSpecsTable(html) {
  const specs = {};
  const acc = extractAccordionHtml(html, "Technical Specifications");
  if (!acc) return specs;
  const rows = [
    ...acc.matchAll(
      /datatable-leftcell">([^<]+)<[\s\S]*?datatable-rightcell">([\s\S]*?)<\/td>/gi,
    ),
  ];
  for (const m of rows) {
    const key = cleanText(m[1]);
    const value = cleanText(m[2]);
    if (key && value) specs[key] = value;
  }
  return specs;
}

/** Theme calculator metafields embedded in PDP JS (pcsIn1Box / pcsIn1Sqm). */
function extractOttoCalculator(html) {
  const out = {
    tilesPerBox: null,
    tilesPerSqm: null,
    leadTimeLabel: "",
    leadTimeDetail: "",
  };
  if (!html) return out;
  const box = html.match(/pcsIn1Box\s*=\s*parseFloat\('([^']+)'\)/i);
  const sqm = html.match(/pcsIn1Sqm\s*=\s*parseFloat\('([^']+)'\)/i);
  if (box) {
    const n = Number(box[1]);
    if (Number.isFinite(n) && n > 0) out.tilesPerBox = n;
  }
  if (sqm) {
    const n = Number(sqm[1]);
    if (Number.isFinite(n) && n > 0) out.tilesPerSqm = n;
  }
  const status = html.match(
    /class="stock-status"[^>]*>\s*([\s\S]*?)<\/strong>/i,
  );
  if (status) {
    const label = cleanText(status[1]);
    if (label) out.leadTimeLabel = label;
  }
  const detailVal = html.match(
    /lead-time__text__value[^>]*>\s*([^<]+)/i,
  );
  if (detailVal) {
    const weeks = cleanText(detailVal[1]);
    if (weeks) out.leadTimeDetail = `Estimated to ship in ${weeks}`;
  }
  return out;
}

function isSampleVariant(v) {
  const t = String(v?.title || v?.option1 || "").toLowerCase();
  return t.includes("sample");
}

function pickOttoVariants(shopify) {
  const variants = Array.isArray(shopify?.variants) ? shopify.variants : [];
  const full =
    variants.find((v) => !isSampleVariant(v)) || variants[0] || null;
  const sample = variants.find((v) => isSampleVariant(v)) || null;
  return { full, sample };
}

function extractInstallGuides(html) {
  const acc = extractAccordionHtml(
    html,
    "Download Installation & Maintenance Guides",
  );
  if (!acc) return [];
  const guides = [];
  const cards = [
    ...acc.matchAll(/<article class="downloads-card"[\s\S]*?<\/article>/gi),
  ];
  for (const card of cards) {
    const block = card[0];
    const title =
      cleanText(
        (block.match(/downloads-card__title[^>]*>\s*([^<]+)/i) || [])[1] ||
          (block.match(/id="download-\d+-title"[^>]*>\s*([^<]+)/i) || [])[1] ||
          "",
      ) || "";
    const href =
      (block.match(/href="([^"]+\.pdf[^"]*)"/i) || [])[1] ||
      (block.match(/src="([^"]+\.pdf[^"]*)"/i) || [])[1] ||
      (block.match(/href="(https?:\/\/cdn\.shopify\.com[^"]+)"/i) || [])[1] ||
      "";
    if (!href || /my-account|professional-account/i.test(href)) continue;
    const name =
      title ||
      decodeURIComponent(href.split("/").pop() || "")
        .replace(/\.pdf.*/i, "")
        .replace(/[_-]+/g, " ")
        .trim() ||
      "Installation Guide";
    guides.push({ name, url: href.split("?")[0] });
  }
  // Fallback: any PDF in the accordion
  if (!guides.length) {
    for (const m of acc.matchAll(/href="([^"]+\.pdf[^"]*)"/gi)) {
      const url = m[1].split("?")[0];
      if (guides.some((g) => g.url === url)) continue;
      const name = decodeURIComponent(url.split("/").pop() || "")
        .replace(/\.pdf.*/i, "")
        .replace(/[_-]+/g, " ")
        .trim();
      guides.push({ name: name || "Installation Guide", url });
    }
  }
  return guides;
}

function extractUsage(html) {
  const start = html.indexOf('class="product-feature-list"');
  if (start < 0) return [];
  const block = html.slice(start, start + 40000);
  const items = [];
  const re =
    /<div class="feature-item">([\s\S]*?)<\/div>\s*(?=<div class="feature-item">|<\/div>\s*<\/div>\s*<\/div>)/gi;
  let m;
  while ((m = re.exec(block))) {
    const chunk = m[1];
    const img = absUrl((chunk.match(/src="([^"]+)"/) || [])[1] || "");
    const title = cleanText(
      (chunk.match(/feature-item__title">([^<]+)</) || [])[1] || "",
    );
    const color = (
      (chunk.match(/color:\s*(green|red)/i) || [])[1] || ""
    ).toLowerCase();
    if (!title && !img) continue;
    items.push({
      title,
      image: img,
      checked: color !== "red",
    });
  }
  return items;
}

function extractDescription(shopify, html) {
  const body = cleanText(shopify.body_html || "");
  if (body.length > 40) return body.slice(0, 12000);
  const acc = extractAccordionHtml(html, "Product Details");
  const fromAcc = extractRichText(acc);
  if (fromAcc) return fromAcc.slice(0, 12000);
  return `${shopify.title} from Otto Tiles.`;
}

async function parsePdp(handle) {
  const url = `${BASE}/products/${handle}`;
  const html = await fetchText(url);
  return {
    url,
    html,
    delivery: extractRichText(extractAccordionHtml(html, "Delivery")),
    howItsMade: extractRichText(extractAccordionHtml(html, "How It's Made")),
    productAndSampleOrders: extractRichText(
      extractAccordionHtml(html, "Product and Sample Orders"),
    ),
    installationMaintenanceGuides: extractInstallGuides(html),
    usage: extractUsage(html),
    techSpecs: extractSpecsTable(html),
    calculator: extractOttoCalculator(html),
  };
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
  fs.writeFileSync(LOG, `Otto Tiles import ${new Date().toISOString()}\n`);
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (!SKIP_IMAGES && !DRY_RUN) {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      throw new Error("Missing Cloudinary credentials");
    }
  }

  log(
    `Otto Tiles import${DRY_RUN ? " (DRY RUN)" : ""} concurrency=${CONCURRENCY}`,
  );

  let shopifyProducts = [];
  /** @type {Record<string, string[]>} */
  let handleCollections = {};

  if (RESUME && fs.existsSync(CHECKPOINT)) {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    shopifyProducts = saved.shopifyProducts || [];
    handleCollections = saved.handleCollections || {};
    log(
      `Resumed ${shopifyProducts.length} products, ${Object.keys(handleCollections).length} collection maps`,
    );
  } else {
    shopifyProducts = await fetchAllShopifyProducts();
    const map = await buildHandleToCollections();
    handleCollections = {};
    for (const [h, set] of map.entries()) {
      handleCollections[h] = [...set];
    }
    fs.writeFileSync(
      CHECKPOINT,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          shopifyProducts,
          handleCollections,
          count: shopifyProducts.length,
        },
        null,
        2,
      ),
    );
  }

  if (DISCOVER_ONLY) {
    log("Discover-only done.");
    return;
  }

  // Keep full catalogue for category remap; LIMIT only applies to scrape/import.
  const allShopifyForRemap = shopifyProducts.slice();
  if (LIMIT > 0 && !REMAP_ONLY) {
    shopifyProducts = shopifyProducts.slice(0, LIMIT);
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  const parentMenus = new Map();
  const subMenus = new Map();
  const allowedDirectSubSlugs = new Map(); // topSlug → Set(groupSlug)

  for (let i = 0; i < MENU_TREE.length; i++) {
    const cat = MENU_TREE[i];
    const menu = await ensureMenu(db, {
      name: cat.name,
      slug: cat.slug,
      parent: null,
      brandId: brand._id,
      order: i,
      image: "",
    });
    parentMenus.set(cat.slug, menu);
    const allowed = new Set();

    for (let j = 0; j < cat.children.length; j++) {
      const group = cat.children[j];
      const groupSlug = group.slug || slugify(group.name);
      allowed.add(groupSlug);
      const groupMenu = await ensureMenu(db, {
        name: group.name,
        slug: groupSlug,
        parent: menu._id,
        brandId: brand._id,
        order: j,
        image: "",
      });
      subMenus.set(`${cat.slug}/${groupSlug}`, groupMenu);

      const leaves = group.children || [];
      for (let k = 0; k < leaves.length; k++) {
        const leaf = leaves[k];
        const leafSlug = leaf.slug || slugify(leaf.name);
        await ensureMenu(db, {
          name: leaf.name,
          slug: leafSlug,
          parent: groupMenu._id,
          brandId: brand._id,
          order: k,
          image: "",
        });
      }
    }
    allowedDirectSubSlugs.set(cat.slug, allowed);
  }

  // Hide old flat leaf menus that were incorrectly attached directly under
  // Signature / Encaustic (so UI only shows the nav groups: 4 / 3).
  if (!DRY_RUN) {
    for (const [topSlug, allowed] of allowedDirectSubSlugs.entries()) {
      const top = parentMenus.get(topSlug);
      if (!top) continue;
      const stale = await db.collection("menus").updateMany(
        {
          brand: brand._id,
          parent: top._id,
          slug: { $nin: [...allowed] },
        },
        { $set: { isActive: false, updatedAt: new Date() } },
      );
      if (stale.modifiedCount) {
        log(
          `Deactivated ${stale.modifiedCount} stale direct subs under ${topSlug}`,
        );
      }
    }
  }

  await deactivateObsoleteOttoMenus(db, brand._id);

  // Remap any already-imported Otto products onto the 5 brand-scoped mains
  // without re-scraping images (keeps products out of obsolete / shared cats).
  if (!DRY_RUN) {
    let remapped = 0;
    for (const shopify of allShopifyForRemap) {
      const handle = shopify.handle;
      const cats = resolveCategory(
        shopify,
        new Set(handleCollections[handle] || []),
      );
      const r = await productsCol.updateMany(
        {
          "specs.source": SOURCE_TAG,
          $or: [
            { "specs.ottoHandle": handle },
            { brand: brand._id, "specs.ottoHandle": handle },
            { brands: brand._id, "specs.ottoHandle": handle },
          ],
        },
        {
          $set: {
            category: cats.categorySlug,
            subCategory: cats.subSlug || "",
            brand: brand._id,
            brands: [brand._id],
            "specs.collectionHandle": cats.collectionHandle || "",
            "specs.ottoGroup": cats.subName || "",
            "specs.ottoLeaf": cats.leafName || "",
            updatedAt: new Date(),
          },
        },
      );
      remapped += r.modifiedCount || 0;
    }
    log(`Remapped Otto product categories: ${remapped}`);

    // Sanity: Otto products must only use brand-scoped MENU_TREE mains
    const allowed = new Set(MENU_TREE.map((c) => c.slug));
    // Migrate leftover alternate slugs from earlier taxonomy passes
    await productsCol.updateMany(
      {
        brand: brand._id,
        "specs.source": SOURCE_TAG,
        category: "zellige",
      },
      {
        $set: {
          category: "zellige-and-bejmat",
          updatedAt: new Date(),
        },
      },
    );
    await productsCol.updateMany(
      {
        brand: brand._id,
        "specs.source": SOURCE_TAG,
        category: "kit-kat-zellige",
      },
      {
        $set: {
          category: "signature-collection",
          subCategory: "kit-kat-zellige",
          updatedAt: new Date(),
        },
      },
    );
    const bad = await productsCol
      .find({
        brand: brand._id,
        "specs.source": SOURCE_TAG,
        category: { $nin: [...allowed] },
      })
      .project({ name: 1, category: 1, subCategory: 1 })
      .limit(20)
      .toArray();
    if (bad.length) {
      log(
        `WARN products still outside Otto mains:`,
        bad.map((p) => `${p.name}=${p.category}/${p.subCategory}`).join("; "),
      );
    } else {
      log("All Otto products use brand-scoped main categories + subs");
    }

    const byCat = await productsCol
      .aggregate([
        { $match: { brand: brand._id, "specs.source": SOURCE_TAG } },
        {
          $group: {
            _id: { c: "$category", s: "$subCategory" },
            n: { $sum: 1 },
          },
        },
        { $sort: { "_id.c": 1, n: -1 } },
      ])
      .toArray();
    log(
      "Otto category/sub counts:",
      byCat.map((r) => `${r._id.c}/${r._id.s || "-"}:${r.n}`).join(", "),
    );

    // Verify Signature = 4 active direct subs, Encaustic = 3
    for (const check of [
      ["signature-collection", 4],
      ["encaustic-cement", 3],
    ]) {
      const [slug, expect] = check;
      const top = parentMenus.get(slug);
      if (!top) continue;
      const n = await db.collection("menus").countDocuments({
        brand: brand._id,
        parent: top._id,
        isActive: true,
      });
      log(`UI check ${slug}: ${n} active direct subs (expect ${expect})`);
    }
  }

  // CALC_ONLY takes precedence over REMAP_ONLY (REMAP_ONLY may be set in .env).
  if (REMAP_ONLY && !CALC_ONLY) {
    log("REMAP_ONLY done — skipping product scrape.");
    await mongoose.disconnect();
    return;
  }

  if (CALC_ONLY) {
    let calcUpdated = 0;
    let calcFailed = 0;
    const list = shopifyProducts.slice();
    log(`CALC_ONLY: refreshing calculator fields for ${list.length} products…`);
    await mapPool(list, CONCURRENCY, async (shopify, idx) => {
      const label = `[${idx + 1}/${list.length}]`;
      const handle = shopify.handle;
      try {
        const { full, sample } = pickOttoVariants(shopify);
        const price = Number(full?.price || 0) || 0;
        const samplePrice = Number(sample?.price || 0) || 0;
        const sizeLabel = cleanText(full?.title || full?.option1 || "");
        let calc = {
          tilesPerBox: null,
          tilesPerSqm: null,
          leadTimeLabel: "",
          leadTimeDetail: "",
        };
        try {
          const pdp = await parsePdp(handle);
          calc = pdp.calculator || calc;
          await delay(60);
        } catch (e) {
          log(`${label} PDP warn ${handle}:`, e.message);
        }
        const $set = {
          price,
          updatedAt: new Date(),
          "specs.unit": "per m2",
          "specs.pricePerM2": price || null,
          "specs.size": sizeLabel || undefined,
          "specs.shopifyVariantId": String(full?.id || ""),
          "specs.sku": full?.sku || "",
          "specs.shopifySku": full?.sku || "",
        };
        if (calc.tilesPerBox != null) $set["specs.tilesPerBox"] = calc.tilesPerBox;
        if (calc.tilesPerSqm != null) $set["specs.tilesPerSqm"] = calc.tilesPerSqm;
        if (samplePrice > 0) $set["specs.samplePrice"] = samplePrice;
        if (calc.leadTimeLabel) $set["specs.leadTimeLabel"] = calc.leadTimeLabel;
        if (calc.leadTimeDetail) {
          $set["specs.leadTimeDetail"] = calc.leadTimeDetail;
        }
        // Drop undefined keys
        for (const k of Object.keys($set)) {
          if ($set[k] === undefined) delete $set[k];
        }
        if (DRY_RUN) {
          log(
            `${label} [dry] ${handle} box=${calc.tilesPerBox} /m2=${calc.tilesPerSqm} sample=£${samplePrice} size=${sizeLabel}`,
          );
          calcUpdated++;
          return;
        }
        const r = await productsCol.updateMany(
          {
            "specs.source": SOURCE_TAG,
            $or: [
              { "specs.ottoHandle": handle },
              { brand: brand._id, "specs.ottoHandle": handle },
            ],
          },
          { $set },
        );
        if (r.matchedCount) {
          calcUpdated += r.modifiedCount || 0;
          log(
            `${label} ✓ ${handle} box=${calc.tilesPerBox} sqm=${calc.tilesPerSqm} sample=£${samplePrice}`,
          );
        } else {
          log(`${label} skip (not in DB): ${handle}`);
        }
      } catch (e) {
        calcFailed++;
        log(`${label} ✗ ${handle}:`, e.message);
      }
    });
    log(`CALC_ONLY done. Updated ${calcUpdated}, failed ${calcFailed}`);
    await mongoose.disconnect();
    return;
  }

  const done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    try {
      const prog = JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
      for (const id of prog.done || []) done.add(String(id));
      log(`Resume progress: ${done.size} already done`);
    } catch {
      /* ignore */
    }
  }

  let imported = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  const pending = shopifyProducts.filter((p) => !done.has(String(p.id)));
  log(`Importing ${pending.length} products…`);

  await mapPool(pending, CONCURRENCY, async (shopify, idx) => {
    const label = `[${idx + 1}/${pending.length}]`;
    try {
      const handle = shopify.handle;
      const name = cleanText(shopify.title) || handle;
      const { full: variant, sample: sampleVariant } = pickOttoVariants(shopify);
      const price = Number(variant?.price || 0) || 0;
      const compareAt = Number(variant?.compare_at_price || 0) || 0;
      const samplePrice = Number(sampleVariant?.price || 0) || 0;
      const sizeLabel = cleanText(variant?.title || variant?.option1 || "");
      const available =
        variant?.available === true ||
        shopify.variants?.some((v) => v.available);

      let pdp;
      try {
        pdp = await parsePdp(handle);
        await delay(80);
      } catch (e) {
        log(`${label} PDP warn ${handle}:`, e.message);
        pdp = {
          url: `${BASE}/products/${handle}`,
          html: "",
          delivery: "",
          howItsMade: "",
          productAndSampleOrders: "",
          installationMaintenanceGuides: [],
          usage: [],
          techSpecs: {},
          calculator: {
            tilesPerBox: null,
            tilesPerSqm: null,
            leadTimeLabel: "",
            leadTimeDetail: "",
          },
        };
      }

      const cats = resolveCategory(
        shopify,
        new Set(handleCollections[handle] || []),
      );

      const parentMenu = parentMenus.get(cats.categorySlug);
      if (cats.subSlug && parentMenu) {
        const key = `${cats.categorySlug}/${cats.subSlug}`;
        if (!subMenus.has(key)) {
          const sub = await ensureMenu(db, {
            name: cats.subName || cats.subSlug,
            slug: cats.subSlug,
            parent: parentMenu._id,
            brandId: brand._id,
            order: 99,
            image: "",
          });
          subMenus.set(key, sub);
        }
      }

      const images = [];
      for (const img of shopify.images || []) {
        const src = absUrl(img.src);
        if (!src) continue;
        if (!images.includes(src)) images.push(src);
        if (images.length >= MAX_IMAGES) break;
      }

      const uploaded = [];
      for (let i = 0; i < images.length; i++) {
        try {
          const url = await uploadRemoteImage(images[i], `${handle}-${i + 1}`);
          if (url) uploaded.push(url);
        } catch (e) {
          log(`${label} image fail:`, e.message);
        }
      }

      // Usage icons → Cloudinary
      const usage = [];
      for (let i = 0; i < (pdp.usage || []).length; i++) {
        const u = pdp.usage[i];
        let image = u.image;
        try {
          if (image) {
            image = await uploadRemoteImage(
              image,
              `usage-${handle}-${slugify(u.title) || i}`,
            );
          }
        } catch (e) {
          log(`${label} usage img fail:`, e.message);
        }
        usage.push({
          title: u.title || "",
          image: image || "",
          checked: u.checked !== false,
        });
      }

      const guides = [];
      for (let i = 0; i < (pdp.installationMaintenanceGuides || []).length; i++) {
        const g = pdp.installationMaintenanceGuides[i];
        let url = g.url;
        try {
          url = await uploadRemoteFile(
            g.url,
            `guide-${handle}-${slugify(g.name) || i}`,
          );
        } catch (e) {
          log(`${label} guide upload fail, keeping source:`, e.message);
        }
        if (url) guides.push({ name: g.name, url });
      }

      const calc = pdp.calculator || {};
      const specs = {
        source: SOURCE_TAG,
        sourceUrl: pdp.url,
        ottoId: shopify.id,
        ottoHandle: handle,
        shopifyProductId: String(shopify.id),
        productType: shopify.product_type || "",
        vendor: shopify.vendor || "",
        tags: Array.isArray(shopify.tags)
          ? shopify.tags.join(", ")
          : String(shopify.tags || ""),
        sku: variant?.sku || "",
        shopifySku: variant?.sku || "",
        shopifyVariantId: String(variant?.id || ""),
        shopifyListPrice: price,
        shopifyCompareAt: compareAt || null,
        unit: "per m2",
        pricePerM2: price || null,
        size: sizeLabel || "",
        tilesPerBox: calc.tilesPerBox,
        tilesPerSqm: calc.tilesPerSqm,
        samplePrice: samplePrice > 0 ? samplePrice : null,
        leadTimeLabel: calc.leadTimeLabel || "",
        leadTimeDetail: calc.leadTimeDetail || "",
        collectionHandle: cats.collectionHandle || "",
        ottoGroup: cats.subName || "",
        ottoLeaf: cats.leafName || "",
        ...pdp.techSpecs,
      };
      // Prefer theme calculator metafields over any overlapping tech-spec keys
      if (calc.tilesPerBox != null) specs.tilesPerBox = calc.tilesPerBox;
      if (calc.tilesPerSqm != null) specs.tilesPerSqm = calc.tilesPerSqm;
      if (sizeLabel) specs.size = sizeLabel;

      const description = extractDescription(shopify, pdp.html || "");

      const now = new Date();
      const doc = {
        name,
        description,
        price,
        images: uploaded,
        category: cats.categorySlug,
        subCategory: cats.subSlug || "",
        brand: brand._id,
        brands: [brand._id],
        stock: available ? STOCK_DEFAULT : 0,
        isOutOfStock: !available,
        tagline: shopify.product_type || "",
        schematicImage: "",
        linxSku: variant?.sku || handle,
        manufacturerSku: variant?.sku || "",
        specs,
        showSpecs: true,
        delivery: pdp.delivery || "",
        howItsMade: pdp.howItsMade || "",
        productAndSampleOrders: pdp.productAndSampleOrders || "",
        installationMaintenanceGuides: guides,
        usage,
        updatedAt: now,
      };

      if (DRY_RUN) {
        log(
          `${label} [dry] ${name} £${price} imgs=${images.length} cat=${doc.category}/${doc.subCategory} usage=${usage.length} guides=${guides.length}`,
        );
        imported++;
      } else {
        const existing = await productsCol.findOne({
          $or: [
            { "specs.sourceUrl": pdp.url, "specs.source": SOURCE_TAG },
            { "specs.ottoId": shopify.id, "specs.source": SOURCE_TAG },
            { "specs.ottoHandle": handle, "specs.source": SOURCE_TAG },
          ],
        });

        if (existing) {
          const prev = Array.isArray(existing.images) ? existing.images : [];
          const prevCloud = prev.filter((u) => /cloudinary\.com/i.test(u));
          if (!uploaded.length && prevCloud.length) {
            doc.images = prevCloud;
          } else if (uploaded.length) {
            doc.images = uploaded;
          } else {
            doc.images = prev;
          }
          await productsCol.updateOne({ _id: existing._id }, { $set: doc });
          updated++;
        } else {
          await productsCol.insertOne({ ...doc, createdAt: now });
          imported++;
        }
        log(
          `${label} ✓ ${name} (£${price}) cat=${doc.category}/${doc.subCategory} imgs=${doc.images.length} usage=${usage.length}`,
        );
      }

      done.add(String(shopify.id));
      if ((imported + updated) % 5 === 0) {
        fs.writeFileSync(
          PROGRESS,
          JSON.stringify(
            {
              at: new Date().toISOString(),
              done: [...done],
              imported,
              updated,
              failed,
            },
            null,
            2,
          ),
        );
      }
    } catch (e) {
      failed++;
      log(`${label} ✗`, e.message);
    }
  });

  fs.writeFileSync(
    PROGRESS,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        done: [...done],
        imported,
        updated,
        failed,
        skipped,
      },
      null,
      2,
    ),
  );

  log("\n========== OTTO TILES IMPORT ==========");
  log(`Created:  ${imported}`);
  log(`Updated:  ${updated}`);
  log(`Failed:   ${failed}`);
  log(`Skipped:  ${skipped}`);
  log(`Brand:    ${BRAND_NAME} (${brand._id})`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
