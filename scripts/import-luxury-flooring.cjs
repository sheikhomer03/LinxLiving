/**
 * Scrape https://luxuryflooring.co.uk → LINX Mongo + Cloudinary
 *
 * Brand name: "Luxury Flooring"  |  UI name: "Linx Square"  |  slug: luxury-flooring
 *
 * The source runs Magento 2 behind a Hyvä theme. Its GraphQL endpoint is open
 * and carries far more per product than the rendered page does, so structured
 * data comes from there and the HTML is read only for the two things GraphQL
 * cannot give us: which products a category page actually lists, and the SKU
 * behind a URL. `products(filter: …)` is broken server-side on this store —
 * every filtered query returns "Internal server error" — so a product can only
 * be looked up by `search`, which needs its SKU.
 *
 * Main nav categories (SALE and Clearance are deliberately excluded):
 *   Engineered Wood Flooring, Vinyl (LVT), Laminate,
 *   Parquet Flooring, Solid Wood Flooring, Accessories
 *
 * Sub-categories keep the source's own grouping. A middle path segment such as
 * `finish` or `shop-by-room` has no page of its own (it 404s) and exists only
 * to shelve its children, so it becomes `Menu.group` rather than a menu level;
 * one that does resolve (`accessories/fit-your-floor`) stays a real menu.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/import-luxury-flooring.cjs
 *
 * Options:
 *   DRY_RUN=1 LIMIT=20 CONCURRENCY=3 SKIP_IMAGES=1 RESUME=1 DISCOVER_ONLY=1
 *   ONLY_SLUG=waterproof-sand-oak   MAX_IMAGES=20
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

const BASE = "https://luxuryflooring.co.uk";
const GRAPHQL = `${BASE}/graphql`;
const MEDIA_BASE = `${BASE}/media/catalog/product`;
const BRAND_SLUG = "luxury-flooring";
const BRAND_NAME = "Luxury Flooring";
const BRAND_UI_NAME = "Linx Square";
const SOURCE_TAG = "luxury-flooring-scrape";
const CLOUDINARY_FOLDER = "linx-living/products/luxury-flooring";
const CHECKPOINT = path.join(__dirname, "_tmp-lf-catalogue.json");
const PROGRESS = path.join(__dirname, "_tmp-lf-progress.json");
const LOG = path.join(__dirname, "_tmp-lf-import.log");

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_IMAGES = process.env.SKIP_IMAGES === "1";
const DISCOVER_ONLY = process.env.DISCOVER_ONLY === "1";
const RESUME = process.env.RESUME === "1";
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));
const MAX_IMAGES = Math.max(1, Number(process.env.MAX_IMAGES || 20));
const REQUEST_GAP_MS = Math.max(0, Number(process.env.REQUEST_GAP_MS || 120));
const ONLY_SLUG = String(process.env.ONLY_SLUG || "").trim().toLowerCase();
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxLuxuryFlooringImporter/1.0";

/**
 * The six product roots from the site header, in nav order.
 *
 * `Inspiration` is the blog and `SALE` is the promotional shelf; neither is a
 * catalogue category, and the brief excludes sale goods, so neither is
 * crawled. A product that also sits in SALE is still imported through whichever
 * real category lists it, at its list price.
 */
const MAIN_NAV = [
  { name: "Engineered Wood Flooring", slug: "engineered-wood-flooring", department: "flooring", order: 0 },
  { name: "Vinyl (LVT)", slug: "vinyl-flooring", department: "flooring", order: 1 },
  { name: "Laminate", slug: "laminate-flooring", department: "flooring", order: 2 },
  { name: "Parquet Flooring", slug: "parquet-flooring", department: "flooring", order: 3 },
  { name: "Solid Wood Flooring", slug: "solid-wood-flooring", department: "flooring", order: 4 },
  { name: "Accessories", slug: "accessories", department: "accessories", order: 5 },
];

/** Source paths that must never produce a menu or contribute a membership. */
const EXCLUDED_ROOTS = new Set([
  "sale",
  "clearance",
  "special-offers",
  "black-friday-special-offers",
  "cyber-monday-special-offers",
  "christmas-special-offers",
]);

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG, `${line}\n`);
  } catch {
    /* logging must never abort an import */
  }
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function titleCase(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Display heading for a grouping shelf.
 *
 * `pages` is Magento's own container for landing pages the merchandisers hang
 * off a category; it is plumbing, not a heading a customer should read, so its
 * children are left ungrouped.
 */
const GROUP_ALIASES = new Map([
  ["pages", ""],
  ["shop-by-room", "Shop By Room"],
  ["plank-effect", "Plank Effect"],
  ["joining-method", "Joining Method"],
  ["flooring-accessories", "Flooring Accessories"],
]);

function groupLabel(slug) {
  const key = slugify(slug);
  if (!key) return "";
  if (GROUP_ALIASES.has(key)) return GROUP_ALIASES.get(key);
  return titleCase(key);
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&ldquo;|&rdquo;|&#822[01];/g, '"')
    .replace(/&amp;/g, "&");
}

function cleanText(s) {
  return decodeEntities(
    String(s || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, { tries = 3, accept = "text/html" } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: accept },
        redirect: "follow",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await delay(500 * (i + 1));
    }
  }
  throw new Error(`${lastErr && lastErr.message} ${url}`);
}

async function gql(query, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(GRAPHQL, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Partial errors are normal here: one alias in a batch can fail while the
      // rest resolve. Only a wholly empty payload is worth retrying.
      if (!json.data && json.errors) {
        throw new Error(json.errors[0] && json.errors[0].message);
      }
      return json;
    } catch (e) {
      lastErr = e;
      await delay(700 * (i + 1));
    }
  }
  throw new Error(`graphql: ${lastErr && lastErr.message}`);
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
    Array.from({ length: Math.min(concurrency, items.length || 1) }, run),
  );
}

/* ------------------------------------------------------------------ media */

/**
 * Magento serves gallery images through a resizing cache. The original is the
 * same path with the `cache/<hash>/` segment removed, and is what we hand
 * Cloudinary — a cached copy is already downscaled and re-encoded.
 */
function originalMediaUrl(url) {
  const clean = String(url || "").split("?")[0];
  if (!clean) return "";
  return clean.replace(/\/cache\/[0-9a-f]{16,}\//i, "/");
}

/** A MEDIA_IMAGE attribute holds a path relative to the catalogue root. */
function mediaAttrUrl(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  // The source catalogue holds a few half-finished uploads ("…jpg.tmp") that
  // 403 on fetch; storing one would leave a permanently broken image.
  if (/\.tmp$/i.test(v)) return "";
  if (/^https?:\/\//i.test(v)) return originalMediaUrl(v);
  return `${MEDIA_BASE}${v.startsWith("/") ? "" : "/"}${v}`;
}

/**
 * Stage one image on Cloudinary, trying each source in turn.
 *
 * The origin returns a sporadic 500/502 for an image it will serve happily a
 * second later — it appears to render derivatives on demand — so a single
 * failure means nothing and must not cost us the picture. Cloudinary fetches
 * the bytes itself and does not retry, so the retry has to live here. The
 * cached derivative is kept as a second candidate because the origin sometimes
 * serves it when the un-cached path is still failing.
 *
 * Returns "" when every candidate is exhausted: storing a URL we just watched
 * fail would leave a permanently broken image on the record.
 */
async function uploadRemoteImage(sources, publicId) {
  const candidates = (Array.isArray(sources) ? sources : [sources])
    .map((u) => String(u || "").split("?")[0])
    .filter((u) => /^https?:\/\//i.test(u));
  const unique = [...new Set(candidates)];
  if (!unique.length) return "";
  if (SKIP_IMAGES || DRY_RUN) return unique[0];

  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of unique) {
      try {
        const result = await cloudinary.uploader.upload(url, {
          folder: CLOUDINARY_FOLDER,
          public_id: String(publicId).slice(0, 180),
          overwrite: true,
          resource_type: "image",
        });
        return result.secure_url;
      } catch (e) {
        lastErr = e.message;
      }
    }
    await delay(800 * (attempt + 1));
  }
  log(`  cloudinary gave up on ${publicId}: ${lastErr}`);
  return "";
}

/* --------------------------------------------------------------- discovery */

/** Product links a category listing page renders, plus its pagination depth. */
function parseListing(html) {
  const links = [
    ...new Set(
      [...html.matchAll(/class="product-item-link"[^>]*href="([^"]+)"/g)].map(
        (m) => decodeEntities(m[1]).split("?")[0],
      ),
    ),
  ];
  const pages = [...html.matchAll(/[?&]p=(\d+)/g)].map((m) => Number(m[1]));
  return { links, maxPage: pages.length ? Math.max(...pages) : 1 };
}

async function crawlCategory(urlPath) {
  const found = new Set();
  let page = 1;
  let maxPage = 1;
  while (page <= maxPage && page <= 60) {
    const url = `${BASE}/${urlPath}.html?product_list_limit=36&p=${page}`;
    const html = await fetchText(url);
    if (html == null) break;
    const { links, maxPage: mp } = parseListing(html);
    if (!links.length) break;
    links.forEach((l) => found.add(l));
    maxPage = Math.max(maxPage, mp);
    page += 1;
    await delay(REQUEST_GAP_MS);
  }
  return [...found];
}

/**
 * Every category path the sitemap publishes beneath the six roots.
 *
 * The sitemap is the only complete listing: the header's dropdowns are fetched
 * client-side, so the rendered homepage carries only the six root links.
 */
async function discoverCategoryPaths() {
  const xml = await fetchText(`${BASE}/pub/media/sitemaps/uk/sitemap.xml`, {
    accept: "application/xml",
  });
  const locs = [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    m[1].replace(`${BASE}/`, "").replace(/\.html$/, ""),
  );
  const roots = new Set(MAIN_NAV.map((n) => n.slug));
  const paths = new Set();
  for (const loc of locs) {
    const segs = loc.split("/");
    if (!roots.has(segs[0])) continue;
    if (segs.some((s) => EXCLUDED_ROOTS.has(s))) continue;
    if (segs.length < 2) continue;
    paths.add(loc);
  }
  return [...paths].sort();
}

/**
 * Resolve the source's path segments into menu levels and grouping headings.
 *
 * A segment with no page of its own is a shelf the source uses to bucket
 * siblings ("finish", "shop-by-room"); it becomes the child's `group`. One that
 * resolves is a real category and becomes a menu of its own. Answers are cached
 * because the same shelf appears under every root.
 */
async function buildCategoryTree(paths) {
  const resolvable = new Map();
  async function resolves(p) {
    if (resolvable.has(p)) return resolvable.get(p);
    const html = await fetchText(`${BASE}/${p}.html`);
    const ok = html != null;
    resolvable.set(p, ok);
    await delay(REQUEST_GAP_MS);
    return ok;
  }

  const nodes = [];
  for (const p of paths) {
    const segs = p.split("/");
    const chain = [];
    let pendingGroup = "";
    for (let i = 1; i < segs.length; i++) {
      const prefix = segs.slice(0, i + 1).join("/");
      const isReal = i === segs.length - 1 ? true : await resolves(prefix);
      if (!isReal) {
        pendingGroup = segs[i];
        continue;
      }
      chain.push({ slug: segs[i], path: prefix, group: groupLabel(pendingGroup) });
      pendingGroup = "";
    }
    if (!chain.length) continue;
    nodes.push({ root: segs[0], path: p, chain });
  }
  return nodes;
}

/**
 * Product URLs the sitemap publishes at the site root.
 *
 * Category crawling is the only way to learn a product's shelf, but it finds
 * only what a listing paginates to. The sitemap also carries every product as a
 * root-level `.html`, so it is the completeness check: anything here that no
 * category listed still belongs in the catalogue, and its shelves are recovered
 * from the product's own `categories` once GraphQL returns it.
 */
async function discoverRootProductCandidates(knownPaths) {
  const xml = await fetchText(`${BASE}/pub/media/sitemaps/uk/sitemap.xml`, {
    accept: "application/xml",
  });
  const out = [];
  for (const m of String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const loc = m[1].replace(`${BASE}/`, "");
    if (!loc.endsWith(".html")) continue; // CMS pages carry no suffix
    const key = loc.replace(/\.html$/, "");
    if (!key || key.includes("/")) continue;
    if (EXCLUDED_ROOTS.has(key)) continue;
    if (MAIN_NAV.some((n) => n.slug === key)) continue;
    if (knownPaths.has(key)) continue;
    out.push(key);
  }
  return out;
}

/* ----------------------------------------------------------- product query */

const PRODUCT_FIELDS = `
  __typename id uid sku name url_key url_suffix canonical_url
  meta_title meta_description meta_keyword
  description { html } short_description { html }
  stock_status only_x_left_in_stock
  country_of_manufacture status visibility
  special_price special_to_date new_from_date new_to_date
  min_sale_qty max_sale_qty options_container gift_message_available
  rating_summary review_count swatch_image
  image { url label position disabled }
  small_image { url label }
  thumbnail { url label }
  media_gallery {
    url label position disabled __typename
    ... on ProductVideo { video_content { media_type video_provider video_url video_title video_description video_metadata } }
  }
  price_range {
    minimum_price { regular_price { value currency } final_price { value currency } discount { amount_off percent_off } }
    maximum_price { regular_price { value currency } final_price { value currency } discount { amount_off percent_off } }
  }
  price_tiers { quantity final_price { value } discount { amount_off percent_off } }
  categories { id uid name url_key url_path level path }
  visibleAttrs: custom_attributesV2(filters: { is_visible_on_front: true }) { items { code __typename ... on AttributeValue { value } ... on AttributeSelectedOptions { selected_options { label value } } } }
  listingAttrs: custom_attributesV2(filters: { used_in_product_listing: true }) { items { code __typename ... on AttributeValue { value } ... on AttributeSelectedOptions { selected_options { label value } } } }
  htmlAttrs: custom_attributesV2(filters: { is_html_allowed_on_front: true }) { items { code __typename ... on AttributeValue { value } ... on AttributeSelectedOptions { selected_options { label value } } } }
  filterAttrs: custom_attributesV2(filters: { is_filterable: true }) { items { code __typename ... on AttributeValue { value } ... on AttributeSelectedOptions { selected_options { label value } } } }
  searchAttrs: custom_attributesV2(filters: { is_searchable: true }) { items { code __typename ... on AttributeValue { value } ... on AttributeSelectedOptions { selected_options { label value } } } }
  compareAttrs: custom_attributesV2(filters: { is_comparable: true }) { items { code __typename ... on AttributeValue { value } ... on AttributeSelectedOptions { selected_options { label value } } } }
  promoAttrs: custom_attributesV2(filters: { is_used_for_promo_rules: true }) { items { code __typename ... on AttributeValue { value } ... on AttributeSelectedOptions { selected_options { label value } } } }
  advSearchAttrs: custom_attributesV2(filters: { is_visible_in_advanced_search: true }) { items { code __typename ... on AttributeValue { value } ... on AttributeSelectedOptions { selected_options { label value } } } }
  searchFilterAttrs: custom_attributesV2(filters: { is_filterable_in_search: true }) { items { code __typename ... on AttributeValue { value } ... on AttributeSelectedOptions { selected_options { label value } } } }
  wysiwygAttrs: custom_attributesV2(filters: { is_wysiwyg_enabled: true }) { items { code __typename ... on AttributeValue { value } ... on AttributeSelectedOptions { selected_options { label value } } } }
  related_products { sku name url_key }
  upsell_products { sku name url_key }
  crosssell_products { sku name url_key }
  product_links { sku link_type linked_product_sku position }
  reviews(pageSize: 20) { items { summary text nickname created_at average_rating ratings_breakdown { name value } } }
  ... on PhysicalProductInterface { weight }
  ... on CustomizableProductInterface {
    options { uid title required sort_order option_id __typename
      ... on CustomizableDropDownOption { dropdownValues: value { uid title price price_type sku sort_order } }
      ... on CustomizableRadioOption { radioValues: value { uid title price price_type sku sort_order } }
      ... on CustomizableCheckboxOption { checkboxValues: value { uid title price price_type sku sort_order } }
      ... on CustomizableMultipleOption { multiValues: value { uid title price price_type sku sort_order } }
      ... on CustomizableFieldOption { fieldValue: value { uid price price_type sku max_characters } }
      ... on CustomizableAreaOption { areaValue: value { uid price price_type sku max_characters } }
    }
  }
  ... on ConfigurableProduct {
    configurable_options {
      uid attribute_code label position
      values { uid label value_index default_label store_label swatch_data { value __typename ... on ImageSwatchData { thumbnail } } }
    }
    variants {
      attributes { code label value_index uid }
      product {
        id sku name url_key stock_status only_x_left_in_stock weight
        price_range { minimum_price { regular_price { value } final_price { value } discount { amount_off percent_off } } }
        image { url label } thumbnail { url label }
        media_gallery { url label position disabled }
      }
    }
  }
  ... on GroupedProduct { items { position qty product { sku name url_key price_range { minimum_price { final_price { value } } } } } }
  ... on BundleProduct {
    dynamic_sku dynamic_price dynamic_weight ship_bundle_items
    items { uid option_id title required type position sku options { uid label quantity position is_default price price_type can_change_quantity product { sku name } } }
  }
  ... on DownloadableProduct {
    links_purchased_separately links_title
    downloadable_product_links { title sort_order sample_url }
    downloadable_product_samples { title sort_order sample_url }
  }
`;

const ATTR_BUCKETS = [
  "visibleAttrs",
  "listingAttrs",
  "htmlAttrs",
  "filterAttrs",
  "searchAttrs",
  "compareAttrs",
  "promoAttrs",
  "advSearchAttrs",
  "searchFilterAttrs",
  "wysiwygAttrs",
];

/** Attribute code → { label, frontendInput, visibleOnFront }, fetched once. */
async function loadAttributeMeta() {
  const json = await gql(`{
    attributesList(entityType: CATALOG_PRODUCT) {
      items {
        code label frontend_input
        ... on CatalogAttributeMetadata { is_visible_on_front used_in_product_listing }
      }
    }
  }`);
  const meta = new Map();
  const items =
    (json.data && json.data.attributesList && json.data.attributesList.items) || [];
  for (const a of items) {
    meta.set(a.code, {
      label: a.label || titleCase(a.code),
      frontendInput: a.frontend_input || "",
      visibleOnFront: Boolean(a.is_visible_on_front),
    });
  }
  return meta;
}

/**
 * Look one product up by a search term.
 *
 * This store caps a GraphQL document at ten aliases and the ten
 * `custom_attributesV2` buckets above use every one of them, so a product
 * cannot be aliased — batching several per request is impossible and each
 * product costs its own round trip. Parallelism comes from the worker pool
 * instead. (`products(filter: …)` would avoid the search entirely, but every
 * filtered query on this store returns "Internal server error".)
 */
async function searchProducts(term, pageSize = 20) {
  const json = await gql(
    `{ products(search: ${JSON.stringify(term)}, pageSize: ${pageSize}) { items { ${PRODUCT_FIELDS} } } }`,
  );
  return (json.data && json.data.products && json.data.products.items) || [];
}

/**
 * Resolve a discovered URL to its product record.
 *
 * The slug is the only identifier discovery has, and it is usually enough. Two
 * fallbacks cover what search will not match on: a slug carrying the plank's
 * dimensions ("…-125-x-600-x-15-4mm") tokenises into nothing the index holds,
 * and some products publish a marketing code in their JSON-LD that is not the
 * Magento SKU — so a slug lookup is tried before, not after, the page fetch.
 */
async function resolveProduct(t) {
  const pick = (items, sku) =>
    items.find((i) => i && i.url_key === t.urlKey) ||
    (sku ? items.find((i) => i && i.sku === sku) : null) ||
    null;

  const words = t.urlKey.replace(/-/g, " ");
  let hit = pick(await searchProducts(words), "");
  if (hit) return { item: hit, via: "slug" };

  // Drop the dimension tokens and retry on the name alone.
  const alpha = t.urlKey
    .split("-")
    .filter((w) => /^[a-z]+$/.test(w) && w !== "x")
    .join(" ");
  if (alpha && alpha !== words) {
    hit = pick(await searchProducts(alpha, 40), "");
    if (hit) return { item: hit, via: "name" };
  }

  const html = await fetchText(`${BASE}/${t.urlKey}.html`);
  if (html == null) return { item: null, via: "404" };
  const { sku } = skuFromPdp(html);
  // Only a PDP carries Product JSON-LD, so a page without one is a landing or
  // category page the sitemap listed alongside the products, not a failure.
  if (!sku) return { item: null, via: "not-a-product" };

  hit = pick(await searchProducts(sku, 10), sku);
  return { item: hit, via: hit ? "sku" : "unresolved" };
}

/** The SKU behind a PDP URL, from the page's own Product JSON-LD. */
function skuFromPdp(html) {
  for (const m of String(html).matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      const json = JSON.parse(m[1]);
      if (json && json["@type"] === "Product" && json.sku) {
        return { sku: String(json.sku).trim(), ld: json };
      }
    } catch {
      /* the page carries other feeds we do not read */
    }
  }
  return { sku: "", ld: null };
}

/* ----------------------------------------------------------------- mapping */

function attrRows(item, meta) {
  const seen = new Map();
  for (const bucket of ATTR_BUCKETS) {
    const items = (item[bucket] && item[bucket].items) || [];
    for (const a of items) {
      if (!a || !a.code || seen.has(a.code)) continue;
      const m = meta.get(a.code) || {};
      const options = (a.selected_options || [])
        .filter((o) => o && String(o.label || "").trim())
        .map((o) => ({ label: String(o.label).trim(), value: String(o.value ?? "") }));
      seen.set(a.code, {
        code: a.code,
        label: m.label || titleCase(a.code),
        value: String(a.value ?? "").trim(),
        options,
        frontendInput: m.frontendInput || "",
        visibleOnFront: Boolean(m.visibleOnFront),
      });
    }
  }
  return [...seen.values()];
}

/** Human-readable value of an attribute row, whatever its input type. */
function rowText(row) {
  if (!row) return "";
  if (row.options && row.options.length) {
    return row.options
      .map((o) => o.label)
      .filter((l) => l.trim())
      .join(", ")
      .trim();
  }
  return String(row.value || "").trim();
}

/**
 * A number, or null when the source has nothing to say.
 *
 * `Number("")` is 0, which would turn every blank price and unset weight into a
 * real zero and stop `??` fallbacks from ever firing — a product with no
 * published m² price would claim to cost nothing per m².
 */
const num = (v) => {
  if (v === null || v === undefined) return null;
  const digits = String(v).replace(/[^0-9.\-]/g, "");
  if (!digits || !/\d/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
};
const isTrue = (v) =>
  v === "1" || v === 1 || v === true || /^(yes|true)$/i.test(String(v || ""));

/** Attribute codes already carried by a typed field; kept out of `attributes[]`. */
const SPEC_EXCLUDE = new Set([
  "name", "description", "short_description", "price", "special_price",
  "special_from_date", "special_to_date", "news_from_date", "news_to_date",
  "status", "url_key", "visibility", "tax_class_id", "msrp_display_actual_price_type",
  "image", "small_image", "thumbnail", "swatch_image", "rollover_image",
  "topdown_image", "sample_pdf_image", "media_gallery", "gallery",
  "meta_title", "meta_keyword", "meta_description", "video", "tagline",
  "product_usp_1", "product_usp_2", "product_usp_1_img", "product_usp_2_img",
  "best_sellers_index", "highest_rated_index", "most_viewed_index",
  "most_wished_for_index", "just_rated_index", "product_merchandising_score",
  "homepageoffer", "homepagebest", "category_featured", "to_export",
  "second_search_term", "sam_search_term", "alternative", "free_sample",
  "product_poa", "discontinued_product", "restrict_online_sale", "eta_date",
  "calculator", "new_calculator", "meter_squared_price", "cheapest_price",
  "is_flooring_product", "product_delivery", "installation_tab", "delivery_tab",
]);

/** Dimension-ish codes that also earn a row in the PDP dimensions table. */
const DIMENSION_CODES = new Set([
  "length", "width", "thickness1", "thickness2", "pack_size", "pack_weight",
  "pack_length", "coverage", "flooring_coverage", "wear_layer", "wear_layer1",
  "plank_length", "underlay_thickness", "width1", "ship_length", "ship_width",
  "ship_height", "height_beading_accessories", "accessories_size",
]);

/** `X` paired with the standard in `X_testing_result` (Magento truncates codes). */
const TEST_PAIRS = [
  ["slip_rating", "slip_rating_testing_result"],
  ["hardness_rating", "hardness_rating_testing_result"],
  ["content_of_pcp", "content_of_pcp_testing_result"],
  ["thermal_conductivity", "thermal_conductivity_testing_r"],
  ["thermal_resistance", "thermal_resistance_testing_res"],
  ["r_value_insulation", "r_value_insulation_testing_res"],
  ["release_of_formaldayhyde", "release_of_formaldayhyde_testi"],
];

/** The six trust icons the source prints under the buy box. */
const USAGE_FLAGS = [
  ["pdf_icon_1", "DIY-ready"],
  ["pdf_icon_2", "Water-resistant"],
  ["pdf_icon_3", "Underfloor Heating Compatible"],
  ["pdf_icon_4", "Sustainably Sourced"],
  ["pdf_icon_5", "Durable & Long-Lasting"],
  ["pdf_icon_6", "Pet-friendly"],
];

function mapProduct(item, meta, ctx) {
  const rows = attrRows(item, meta);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const val = (code) => rowText(byCode.get(code));
  const raw = (code) => (byCode.get(code) || {}).value || "";

  const minPrice = (item.price_range && item.price_range.minimum_price) || {};
  const regular = minPrice.regular_price && minPrice.regular_price.value;
  const final = minPrice.final_price && minPrice.final_price.value;
  // We sell at list price: a supplier promo is recorded, never charged.
  const price = num(regular) ?? num(final) ?? 0;
  const promo = num(final);
  const onPromo = promo != null && price > 0 && promo < price - 0.005;

  const coverage = num(val("coverage")) || num(val("flooring_coverage"));
  const sqmPrice = num(val("meter_squared_price"));

  const gallery = (item.media_gallery || []).filter((g) => g && !g.disabled);
  const images = [];
  // Each gallery slot keeps the un-cached path and the derivative the source
  // linked, so a flaky origin has two chances to hand over the bytes.
  const imageSources = [];
  const externalVideos = [];
  for (const g of gallery.sort((a, b) => (a.position || 0) - (b.position || 0))) {
    if (g.__typename === "ProductVideo" && g.video_content) {
      const vc = g.video_content;
      const url = String(vc.video_url || "");
      const yt = url.match(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{6,})/);
      const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      const host = yt ? "youtube" : vm ? "vimeo" : "";
      const externalId = yt ? yt[1] : vm ? vm[1] : "";
      externalVideos.push({
        host,
        externalId,
        src: host && externalId ? `${host}:${externalId}` : url,
        posterUrl: originalMediaUrl(g.url || ""),
        position: g.position ?? null,
        alt: cleanText(vc.video_title || g.label || ""),
      });
      continue;
    }
    const cached = String(g.url || "").split("?")[0];
    const u = originalMediaUrl(cached);
    if (u && !images.includes(u)) {
      images.push(u);
      imageSources.push([u, cached]);
    }
  }
  const leadCached = String((item.image && item.image.url) || "").split("?")[0];
  const lead = originalMediaUrl(leadCached);
  if (lead && !images.includes(lead)) {
    images.unshift(lead);
    imageSources.unshift([lead, leadCached]);
  }

  const usps = [];
  for (const [textCode, imgCode] of [
    ["product_usp_1", "product_usp_1_img"],
    ["product_usp_2", "product_usp_2_img"],
  ]) {
    const html = raw(textCode);
    const image = mediaAttrUrl(raw(imgCode));
    if (!html && !image) continue;
    usps.push({ title: cleanText(html).slice(0, 140), html, image });
  }

  const testResults = [];
  for (const [valueCode, resultCode] of TEST_PAIRS) {
    const v = val(valueCode);
    const r = val(resultCode);
    if (!v && !r) continue;
    const m = meta.get(valueCode) || {};
    testResults.push({ name: m.label || titleCase(valueCode), value: v, result: r });
  }

  const usage = USAGE_FLAGS.filter(([code]) => isTrue(raw(code))).map(
    ([code, title]) => ({
      title: (meta.get(code) || {}).label || title,
      image: "",
      checked: true,
    }),
  );

  const attributes = rows
    .filter((r) => !SPEC_EXCLUDE.has(r.code) && rowText(r))
    .map((r) => ({ label: r.label, value: rowText(r), key: r.code }));

  const dimensionRows = rows
    .filter((r) => DIMENSION_CODES.has(r.code) && rowText(r))
    .map((r) => ({ label: r.label, value: rowText(r), key: r.code }));

  const dimensions = {};
  for (const r of dimensionRows) dimensions[r.key] = r.value;

  const specs = {};
  for (const r of rows) {
    const t = rowText(r);
    if (t) specs[r.code] = t;
  }

  const supplierRefs = [];
  for (const i of ["", "2", "3", "4"]) {
    const name = val(`supplier_name${i}`);
    const code = val(`supplier_code${i}`);
    const p = val(`supplier_price${i}`);
    if (!name && !code && !p) continue;
    supplierRefs.push({ name, code, price: p });
  }

  const badges = [val("product_sticker"), val("product_label"), val("limited")]
    .map((b) => String(b || "").trim())
    .filter((b) => b && !/^no$/i.test(b));

  const roomSuitability = (byCode.get("room_suitability") || {}).options || [];
  const suitability = roomSuitability.length
    ? {
        type: "table",
        image: "",
        tableHeadings: ["Room"],
        tableRows: roomSuitability.map((o) => [o.label]),
      }
    : { type: "", image: "", tableHeadings: [], tableRows: [] };

  const productSections = [];
  for (const [code, heading] of [
    ["installation_tab", "Installation"],
    ["delivery_tab", "Delivery"],
  ]) {
    const html = raw(code);
    if (!html) continue;
    productSections.push({
      heading,
      blockId: code,
      html,
      text: cleanText(html),
      rows: [],
    });
  }

  const variants = [];
  for (const [i, v] of (item.variants || []).entries()) {
    const vp = (v && v.product) || {};
    const axes = (v && v.attributes) || [];
    const vMin = (vp.price_range && vp.price_range.minimum_price) || {};
    const options = {};
    for (const a of axes) options[a.code] = a.label;
    variants.push({
      name:
        axes.map((a) => a.label).join(" / ") || vp.name || vp.sku || `Option ${i + 1}`,
      sku: vp.sku || "",
      options,
      price: num(vMin.regular_price && vMin.regular_price.value),
      stock: num(vp.only_x_left_in_stock) ?? 1000,
      available: String(vp.stock_status || "").toUpperCase() !== "OUT_OF_STOCK",
      imageUrl: originalMediaUrl((vp.image && vp.image.url) || ""),
      option1: (axes[0] && axes[0].label) || "",
      option2: (axes[1] && axes[1].label) || "",
      option3: (axes[2] && axes[2].label) || "",
      weight: num(vp.weight),
      position: i,
      externalId: String(vp.id || ""),
      isDefault: i === 0,
      attributes: axes.map((a) => ({ label: a.code, value: a.label })),
    });
  }

  const shopifyOptions = (item.configurable_options || []).map((o) => ({
    name: o.label || titleCase(o.attribute_code || ""),
    attributeCode: o.attribute_code || "",
    position: o.position ?? 0,
    values: (o.values || []).map((v) => ({
      label: v.label || v.store_label || v.default_label || "",
      valueIndex: v.value_index ?? null,
      swatch:
        (v.swatch_data &&
          (v.swatch_data.thumbnail
            ? mediaAttrUrl(v.swatch_data.thumbnail)
            : v.swatch_data.value)) || "",
    })),
  }));

  const optionElements = (item.options || []).map((o) => {
    const values =
      o.dropdownValues || o.radioValues || o.checkboxValues || o.multiValues || [];
    const single = o.fieldValue || o.areaValue || null;
    return {
      type: String(o.__typename || "")
        .replace(/^Customizable/, "")
        .replace(/Option$/, ""),
      title: o.title || "",
      required: Boolean(o.required),
      sortOrder: o.sort_order ?? 0,
      externalId: String(o.option_id ?? o.uid ?? ""),
      values: values.map((v) => ({
        title: v.title || "",
        price: num(v.price),
        priceType: v.price_type || "",
        sku: v.sku || "",
        sortOrder: v.sort_order ?? 0,
      })),
      maxCharacters: single ? single.max_characters ?? null : null,
      price: single ? num(single.price) : null,
    };
  });

  const sourceReviews = ((item.reviews && item.reviews.items) || []).map((r) => ({
    title: cleanText(r.summary || ""),
    body: cleanText(r.text || ""),
    author: cleanText(r.nickname || ""),
    rating: num(r.average_rating),
    createdAt: r.created_at || "",
    breakdown: (r.ratings_breakdown || []).map((b) => ({
      name: b.name || "",
      value: String(b.value ?? ""),
    })),
  }));

  const handlesOf = (list) => (list || []).map((p) => p && p.url_key).filter(Boolean);
  const alternatives = val("alternative")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const stockStatus =
    String(item.stock_status || "").toUpperCase() === "OUT_OF_STOCK"
      ? "out_of_stock"
      : "in_stock";

  const rangeName = val("range") || val("laminate_range") || val("vinyl_range") || "";
  const manufacturer = val("wood_brand") || val("vinyl_brand") || val("brand1") || "";

  const googleImages = [
    "google_shopping_image_1",
    "google_shopping_image_2",
    "google_shopping_image_3",
    "google_shopping_image_url",
  ]
    .map((c) => mediaAttrUrl(raw(c)))
    .filter(Boolean);

  const videos = [
    ...new Set(
      [...String(raw("video")).matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0]),
    ),
  ];

  return {
    /* identity */
    sourceProductId: String(item.id || ""),
    sourceSku: item.sku || "",
    sourceType: item.__typename || "",
    sourceHandle: item.url_key || "",
    sourceUrl: `${BASE}/${item.url_key || ""}${item.url_suffix || ".html"}`,
    canonicalUrl: item.canonical_url
      ? `${BASE}/${String(item.canonical_url).replace(/^\//, "")}`
      : "",

    /* copy */
    name: cleanText(item.name) || item.sku,
    description:
      (item.description && item.description.html) ||
      (item.short_description && item.short_description.html) ||
      cleanText(item.name) ||
      item.sku,
    shortDescription: cleanText(
      (item.short_description && item.short_description.html) || "",
    ),
    tagline: cleanText(raw("tagline")),
    metaTitle: item.meta_title || "",
    metaDescription: item.meta_description || "",
    metaKeywords: item.meta_keyword || "",

    /* money */
    price,
    packPrice: price,
    pricePerSqm:
      sqmPrice ?? (coverage && price ? Number((price / coverage).toFixed(2)) : null),
    priceCurrency: (minPrice.regular_price && minPrice.regular_price.currency) || "GBP",
    rrpIncVat: price,
    specialPrice: onPromo ? promo : null,
    specialPriceFrom: val("special_from_date") || "",
    specialPriceTo: item.special_to_date || val("special_to_date") || "",
    tierPrices: (item.price_tiers || []).map((t) => ({
      quantity: num(t.quantity),
      price: num(t.final_price && t.final_price.value),
      amountOff: num(t.discount && t.discount.amount_off),
      percentOff: num(t.discount && t.discount.percent_off),
    })),
    vatRate: 20,
    isPoa: isTrue(raw("product_poa")),

    /* stock + logistics */
    stock: num(item.only_x_left_in_stock) ?? 1000,
    stockStatus,
    isOutOfStock: stockStatus === "out_of_stock",
    minSaleQty: num(item.min_sale_qty),
    maxSaleQty: num(item.max_sale_qty),
    weight: num(item.weight),
    weightUnit: "kg",
    countryOfManufacture: item.country_of_manufacture || val("product_origin") || "",
    etaDate: val("eta_date"),
    discontinued:
      isTrue(raw("discontinued_product")) || /yes/i.test(val("discontinued_product")),
    restrictOnlineSale: isTrue(raw("restrict_online_sale")),

    /* media */
    images: images.slice(0, MAX_IMAGES),
    _imageSources: imageSources.slice(0, MAX_IMAGES),
    videos,
    externalVideos,
    hoverImage: mediaAttrUrl(raw("rollover_image")),
    topDownImage: mediaAttrUrl(raw("topdown_image")),

    /* structured content */
    attributes,
    dimensionRows,
    dimensions,
    specs,
    usps,
    testResults,
    usage,
    suitability,
    productSections,
    badges,
    features: [val("features")].filter(Boolean),
    finish:
      val("finish_select") || val("finish") || val("prodfinish") || val("lamfinish") || "",
    colours: ((byCode.get("shade1") || byCode.get("color") || {}).options || []).map(
      (o) => o.label,
    ),
    materials: ((byCode.get("species1") || {}).options || []).map((o) => o.label),
    warranty:
      val("product_guarantee") || val("wood_guarantee") || val("underlay_guarentee") || "",
    complianceCertificates: val("product_certification")
      ? val("product_certification").split(/\s*,\s*/).filter(Boolean)
      : [],
    unitOfMeasure: val("pack_size") ? "Pack" : "",
    soldPerUnit: !coverage,
    areaCalculator: isTrue(raw("calculator")) || isTrue(raw("new_calculator")),
    freeSample: isTrue(raw("free_sample")),
    sampleSku: val("sam_search_term"),
    showSpecs: true,

    /* variants + options */
    variants,
    shopifyOptions,
    optionElements,

    /* codes */
    linxSku: item.sku || "",
    supplierSku: item.sku || "",
    manufacturerSku: val("mpn") || "",
    productCode: item.sku || "",
    legacyProductCode: val("product_code"),
    barcode: val("gtin"),
    rangeName,
    supplierRefs,

    /* reviews */
    reviewSummary: {
      rating: item.rating_summary != null ? Number(item.rating_summary) / 20 : null,
      count: item.review_count || 0,
      source: "luxuryflooring.co.uk",
    },
    sourceReviews,

    /* relations */
    relatedHandles: [
      ...new Set([...handlesOf(item.related_products), ...alternatives]),
    ],
    upsellHandles: handlesOf(item.upsell_products),
    crosssellHandles: handlesOf(item.crosssell_products),

    /* feeds + merchandising */
    googleShopping: {
      title: val("google_shopping_title"),
      description:
        val("google_shopping_description2") || val("google_shopping_description"),
      productType: val("google_shopping_product_type"),
      category: val("google_shopping_product_cat"),
      shipping: val("google_shopping_shipping"),
      price: val("google_shopping_price_2"),
      images: googleImages,
    },
    merchandising: {
      bestSellersIndex: val("best_sellers_index"),
      highestRatedIndex: val("highest_rated_index"),
      mostViewedIndex: val("most_viewed_index"),
      mostWishedForIndex: val("most_wished_for_index"),
      justRatedIndex: val("just_rated_index"),
      score: val("product_merchandising_score"),
      featuredOnCategory: isTrue(raw("category_featured")),
      homepageOffer: isTrue(raw("homepageoffer")),
      homepageBestSeller: isTrue(raw("homepagebest")),
    },

    /* lossless source record */
    sourceAttributes: rows,
    sourceCategories: (item.categories || [])
      .filter(
        (c) =>
          c &&
          !String(c.url_path || "")
            .split("/")
            .some((s) => EXCLUDED_ROOTS.has(s)),
      )
      .map((c) => {
        const segs = String(c.url_path || "").split("/");
        const parentSeg = segs[segs.length - 2] || "";
        return {
          externalId: String(c.id ?? ""),
          name: cleanText(c.name || ""),
          urlKey: c.url_key || "",
          urlPath: c.url_path || "",
          level: c.level ?? null,
          group: ctx.shelfSlugs.has(parentSeg) ? groupLabel(parentSeg) : "",
        };
      }),

    _manufacturer: manufacturer,
  };
}

/* ------------------------------------------------------------- persistence */

async function ensureBrand(db) {
  const brands = db.collection("brands");
  let brand = await brands.findOne({ slug: BRAND_SLUG });
  const now = new Date();
  const payload = {
    name: BRAND_NAME,
    uiName: BRAND_UI_NAME,
    slug: BRAND_SLUG,
    isActive: true,
    updatedAt: now,
  };
  if (!brand) {
    const insert = { ...payload, order: 86, image: "", subBrands: [], createdAt: now };
    if (DRY_RUN) {
      brand = { ...insert, _id: "dry-brand" };
      log(`[dry] create brand ${BRAND_NAME} (UI: ${BRAND_UI_NAME})`);
    } else {
      const r = await brands.insertOne(insert);
      brand = { ...insert, _id: r.insertedId };
      log(`Created brand ${BRAND_NAME} (UI: ${BRAND_UI_NAME}) ${brand._id}`);
    }
  } else if (!DRY_RUN) {
    await brands.updateOne({ _id: brand._id }, { $set: payload });
    brand = { ...brand, ...payload };
    log(`Using brand ${brand.name} uiName=${BRAND_UI_NAME} (${brand._id})`);
  }
  return brand;
}

async function ensureSubBrand(db, brand, name) {
  const slug = slugify(name);
  if (!slug || DRY_RUN) return slug;
  const list = Array.isArray(brand.subBrands) ? brand.subBrands : [];
  if (list.some((s) => s.slug === slug)) return slug;
  await db
    .collection("brands")
    .updateOne(
      { _id: brand._id },
      { $addToSet: { subBrands: { name, slug } }, $set: { updatedAt: new Date() } },
    );
  brand.subBrands = [...list, { name, slug }];
  return slug;
}

async function ensureMenu(db, { name, slug, parent, brandId, order, group, departmentId }) {
  const menus = db.collection("menus");
  const query = { slug, parent: parent || null, brand: brandId };
  let menu = DRY_RUN ? null : await menus.findOne(query);
  const now = new Date();
  if (!menu) {
    const insert = {
      name,
      slug,
      parent: parent || null,
      brand: brandId,
      order: order ?? 0,
      group: group || "",
      isActive: true,
      image: "",
      level: parent ? "subcategory" : "category",
      department: departmentId || null,
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      menu = { ...insert, _id: `dry-${slug}-${parent || "root"}` };
    } else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
      log(`  + menu ${parent ? "sub" : "cat"} ${name}${group ? ` [${group}]` : ""}`);
    }
  } else if (!DRY_RUN) {
    const set = { name, isActive: true, updatedAt: now, order: order ?? menu.order };
    if (group) set.group = group;
    if (departmentId) set.department = departmentId;
    await menus.updateOne({ _id: menu._id }, { $set: set });
    menu = { ...menu, ...set };
  }
  return menu;
}

function saveProgress(done) {
  fs.writeFileSync(
    PROGRESS,
    JSON.stringify({ at: new Date().toISOString(), done: [...done] }, null, 2),
  );
}

/* -------------------------------------------------------------------- main */

async function main() {
  if (!RESUME) fs.writeFileSync(LOG, `Luxury Flooring import ${new Date().toISOString()}\n`);
  log(
    `Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"} concurrency=${CONCURRENCY} limit=${LIMIT || "none"}`,
  );

  /* 1. Categories + product discovery ---------------------------------- */
  let catalogue = null;
  if (RESUME && fs.existsSync(CHECKPOINT)) {
    catalogue = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    log(
      `Resumed catalogue: ${catalogue.nodes.length} categories, ${catalogue.products.length} products`,
    );
  } else {
    log("Discovering categories from sitemap…");
    const paths = await discoverCategoryPaths();
    log(`Sitemap category paths under the six roots: ${paths.length}`);
    const nodes = await buildCategoryTree(paths);
    const shelfSlugs = [
      ...new Set(
        nodes.flatMap((n) => n.chain.map((c) => c.group).filter(Boolean).map(slugify)),
      ),
    ];
    log(`Grouping shelves: ${shelfSlugs.join(", ") || "(none)"}`);

    const membership = new Map(); // url_key → { root, paths[] }
    const rank = (s) => MAIN_NAV.findIndex((n) => n.slug === s);
    const crawlTargets = [
      ...MAIN_NAV.map((n) => ({ root: n.slug, path: n.slug })),
      ...nodes.map((n) => ({ root: n.root, path: n.path })),
    ];
    log(`Crawling ${crawlTargets.length} listing pages…`);
    let crawled = 0;
    await mapPool(crawlTargets, CONCURRENCY, async (t) => {
      const links = await crawlCategory(t.path);
      for (const href of links) {
        const key = href.replace(`${BASE}/`, "").replace(/\.html$/, "");
        if (!key || key.includes("/")) continue;
        const entry = membership.get(key) || { root: t.root, paths: [] };
        if (!entry.paths.includes(t.path)) entry.paths.push(t.path);
        // The first root in nav order that lists a product is its primary.
        if (rank(t.root) >= 0 && (rank(entry.root) < 0 || rank(t.root) < rank(entry.root))) {
          entry.root = t.root;
        }
        membership.set(key, entry);
      }
      crawled += 1;
      if (crawled % 20 === 0) {
        log(`  …${crawled}/${crawlTargets.length} listings, ${membership.size} products so far`);
      }
    });

    catalogue = {
      at: new Date().toISOString(),
      shelfSlugs,
      nodes,
      products: [...membership.entries()].map(([urlKey, v]) => ({
        urlKey,
        root: v.root,
        paths: v.paths,
      })),
    };
    fs.writeFileSync(CHECKPOINT, JSON.stringify(catalogue, null, 2));
    log(`Discovered ${catalogue.products.length} products across ${nodes.length} categories`);
  }

  // Applied on fresh and resumed runs alike, so an existing checkpoint still
  // picks up products no category listing reached.
  {
    const known = new Set(catalogue.products.map((p) => p.urlKey));
    const extra = await discoverRootProductCandidates(known);
    if (extra.length) {
      log(`Sitemap adds ${extra.length} product URL(s) no category listing reached`);
      for (const urlKey of extra) {
        // No shelf is known yet; `persist` recovers it from the product's own
        // categories, and drops anything that lives only under SALE.
        catalogue.products.push({ urlKey, root: "", paths: [] });
      }
      fs.writeFileSync(CHECKPOINT, JSON.stringify(catalogue, null, 2));
    }
  }

  if (DISCOVER_ONLY) {
    log("DISCOVER_ONLY set — stopping before import.");
    return;
  }

  /* 2. Brand, departments and menus ------------------------------------ */
  const conn = await connectMongo();
  const db = conn.db;
  const brand = await ensureBrand(db);
  const productsCol = db.collection("products");

  const deptDocs = await db
    .collection("departments")
    .find({}, { projection: { slug: 1 } })
    .toArray();
  const deptBySlug = new Map(deptDocs.map((d) => [d.slug, d._id]));

  const menuByPath = new Map();
  for (const nav of MAIN_NAV) {
    const menu = await ensureMenu(db, {
      name: nav.name,
      slug: nav.slug,
      parent: null,
      brandId: brand._id,
      order: nav.order,
      group: "",
      departmentId: deptBySlug.get(nav.department) || null,
    });
    menuByPath.set(nav.slug, menu);
  }
  // Shallowest first, so a parent always exists before its child.
  const orderedNodes = [...catalogue.nodes].sort(
    (a, b) => a.chain.length - b.chain.length || a.path.localeCompare(b.path),
  );
  for (const node of orderedNodes) {
    const nav = MAIN_NAV.find((n) => n.slug === node.root);
    let parent = menuByPath.get(node.root);
    for (const [i, link] of node.chain.entries()) {
      if (menuByPath.has(link.path)) {
        parent = menuByPath.get(link.path);
        continue;
      }
      const menu = await ensureMenu(db, {
        name: titleCase(link.slug),
        slug: link.slug,
        parent: parent ? parent._id : null,
        brandId: brand._id,
        order: i,
        group: groupLabel(link.group),
        departmentId: nav ? deptBySlug.get(nav.department) || null : null,
      });
      menuByPath.set(link.path, menu);
      parent = menu;
    }
  }
  log(`Menus ready: ${menuByPath.size}`);

  /* 3. Products -------------------------------------------------------- */
  const meta = await loadAttributeMeta();
  log(`Attribute metadata: ${meta.size} codes`);
  const ctx = { shelfSlugs: new Set(catalogue.shelfSlugs) };

  let targets = catalogue.products;
  if (ONLY_SLUG) targets = targets.filter((p) => p.urlKey.toLowerCase() === ONLY_SLUG);

  const done = new Set();
  if (RESUME && fs.existsSync(PROGRESS)) {
    for (const k of JSON.parse(fs.readFileSync(PROGRESS, "utf8")).done || []) done.add(k);
    log(`Resuming — ${done.size} already imported`);
  }
  targets = targets.filter((p) => !done.has(p.urlKey));
  if (LIMIT) targets = targets.slice(0, LIMIT);
  log(`To import: ${targets.length}`);

  let created = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;
  let notProduct = 0;

  /** Map, mirror the media, and write one product. */
  async function persist(t, item) {
    try {
      const p = mapProduct(item, meta, ctx);

      /*
       * Category membership.
       *
       * Two sources disagree and each is right about something. The product's
       * own `categories` say what the thing *is* — a solid oak herringbone is
       * filed under Solid Wood and nothing else. The crawl says where the site
       * *surfaces* it, and several of this store's listings are virtual
       * categories that pull in anything matching a filter, which is why that
       * same solid floor also appears on the Engineered Wood and Parquet
       * pages. Taking the crawl as primary filed every parquet under
       * engineered wood and left the Parquet department empty.
       *
       * So the primary comes from the product's own record, and the crawl only
       * adds membership. A product whose own categories are all promotional
       * (or which has none) falls back to where it was crawled; one with
       * neither is sale-only, which the brief excludes.
       */
      const isRoot = (x) => MAIN_NAV.some((n) => n.slug === x);
      const navRank = (x) => MAIN_NAV.findIndex((n) => n.slug === x);
      const underRoot = (x) => isRoot(String(x).split("/")[0]);

      const ownPaths = p.sourceCategories.map((c) => c.urlPath).filter(Boolean);
      const paths = [...new Set([...ownPaths, ...t.paths])].filter(
        (x) => underRoot(x) && !x.split("/").some((seg) => EXCLUDED_ROOTS.has(seg)),
      );

      const rootsOf = (list) => [
        ...new Set(list.map((x) => String(x).split("/")[0]).filter(isRoot)),
      ];
      const rootPool = rootsOf(ownPaths).length
        ? rootsOf(ownPaths)
        : rootsOf(t.paths);
      if (!rootPool.length) {
        skipped += 1;
        log(`  – ${t.urlKey}: no category outside SALE/Clearance`);
        return;
      }
      const root = rootPool.sort((a, b) => navRank(a) - navRank(b))[0];

      const nav = MAIN_NAV.find((n) => n.slug === root) || MAIN_NAV[0];
      // A sibling root is a category, not a subcategory; it is already carried
      // in `categories`.
      const subPaths = paths.filter((x) => x !== nav.slug && !isRoot(x));
      const subSlugs = [
        ...new Set(subPaths.map((x) => x.split("/").pop()).filter(Boolean)),
      ];
      const categories = rootsOf(paths);

      // Square metres one pack covers, however the supplier punctuated it.
      const packCoverage =
        num(p.specs.coverage) ||
        num(p.specs.flooring_coverage) ||
        num(p.specs.pack_size) ||
        0;

      const handle = slugify(p.sourceHandle || p.name) || `lf-${p.sourceProductId}`;
      // The gallery goes up in one pass rather than one at a time: the origin
      // is the slow half of this import, and its 500s are load-independent.
      const uploaded = [
        ...new Set(
          (
            await Promise.all(
              p._imageSources.map((sources, n) =>
                uploadRemoteImage(sources, `${handle}-${n + 1}`),
              ),
            )
          ).filter(Boolean),
        ),
      ];
      delete p._imageSources;

      const [hover, topDown, uspImages, feedImages] = await Promise.all([
        p.hoverImage ? uploadRemoteImage(p.hoverImage, `${handle}-hover`) : "",
        p.topDownImage ? uploadRemoteImage(p.topDownImage, `${handle}-topdown`) : "",
        Promise.all(
          p.usps.map((u, n) =>
            u.image ? uploadRemoteImage(u.image, `${handle}-usp-${n + 1}`) : "",
          ),
        ),
        // Feed artwork is staged too, so the Cloudinary → Shopify mirror has a
        // single place to pick every asset up from.
        Promise.all(
          p.googleShopping.images.map((u, n) =>
            uploadRemoteImage(u, `${handle}-gfeed-${n + 1}`),
          ),
        ),
      ]);
      p.hoverImage = hover;
      p.topDownImage = topDown;
      p.usps.forEach((u, n) => {
        u.image = uspImages[n] || "";
      });
      p.googleShopping.images = feedImages.filter(Boolean);

      const subBrand = p._manufacturer
        ? await ensureSubBrand(db, brand, p._manufacturer)
        : "";
      delete p._manufacturer;

      const now = new Date();
      const doc = {
        ...p,
        images: uploaded,
        department: nav.department,
        category: nav.slug,
        categories,
        subCategory: subSlugs[0] || "",
        subCategories: subSlugs,
        brand: brand._id,
        brands: [brand._id],
        subBrand,
        supplierCategory: paths.join(" | "),
        specs: {
          ...p.specs,
          /*
           * Pack coverage and the per-m2 rate, under the keys the rest of the
           * app looks for.
           *
           * The PDP resolves pack coverage from `sqmPerBox` / `Pack Coverage` /
           * `packCoverage` — the supplier's own `coverage` key is not one of
           * them, so without this the pack configurator never appears. And
           * `verifyConfiguredUnitPrice` only reads a rate as per-m2 when
           * `pricePerM2` is set; left unset it treats a pack price as a per-m2
           * price and floors a configured line at roughly twice what was
           * quoted, so Shopify checkout refuses the basket as tampered.
           */
          ...(packCoverage > 0 && p.price > 0
            ? {
                sqmPerBox: packCoverage,
                pricePerM2: Math.round((p.price / packCoverage) * 100) / 100,
              }
            : {}),
          source: SOURCE_TAG,
          sourceUrl: p.sourceUrl,
          sourceSku: p.sourceSku,
          sourcePaths: paths,
          importedAt: now.toISOString(),
        },
        updatedAt: now,
        priceSyncedAt: now,
        stockSyncedAt: now,
      };

      delete p._imageSources;

      if (DRY_RUN) {
        log(
          `  [dry] ${doc.name} £${doc.price} imgs=${p.images.length} attrs=${doc.attributes.length} src=${doc.sourceAttributes.length} vars=${doc.variants.length} cat=${doc.category}/${doc.subCategory}`,
        );
        created += 1;
      } else {
        const existing = await productsCol.findOne({
          "specs.source": SOURCE_TAG,
          $or: [
            { sourceHandle: p.sourceHandle },
            { sourceSku: p.sourceSku },
            { "specs.sourceUrl": p.sourceUrl },
          ],
        });
        if (existing) {
          // A failed image pass must not blank a gallery we already have.
          if (!uploaded.length && Array.isArray(existing.images) && existing.images.length) {
            doc.images = existing.images;
          }
          await productsCol.updateOne({ _id: existing._id }, { $set: doc });
          updated += 1;
        } else {
          await productsCol.insertOne({ ...doc, createdAt: now });
          created += 1;
        }
        log(
          `  ✓ ${doc.name} £${doc.price} imgs=${doc.images.length} attrs=${doc.attributes.length} src=${doc.sourceAttributes.length} vars=${doc.variants.length}`,
        );
      }
      done.add(t.urlKey);
    } catch (e) {
      failed += 1;
      log(`  ✗ ${t.urlKey}: ${e.message}`);
    }
  }

  let processed = 0;
  await mapPool(targets, CONCURRENCY, async (t) => {
    try {
      const { item, via } = await resolveProduct(t);
      if (!item) {
        if (via === "not-a-product") notProduct += 1;
        else if (via === "404") {
          failed += 1;
          log(`  ✗ ${t.urlKey}: PDP 404`);
        } else {
          skipped += 1;
          log(`  – ${t.urlKey}: not found by slug, name or SKU search`);
        }
        return;
      }
      await persist(t, item);
    } catch (e) {
      failed += 1;
      log(`  ✗ ${t.urlKey}: ${e.message}`);
    }
    processed += 1;
    if (processed % 25 === 0) {
      saveProgress(done);
      log(`Progress: ${processed}/${targets.length} — ${created + updated} written`);
    }
    await delay(REQUEST_GAP_MS);
  });
  saveProgress(done);
  log(
    `Finished pass: ${processed}/${targets.length} seen, ${created + updated} written (${done.size} done overall)`,
  );


  /* 4. Resolve handle relations to real ids ---------------------------- */
  if (!DRY_RUN) {
    const all = await productsCol
      .find(
        { "specs.source": SOURCE_TAG },
        {
          projection: {
            sourceHandle: 1,
            relatedHandles: 1,
            upsellHandles: 1,
            crosssellHandles: 1,
          },
        },
      )
      .toArray();
    const idByHandle = new Map(all.map((d) => [d.sourceHandle, d._id]));
    let linked = 0;
    for (const d of all) {
      const related = [
        ...new Set([...(d.relatedHandles || []), ...(d.crosssellHandles || [])]),
      ]
        .map((h) => idByHandle.get(h))
        .filter(Boolean);
      const accessories = (d.upsellHandles || [])
        .map((h) => idByHandle.get(h))
        .filter(Boolean);
      if (!related.length && !accessories.length) continue;
      await productsCol.updateOne(
        { _id: d._id },
        {
          $set: {
            relatedProductIds: related,
            accessoryProductIds: accessories,
            updatedAt: new Date(),
          },
        },
      );
      linked += 1;
    }
    log(`Linked related/accessory products on ${linked} records`);
  }

  log("========== LUXURY FLOORING IMPORT ==========");
  log(`Created:  ${created}`);
  log(`Updated:  ${updated}`);
  log(`Skipped:  ${skipped} (sale-only or unresolvable)`);
  log(`Non-product URLs: ${notProduct}`);
  log(`Failed:   ${failed}`);
  log(`Brand:    ${BRAND_NAME} / UI ${BRAND_UI_NAME}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
