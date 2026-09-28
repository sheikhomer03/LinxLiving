/**
 * Build the Bathdisc catalogue from the Shopify feed capture
 * (.scratch/bathdisc/v2/products.jsonl, from bathdisc-api-scrape.cjs).
 *
 * 1. Duplicates: Bathdisc lists many items two or three times under different
 *    handles with the same SKUs. Products sharing any SKU are one item; the
 *    most complete listing is kept and the others fold into it.
 * 2. Families: an item sold in several finishes / sizes is sometimes one
 *    product per finish ("... JM2143AG Antique Gold", "... JM2143CP Chrome").
 *    Single-variant products whose titles differ only by finish (from
 *    Bathdisc's finish_* tags or known finish names), size, or product code are
 *    merged into one product with Finish / Size options — only when every
 *    member has a distinct, detected value.
 * 3. Every variant keeps its own live price, was-price (only when higher),
 *    SKU and images. Specs come from the description's "Key: value" lists.
 *
 * Bathdisc has no area calculator on its live site — even its three tiles are
 * sold per box — so everything is sold by quantity here too.
 *
 * Output (.scratch/bathdisc/v2/): bathdisc-final.json, bathdisc-audit.json.
 * No database or Shopify access.
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "../.scratch/bathdisc/v2");
const SITE = "https://www.bathdisc.co.uk";
const RAW = fs.readFileSync(path.join(DIR, "products.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const MAX_MEDIA = 240;

const audit = { dropped: [], deduped: [], families: [], familyRejected: [], warnings: [] };

// ---------- text ----------
const fixText = (s) => String(s || "")
  .replace(/Ã‚Â|Â/g, " ").replace(/â€™|’/g, "'").replace(/â€œ|â€\x9d|“|”/g, '"').replace(/â€“|–/g, "-").replace(/â€”|—/g, "-")
  .replace(/\?\?/g, "'");
const decode = (s) => fixText(s).replace(/&nbsp;| /g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&ndash;|&mdash;/g, "-").replace(/&[a-z]+;/g, " ");
const clean = (s) => decode(s).replace(/\s+/g, " ").trim();

/** Lead prose + "Key: value" spec rows + remaining bullet points from body_html. */
function parseBody(html) {
  const h = String(html || "");
  const specs = {};
  const bullets = [];
  for (const m of h.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const t = clean(m[1].replace(/<[^>]+>/g, " "));
    if (!t) continue;
    const kv = t.match(/^([A-Za-z][A-Za-z0-9 /&().'-]{1,40}?)\s*:\s*(.+)$/);
    if (kv && !specs[kv[1].trim()]) specs[kv[1].trim()] = kv[2].trim();
    else bullets.push(t);
  }
  for (const m of h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => clean(c[1].replace(/<[^>]+>/g, " ")));
    if (cells.length === 2 && cells[0] && cells[1] && cells[0].length <= 40 && !specs[cells[0]]) specs[cells[0].replace(/:$/, "")] = cells[1];
  }
  const prose = h.replace(/<ul[\s\S]*?<\/ul>|<table[\s\S]*?<\/table>|<h\d[\s\S]*?<\/h\d>/gi, " ")
    .split(/<\/p>|<br\s*\/?>/i).map((s) => clean(s.replace(/<[^>]+>/g, " "))).filter((s) => s && s.length > 2);
  return { prose, specs, bullets };
}

// ---------- images ----------
const img = (src) => {
  if (!src) return "";
  let u = String(src).split("?")[0];
  if (u.startsWith("//")) u = "https:" + u;
  return u;
};

// ---------- option names ----------
const AXIS = (name) => {
  const n = clean(name);
  if (/^(title)$/i.test(n)) return null;
  if (/^tap holes?$/i.test(n)) return "Tap Holes";
  if (/^colou?r$/i.test(n)) return "Colour";
  if (/^choose option$/i.test(n)) return "Option";
  return n;
};

// ---------- categories (existing slugs) ----------
const r = (department, category, subCategory) => ({ department, category, subCategory });
/**
 * What the product IS, read from its title, checked before Bathdisc's
 * product_type — their type is often the family it sells with ("Accessories"
 * on a heated-towel-rail valve pack, "Bath" on a bath panel).
 */
function byTitle(n, t) {
  const tapLike = /mixer|\btaps?\b|filler|spout|monobloc|bib/.test(n);
  if (/\bbasin taps?\b/.test(n) && /pillar|pair|taps\b/.test(n)) return r("bathrooms", "taps", "pillar-tap-pairs");
  if (/\btrv\b|rad(iator)? valve|(corner|angled|straight|thermostatic) (rad |radiator )?valve\b/.test(n) && !/shower|bath|basin|concealed|diverter|outlet/.test(n)) return r("bathrooms", "heating", "radiator-valves-and-accessories");
  if (/element (shroud|cover)|element wire|cable cover/.test(n)) return r("bathrooms", "heating", "heating-elements");
  if (/bath (cushion|pillow|headrest|frame|support)/.test(n)) return r("bathrooms", "baths", "bath-wastes-and-fittings");
  if (/(washbasin|basin) (frame|stand)|stand for .*basin/.test(n)) return r("bathrooms", "toilets-basins", "wash-stands");
  if (/\belement\b/.test(n) && /radiator|towel/.test(t) && !/radiator|towel rail/.test(n)) return r("bathrooms", "heating", "heating-elements");
  if (/mug\s*(&|and)?\s*holder|glass mug|sponge dish/.test(n)) return r("accessories", "accessories", "soap-dishes-and-dispensers");
  if (/shower seat|folding seat/.test(n)) return r("bathrooms", "showers", "shower-accessories");
  if (/linear drain|\bgulley\b|wet ?room drain/.test(n)) return r("accessories", "accessories", "shower-wastes");
  if (/exofil|overflow filler/.test(n)) return r("accessories", "accessories", "overflow-bath-fillers");
  if (/\bniche\b|\b(metal|plastic|shower) hose\b|\bhose\b|water outlet|outlet elbow|universal box|crossbox universal/.test(n) && !/mixer|valve kit/.test(n)) return r("bathrooms", "showers", "shower-accessories");
  if (/drawer organi[sz]er|drawer insert|drawer divider/.test(n)) return r("bathrooms", "bathroom-furniture", "furniture-accessories");
  if (/towel (hanging bar|stand|butler)|bathroom butler|towel holder/.test(n)) return r("accessories", "accessories", "towel-rails-and-rings");
  if (/glass holder|tumbler/.test(n)) return r("accessories", "accessories", "soap-dishes-and-dispensers");
  if (/\bsink\b/.test(n) && !tapLike && !/waste|strainer|plug/.test(n)) return r("kitchens", "kitchens", "sinks");
  if (/\b(kitchen|sink)\b/.test(n) && tapLike) return r("kitchens", "kitchens", "kitchen-taps");
  if (/strainer waste|basket strainer/.test(n)) return r("accessories", "accessories", "basin-wastes");
  if (/\burinal\b/.test(n)) return r("bathrooms", "sanitaryware", "urinals");
  if (/\b(legs?|feet)\b/.test(n) && /vanity|furniture|unit|canvass/.test(n)) return r("bathrooms", "bathroom-furniture", "furniture-accessories");
  if (/radiator|column|k-flat|laser/.test(n) && /\b(feet|legs?|brackets?|stays?)\b/.test(n)) return r("bathrooms", "heating", "radiator-valves-and-accessories");
  if (/k-rails?\b/.test(n)) return r("bathrooms", "heating", "ladder");
  if (/flush pipe|flush bend|pan connector|wc connector/.test(n)) return r("bathrooms", "toilets-basins", "toilet-accessories");
  if (/pre.?wall|wc frame|toilet frame|frame set|concealed cistern/.test(n)) return r("bathrooms", "toilets-basins", "concealed-cisterns-and-frames");
  if (/\bbath panel\b|bath surround/.test(n) || (/\b(end|side|front) panel\b/.test(n) && /\bbath\b/.test(n) && !/shower|enclosure|door/.test(n))) return r("bathrooms", "baths", "bath-panels");
  if (/\bend panel\b/.test(n) && !/shower|enclosure|door|corner|gallery/.test(n)) return r("bathrooms", "bathroom-furniture", "furniture-accessories");
  if (/\bbath screen\b/.test(n)) return r("bathrooms", "baths", "bath-screens");
  if ((/heating element|\b\d{3,4} ?w element/.test(n) || /^\S+ \d{3,4}w element/.test(n) || /^electric element/.test(n)) && !/radiator with|rail with/.test(n)) return r("bathrooms", "heating", "heating-elements");
  if (/electric (towel |tower )?(radiator|rail)/.test(n)) return r("bathrooms", "heating", "electric");
  if (/radiator|heated towel|towel warmer/.test(n)) {
    if (/valve|sleeving|blanking|plug|bracket|pipe|kit|spanner|shroud|cover|lockshield|tail/.test(n)) return r("bathrooms", "heating", "radiator-valves-and-accessories");
    return /electric/.test(n) ? r("bathrooms", "heating", "electric") : null;
  }
  if (/flush plate|flush button/.test(n)) return r("bathrooms", "toilets-basins", "flush-plates");
  if (/hinge cover|seat hinge|seat fixing|fixing cover|toilet (roll )?accessor/.test(n)) return r("bathrooms", "toilets-basins", "toilet-accessories");
  if (/\b(wc|toilet) seat\b/.test(n) && !/(with|and|&|\+)\s*(soft close\s*)?(wc |toilet )?seat|pan\b.*seat|toilet with/.test(n)) return r("bathrooms", "toilets-basins", "toilet-seats");
  if (/toilet furniture unit|wc unit|toilet unit/.test(n)) return r("bathrooms", "bathroom-furniture", "wc-units");
  if (/overflow bath filler|bath filler with (click|pop|waste)|bath filler & waste|combined bath filler/.test(n)) return r("accessories", "accessories", "overflow-bath-fillers");
  if (/shower tray/.test(n) && /waste|drain|outlet/.test(n)) return r("accessories", "accessories", "shower-wastes");
  if (/shower tray/.test(n) && /frame|support|leg|riser kit|installation/.test(n)) return r("bathrooms", "showers", "shower-accessories");
  if (/\bmirror\b/.test(n) && !/cabinet/.test(n) && !/mirror (radiator|rail)/.test(n) && !/vanity|drawer/.test(n)) {
    if (/magnif/.test(n)) return r("bathrooms", "bathroom-mirrors", "magnifying");
    if (/without (led|light)|non.?illuminat|no light/.test(n)) return r("bathrooms", "bathroom-mirrors", "non-illuminated");
    if (/illuminat|\bled\b|\blight|back ?lit|glow|heated pad|demist|sensor/.test(n)) return r("bathrooms", "bathroom-mirrors", "illuminated");
    return r("bathrooms", "bathroom-mirrors", "non-illuminated");
  }
  if (/mirrored cabinet|mirror cabinet/.test(n)) return r("bathrooms", "bathroom-furniture", "mirrored-bathroom-cabinets");
  if (/\bvanity\b/.test(n) && /drawer|door|unit|worktop|cabinet/.test(n) && !/vanity (basin|bowl)/.test(n)) return null; // furniture: handled by type below
  if (/\bbath (mixer|filler)\b|\bbath shower mixer\b/.test(n) && /shower valve|shower head|^shower$/.test(t)) return /freestanding|floor standing/.test(n) ? r("bathrooms", "taps", "freestanding") : r("bathrooms", "taps", "bath-mixers");
  if (/bar valve|exposed (thermostatic )?valve/.test(n)) return r("bathrooms", "showers", "exposed-valves");
  if (/slide rail|shower rail|riser rail|riser kit/.test(n) && !/valve|mixer|thermostatic|concealed|push button/.test(n)) return r("bathrooms", "showers", "shower-rail-kits");
  if (/shower (handset|hand ?shower)|\bhandset\b|hand shower/.test(n) && !/mixer|filler|valve|thermostatic|concealed/.test(n)) return r("bathrooms", "showers", "shower-handsets");
  if (/\briser\b/.test(n) && /only|pipe/.test(n) && !/valve|mixer|thermostatic|concealed/.test(n)) return r("bathrooms", "showers", "shower-rail-kits");
  if (/stop ?cock|wall outlet|walloutlet|shower (hose|bracket|niche)|squeeg/.test(n)) return /squeeg/.test(n) ? r("accessories", "accessories", "cleaning-products") : r("bathrooms", "showers", "shower-accessories");
  if (/\b(corner trim|h joining trim|end cap|panel trim|joining trim)\b/.test(n)) return r("bathrooms", "showers", "bathroom-wall-panels");
  if (/bath legs?|bath feet|ball and claw/.test(n)) return r("bathrooms", "baths", "bath-wastes-and-fittings");
  if (/aerator|wall unions?|tap (tails?|valves?|conversion)|isolat/.test(n)) return r("bathrooms", "taps", "wastes-and-plumbing-accessories");
  if (/\bbasin\b/.test(n) && /waste|overflow|pop.?up|click.?clack/.test(n) && !tapLike) return r("accessories", "accessories", "basin-wastes");
  if (/pop.?up|click.?clack/.test(n) && /bath/.test(n)) return r("accessories", "accessories", "bath-wastes");
  if (/\bspout\b/.test(n) && /filler|mixer/.test(n)) return r("bathrooms", "taps", "bath-mixers");
  return null;
}

function categorise(p) {
  const t = String(p.product_type || "").toLowerCase();
  const tags = new Set(p.tags.map((x) => x.toLowerCase()));
  const n = String(p.title || "").toLowerCase();
  const has = (...xs) => xs.some((x) => tags.has(x.toLowerCase()));
  const titled = byTitle(n, t);
  if (titled) return titled;
  // vanity units with a basin/worktop that Bathdisc typed as "Basin"
  if (/basin/.test(t) && /\bvanity\b/.test(n) && /drawer|door|unit|worktop/.test(n) && !/vanity (basin|bowl)/.test(n))
    return /floor.?standing|floor mounted/.test(n) ? r("bathrooms", "bathroom-furniture", "floorstanding") : r("bathrooms", "bathroom-furniture", "wall-hung");
  if (/kitchen/.test(t) || has("Kitchen Taps")) return r("kitchens", "kitchens", "kitchen-taps");
  if (/sink/.test(t)) return r("kitchens", "kitchens", "sinks");
  if (/bath tap/.test(t)) return has("Wall Mounted Taps") && /spout/.test(n) ? r("bathrooms", "taps", "bath-and-basin-spouts")
    : /shower mixer|bsm|bath shower/.test(n) ? r("bathrooms", "taps", "bath-shower-mixers")
    : /freestanding|floor standing|floorstanding/.test(n) ? r("bathrooms", "taps", "freestanding")
    : /pillar|pair/.test(n) ? r("bathrooms", "taps", "bath-tap-pairs") : r("bathrooms", "taps", "bath-mixers");
  if (/basin tap/.test(t)) return /wall/.test(n) || has("Wall Mounted Taps") ? r("bathrooms", "taps", "wall-mounted")
    : /tall/.test(n) ? r("bathrooms", "taps", "tall-basin-taps")
    : /3 hole|3-hole|three hole|3th/.test(n) ? r("bathrooms", "taps", "3-tap-hole")
    : /pillar|pair/.test(n) ? r("bathrooms", "taps", "pillar-tap-pairs") : r("bathrooms", "taps", "mono-basin-mixers");
  if (/bidet tap/.test(t)) return r("bathrooms", "taps", "bidet-taps");
  if (/tap shroud/.test(t)) return r("bathrooms", "taps", "wastes-and-plumbing-accessories");
  if (/radiator valve/.test(t)) return r("bathrooms", "heating", "radiator-valves-and-accessories");
  if (/towel radiator|towel rail/.test(t)) return /electric/.test(n) ? r("bathrooms", "heating", "electric") : r("bathrooms", "heating", "ladder");
  if (/radiator/.test(t)) return /column/.test(n) ? r("bathrooms", "heating", "column") : /vertical/.test(n) ? r("bathrooms", "heating", "vertical")
    : /traditional|cast iron/.test(n) ? r("bathrooms", "heating", "traditional") : r("bathrooms", "heating", "designer");
  if (/shower tray/.test(t)) return r("bathrooms", "showers", "shower-trays");
  if (/shower enclosure|showers enclosure/.test(t)) return /wall panel|tile wall panel/.test(n) ? r("bathrooms", "showers", "bathroom-wall-panels")
    : /walk.?in|wet ?room|screen/.test(n) ? r("bathrooms", "showers", "walk-in")
    : /quadrant/.test(n) ? r("bathrooms", "showers", "quadrant") : /sliding/.test(n) ? r("bathrooms", "showers", "sliding")
    : /pivot/.test(n) ? r("bathrooms", "showers", "pivot") : /bi.?fold/.test(n) ? r("bathrooms", "showers", "bi-fold")
    : /hinged/.test(n) ? r("bathrooms", "showers", "hinged") : r("bathrooms", "showers", "shower-enclosures");
  if (/shower valve|panel valve/.test(t)) return /exposed|bar/.test(n) ? r("bathrooms", "showers", "exposed-valves") : r("bathrooms", "showers", "concealed-valves");
  if (/shower head/.test(t)) return /hand/.test(n) ? r("bathrooms", "showers", "shower-handsets") : r("bathrooms", "showers", "fixed-heads");
  if (/shower arm/.test(t)) return r("bathrooms", "showers", "shower-arms");
  if (/shower slide rail/.test(t)) return r("bathrooms", "showers", "shower-rail-kits");
  if (/shower kit|shower set|douche/.test(t)) return /exposed/.test(n) ? r("bathrooms", "showers", "exposed-valve-showers") : r("bathrooms", "showers", "concealed-valve-showers");
  if (/shower panel/.test(t)) return /glass|screen|frameless|side panel/.test(n) ? r("bathrooms", "showers", "walk-in") : r("bathrooms", "showers", "bathroom-wall-panels");
  if (/^shower$/.test(t)) return /electric/.test(n) ? r("bathrooms", "showers", "electric-showers") : r("bathrooms", "showers", "concealed-valve-showers");
  if (/shower (fitting|hose|outlet)|wall bracket/.test(t)) return r("bathrooms", "showers", "shower-accessories");
  if (/bath screen/.test(t)) return r("bathrooms", "baths", "bath-screens");
  if (/bath panel/.test(t)) return r("bathrooms", "baths", "bath-panels");
  if (/shower bath/.test(t)) return r("bathrooms", "baths", "shower-baths");
  if (/^bath$/.test(t)) return /freestanding/.test(n) || has("Freestanding Baths") ? r("bathrooms", "baths", "freestanding-baths")
    : /double ended/.test(n) ? r("bathrooms", "baths", "double-ended-baths") : /single ended/.test(n) ? r("bathrooms", "baths", "single-ended-baths")
    : /roll ?top|slipper/.test(n) ? r("bathrooms", "baths", "roll-top-and-slipper") : r("bathrooms", "baths", "straight-baths");
  if (/toilet seat/.test(t)) return r("bathrooms", "toilets-basins", "toilet-seats");
  if (/toilet frame|toilet cistern/.test(t)) return r("bathrooms", "toilets-basins", "concealed-cisterns-and-frames");
  if (/toilet|wall hung/.test(t)) return /back to wall|btw/.test(n) ? r("bathrooms", "toilets-basins", "back-to-wall")
    : /wall.?hung|wall.?mounted/.test(n + t) ? r("bathrooms", "toilets-basins", "wall-hung") : /close coupled/.test(n) ? r("bathrooms", "toilets-basins", "close-coupled")
    : /high level/.test(n) ? r("bathrooms", "toilets-basins", "high-level") : /low level/.test(n) ? r("bathrooms", "toilets-basins", "low-level")
    : /bidet/.test(n) ? r("bathrooms", "toilets-basins", "bidets") : r("bathrooms", "toilets-basins", "close-coupled");
  if (/basin/.test(t)) return /countertop|counter top|vessel/.test(n) || has("Countertop Basins") ? r("bathrooms", "toilets-basins", "countertop")
    : /semi.?pedestal/.test(n) ? r("bathrooms", "toilets-basins", "semi-pedestal") : /pedestal/.test(n) || has("Pedestal Basins") ? r("bathrooms", "toilets-basins", "full-pedestal")
    : /semi.?recess/.test(n) ? r("bathrooms", "toilets-basins", "semi-recessed") : /inset|under.?mount/.test(n) ? r("bathrooms", "toilets-basins", "inset")
    : /wash ?stand/.test(n) ? r("bathrooms", "toilets-basins", "wash-stands") : /cloak/.test(n) ? r("bathrooms", "toilets-basins", "cloakroom")
    : r("bathrooms", "toilets-basins", "wall-hung");
  if (/vanity|cabinet$|^cabinet|worktop/.test(t)) return /wc unit|toilet unit/.test(n) ? r("bathrooms", "bathroom-furniture", "wc-units")
    : /free.?standing/.test(n) ? r("bathrooms", "bathroom-furniture", "floorstanding")
    : /tall|column|storage/.test(n) ? r("bathrooms", "bathroom-furniture", "tall")
    : /floor.?standing|floor mounted|floorstanding/.test(n) ? r("bathrooms", "bathroom-furniture", "floorstanding")
    : /countertop|worktop/.test(n + t) ? r("bathrooms", "bathroom-furniture", "countertop-basin-units")
    : /cloak/.test(n) ? r("bathrooms", "bathroom-furniture", "cloakroom") : r("bathrooms", "bathroom-furniture", "wall-hung");
  if (/mirror cabinet/.test(t)) return r("bathrooms", "bathroom-furniture", "mirrored-bathroom-cabinets");
  if (/mirror/.test(t)) return /illuminat|led|light/.test(n) || has("Illuminating Mirrors") ? r("bathrooms", "bathroom-mirrors", "illuminated")
    : /magnif/.test(n) ? r("bathrooms", "bathroom-mirrors", "magnifying") : r("bathrooms", "bathroom-mirrors", "non-illuminated");
  if (/light/.test(t)) return r("accessories", "accessories", "lighting-and-electrical");
  if (/^tile$/.test(t)) return r("tiles", "floor-and-wall", /mosaic/.test(n) ? "mosaics-and-decorations" : "floor-tiles");
  if (/accessor/.test(t) || !t) {
    if (/toilet roll|roll holder|paper holder|tissue holder/.test(n)) return r("accessories", "accessories", "toilet-roll-holders");
    if (/\blights?\b|\blamps?\b|sconce|pendant/.test(n)) return r("accessories", "accessories", "lighting-and-electrical");
    if (/tidy|caddy|rack/.test(n)) return r("accessories", "accessories", "shelves-and-baskets");
    if (/toilet brush|wc set|brush holder|\bbrush\b(?!ed)/.test(n)) return r("accessories", "accessories", "toilet-brushes");
    if (/robe|hook/.test(n)) return r("accessories", "accessories", "robe-and-towel-hooks");
    // a towel rail sized like a radiator (e.g. 940 x 500mm) is a heated rail
    if (/towel rail|towel ring|towel bar/.test(n)) return /heated|radiator/.test(n) || /\b[3-9]\d{2,3}\s*x\s*[3-9]\d{2}/.test(n) || /\b1\d{3}\s*x\s*[3-9]\d{2}/.test(n) ? r("bathrooms", "heating", "ladder") : r("accessories", "accessories", "towel-rails-and-rings");
    if (/soap|dispenser|tumbler/.test(n)) return r("accessories", "accessories", "soap-dishes-and-dispensers");
    if (/shelf|basket|caddy/.test(n)) return r("accessories", "accessories", "shelves-and-baskets");
    if (/grab|support rail/.test(n)) return r("accessories", "accessories", "grab-rails");
    if (/bottle trap|trap/.test(n)) return r("accessories", "accessories", "bottle-traps");
    if (/bath waste|bath filler|overflow/.test(n)) return r("accessories", "accessories", "bath-wastes");
    if (/shower waste/.test(n)) return r("accessories", "accessories", "shower-wastes");
    if (/basin waste|waste|click.?clack|plug/.test(n)) return r("accessories", "accessories", "basin-wastes");
    if (/handle|knob/.test(n)) return r("bathrooms", "bathroom-furniture", "furniture-handles");
    if (/cabinet/.test(n)) return r("bathrooms", "bathroom-furniture", /mirror/.test(n) ? "mirrored-bathroom-cabinets" : "wall-hung");
    if (/tooth/.test(n)) return r("accessories", "accessories", "toothbrush-holders");
    if (/fan|extractor/.test(n)) return r("accessories", "accessories", "bathroom-extractor-fans");
    if (/clean/.test(n)) return r("accessories", "accessories", "cleaning-products");
    return r("accessories", "accessories", "miscellaneous");
  }
  return r("accessories", "accessories", "miscellaneous");
}

// ---------- finishes (from options + finish_* tags) ----------
const FINISHES = new Set();
for (const p of RAW) {
  for (const t of p.tags) if (/^finish_/i.test(t)) FINISHES.add(clean(t.slice(7)).toLowerCase());
  (p.options || []).forEach((o, i) => { if (/finish|colou?r/i.test(o.name)) for (const v of o.values) FINISHES.add(clean(v).toLowerCase()); });
}
for (const f of [...FINISHES]) if (f.length < 3 || /^(default|title|none|n\/a)$/.test(f)) FINISHES.delete(f);

// ---------- variants ----------
function buildVariants(p) {
  const axes = (p.options || []).map((o, i) => {
    let name = AXIS(o.name);
    // Shopify's default "Title" axis sometimes carries real values ("Chrome", "Black")
    if (!name) {
      const vals = (o.values || []).map(clean).filter((v) => v && !/^default( title)?$/i.test(v));
      if (vals.length > 1) name = vals.every((v) => FINISHES.has(v.toLowerCase())) ? "Finish" : "Option";
    }
    return { name, position: i + 1 };
  }).filter((a) => a.name);
  const imageById = new Map((p.images || []).map((im) => [im.id, im]));
  return p.variants.filter((v) => Number(v.price) > 0).map((v) => {
    const options = {};
    for (const ax of axes) {
      const val = clean(v[`option${ax.position}`]);
      if (val && !/^default( title)?$/i.test(val)) options[ax.name] = val;
    }
    const own = (p.images || []).filter((im) => (im.variant_ids || []).includes(v.id)).map((im) => img(im.src));
    const feat = img(v.featured_image?.src || (v.image_id && imageById.get(v.image_id)?.src) || "");
    const price = Math.round(Number(v.price) * 100) / 100;
    const cmp = Number(v.compare_at_price);
    return {
      name: Object.values(options).join(" / "),
      sku: String(v.sku || "").trim(),
      externalId: String(v.id),
      options,
      price,
      compareAtPrice: cmp > price ? Math.round(cmp * 100) / 100 : null,
      imageUrl: feat || own[0] || img(p.images?.[0]?.src) || "",
      images: [...new Set([feat, ...own].filter(Boolean))],
      weight: v.grams ? Math.round(v.grams) / 1000 : null,
      available: v.available !== false,
      sourceUrl: `${SITE}/products/${p.handle}?variant=${v.id}`,
      barcode: String(v.barcode || ""),
    };
  });
}

// ---------- 1) duplicates: products sharing SKUs ----------
const live = RAW.filter((p) => {
  // hidden helper products of Bathdisc's options app (add-on dropdowns), not browsable
  if (/^test\b|\btest-aware\b/i.test(String(p.title || ""))) { audit.dropped.push({ title: p.title, why: "test product" }); return false; }
  if (/^option-set-/i.test(p.handle)) { audit.dropped.push({ title: p.title, why: "options-app helper (not a real product)" }); return false; }
  const priced = (p.variants || []).some((v) => Number(v.price) > 0);
  if (!priced) audit.dropped.push({ title: p.title, why: "no price" });
  return priced;
});
const parent = new Map(live.map((p) => [p.id, p.id]));
const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
const bySku = new Map();
for (const p of live) for (const v of p.variants) {
  const s = String(v.sku || "").trim();
  if (!s) continue;
  if (bySku.has(s)) parent.set(find(p.id), find(bySku.get(s))); else bySku.set(s, p.id);
}
const comps = new Map();
for (const p of live) { const k = find(p.id); if (!comps.has(k)) comps.set(k, []); comps.get(k).push(p); }

const score = (p) => [(p.images || []).length > 0 ? 1 : 0, p.variants.length, (p.options || []).filter((o) => AXIS(o.name)).length, (p.images || []).length, (p.body_html || "").length];
const better = (a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return a.title.length < b.title.length; };

const items = []; // { lead, variants, extraImages, aliases }
for (const group of comps.values()) {
  const sorted = [...group].sort((a, b) => (better(a, b) ? -1 : 1));
  const lead = sorted[0];
  const item = { lead, variants: buildVariants(lead), extraImages: [], aliases: [] };
  const have = new Set(item.variants.map((v) => v.sku).filter(Boolean));
  for (const other of sorted.slice(1)) {
    const ov = buildVariants(other);
    const extra = ov.filter((v) => !v.sku || !have.has(v.sku));
    if (!extra.length) {
      item.aliases.push({ title: other.title, handle: other.handle });
      item.extraImages.push(...(other.images || []).map((im) => img(im.src)));
      continue;
    }
    // shares some SKUs but also sells others: keep it as its own item without the shared ones
    items.push({ lead: other, variants: extra, extraImages: [], aliases: [] });
    extra.forEach((v) => v.sku && have.add(v.sku));
  }
  if (item.aliases.length) audit.deduped.push({ kept: lead.title, folded: item.aliases.map((a) => a.title) });
  items.push(item);
}

// ---------- 2) families: single-variant products split by finish / size ----------
const FINISH_LIST = [...FINISHES].sort((a, b) => b.length - a.length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SIZE_RX = /\b\d{2,4}(?:\s*(?:mm|cm))?\s*(?:x\s*\d{2,4}(?:\s*(?:mm|cm))?){0,2}(?:\s*(?:mm|cm))\b|\b\d{2,4}\s*x\s*\d{2,4}(?:\s*x\s*\d{2,4})?\b/i;
const CODE_RX = /\b(?=[A-Z0-9_/-]*\d)(?=[A-Z0-9_/-]*[A-Z])[A-Z0-9][A-Z0-9_/-]{3,}\b/g;

function familyKey(it) {
  const p = it.lead;
  if (it.variants.length !== 1 || Object.keys(it.variants[0].options).length) return null;
  let title = ` ${clean(p.title)} `;
  const tagFinish = p.tags.filter((t) => /^finish_/i.test(t)).map((t) => clean(t.slice(7)));
  let finish = "";
  const cands = tagFinish.length === 1 ? [tagFinish[0].toLowerCase(), ...FINISH_LIST] : FINISH_LIST;
  for (const f of cands) {
    const rx = new RegExp(`(?<![\\w])${esc(f)}(?![\\w])`, "i");
    if (rx.test(title)) { finish = title.match(rx)[0].trim(); title = title.replace(rx, " "); break; }
  }
  let size = "";
  const sm = title.match(SIZE_RX);
  if (sm) { size = sm[0].trim(); title = title.replace(sm[0], " "); }
  title = title.replace(CODE_RX, " ");
  const sku = it.variants[0].sku;
  if (sku) title = title.replace(new RegExp(esc(sku), "ig"), " ");
  const base = title.replace(/\s[-–|,]\s|\s[-–|,]$|^\s*[-–|,]\s/g, " ").replace(/[()]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (!finish && !size) return null;
  return { key: [p.vendor, p.product_type, base].join("|"), finish, size, base };
}

const famGroups = new Map();
for (const it of items) {
  const k = familyKey(it);
  if (!k) continue;
  it._fam = k;
  if (!famGroups.has(k.key)) famGroups.set(k.key, []);
  famGroups.get(k.key).push(it);
}
const mergedAway = new Set();
for (const [key, members] of famGroups) {
  if (members.length < 2) continue;
  const finishes = new Set(members.map((m) => m._fam.finish.toLowerCase()));
  const sizes = new Set(members.map((m) => m._fam.size.toLowerCase()));
  const axes = [];
  if (finishes.size > 1) axes.push("Finish");
  if (sizes.size > 1) axes.push("Size");
  const val = (m, ax) => (ax === "Finish" ? m._fam.finish : m._fam.size);
  const combos = new Set(members.map((m) => axes.map((ax) => val(m, ax).toLowerCase()).join("§")));
  const ok = axes.length && members.every((m) => axes.every((ax) => val(m, ax))) && combos.size === members.length;
  if (!ok) { audit.familyRejected.push({ base: key.split("|").pop(), titles: members.map((m) => m.lead.title) }); continue; }
  const lead = [...members].sort((a, b) => (better(a.lead, b.lead) ? -1 : 1))[0];
  const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  const variants = members.map((m) => {
    const v = { ...m.variants[0], options: {} };
    for (const ax of axes) v.options[ax] = ax === "Finish" ? titleCase(val(m, ax)) : val(m, ax);
    v.name = Object.values(v.options).join(" / ");
    v.sourceUrl = `${SITE}/products/${m.lead.handle}`;
    v.images = [...new Set([...(v.images.length ? v.images : [v.imageUrl]), ...(m.lead.images || []).map((im) => img(im.src))])].filter(Boolean);
    return v;
  });
  // family name: the lead's title without its own finish / size / code
  let name = ` ${clean(lead.lead.title)} `;
  if (lead._fam.finish && axes.includes("Finish")) name = name.replace(new RegExp(`(?<![\\w])${esc(lead._fam.finish)}(?![\\w])`, "i"), " ");
  if (lead._fam.size && axes.includes("Size")) name = name.replace(lead._fam.size, " ");
  name = name.replace(CODE_RX, " ").replace(/\s[-–|,]\s*$|\s[-–|,](?=\s[-–|,])/g, " ").replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").replace(/\s[-–]\s*$/, "").trim();
  const family = { lead: lead.lead, variants, extraImages: members.flatMap((m) => m.extraImages), aliases: members.flatMap((m) => [{ title: m.lead.title, handle: m.lead.handle }, ...m.aliases]), familyName: name, familyAxes: axes };
  members.forEach((m) => mergedAway.add(m));
  items.push(family);
  audit.families.push({ name, axes, variants: variants.map((v) => `${v.name} £${v.price}`) });
}
const finalItems = items.filter((it) => !mergedAway.has(it));

// ---------- 3) listings ----------
const listings = finalItems.map((it) => {
  const p = it.lead;
  const cat = categorise(p);
  const body = parseBody(p.body_html);
  const variants = it.variants;
  const axisNames = it.familyAxes || [...new Set(variants.flatMap((v) => Object.keys(v.options)))];
  // drop single-value axes: they describe the product, they are not a choice
  const used = axisNames.filter((ax) => new Set(variants.map((v) => v.options[ax] || "")).size > 1);
  const fixed = {};
  for (const ax of axisNames) if (!used.includes(ax) && variants[0].options[ax]) fixed[ax] = variants[0].options[ax];
  variants.forEach((v, i) => {
    const o = {};
    for (const ax of used) o[ax] = v.options[ax] || "";
    v.options = o;
    used.forEach((ax, j) => (v[`option${j + 1}`] = o[ax]));
    v.name = Object.values(o).join(" / ") || clean(p.title);
    v.position = i;
    v.isDefault = i === 0;
  });
  const gallery = [...new Set([...(p.images || []).map((im) => img(im.src)), ...variants.flatMap((v) => v.images), ...it.extraImages])].filter(Boolean).slice(0, MAX_MEDIA);
  const specs = { Manufacturer: clean(p.vendor), ...body.specs, ...fixed };
  if (/^tile$/i.test(p.product_type)) {
    const t = clean(String(p.body_html || "").replace(/<[^>]+>/g, " "));
    const cov = t.match(/([\d.]+)\s*m2\s*coverage per box/i); const per = t.match(/(\d+)\s*tiles per box/i);
    if (cov) specs["Coverage per box"] = `${cov[1]} m²`;
    if (per) specs["Tiles per box"] = per[1];
    specs["Sold per"] = "Box";
  }
  const lead = body.prose.join("\n") || clean(p.title);
  const description = [lead, ...Object.entries(specs).map(([k, v]) => `${k}: ${v}`), ...body.bullets].join("\n");
  const name = it.familyName || clean(p.title);
  return {
    key: it.familyName ? `bathdisc:f:${variants.map((v) => v.externalId).sort().join("-")}` : `bathdisc:${p.id}`,
    name,
    sourceType: it.familyName ? "merged-family" : it.aliases.length ? "deduped" : "product",
    sourceUrl: `${SITE}/products/${p.handle}`,
    sourceProductId: String(p.id),
    sourceHandle: p.handle,
    vendor: clean(p.vendor),
    productType: clean(p.product_type),
    tags: p.tags.filter((t) => !/liquify|promotion|sale|listing-page|^finish_/i.test(t)),
    ...cat,
    price: variants[0].price,
    images: gallery,
    description,
    shortDescription: (body.prose[0] || "").slice(0, 400),
    specs,
    shopifyOptions: used.map((ax, i) => ({ name: ax, position: i + 1, values: [...new Set(variants.map((v) => v.options[ax]))] })),
    variantGroups: used,
    aliases: it.aliases,
    variants,
  };
});

// ---------- 3b) images by SKU, unique names ----------
const imageBySku = new Map();
for (const p of RAW) for (const v of p.variants) {
  const s = String(v.sku || "").trim();
  if (!s || imageBySku.has(s)) continue;
  const own = img(v.featured_image?.src || "") || (p.variants.length === 1 ? img(p.images?.[0]?.src) : "");
  if (own) imageBySku.set(s, own);
}
let filled = 0;
for (const L of listings) {
  for (const v of L.variants) if (!v.imageUrl && v.sku && imageBySku.has(v.sku)) {
    v.imageUrl = imageBySku.get(v.sku); v.images = [v.imageUrl]; filled++;
  }
  if (!L.images.length) L.images = [...new Set(L.variants.map((v) => v.imageUrl).filter(Boolean))].slice(0, MAX_MEDIA);
}
audit.imagesFilledBySku = filled;
const nameCount = new Map();
for (const L of listings) nameCount.set(L.name.toLowerCase(), (nameCount.get(L.name.toLowerCase()) || 0) + 1);
for (const L of listings) if (nameCount.get(L.name.toLowerCase()) > 1) {
  const code = (L.variants[0].sku || L.sourceProductId).replace(/^[A-Z]{1,3}(?=\d)/, "");
  L.name = `${L.name} (${code})`;
}
// still clashing (same lead SKU): fall back to Bathdisc's own product id
const again = new Map();
for (const L of listings) again.set(L.name.toLowerCase(), (again.get(L.name.toLowerCase()) || 0) + 1);
for (const L of listings) if (again.get(L.name.toLowerCase()) > 1) L.name = `${L.name.replace(/\s*\([^)]*\)$/, "")} (${L.sourceProductId})`;

// ---------- 3c) never list a product without a price or without images ----------
for (let i = listings.length - 1; i >= 0; i--) {
  const L = listings[i];
  L.variants = L.variants.filter((v) => v.price > 0);
  L.variants.forEach((v) => { if (!v.imageUrl && L.images.length) v.imageUrl = L.images[0]; });
  const why = !L.variants.length ? "no priced variant" : !L.images.length ? "no images" : "";
  if (why) { audit.dropped.push({ title: L.name, why }); listings.splice(i, 1); }
}

// ---------- 4) checks ----------
for (const L of listings) {
  const seen = new Map();
  for (const v of L.variants) {
    const k = JSON.stringify(v.options);
    if (L.variants.length > 1 && seen.has(k)) audit.warnings.push(`${L.name}: two variants share options ${k}`);
    seen.set(k, 1);
    if (!(v.price > 0)) audit.warnings.push(`${L.name} / ${v.name}: price £${v.price}`);
    if (!v.imageUrl) audit.warnings.push(`${L.name} / ${v.name}: no image`);
  }
  if (!L.images.length) audit.warnings.push(`${L.name}: no images`);
  if (L.shopifyOptions.length > 3) audit.warnings.push(`${L.name}: ${L.shopifyOptions.length} option axes`);
  if (L.variants.length > 2048) audit.warnings.push(`${L.name}: ${L.variants.length} variants (> Shopify 2048)`);
}
const summary = {
  capturedProducts: RAW.length,
  listings: listings.length,
  variants: listings.reduce((n, l) => n + l.variants.length, 0),
  withOptions: listings.filter((l) => l.shopifyOptions.length).length,
  bySource: listings.reduce((o, l) => ((o[l.sourceType] = (o[l.sourceType] || 0) + 1), o), {}),
  duplicateListingsFolded: audit.deduped.reduce((n, d) => n + d.folded.length, 0),
  familiesMerged: audit.families.length,
  productsMergedIntoFamilies: audit.families.reduce((n, f) => n + f.variants.length, 0),
  familyRejected: audit.familyRejected.length,
  dropped: audit.dropped.length,
  onSaleVariants: listings.reduce((n, l) => n + l.variants.filter((v) => v.compareAtPrice).length, 0),
  variantsWithoutSku: listings.reduce((n, l) => n + l.variants.filter((v) => !v.sku).length, 0),
  warnings: audit.warnings.length,
  imagesFilledBySku: audit.imagesFilledBySku,
  listingsWithoutImages: listings.filter((l) => !l.images.length).length,
  duplicateNames: [...listings.reduce((m, l) => m.set(l.name, (m.get(l.name) || 0) + 1), new Map()).values()].filter((n) => n > 1).length,
  categories: listings.reduce((o, l) => { const k = `${l.department}/${l.category}/${l.subCategory}`; o[k] = (o[k] || 0) + 1; return o; }, {}),
};
fs.writeFileSync(path.join(DIR, "bathdisc-final.json"), JSON.stringify(listings, null, 1));
fs.writeFileSync(path.join(DIR, "bathdisc-audit.json"), JSON.stringify({ summary, ...audit }, null, 1));
const { categories, ...rest } = summary;
console.log(JSON.stringify(rest, null, 1));
