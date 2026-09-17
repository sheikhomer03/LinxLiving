/**
 * Capture drench.co.uk into a JSONL store (crawl only — no Mongo writes).
 *
 * Two-stage by design, like the other retailer importers here: this script
 * only fetches and parses, so `import-drench.cjs` can be re-run against the
 * capture without re-crawling 5,600 pages.
 *
 * Enumeration uses the site's own sitemap-products.xml. Listing grids render
 * client-side against /api/*, which robots.txt disallows, so nothing here
 * touches them — category membership comes from each PDP's BreadcrumbList.
 *
 * Env:
 *   LIMIT=n        stop after n products (smoke test)
 *   CONCURRENCY=n  parallel fetches (default 3 — be polite, it is a live shop)
 *   WITH_SALE=1    keep discounted products (default: skipped)
 *   FRESH=1        ignore an existing capture and start over
 */
const path = require("path");
const fs = require("fs");

const ORIGIN = "https://www.drench.co.uk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DATA =
  process.env.DRENCH_DATA ||
  "C:/Users/hp/AppData/Local/Temp/claude/D--OMER-linxLiving-LinxLiving/a167de67-d47a-4f6e-aa8a-c11dee9e30bc/scratchpad";

const LIMIT = Number(process.env.LIMIT) || Infinity;
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CONCURRENCY) || 3, 6));
const WITH_SALE = process.env.WITH_SALE === "1";
const FRESH = process.env.FRESH === "1";

const PDP_FILE = path.join(DATA, "drench-pdp.jsonl");
const NAV_FILE = path.join(DATA, "drench-nav.json");
const URLS_FILE = path.join(DATA, "drench-urls.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Accordion panels that are page furniture, identical on every product. */
const NOISE_SECTIONS = [
  /buy now,? pay later/i,
  /^reviews?$/i,
  /customer questions/i,
  /trustpilot/i,
  /^finance$/i,
  /klarna|clearpay|paypal/i,
];

const ENTITIES = {
  "&amp;": "&",
  "&pound;": "\u00a3",
  "&#163;": "\u00a3",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&lt;": "<",
  "&gt;": ">",
};

function clean(s) {
  let out = String(s || "").replace(/<[^>]*>/g, " ");
  for (const [ent, ch] of Object.entries(ENTITIES)) out = out.split(ent).join(ch);
  return out.replace(/\s+/g, " ").trim();
}

async function fetchText(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(45000),
    });
    // 429/5xx mean we are going too fast — back off rather than hammer.
    if (res.status === 429 || res.status >= 500) throw new Error("HTTP " + res.status);
    if (!res.ok) return { error: "HTTP " + res.status };
    return { html: await res.text() };
  } catch (e) {
    if (attempt >= 4) return { error: String(e.message || e).slice(0, 200) };
    await sleep(1200 * Math.pow(2, attempt));
    return fetchText(url, attempt + 1);
  }
}

/** Every <script type="application/ld+json"> on the page, parsed. */
function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      /* a malformed block is not worth failing the product over */
    }
  }
  return out;
}

/** Nav tree: top level -> dropdown group -> subcategory, groups kept apart. */
function parseNav(html) {
  const tops = [
    ...html.matchAll(
      /<a href="([^"]+)" class="c-nav__link js-nav-link-top-level"[^>]*aria-controls=nav-secondary-(\d+)[^>]*>([^<]*)<\/a>/g,
    ),
  ].map((m) => ({ url: m[1], title: clean(m[3]) }));

  const blocks = [
    ...html.matchAll(
      /<script class="js-sub-nav-data" type="application\/json">\s*([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => {
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  });

  return tops.map((t, i) => {
    const groups = [];
    for (const col of (blocks[i] && blocks[i].Items) || []) {
      for (const g of col.Items || []) {
        groups.push({
          group: clean(g.Title),
          groupUrl: g.Url || null,
          column: col.Title || null,
          children: (g.Items || []).map((c) => ({
            title: clean(c.Title),
            url: c.Url,
            id: c.Id,
          })),
        });
      }
    }
    return { url: t.url, title: t.title, groups };
  });
}

/**
 * The price element, which is a custom tag carrying its own JSON attributes.
 *
 * `rrp` is the manufacturer's list price and is shown on nearly everything, so
 * it is not a discount signal. A genuine markdown is `price` below
 * `originalPrice` — that is what "on sale" means here.
 */
function parsePrice(html) {
  const tag = html.match(/<product-main-price\b([^>]*)>/);
  if (!tag) return {};
  const attrs = tag[1];
  const json = (name) => {
    const m = attrs.match(new RegExp(name + "='([^']*)'"));
    if (!m) return null;
    try {
      return JSON.parse(m[1].split("&quot;").join('"'));
    } catch {
      return null;
    }
  };
  const plain = (name) => {
    const m = attrs.match(new RegExp(name + '="([^"]*)"'));
    return m ? clean(m[1]) : null;
  };
  const price = json("price");
  const original = json("originalPrice");
  const retail = json("retailPrice");
  const rrp = json("rrp");
  const pick = (o) => (o && typeof o.Price === "number" ? o.Price : null);
  return {
    price: pick(price),
    originalPrice: pick(original),
    retailPrice: pick(retail),
    rrp: pick(rrp),
    percentageSaving: plain("percentageSaving"),
    tradeSaving: plain("tradeSaving"),
  };
}

/** Full-resolution gallery entries, de-duplicated, in page order. */
function parseGallery(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(
    /<a\s+href="(\/\/img\.drench\.co\.uk\/[^"]+)"([^>]*data-gibe-gallery-item[^>]*)>/g,
  )) {
    // Strip the resize query so the original asset is what gets recorded.
    const base = "https:" + m[1].split("?")[0];
    if (seen.has(base)) continue;
    seen.add(base);
    const rest = m[2];
    const attr = (n) => {
      const x = rest.match(new RegExp(n + '="([^"]*)"'));
      return x ? x[1] : "";
    };
    out.push({
      url: base,
      full: base + "?w=1600&scale=both&quality=100",
      id: attr("data-gibe-gallery-item-id"),
      kind: attr("data-gibe-gallery-item") || "image",
      alt: clean(attr("data-gibe-gallery-item-title")),
      isTechnicalDrawing: /true/i.test(attr("data-gibe-gallery-item-techimage")),
    });
  }
  return out;
}

/** The striped specification table, label/value verbatim. */
function parseSpecs(html) {
  const rows = [];
  for (const tbl of html.matchAll(
    /<table[^>]*c-table-striped--spec[^>]*>([\s\S]*?)<\/table>/g,
  )) {
    for (const tr of tbl[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) =>
        clean(c[1]),
      );
      if (cells.length < 2 || !cells[0] || !cells[1]) continue;
      // The page ships its client-side row template inside the same table;
      // it is Mustache, not a spec, and would otherwise import as a field.
      if (cells[0].includes("{{") || cells[1].includes("{{")) continue;
      rows.push({ label: cells[0], value: cells.slice(1).join(" ") });
    }
  }
  return rows;
}

/**
 * Product state blobs the page carries for its own card and every card it
 * recommends. This is where variants live: `Previews` holds one entry per
 * buyable option, with its own SKU, image and swatch.
 */
function parseCards(html) {
  const Q = String.fromCharCode(34);
  const BS = String.fromCharCode(92);
  // Order matters: \&quot; is a quote inside a JSON string and must stay
  // escaped, while a bare &quot; is a real delimiter.
  const unesc = (s) =>
    s
      .split(BS + "&quot;").join("@ESCQ@")
      .split("&quot;").join(Q)
      .split("@ESCQ@").join(BS + Q)
      .split("&amp;").join("&")
      .split("&lt;").join("<")
      .split("&gt;").join(">")
      .split("&#39;").join("'");

  const out = [];
  for (const m of html.matchAll(/<product-card[^>]*\sproduct='([^']*)'/g)) {
    if (m[1].includes("{{")) continue; // the client-side template placeholder
    let c;
    try {
      c = JSON.parse(unesc(m[1]));
    } catch {
      continue;
    }
    out.push({
      url: c.Url || "",
      guid: c.Guid || "",
      name: clean(c.DisplayName || c.Name || ""),
      price: c.Price && typeof c.Price.Price === "number" ? c.Price.Price : null,
      originalPrice:
        c.OriginalPrice && typeof c.OriginalPrice.Price === "number"
          ? c.OriginalPrice.Price
          : null,
      rrp: c.RRP && typeof c.RRP.Price === "number" ? c.RRP.Price : null,
      stock: c.Stock ?? null,
      isOnSale: !!c.IsOnSale,
      hasVariants: !!c.HasVariants,
      isVariant: !!c.IsVariant,
      variantOptionsText: clean(c.VariantOptionsText || ""),
      keyFeatures: Array.isArray(c.KeyFeatures)
        ? c.KeyFeatures.map((k) => clean(k)).filter(Boolean)
        : [],
      previews: (c.Previews || []).map((p) => ({
        sku: p.Sku || "",
        name: clean(p.DisplayName || ""),
        url: p.Url || "",
        image: p.DisplayImage || "",
        swatch: p.PreviewThumbnail || "",
        multiOption: !!p.IsMultiOptionVariant,
        guid: p.ProductGuid || "",
      })),
    });
  }
  return out;
}

/** Accordion panels — description, dimensions, delivery, guarantee, etc. */
function parseSections(html) {
  const out = [];
  const titles = [
    ...html.matchAll(
      /class="[^"]*c-accordion__title[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/g,
    ),
  ];
  // Walk the div depth rather than matching a closing pair.
  //
  // The previous form ended the body at the first `</div></div>`, which with
  // nested content stopped early and left the wrapper divs unclosed. Half the
  // captured descriptions came out malformed, and a browser silently repairs
  // them on parse — so the server HTML and the hydrated DOM disagreed.
  const bodies = [];
  const OPEN = /<div[^>]*class="[^"]*c-accordion__content__inner[^"]*"[^>]*>/g;
  let om;
  while ((om = OPEN.exec(html)) !== null) {
    const start = om.index + om[0].length;
    let depth = 1;
    const scan = /<div\b[^>]*>|<\/div>/g;
    scan.lastIndex = start;
    let sm;
    let end = -1;
    while ((sm = scan.exec(html)) !== null) {
      depth += sm[0] === "</div>" ? -1 : 1;
      if (depth === 0) { end = sm.index; break; }
    }
    if (end > start) bodies.push([null, html.slice(start, end)]);
  }
  for (let i = 0; i < Math.max(titles.length, bodies.length); i += 1) {
    const heading = clean((titles[i] && titles[i][1]) || "");
    const raw = (bodies[i] && bodies[i][1]) || "";
    const text = clean(raw);
    if (!heading && !text) continue;
    // Storefront furniture, not product copy — the same panels on every page.
    if (NOISE_SECTIONS.some((rx) => rx.test(heading))) continue;
    out.push({ heading, html: raw.trim(), text });
  }
  return out;
}

function parsePdp(html, url) {
  const ld = jsonLd(html);
  const product = ld.find((x) => x["@type"] === "Product") || {};
  const crumbs = ld.find((x) => x["@type"] === "BreadcrumbList");
  const trail = ((crumbs && crumbs.itemListElement) || []).map((x) => ({
    name: clean(x.name || (x.item && x.item.name) || ""),
    url: (x.item && x.item["@id"]) || (typeof x.item === "string" ? x.item : "") || "",
  }));

  const offer = product.offers || {};
  const tiers = (offer.priceSpecification || [])
    .filter((p) => p.validForMemberTier)
    .map((p) => ({
      tier: (p.validForMemberTier && p.validForMemberTier.name) || "",
      program:
        (p.validForMemberTier &&
          p.validForMemberTier.isTierOf &&
          p.validForMemberTier.isTierOf.name) ||
        "",
      price: typeof p.price === "number" ? p.price : null,
    }));

  const price = parsePrice(html);

  // Cards carry the variant matrix. Keep only this product's own card and any
  // card that actually has variants — the rest are recommendation noise that
  // would multiply the capture size for nothing.
  const allCards = parseCards(html);
  const slug = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const ownCard = allCards.find((c) => c.url && c.url.split("?")[0] === slug) || null;
  const cards = allCards.filter((c) => c === ownCard || c.hasVariants);

  const meta = (n) => {
    const m = html.match(
      new RegExp('<meta[^>]*(?:name|property)="' + n + '"[^>]*content="([^"]*)"'),
    );
    return m ? clean(m[1]) : "";
  };

  const rec = {
    url,
    name: clean(product.name || ""),
    h1: clean((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || ""),
    sku: product.sku || "",
    mpn: product.mpn || "",
    manufacturer: clean((product.brand && product.brand.name) || ""),
    ldDescription: clean(product.description || ""),
    availability: offer.availability || "",
    currency: "GBP",
    tradeTiers: tiers,
    breadcrumb: trail,
    categoryPath: trail
      .slice(1, -1)
      .map((t) => t.name)
      .join(" > "),
    gallery: parseGallery(html),
    specs: parseSpecs(html),
    sections: parseSections(html),
    hasVariants: !!(ownCard && ownCard.hasVariants),
    isVariant: !!(ownCard && ownCard.isVariant),
    variantOptionsText: (ownCard && ownCard.variantOptionsText) || "",
    variants: (ownCard && ownCard.previews) || [],
    keyFeatures: (ownCard && ownCard.keyFeatures) || [],
    stock: ownCard ? ownCard.stock : null,
    guid: (ownCard && ownCard.guid) || "",
    cards,
    productId:
      (html.match(/data-product-id="([^"]*)"/) || [])[1] ||
      (html.match(/data-test-product-id="([^"]*)"/) || [])[1] ||
      "",
    metaTitle:
      meta("title") ||
      clean((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""),
    metaDescription: meta("description"),
    canonical:
      (html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"/) || [])[1] || url,
    capturedAt: new Date().toISOString(),
  };
  return Object.assign(rec, price);
}

/** A markdown, not an RRP saving — see parsePrice. */
function isOnSale(p) {
  return (
    typeof p.price === "number" &&
    typeof p.originalPrice === "number" &&
    p.price < p.originalPrice
  );
}

const SKIP_NAV = ["/c/sale", "/c/ideas/", "/help", "/c/brands"];

async function main() {
  fs.mkdirSync(DATA, { recursive: true });

  console.log("1/3  nav");
  const home = await fetchText(ORIGIN + "/");
  if (home.error) throw new Error("homepage: " + home.error);
  const nav = parseNav(home.html);
  fs.writeFileSync(NAV_FILE, JSON.stringify(nav, null, 2));
  const importable = nav.filter((t) => !SKIP_NAV.includes(t.url));
  console.log(
    "     " +
      importable.length +
      " categories, " +
      importable.reduce((n, t) => n + t.groups.length, 0) +
      " groups, " +
      importable.reduce(
        (n, t) => n + t.groups.reduce((k, g) => k + g.children.length, 0),
        0,
      ) +
      " subcategories",
  );

  console.log("2/3  sitemap");
  const sm = await fetchText(ORIGIN + "/sitemap-products.xml");
  if (sm.error) throw new Error("sitemap: " + sm.error);
  const all = [...sm.html.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  fs.writeFileSync(URLS_FILE, JSON.stringify({ products: all }, null, 2));
  console.log("     " + all.length + " product urls");

  if (FRESH && fs.existsSync(PDP_FILE)) fs.unlinkSync(PDP_FILE);
  const done = new Set();
  if (fs.existsSync(PDP_FILE)) {
    for (const line of fs.readFileSync(PDP_FILE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        done.add(JSON.parse(line).url);
      } catch {
        /* a truncated final line just gets re-fetched */
      }
    }
  }

  const pending = all.filter((u) => !done.has(u));
  const queue = LIMIT === Infinity ? pending : pending.slice(0, LIMIT);
  console.log(
    "3/3  products — " +
      queue.length +
      " to fetch" +
      (done.size ? " (" + done.size + " already captured)" : "") +
      ", concurrency " +
      CONCURRENCY,
  );
  if (!queue.length) {
    console.log("nothing to do");
    return;
  }

  const out = fs.createWriteStream(PDP_FILE, { flags: "a" });
  let cursor = 0;
  let ok = 0;
  let sale = 0;
  let failed = 0;
  const started = Date.now();

  async function worker() {
    for (;;) {
      const idx = cursor++;
      if (idx >= queue.length) return;
      const url = queue[idx];
      const res = await fetchText(url);
      let rec;
      if (res.error) {
        rec = { url, error: res.error, capturedAt: new Date().toISOString() };
        failed += 1;
      } else {
        rec = parsePdp(res.html, url);
        rec.onSale = isOnSale(rec);
        if (rec.onSale && !WITH_SALE) {
          rec = {
            url,
            skipped: "sale",
            price: rec.price,
            originalPrice: rec.originalPrice,
            capturedAt: rec.capturedAt,
          };
          sale += 1;
        } else {
          ok += 1;
        }
      }
      out.write(JSON.stringify(rec) + "\n");

      const n = ok + sale + failed;
      if (n % 100 === 0 || n === queue.length) {
        const rate = n / ((Date.now() - started) / 1000);
        const left = Math.round((queue.length - n) / Math.max(rate, 0.01) / 60);
        console.log(
          "     " +
            n +
            "/" +
            queue.length +
            "  ok " +
            ok +
            "  sale-skipped " +
            sale +
            "  failed " +
            failed +
            "  ~" +
            left +
            "m left",
        );
      }
      await sleep(150 + Math.random() * 200);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  out.end();
  console.log(
    "\ndone — captured " + ok + ", skipped " + sale + " on sale, " + failed + " failed",
  );
  console.log("capture: " + PDP_FILE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
