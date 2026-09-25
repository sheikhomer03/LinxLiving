/**
 * Capture aicabathrooms.co.uk (AICA) into a JSONL store (crawl only — no Mongo
 * or Shopify writes of any kind).
 *
 * Plain Shopify storefront, no bot-check. Sources, all read-only:
 *   Stage A (categories):
 *     - /collections.json            every published collection (60)
 *     - homepage nav                 the real menu tree (depth-1 / depth-2)
 *     - /collections/<h>/products.json  per-collection membership, so each
 *       product records EVERY collection it is listed under
 *     - /products.json + sitemap_products_1.xml, cross-checked, so no product
 *       that is live on the storefront is missed (collection products_count
 *       also counts unpublished items Shopify never serves — ignore it)
 *   Stage B (per product):
 *     - products.json record (raw)   variants, options, images w/ variant_ids
 *     - /products/<h>.js (raw)       media (incl. video/3D), barcode, weight,
 *                                    inventory mode, quantity rules, alt text
 *     - product page HTML            rating/review count, JSON-LD, breadcrumb,
 *                                    gallery, manuals/PDFs, embedded videos,
 *                                    notes/delivery blocks, related products,
 *                                    full page text (kept raw for re-parsing)
 *
 * Env:
 *   LIMIT=n        stop stage B after n products (smoke test)
 *   CONCURRENCY=n  parallel fetches (default 4)
 *   FRESH=1        ignore existing checkpoints and start over
 *   CATS_ONLY=1    stop after stage A
 */
const path = require("path");
const fs = require("fs");

const ORIGIN = "https://www.aicabathrooms.co.uk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Pin the UK market. Without it, Shopify Markets can geolocate the request
// elsewhere and serve ex-VAT prices (£81.67 instead of the £98.00 a UK
// visitor sees) — verified per product below via priceCheck.
const GB_COOKIE = "localization=GB; cart_currency=GBP";

const DATA =
  process.env.AICA_DATA || "/Users/niazig/Desktop/linxliving/LinxLiving/.scratch/aica";
fs.mkdirSync(DATA, { recursive: true });

const LIMIT = Number(process.env.LIMIT) || Infinity;
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 4, 8));
const FRESH = process.env.FRESH === "1";
const CATS_ONLY = process.env.CATS_ONLY === "1";

const CATS_FILE = path.join(DATA, "aica-categories.json"); // stage A: collections + nav + membership
const PRODUCTS_FILE = path.join(DATA, "aica-products.json"); // stage A: raw products.json records
const PDP_FILE = path.join(DATA, "aica-pdp.jsonl"); // stage B: detail records
const PDP_DONE_FILE = path.join(DATA, "aica-pdp-done.json"); // stage B: ids done (ok or error)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*", cookie: GB_COOKIE } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(3000 * (i + 1));
        continue;
      }
      if (!res.ok) return { status: res.status, text: null };
      return { status: res.status, text: await res.text() };
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(2000 * (i + 1));
    }
  }
  throw new Error(`gave up after ${tries} tries: ${url}`);
}

async function getJson(url) {
  const r = await get(url);
  if (!r.text) throw new Error(`HTTP ${r.status}: ${url}`);
  return JSON.parse(r.text);
}

async function paged(base, key) {
  const out = [];
  for (let page = 1; page < 100; page++) {
    const d = await getJson(`${base}${base.includes("?") ? "&" : "?"}limit=250&page=${page}`);
    if (!d[key] || !d[key].length) break;
    out.push(...d[key]);
    await sleep(300);
  }
  return out;
}

const decode = (s) =>
  String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&pound;/g, "£")
    .replace(/&times;/g, "×")
    .replace(/&deg;/g, "°")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const stripTags = (h) =>
  decode(
    String(h || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

// Block-aware text: keeps one line per <li>/<p>/<br>/<tr>, so a spec list
// stays one-spec-per-line (see PLAYBOOK rule 6).
const toLines = (h) =>
  decode(
    String(h || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|div|tr|h[1-6]|ul|ol|table)>/gi, "\n")
      .replace(/<\/t[dh]>/gi, "\t")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

const absUrl = (u) => {
  if (!u) return u;
  u = decode(u).trim();
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("/")) return ORIGIN + u;
  return u;
};

// Strip Shopify size suffixes (_1024x1024, _x800, _800x) to get the original.
const fullRes = (u) =>
  absUrl(u)
    .replace(/_(\d+x\d*|x\d+|\d+x)(@\dx)?(?=\.(jpe?g|png|gif|webp|avif)(\?|$))/i, "")
    .replace(/[?&]width=\d+/, "");

// Same file is served from cdn.shopify.com/s/files/1/<shop>/X and
// www.<site>/cdn/shop/X — key on the "products|files/..." tail, sans query.
const imageKey = (u) => {
  const m = fullRes(u).split("?")[0].match(/\/(?:products|files)\/[^/]+$/);
  return m ? m[0].toLowerCase() : fullRes(u).split("?")[0];
};
const isImageUrl = (u) =>
  /^https:\/\/(cdn\.shopify\.com\/s\/files\/|www\.aicabathrooms\.co\.uk\/cdn\/shop\/|img\.aicabathrooms\.co\.uk\/)/i.test(absUrl(u)) &&
  /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(absUrl(u));

// ---------- specs from description ----------
// Each description line of shape "Label: value" / "Label：value" becomes a spec.
// Label must be short (≤ 40 chars, ≤ 6 words) so prose sentences that happen to
// contain a colon are not mistaken for specs; everything is also kept raw.
function parseSpecs(lines) {
  const specs = [];
  for (const line of lines) {
    const m = line.match(/^([^:：]{1,40}?)\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const label = m[1].trim();
    if (label.split(/\s+/).length > 6 || /^https?$/i.test(label)) continue;
    // "700x1850mm (Adjustment range: 686-716mm)" is a size row, not a label
    if (/^\d/.test(label) || (label.match(/\(/g) || []).length !== (label.match(/\)/g) || []).length) continue;
    specs.push({ label, value: m[2].trim() });
  }
  return specs;
}

// Tables inside the description: rows of cell text plus any links per cell.
function parseHtmlTables(html) {
  return [...String(html || "").matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((t) =>
    [...t[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((r) =>
      [...r[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => {
        const links = [...c[1].matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map((m) => absUrl(m[1]));
        return links.length ? { text: stripTags(c[1]), links } : stripTags(c[1]);
      })
    )
  );
}

// A table where every non-empty row is exactly [label, value] is a spec table.
function tableSpecs(tables) {
  const specs = [];
  for (const t of tables) {
    const rows = t.filter((r) => r.some((c) => (typeof c === "string" ? c : c.text)));
    if (!rows.length || !rows.every((r) => r.length === 2)) continue;
    for (const [a, b] of rows) {
      const label = (typeof a === "string" ? a : a.text).replace(/[:：]\s*$/, "").trim();
      const value = (typeof b === "string" ? b : b.text).trim();
      if (label && value) specs.push({ label, value, source: "table" });
    }
  }
  return specs;
}

// Tags on this store carry facets like "Width: 700mm", "Glass: 6mm".
function parseTagFacets(tags) {
  const facets = {};
  for (const t of tags || []) {
    const m = String(t).match(/^([^:]{1,40}):\s*(.+)$/);
    if (!m) continue;
    (facets[m[1].trim()] ||= []).push(m[2].trim());
  }
  return facets;
}

// ---------- nav tree ----------
// Walks the first (desktop) `navmenu-depth-1` <ul> to its balanced close. Every
// <ul> (menu or not) is tracked so a stray non-menu </ul> can't unbalance the
// stack; a nested navmenu <ul> hangs off the last link at the enclosing level.
function parseNavAt(html, startIndex) {
  const tok = /<ul\b([^>]*)>|<\/ul>|<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  tok.lastIndex = startIndex;
  const root = { title: "ROOT", url: null, children: [] };
  const stack = []; // { node, lastChild }
  let m;
  while ((m = tok.exec(html))) {
    if (m[0].startsWith("<ul")) {
      const isMenu = /navmenu-depth-\d/.test(m[1] || "");
      const top = stack[stack.length - 1];
      const node = !top ? root : isMenu && top.lastChild ? top.lastChild : top.node;
      stack.push({ node, lastChild: null });
    } else if (m[0] === "</ul>") {
      stack.pop();
      if (!stack.length) break;
    } else if (stack.length) {
      const title = stripTags(m[3]);
      if (!title) continue;
      const top = stack[stack.length - 1];
      const node = { title, url: absUrl(m[2]), children: [] };
      top.node.children.push(node);
      top.lastChild = node;
    }
  }
  return root.children;
}

// Every depth-1 menu on the page (utility bar, main menu, mobile, footer);
// the main catalogue menu is the one with the most links.
function parseNav(html) {
  const count = (ns) => ns.reduce((a, n) => a + 1 + count(n.children), 0);
  const menus = [...html.matchAll(/<ul\b[^>]*class="[^"]*navmenu-depth-1[^"]*"[^>]*>/gi)]
    .map((m) => parseNavAt(html, m.index))
    .filter((t) => t.length);
  const main = menus.reduce((a, b) => (count(b) > count(a) ? b : a), []);
  return { main, allMenus: menus };
}

// ---------- PDP HTML ----------
function parsePdp(html) {
  const out = {};
  const mainStart = html.indexOf("<main");
  const mainEnd = html.indexOf("</main>", mainStart);
  const main = mainStart >= 0 ? html.slice(mainStart, mainEnd > 0 ? mainEnd : undefined) : html;

  // JSON-LD blocks, raw + parsed
  out.jsonLd = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.jsonLd.push(JSON.parse(m[1]));
    } catch {
      out.jsonLd.push({ _unparsed: m[1].trim() });
    }
  }
  const ldProduct = out.jsonLd.find((j) => j && j["@type"] === "Product");
  const ldCrumb = out.jsonLd.find((j) => j && j["@type"] === "BreadcrumbList");
  out.breadcrumb = ldCrumb?.itemListElement?.map((e) => ({ name: e.item?.name, url: e.item?.["@id"] })) || [];

  // Rating
  const aria = main.match(/aria-label="([\d.]+) out of ([\d.]+) stars"/i);
  const rc = main.match(/(\d+)\s+Reviews?\b/i);
  out.rating = {
    value: aria ? Number(aria[1]) : ldProduct?.aggregateRating ? Number(ldProduct.aggregateRating.ratingValue) : null,
    best: aria ? Number(aria[2]) : null,
    count: ldProduct?.aggregateRating?.ratingCount != null
      ? Number(ldProduct.aggregateRating.ratingCount)
      : ldProduct?.aggregateRating?.reviewCount != null
        ? Number(ldProduct.aggregateRating.reviewCount)
        : rc ? Number(rc[1]) : 0,
  };

  // Gallery: every image referenced inside the product media area of <main>
  const imgs = new Set();
  for (const m of main.matchAll(/(?:src|data-zoom|data-src|href|srcset|data-srcset|data-image)="([^"]+)"/gi)) {
    for (const part of m[1].split(",")) {
      const u = part.trim().split(/\s+/)[0];
      if (isImageUrl(u)) imgs.add(fullRes(u));
    }
  }
  out.pageImages = [...imgs];

  // Documents / manuals / videos anywhere in main
  out.documents = [];
  const seenDoc = new Set();
  for (const m of main.matchAll(/<a\b[^>]*href="([^"]+\.(?:pdf|docx?|xlsx?|zip|dwg)(?:\?[^"]*)?)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absUrl(m[1]);
    if (seenDoc.has(url)) continue;
    seenDoc.add(url);
    out.documents.push({ url, label: stripTags(m[2]) });
  }
  out.videos = [];
  const seenVid = new Set();
  for (const m of main.matchAll(/(?:src|href|data-src)="([^"]*(?:youtube\.com|youtu\.be|vimeo\.com|\.mp4|\.webm|\.m3u8)[^"]*)"/gi)) {
    const url = absUrl(m[1]);
    if (!seenVid.has(url)) seenVid.add(url) && out.videos.push(url);
  }

  // Related / recommended product handles shown on the page
  out.relatedHandles = [...new Set([...main.matchAll(/href="(?:https?:\/\/[^"/]+)?\/(?:collections\/[^"/]+\/)?products\/([^"?#/]+)/gi)].map((m) => m[1]))];

  // Full page text (raw — so any re-parse never needs the network)
  const text = stripTags(main);
  const cut = text.indexOf("You recently viewed");
  out.pageText = cut > 0 ? text.slice(0, cut).trim() : text;

  // Notes near the add-to-cart button, e.g. "Note, do not book an installer..."
  const afterCart = out.pageText.split(/Add to cart|Sold out|Unavailable/i)[1] || "";
  out.cartNote = (afterCart.split(/Share this:/)[0] || "").trim() || null;

  // Delivery block (shared template text, but kept per product in case it differs)
  const dz = out.pageText.indexOf("Delivery Zone Notice");
  out.deliveryText = dz >= 0 ? out.pageText.slice(dz) : null;

  // Any tables in main (delivery zones, size charts, spec tables)
  out.tables = [...main.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((t) =>
    [...t[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((r) =>
      [...r[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]))
    )
  );

  // Calculator / numeric inputs other than quantity, if any exist on the page
  out.calculatorHints = [...new Set(
    [...main.matchAll(/<input\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter((i) => /type="number"/i.test(i) && !/quantity/i.test(i))
  )];
  out.hasCalculator = /calculat/i.test(main) || out.calculatorHints.length > 0;

  out.ldOffers = ldProduct?.offers || null;
  return out;
}

// ---------- stage A ----------
async function stageA() {
  if (!FRESH && fs.existsSync(CATS_FILE) && fs.existsSync(PRODUCTS_FILE)) {
    console.log("[A] using cached", CATS_FILE);
    return {
      cats: JSON.parse(fs.readFileSync(CATS_FILE, "utf8")),
      products: JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8")),
    };
  }
  console.log("[A] homepage nav");
  const home = await get(ORIGIN + "/");
  const nav = parseNav(home.text || "");

  console.log("[A] collections.json");
  const collections = await paged(ORIGIN + "/collections.json", "collections");

  console.log("[A] products.json");
  const products = await paged(ORIGIN + "/products.json", "products");

  console.log("[A] sitemap");
  const idx = (await get(ORIGIN + "/sitemap.xml")).text || "";
  const smHandles = new Set();
  for (const m of idx.matchAll(/<loc>([^<]*sitemap_products_[^<]*)<\/loc>/g)) {
    const sm = (await get(decode(m[1]))).text || "";
    for (const x of sm.matchAll(/<loc>https?:\/\/[^<]*\/products\/([^<]+)<\/loc>/g)) smHandles.add(x[1]);
  }

  // Any sitemap product missing from products.json — fetch its .json directly.
  const byHandle = new Map(products.map((p) => [p.handle, p]));
  for (const h of smHandles) {
    if (byHandle.has(h)) continue;
    console.log("[A] sitemap-only product, fetching:", h);
    try {
      const d = await getJson(`${ORIGIN}/products/${h}.json`);
      products.push(d.product);
      byHandle.set(h, d.product);
    } catch (e) {
      console.log("  failed:", e.message);
    }
  }

  console.log(`[A] membership for ${collections.length} collections`);
  const membership = {}; // handle -> [collection handles]
  const collectionProducts = {};
  for (const c of collections) {
    const items = await paged(`${ORIGIN}/collections/${c.handle}/products.json`, "products");
    collectionProducts[c.handle] = items.map((p) => p.handle);
    for (const p of items) {
      (membership[p.handle] ||= []).push(c.handle);
      if (!byHandle.has(p.handle)) {
        console.log("[A] collection-only product found:", p.handle);
        products.push(p);
        byHandle.set(p.handle, p);
      }
    }
    console.log(`  ${c.handle}: ${items.length} visible (products_count=${c.products_count})`);
  }

  const cats = {
    source: ORIGIN,
    capturedAt: new Date().toISOString(),
    nav,
    collections: collections.map((c) => ({
      ...c,
      url: `${ORIGIN}/collections/${c.handle}`,
      visibleProductCount: collectionProducts[c.handle].length,
      productHandles: collectionProducts[c.handle],
    })),
    membership,
    counts: {
      productsJson: products.length,
      sitemap: smHandles.size,
      uncollected: products.filter((p) => !membership[p.handle]).map((p) => p.handle),
    },
  };
  fs.writeFileSync(CATS_FILE, JSON.stringify(cats, null, 2));
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products));
  console.log(`[A] ${products.length} products, sitemap ${smHandles.size}, ${collections.length} collections`);
  return { cats, products };
}

// ---------- stage B ----------
async function scrapeOne(p, cats) {
  const url = `${ORIGIN}/products/${p.handle}`;
  const [jsRes, htmlRes] = await Promise.all([get(url + ".js"), get(url)]);
  if (!jsRes.text || !htmlRes.text) throw new Error(`js ${jsRes.status} / html ${htmlRes.status}`);
  const js = JSON.parse(jsRes.text);
  const page = parsePdp(htmlRes.text);

  const descLines = toLines(p.body_html);
  const descTables = parseHtmlTables(p.body_html);
  const collHandles = cats.membership[p.handle] || [];
  const collTitle = new Map(cats.collections.map((c) => [c.handle, c.title]));

  // Image list: products.json (originals, with variant links) + .js media + page gallery
  const images = [];
  const seen = new Set();
  const add = (u, extra = {}) => {
    if (!u) return;
    if (!isImageUrl(u)) return;
    const k = imageKey(u);
    if (seen.has(k)) return;
    seen.add(k);
    images.push({ url: fullRes(u), ...extra });
  };
  for (const im of p.images || [])
    add(im.src, { id: im.id, position: im.position, width: im.width, height: im.height, variantIds: im.variant_ids, source: "products.json" });
  for (const m of js.media || []) {
    if (m.media_type === "image") add(m.src, { mediaId: m.id, alt: m.alt, source: "media" });
    else if (m.preview_image?.src) add(m.preview_image.src, { mediaId: m.id, alt: m.alt, source: `media-${m.media_type}-preview` });
  }
  for (const m of String(p.body_html || "").matchAll(/<img\b[^>]*src="([^"]+)"/gi)) add(m[1], { source: "description" });
  for (const u of page.pageImages) add(u, { source: "page" });
  // backfill alt text onto products.json images
  const altByKey = new Map((js.media || []).filter((m) => m.preview_image?.src).map((m) => [imageKey(m.preview_image.src), m.alt]));
  for (const im of images) if (im.alt === undefined) im.alt = altByKey.get(imageKey(im.url)) ?? null;

  const videos = [
    ...(js.media || [])
      .filter((m) => m.media_type !== "image")
      .map((m) => ({ type: m.media_type, host: m.host || null, externalId: m.external_id || null, sources: m.sources || null, alt: m.alt })),
    ...page.videos.map((u) => ({ type: "embedded", url: u })),
  ];

  const jsVar = new Map((js.variants || []).map((v) => [v.id, v]));
  const variants = (p.variants || []).map((v) => {
    const j = jsVar.get(v.id) || {};
    return {
      id: v.id,
      title: v.title,
      options: [v.option1, v.option2, v.option3].filter((x) => x != null),
      optionMap: Object.fromEntries((p.options || []).map((o, i) => [o.name, v[`option${i + 1}`]]).filter(([, x]) => x != null)),
      sku: v.sku,
      barcode: j.barcode ?? null,
      price: v.price != null ? Number(v.price) : null,
      compareAtPrice: v.compare_at_price != null ? Number(v.compare_at_price) : null,
      available: v.available,
      grams: v.grams ?? null,
      weight: j.weight ?? null,
      inventoryManagement: j.inventory_management ?? null,
      quantityRule: j.quantity_rule ?? null,
      quantityPriceBreaks: j.quantity_price_breaks ?? null,
      requiresShipping: v.requires_shipping,
      taxable: v.taxable,
      featuredImage: v.featured_image ? fullRes(v.featured_image.src) : null,
      url: `${url}?variant=${v.id}`,
    };
  });
  const prices = variants.map((v) => v.price).filter((x) => x != null);
  const cmp = variants.map((v) => v.compareAtPrice).filter((x) => x != null);

  return {
    id: p.id,
    handle: p.handle,
    sourceUrl: url,
    name: p.title,
    vendor: p.vendor,
    productType: p.product_type,
    tags: p.tags,
    tagFacets: parseTagFacets(p.tags),
    soldCount: (() => {
      const t = (p.tags || []).find((x) => /^\d+\s+sold$/i.test(x));
      return t ? Number(t.match(/\d+/)[0]) : null;
    })(),
    publishedAt: p.published_at,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    bodyHtml: p.body_html,
    descriptionLines: descLines,
    specs: (() => {
      const ts = tableSpecs(descTables);
      const seen = new Set(ts.map((x) => x.label.toLowerCase() + "|" + x.value));
      // table rows also appear as "label\tvalue" lines, never as "label: value",
      // so line specs and table specs don't overlap — dedupe anyway.
      return [...parseSpecs(descLines).filter((x) => !seen.has(x.label.toLowerCase() + "|" + x.value)), ...ts];
    })(),
    descriptionTables: descTables,
    descriptionLinks: [...String(p.body_html || "").matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
      url: absUrl(m[1]),
      label: stripTags(m[2]),
    })),
    options: (p.options || []).map((o) => ({ name: o.name, position: o.position, values: o.values })),
    variants,
    variantCount: variants.length,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    compareAtMin: cmp.length ? Math.min(...cmp) : null,
    compareAtMax: cmp.length ? Math.max(...cmp) : null,
    currency: "GBP",
    available: variants.some((v) => v.available),
    images,
    imageCount: images.length,
    videos,
    documents: [
      ...page.documents,
      ...[...String(p.body_html || "").matchAll(/href="([^"]+\.(?:pdf|docx?|xlsx?|zip|dwg)(?:\?[^"]*)?)"/gi)]
        .map((m) => ({ url: absUrl(m[1]), label: null }))
        .filter((d) => !page.documents.some((x) => x.url === d.url)),
    ],
    priceCheck: (() => {
      // JSON-LD offers carry the page's own (UK, inc-VAT) price per variant;
      // match them to variants by the ?variant=<id> in each offer's url.
      const offers = [].concat(page.ldOffers || []);
      const byVid = new Map();
      for (const o of offers) {
        const m = String(o.url || "").match(/variant=(\d+)/);
        if (m) byVid.set(Number(m[1]), Number(o.price));
      }
      const compared = variants.filter((v) => byVid.has(v.id) && v.price != null);
      const mismatches = compared
        .filter((v) => Math.abs(byVid.get(v.id) - v.price) >= 0.01)
        .map((v) => ({ id: v.id, title: v.title, json: v.price, page: byVid.get(v.id) }));
      return { offers: offers.length, compared: compared.length, mismatches };
    })(),
    rating: page.rating,
    collectionHandles: collHandles,
    collectionTitles: collHandles.map((h) => collTitle.get(h) || h),
    breadcrumb: page.breadcrumb,
    relatedHandles: page.relatedHandles.filter((h) => h !== p.handle),
    cartNote: page.cartNote,
    deliveryText: page.deliveryText,
    tables: page.tables,
    hasCalculator: page.hasCalculator,
    calculatorHints: page.calculatorHints,
    jsonLd: page.jsonLd,
    pageText: page.pageText,
    rawProductsJson: p,
    rawProductJs: js,
    scrapedAt: new Date().toISOString(),
  };
}

async function stageB({ cats, products }) {
  let done = new Set();
  if (FRESH) {
    for (const f of [PDP_FILE, PDP_DONE_FILE]) if (fs.existsSync(f)) fs.unlinkSync(f);
  } else if (fs.existsSync(PDP_DONE_FILE)) {
    done = new Set(JSON.parse(fs.readFileSync(PDP_DONE_FILE, "utf8")));
  }
  const todo = products.filter((p) => !done.has(p.id)).slice(0, LIMIT);
  console.log(`[B] ${todo.length} to scrape (${done.size} already done)`);
  let i = 0, ok = 0, err = 0;
  const saveDone = () => fs.writeFileSync(PDP_DONE_FILE, JSON.stringify([...done]));
  async function worker() {
    while (i < todo.length) {
      const p = todo[i++];
      let rec;
      try {
        rec = await scrapeOne(p, cats);
        ok++;
      } catch (e) {
        rec = { id: p.id, handle: p.handle, sourceUrl: `${ORIGIN}/products/${p.handle}`, error: String(e.message || e) };
        err++;
      }
      fs.appendFileSync(PDP_FILE, JSON.stringify(rec) + "\n");
      done.add(p.id);
      if ((ok + err) % 20 === 0) {
        saveDone();
        console.log(`[B] ${ok + err}/${todo.length} ok=${ok} err=${err}`);
      }
      await sleep(250);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  saveDone();
  console.log(`[B] finished ok=${ok} err=${err}`);
}

(async () => {
  const a = await stageA();
  if (CATS_ONLY) return;
  await stageB(a);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
