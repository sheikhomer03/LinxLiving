/**
 * Capture al-murad.co.uk into a JSONL store (crawl only — no Mongo writes).
 *
 * Two-stage like the other retailer importers here (tilemountain, ottotiles):
 * this script only fetches and parses, so `import-al-murad.cjs` can be re-run
 * against the capture without re-crawling the shop.
 *
 * Three things about this site shape the crawl:
 *
 *  - It sits behind a Visualsoft "Are you human?" interstitial. The access
 *    code is printed in plain JS on that page and just needs echoing back as
 *    `?ayh_access=` once to earn a session cookie (24h) — see bootstrap().
 *  - `al_murad_categories.json` (26 links) is only the top-level nav. Real
 *    products live 2-3 levels deeper, under subcategory/"range" pages that
 *    are not listed anywhere except by walking each category page's own
 *    links. A single product is cross-listed under many of these (by size,
 *    room, finish), so the product URL set is built as a dedup-by-id set,
 *    not a per-category list.
 *  - Product pages carry a proper JSON-LD `<script type="application/ld+json">`
 *    block (name, image, category, a compact spec-pair Description, SKU,
 *    Offers.price, Offers.availability) — that is the primary source; HTML
 *    regexes only fill in the gallery and variant options JSON-LD omits.
 *
 * Env:
 *   LIMIT=n        stop after n products (smoke test)
 *   CONCURRENCY=n  parallel fetches (default 3 — be polite, it is a live shop)
 *   FRESH=1        ignore an existing capture and start over
 *   CATS_ONLY=1    stop after the category/product-URL enumeration
 */
const path = require("path");
const fs = require("fs");

const ORIGIN = "https://www.al-murad.co.uk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DATA =
  process.env.AM_DATA ||
  "/private/tmp/claude-501/-Users-niazig-Desktop-linxliving-LinxLiving/70eb72c0-74b0-4808-bca4-9fe8441e0bb1/scratchpad";
fs.mkdirSync(DATA, { recursive: true });

const LIMIT = Number(process.env.LIMIT) || Infinity;
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 3, 6));
const FRESH = process.env.FRESH === "1";
const CATS_ONLY = process.env.CATS_ONLY === "1";

const URLS_FILE = path.join(DATA, "am-product-urls.json");
const CATS_FILE = path.join(DATA, "am-cats.json");
const PDP_FILE = path.join(DATA, "am-pdp.jsonl");
const COOKIE_FILE = path.join(DATA, "am-cookie.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * bot-check bypass + fetching
 * ------------------------------------------------------------------ */

let COOKIE = "";

async function bootstrap() {
  if (!FRESH && fs.existsSync(COOKIE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
    if (Date.now() - saved.at < 20 * 60 * 60 * 1000) {
      COOKIE = saved.cookie;
      return;
    }
  }
  const res1 = await fetch(ORIGIN + "/", { headers: { "user-agent": UA } });
  const html1 = await res1.text();
  const setCookie = res1.headers.get("set-cookie") || "";
  const cookieBits = setCookie
    .split(/,(?=[^;]+=[^;]+;)/)
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("="));
  const code = (/accessCode = "([^"]+)"/.exec(html1) || [])[1];
  if (!code) throw new Error("could not find ayh_access code on homepage");

  const cookieHeader = cookieBits.join("; ");
  const res2 = await fetch(ORIGIN + "/?ayh_access=" + code, {
    headers: { "user-agent": UA, cookie: cookieHeader },
  });
  const setCookie2 = res2.headers.get("set-cookie") || "";
  const moreBits = setCookie2
    .split(/,(?=[^;]+=[^;]+;)/)
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("="));
  const merged = new Map();
  for (const c of [...cookieBits, ...moreBits]) {
    const [k] = c.split("=");
    merged.set(k, c);
  }
  COOKIE = [...merged.values()].join("; ");
  fs.writeFileSync(COOKIE_FILE, JSON.stringify({ at: Date.now(), cookie: COOKIE }));

  const html2 = await res2.text();
  if (/Are you human/i.test(html2)) throw new Error("bot-check bypass failed");
}

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": UA,
          cookie: COOKIE,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-GB,en;q=0.9",
        },
        signal: AbortSignal.timeout(45000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("HTTP " + res.status);
      const html = await res.text();
      if (/<title>Are you human\?<\/title>/i.test(html)) {
        await bootstrap();
        continue;
      }
      return html;
    } catch (e) {
      if (i === tries) throw e;
      await sleep(700 * i);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * small HTML helpers
 * ------------------------------------------------------------------ */

const ENTITIES = {
  "&amp;": "&", "&pound;": "£", "&#163;": "£", "&quot;": '"',
  "&apos;": "'", "&#39;": "'", "&nbsp;": " ", "&lt;": "<", "&gt;": ">",
  "&rsquo;": "’", "&lsquo;": "‘", "&ldquo;": "“",
  "&rdquo;": "”", "&ndash;": "–", "&mdash;": "—",
  "&deg;": "°", "&times;": "×", "&reg;": "®", "&trade;": "™",
  "&#176;": "°",
};

function decode(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => (m in ENTITIES ? ENTITIES[m] : m));
}

function stripTags(s) {
  return decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** `/wall-tiles-c26/foo-c123` -> is this a product (`-pNNN`) or a category (`-cNNN`)? */
function isProductPath(p) {
  return /-p\d+$/.test(p);
}
function isCategoryPath(p) {
  return /-c\d+$/.test(p);
}
function productIdOf(p) {
  const m = /-p(\d+)$/.exec(p);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ *
 * stage 1 — walk the category tree, collect every product URL
 * ------------------------------------------------------------------ */

async function pLimitAll(items, n, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * One category/subcategory page: its own subcategory links, its product
 * links, and (if it has more than one page) every further page.
 */
async function crawlCategoryPage(catPath) {
  const products = new Map(); // id -> path
  const subcats = new Set();

  let page = 1;
  let emptyStreak = 0;
  for (;;) {
    const url = ORIGIN + catPath + (page > 1 ? "?page=" + page : "");
    const html = await get(url);
    if (!html) break;

    let foundOnPage = 0;
    for (const m of html.matchAll(/href="\/([a-z0-9][a-z0-9\-\/]{4,160})"/gi)) {
      const p = "/" + m[1].split(/[?#]/)[0].replace(/\/$/, "");
      if (isProductPath(p)) {
        const id = productIdOf(p);
        if (id && !products.has(id)) {
          products.set(id, p);
          foundOnPage++;
        }
      } else if (isCategoryPath(p) && p.startsWith(catPath + "/")) {
        subcats.add(p);
      }
    }

    const hasNext = new RegExp('href="[^"]*' + catPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '\\?page=' + (page + 1) + '"').test(html);
    if (!hasNext) break;
    if (foundOnPage === 0) {
      emptyStreak++;
      if (emptyStreak >= 2) break;
    } else {
      emptyStreak = 0;
    }
    page++;
    if (page > 200) break; // sanity cap
  }

  return { products, subcats: [...subcats] };
}

async function collectAllProductUrls() {
  const seedFile = path.join(__dirname, "..", "al_murad_categories.json");
  const seeds = JSON.parse(fs.readFileSync(seedFile, "utf8")).map(
    (c) => new URL(c.link).pathname,
  );

  const visited = new Set();
  const queue = [...new Set(seeds)];
  const allProducts = new Map(); // id -> { path, categoryPaths: Set }
  const categoryTree = {}; // path -> { subcats: [...], title }

  let processed = 0;
  while (queue.length) {
    const batch = queue.splice(0, CONCURRENCY);
    await pLimitAll(batch, CONCURRENCY, async (catPath) => {
      if (visited.has(catPath)) return;
      visited.add(catPath);
      processed++;
      const { products, subcats } = await crawlCategoryPage(catPath);
      categoryTree[catPath] = { subcats };
      for (const [id, p] of products) {
        if (!allProducts.has(id)) allProducts.set(id, { path: p, categoryPaths: new Set() });
        allProducts.get(id).categoryPaths.add(catPath);
      }
      for (const s of subcats) {
        if (!visited.has(s) && !queue.includes(s)) queue.push(s);
      }
      console.log(
        `  [${processed}] ${catPath}  -> ${products.size} products, ${subcats.length} subcats  (total unique products: ${allProducts.size})`,
      );
    });
  }

  const out = [...allProducts.entries()].map(([id, v]) => ({
    id,
    path: v.path,
    categoryPaths: [...v.categoryPaths],
  }));
  fs.writeFileSync(URLS_FILE, JSON.stringify(out, null, 2));
  fs.writeFileSync(CATS_FILE, JSON.stringify(categoryTree, null, 2));
  console.log(`\ncategory pages walked: ${visited.size}`);
  console.log(`unique products discovered: ${out.length}`);
  return out;
}

/* ------------------------------------------------------------------ *
 * stage 2 — the product page
 * ------------------------------------------------------------------ */

function parseJsonLd(html) {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;
  const m = re.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * Al Murad's own spec label vocabulary, seen across tiles, mosaics (sold
 * "per Sheet" rather than "per Tile") and accessories. Matched with flexible
 * whitespace because `stripTags` leaves irregular spacing where markup wrapped
 * a superscript ("N° of Tiles per Square Metre ( m 2 )" instead of "(m2)").
 */
const KNOWN_SPEC_LABELS = [
  "Colour", "Material", "Finish", "Size (cm)", "Thickness (mm)",
  "Suitability", "N° of Tiles per Square Metre (m2)",
  "N° of Tiles per Pack", "N° of Sheets per Square Metre (m2)",
  "N° of Sheets per Pack", "Availability", "Weight per Tile (kg)",
  "Weight per Pack (kg)", "Slip Rating", "Pattern", "Edge", "Shade Variation",
  // Rarer ranges (planks, mosaic sheets, border/linear pieces) use their
  // own wording for the same kind of coverage figure — found via a
  // catalogue-wide audit after the first fix still left 180/3,776 products
  // with unrecognised text swallowed into "Suitability".
  "N° of Sheets To Cover A Square Metre (m2)",
  "N° of Planks per Square Metre (m2)",
  "N° of Tiles per Linear Metre (m2)",
  "Tiles per Linear Metre",
  "Tiles per SQM",
  "Square Metre (m2) per Pack",
];

/** Values that are free text, not a number — the truncation-removal fix
 *  below only matters for these (a coverage figure should never run past
 *  its own number into unrelated prose). */
const TEXTUAL_LABELS = new Set([
  "Colour", "Material", "Finish", "Size (cm)", "Thickness (mm)",
  "Suitability", "Availability", "Pattern", "Edge", "Shade Variation",
]);

/*
 * These short, ordinary-English-word labels (Material, Finish, Edge,
 * Pattern, Colour) turn up as plain prose inside tools/adhesives/sealants'
 * free-text usage instructions ("...the material to be applied...", "...of
 * the bucket, basket or any other container's edge...") — real sentences,
 * not a new spec entry. Genuine spec labels on this site are always
 * followed by a colon; ordinary sentence usage essentially never is. A
 * mandatory colon for these specific labels (kept optional for the numeric
 * coverage labels, which DO have a confirmed colon-less real case — see
 * below) tells the two apart without needing every one of these words on a
 * case-by-case denylist.
 */
const COLON_REQUIRED_LABELS = new Set([
  "Colour", "Material", "Finish", "Pattern", "Edge", "Shade Variation",
]);

/** A handful of extra literal spellings that don't fit the mechanical
 *  N°/No or Metre/Meter substitution above, mapped onto an existing
 *  canonical label. */
const EXTRA_LABEL_VARIANTS = {
  "Thickness (mm)": ["Thickness"],
};

/*
 * Flexible whitespace between EVERY character, not just at the label's own
 * word spaces. `stripTags` can leave a stray space anywhere the source
 * wrapped part of the label in an inline tag — a `<sup>` around the "2" in
 * "(m2)" (the case this was originally written for), but also, on a
 * handful of products, splitting a plain word in two ("Square Me<b>tre"
 * -> "Square Me tre"). A version that only flexed pre-existing word
 * boundaries matched the first case and missed the second. This also
 * subsumes the old digit-in-parens special case, since "(", "m", "2", ")"
 * each get an optional \s* between them the same as any other character.
 */
function labelToFlexRegex(label) {
  const parts = [];
  for (const ch of label) {
    parts.push(ch === " " ? "\\s+" : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  return parts.join("\\s*");
}

/*
 * Case-insensitive: some range pages render this same label set in sentence
 * case ("N° of tiles per pack") instead of the title case seen elsewhere
 * ("N° of Tiles per Pack"). A first version matched case-sensitively, which
 * silently missed the sentence-case variant on 707/3,776 products — every
 * label after the last one that DID match (almost always "Suitability")
 * got swallowed into that one label's value instead of being split out,
 * leaving tilesPerSqm/sqmPerBox unset and the coverage calculator with
 * nothing to compute a price-per-m² from.
 *
 * One regex per label (rather than a single alternation) so the matched
 * text can be canonicalised back to the exact KNOWN_SPEC_LABELS spelling
 * regardless of which case the source page used — downstream exact-string
 * lookups (e.g. import-al-murad.cjs's `specs["N° of Tiles per Square Metre
 * (m2)"]`) need a stable key every time.
 */
/*
 * The colon after the label is usually there but not always — a few range
 * pages (quarry tiles, some XL-format ones) render "Metre (m2) 46.91" with
 * no colon at all, which a mandatory `:` silently left unmatched, leaving
 * that value stuck inside the PREVIOUS label's text same as the case bug
 * above. Optional, not required.
 */
/*
 * Two more spelling variants seen only on a handful of ranges: "No of ..."
 * instead of "N° of ..." (the degree symbol dropped to plain text), and
 * American "Meter" instead of "Metre". Both map back onto the SAME
 * canonical label so the derived alias fields (tilesPerSqm etc.) and any
 * exact-string lookup downstream see one stable key regardless of which
 * spelling a given range used.
 */
function spellingVariants(label) {
  const variants = [label, ...(EXTRA_LABEL_VARIANTS[label] || [])];
  if (label.startsWith("N° of ")) variants.push("No of " + label.slice("N° of ".length));
  if (/Metre/.test(label)) {
    for (const v of [...variants]) variants.push(v.replace(/Metre/g, "Meter"));
  }
  return [...new Set(variants)];
}

const LABEL_PATTERNS = KNOWN_SPEC_LABELS.flatMap((label) => {
  // Mandatory for Colour/Material/Finish/Pattern/Edge/Shade Variation (see
  // COLON_REQUIRED_LABELS) — real usage-instruction prose on tools and
  // adhesives pages uses these same ordinary English words mid-sentence,
  // and without a colon requirement that got misread as a new spec entry,
  // slicing real copy in two ("...the material" / "to be applied...").
  // Optional everywhere else, where a confirmed real case (quarry tiles'
  // coverage figure) renders with no colon at all.
  const colonPart = COLON_REQUIRED_LABELS.has(label) ? "\\s*:\\s*" : "\\s*:?\\s*";
  return spellingVariants(label).map((variant) => ({
    label,
    // Word-boundary guard: a label must not be matched as a substring
    // inside a longer word ("Pattern" inside "patterns create a flair..."
    // — real prose on a mosaic product page, not a new label — previously
    // matched with zero-width trailing whitespace and truncated "patterns"
    // down to a stray "s" as the start of a bogus "value").
    re: new RegExp("(?<![a-zA-Z])(?:" + labelToFlexRegex(variant) + ")(?![a-zA-Z])" + colonPart, "gi"),
  }));
});

/**
 * `<div class="product-tabs__content__cms">...</div>` — depth-aware, since
 * naive fixed-length slicing cut into the next tab on longer descriptions.
 */
/**
 * Every one of the PDP's three tabs (Product Description, Payment &
 * Security, Delivery & Returns) renders through the SAME generic
 * `.product-tabs__content__cms` wrapper class — a first version anchored on
 * that class alone and always took whichever tab happened to render first
 * in the DOM. Tab order is not fixed (some products render Payment &
 * Security or Delivery & Returns before Description, some render Description
 * without any id on its inner div at all), so on a full-catalogue run that
 * silently pulled the wrong tab's text for ~1,300 products — a payment
 * disclosure or a delivery policy parsed as if it were the spec table.
 *
 * The one thing that IS stable is the tab button's own label. Each button
 * (`.product-tabs__list__item__link`) links to `#tab-<slice-id>-<n>` by
 * `href`, and the matching content panel carries that exact string as its
 * own `id` — so anchoring on the button text "Product Description" and
 * following its href to the right panel is order-independent.
 */
function extractDescriptionTab(html) {
  const linkRe = /<a\s*\nclass="product-tabs__list__item__link"\s*\nhref="#([^"]+)"\s*\n>\s*([\s\S]{0,80}?)<\/a>/g;
  let m;
  let targetId = null;
  while ((m = linkRe.exec(html))) {
    if (m[2].replace(/\s+/g, " ").trim() === "Product Description") {
      targetId = m[1];
      break;
    }
  }
  if (!targetId) return "";

  const anchorRe = new RegExp('<div\\s*\\nid="' + targetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"[^>]*>');
  const am = anchorRe.exec(html);
  if (!am) return "";

  let depth = 1;
  const tagRe = /<div\b[^>]*>|<\/div>/g;
  tagRe.lastIndex = am.index + am[0].length;
  const start = tagRe.lastIndex;
  let t;
  while ((t = tagRe.exec(html))) {
    if (t[0].startsWith("</")) depth--; else depth++;
    if (depth === 0) return html.slice(start, t.index);
  }
  return "";
}

/**
 * Structured spec pairs from the rendered "Product Description" tab — the
 * reliable source. `ld.Description` (JSON-LD) is used only as a fallback: on
 * ~1,000 products (mosaics especially) it is blank even though the tab itself
 * carries the full spec table, which a first pass anchored on JSON-LD alone
 * silently missed.
 */
function parseSpecPairs(text) {
  const out = {};
  const marks = [];
  for (const { label, re } of LABEL_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      marks.push({ label, start: m.index, end: re.lastIndex });
    }
  }
  // Earliest match wins at each position; a longer/more specific label
  // that starts inside a span already claimed by an earlier one is dropped
  // rather than double-counted (mirrors the old single-regex alternation's
  // leftmost-match behaviour, now across per-label patterns).
  marks.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const filtered = [];
  let lastEnd = -1;
  for (const mark of marks) {
    if (mark.start < lastEnd) continue;
    filtered.push(mark);
    lastEnd = mark.end;
  }
  for (let i = 0; i < filtered.length; i++) {
    const cur = filtered[i];
    const next = filtered[i + 1];
    /*
     * The LAST label's value used to be capped at 160 chars (`cur.end +
     * 160`) rather than running to the end of the text. Fine for a short
     * spec figure, but "Suitability" (or the last label matched at all) is
     * sometimes followed by real marketing/usage copy hundreds of
     * characters long — tools, adhesives, sealants, SPC flooring — which
     * this silently chopped off mid-sentence ("...providing professional
     * results for both t"). No cap: take everything to the end.
     */
    let val = text.slice(cur.end, next ? next.start : text.length).trim();
    val = val.replace(/\s+/g, " ");
    /*
     * A numeric label (anything but the free-text ones in TEXTUAL_LABELS)
     * should be a bare figure, not a sentence — but on mosaics/borders the
     * source page runs straight from the number into marketing prose with
     * no separator at all ("N° of Sheets To Cover A Square Metre (m2): 11
     * Sheets Mosaic tiles are a staple of contemporary home tiling..."),
     * and now that the LAST label's value isn't capped at 160 chars (see
     * above), that whole paragraph would otherwise end up stored as if it
     * were the coverage figure. Keep only the leading number + unit word.
     */
    if (val && !TEXTUAL_LABELS.has(cur.label)) {
      const m = /^[\d.,]+\s*(?:tiles?|sheets?|planks?|kg|mm|cm|%)?/i.exec(val);
      if (m) val = m[0].trim();
    }
    if (val) out[cur.label] = val;
  }
  return out;
}

/**
 * Full gallery, in page order.
 *
 * The JSON-LD `image` field and the responsive `<link rel="preload"
 * imagesrcset>` only ever carry the FIRST photo. The real gallery — every
 * photo the PDP actually shows in its slider — is a separate JS array the
 * page hands to `Product.setDefaultImages([...])`, using relative,
 * backslash-escaped paths (`\/images\/...`), which is why a URL-shaped regex
 * anchored on the full https://www.al-murad.co.uk domain silently missed it:
 * on a first pass this returned 1 image for a product that actually had 4.
 */
function parseGallery(html) {
  const m = /Product\.setDefaultImages\((\[[\s\S]*?\])\);/.exec(html);
  if (m) {
    try {
      const arr = JSON.parse(m[1]);
      const out = [];
      const seen = new Set();
      for (const item of arr) {
        const rel = item.image || item.zoom || "";
        if (!rel) continue;
        const url = ORIGIN + (rel.startsWith("/") ? rel : "/" + rel);
        if (!seen.has(url)) {
          seen.add(url);
          out.push(url);
        }
      }
      if (out.length) return out;
    } catch {
      // fall through to the JSON-LD fallback below
    }
  }
  // Fallback for the rare page without that block: at least the hero shot.
  const out = [];
  const seen = new Set();
  for (const mm of html.matchAll(
    /https:\/\/www\.al-murad\.co\.uk\/images\/[a-z0-9\-]+_image\.jpg/gi,
  )) {
    if (!seen.has(mm[0])) {
      seen.add(mm[0]);
      out.push(mm[0]);
    }
  }
  return out;
}

/** Size/colour option buttons rendered on the page, if this SKU has siblings. */
function parseOptions(html) {
  const out = {};
  for (const m of html.matchAll(
    /data-attribute-name="([^"]+)"[^>]*>[\s\S]{0,20}?<span[^>]*>([^<]+)<\/span>/g,
  )) {
    const name = decode(m[1]).trim();
    const val = decode(m[2]).trim();
    if (!name || !val) continue;
    if (!out[name]) out[name] = new Set();
    out[name].add(val);
  }
  for (const k of Object.keys(out)) out[k] = [...out[k]];
  return out;
}

/**
 * The unit `ld.Offers.price` is actually quoted in.
 *
 * A tile PDP shows the same sell price twice: a per-m² conversion in
 * `#js-product-price` (`product-content__price-info__rrp-greater` — a
 * misleading class name, it is not RRP) and the real transactional figure in
 * `#js-product-original-price`, labelled "Per Tile". `ld.Offers.price`
 * matches the LATTER (confirmed against the site's own coverage calculator:
 * 7 tiles × £4.49 = £31.43, the exact total it quotes) — a naive "first
 * price_infix_text on the page" grab returns the per-m² label instead and
 * mislabels the unit for every product with this two-price layout.
 */
function parsePriceUnit(html) {
  const i = html.indexOf('id="js-product-original-price"');
  if (i !== -1) {
    const seg = html.slice(i, i + 600);
    const m = /price_infix_text">\s*([^<]+)</.exec(seg);
    if (m) return stripTags(m[1]);
  }
  const m = /price_infix_text">\s*([^<]+)</.exec(html);
  return m ? stripTags(m[1]) : "";
}

/**
 * `{ value, unit }` for `#js-product-rrp` / `#js-product-was`, or null when
 * the site leaves the slot empty (most products have no standing RRP shown,
 * and `#js-product-was` is only populated during an active markdown).
 */
function parsePriceBlock(html, id) {
  const i = html.indexOf('id="' + id + '"');
  if (i === -1) return null;
  const seg = html.slice(i, i + 500);
  const incMatch = /product-content__price--inc"\s*>\s*<span\s*\nclass="GBP"\s*\n>\s*£?([\d.,]+)/.exec(seg);
  if (!incMatch) return null;
  const unitMatch = /price_infix_text">\s*([^<]+)</.exec(seg);
  return {
    value: parseFloat(incMatch[1].replace(/,/g, "")),
    unit: unitMatch ? stripTags(unitMatch[1]) : "",
  };
}

async function crawlProduct(entry) {
  const url = ORIGIN + entry.path;
  const html = await get(url);
  if (!html) return { error: "fetch-failed", path: entry.path };

  const ld = parseJsonLd(html);
  if (!ld) return { error: "no-jsonld", path: entry.path };

  // The tab panel's own inline <script> (a price-update handler) sits inside
  // the same div as the spec text; stripTags does not know to skip it, and
  // its JS was leaking into whichever spec label happened to be last.
  const tabHtml = extractDescriptionTab(html).replace(/<script[\s\S]*?<\/script>/gi, " ");
  // Everything from "Code:" on is a separate reference-number UI element
  // living in the same panel, not spec text — cut before it glues onto the
  // last real spec's value.
  const tabText = stripTags(tabHtml).replace(/\s*Code:\s*$/, "");
  const rawSpecsText = tabText || decode(String(ld.Description || ""));
  const specs = parseSpecPairs(rawSpecsText);
  const gallery = parseGallery(html);
  const options = parseOptions(html);
  const priceUnit = parsePriceUnit(html);
  const rrp = parsePriceBlock(html, "js-product-rrp");
  const wasPrice = parsePriceBlock(html, "js-product-was");

  const h1 = stripTags((/<span\s+id="js-product-title">([\s\S]*?)<\/span>/.exec(html) || [])[1] || ld.name || "");

  return {
    id: entry.id,
    sourceUrl: url,
    name: decode(h1 || ld.name || ""),
    sku: ld.SKU || "",
    price: ld.Offers ? Number(ld.Offers.price) : null,
    priceCurrency: (ld.Offers && ld.Offers.priceCurrency) || "GBP",
    priceUnit,
    rrp,
    wasPrice,
    availability: ld.Offers ? String(ld.Offers.availability || "").split("/").pop() : "",
    ldCategories: ld.category || [],
    categoryPaths: entry.categoryPaths,
    images: gallery.length ? gallery : ld.image ? [ld.image] : [],
    specs,
    rawSpecsText,
    options,
  };
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  await bootstrap();
  console.log("bot-check bypassed, session cookie acquired");

  let productList;
  if (!FRESH && fs.existsSync(URLS_FILE)) {
    productList = JSON.parse(fs.readFileSync(URLS_FILE, "utf8"));
    console.log(`resuming: ${productList.length} product URLs already discovered`);
  } else {
    console.log("walking category tree from al_murad_categories.json ...");
    productList = await collectAllProductUrls();
  }

  if (CATS_ONLY) return;

  const already = new Set();
  if (!FRESH && fs.existsSync(PDP_FILE)) {
    for (const line of fs.readFileSync(PDP_FILE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        already.add(JSON.parse(line).id);
      } catch {}
    }
    console.log(`already captured: ${already.size} products`);
  }

  const todo = productList.filter((p) => !already.has(p.id)).slice(0, LIMIT);
  console.log(`fetching ${todo.length} product pages ...`);

  const out = fs.createWriteStream(PDP_FILE, { flags: "a" });
  let done = 0, ok = 0, failed = 0;
  await pLimitAll(todo, CONCURRENCY, async (entry) => {
    let rec;
    try {
      rec = await crawlProduct(entry);
    } catch (e) {
      rec = { error: String(e.message || e), path: entry.path, id: entry.id };
    }
    if (rec.error) failed++; else ok++;
    out.write(JSON.stringify(rec) + "\n");
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${todo.length}  ok=${ok} failed=${failed}`);
  });
  out.end();
  console.log(`\ndone. ok=${ok} failed=${failed} total capture=${already.size + ok}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
