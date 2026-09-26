/**
 * Build the Better Bathrooms catalogue from the capture — no DB, no Shopify.
 *
 * Input:  .scratch/betterbathrooms/bb-pdp.jsonl          (original capture)
 *         .scratch/betterbathrooms/work/bb-refetch.jsonl (targeted re-fetch, optional)
 * Output: .scratch/betterbathrooms/work/bb-final.json    (one entry per product, variants inside)
 *         .scratch/betterbathrooms/work/bb-report.json   (counts, categories, problems)
 *         .scratch/betterbathrooms/work/bb-confusions.json (URLs worth re-fetching)
 *
 * Grouping: a page's colour / size / handing words are stripped from its name;
 * pages of one range that are left with the same name are one product, and the
 * stripped words become that page's option values. Where the re-fetch captured
 * Better Bathrooms' own ProductGroup, that grouping wins. A group whose option
 * combinations are not unique is never published merged — its pages are listed
 * as confusions and, until resolved, split back into single products.
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "../.scratch/betterbathrooms");
const WORK = path.join(DIR, "work");
fs.mkdirSync(WORK, { recursive: true });
const ORIGIN = "https://www.betterbathrooms.com";
const DEAD_FILE = path.join(WORK, "dead-images.txt");
const DEAD_IMAGES = new Set(fs.existsSync(DEAD_FILE) ? fs.readFileSync(DEAD_FILE, "utf8").split("\n").map((s) => s.trim()).filter(Boolean) : []);

// ---------------------------------------------------------------- text utils
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "–", mdash: "—", raquo: "»", laquo: "«", hellip: "…", deg: "°", pound: "£", times: "×", frac12: "½", reg: "®", trade: "™", copy: "©" };
function decode(s) {
  let out = String(s ?? "");
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&([a-z]+\d*);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
    if (next === out) break;
    out = next;
  }
  return out;
}
const clean = (s) => decode(s).replace(/\s+/g, " ").trim();
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

// ---------------------------------------------------------------- load
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const pathKey = (u) => {
  let p = String(u || "").split("#")[0].split("?")[0].replace(ORIGIN, "");
  if (!p.startsWith("/")) p = "/" + p;
  return p.toLowerCase();
};

// ---------------------------------------------------------------- options
const COLOUR_WORDS = "White|Black|Chrome|Brass|Grey|Gray|Anthracite|Brown|Beige|Bronze|Silver|Green|Blue|Linen|Burgundy|Nickel|Copper|Gold|Red|Amber|Sage|Sand|Cream|Oak|Walnut|Graphite|Taupe|Pink|Navy|Charcoal|Cashmere|Ivory|Gunmetal|Clay|Terracotta|Mocha|Pearl|Stainless Steel";
const COLOUR_MODS = "Matt|Matte|Gloss|Glossy|Brushed|Polished|Satin|Antique|Midnight|Dark|Light|Pale|Rose|Stone|Dove|Sage|Forest|Olive|Navy|Beige|Black|Gun|Warm|Cool|Natural|Smoked|Dusty|Soft";
const COLOUR_RE = new RegExp(`\\b(?:(?:${COLOUR_MODS}|${COLOUR_WORDS})\\s+)*(?:${COLOUR_WORDS})(?:\\s*(?:&|and)\\s*(?:${COLOUR_WORDS}))?(?:\\s+(?:Gloss|Matt|Effect|Finish))?\\b`, "gi");
const WOOD_RE = /\b(?:(?:Light|Dark|Natural|Grey|Rustic)\s+)?(?:Wood|Oak|Walnut|Marble|Concrete|Stone)\s+Effect\b/gi;
const SIZE_RES = [
  /\bH?\s?\d+(?:\.\d+)?\s*(?:mm|cm)?\s*[x×]\s*W?\s?\d+(?:\.\d+)?(?:\s*(?:mm|cm)?\s*[x×]\s*D?\s?\d+(?:\.\d+)?)?\s*(?:mm|cm)?\b/gi,
  /\b\d+(?:\.\d+)?\s*(?:mm|cm)\b/gi,
  /\b\d+(?:\.\d+)?\s*(?:kW|W)\b/g,
  /\b(?:Single|Double|Triple)\s+Panel\b/gi,
];
const BTU_RE = /\b\d[\d,]*\s*BTU\b/gi;
const HAND_RE = /\b(?:Left|Right)[\s-]?Hand(?:ed)?\b|\b(?:LH|RH)\b/gi;

/** "H1600 x W236" and "H1600xW236mm" are the same size: one spacing, one unit. */
function normSize(t) {
  let v = t.replace(/\s+/g, " ").replace(/\s*[x×]\s*/gi, " x ").trim();
  if (/ x /.test(v)) {
    const unit = /cm\b/i.test(v) ? "cm" : "mm";
    v = v.replace(/\s*(mm|cm)\b/gi, "").trim() + unit;
  }
  return v.replace(/(\d)\s+(mm|cm)\b/gi, "$1$2");
}
/** Pull the variable words out of a name; returns the leftover and what was taken. */
function splitName(name) {
  let rest = ` ${name} `;
  const take = (re) => {
    const hits = [];
    rest = rest.replace(re, (m) => { hits.push(m.trim()); return " "; });
    return hits;
  };
  const hand = take(HAND_RE);
  const wood = take(WOOD_RE);
  const colour = take(COLOUR_RE);
  const size = [];
  for (const re of SIZE_RES) size.push(...take(re));
  take(BTU_RE);
  return {
    rest,
    colour: [...wood, ...colour].map((c) => titleCase(c.replace(/\s+/g, " "))).join(" / "),
    size: size.map(normSize).join(" ").replace(/\s+/g, " ").trim(),
    hand: hand.map((h) => (/^l/i.test(h) ? "Left Hand" : "Right Hand"))[0] || "",
  };
}
const keyOf = (s) => s.toLowerCase().replace(/almost perfect/g, " almostperfect ").replace(/[^a-z0-9]+/g, " ").replace(/\b(with|and|the|a|in|for|of|only)\b/g, " ").replace(/\s+/g, " ").trim();
function tidyName(s) {
  return s
    .replace(/\(\s*\)/g, " ")
    .replace(/(?:\s+[-–]\s*|\s*[-–]\s+)+/g, " - ")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–,&]+|[\s\-–,&]+$/g, "")
    .replace(/\b(with|and|&)\s*$/i, "")
    .trim();
}

// ---------------------------------------------------------------- specs
const LABELS = ["Heat Output (BTU - T50)", "BTU (T30)", "BTU (T60)", "Power (W)", "Bath Water Capacity (L)", "Number of shelves", "Number of Outlets", "Minimum Operating Pressure (Bar)", "Maximum Operating Pressure (Bar)", "IP Rating", "Maximum Load", "Bath Internal Length", "Bath Internal Width", "Bath Internal Height", "Bath Water Capacity", "Bath End Type", "Acrylic Thickness", "Adjustment Range (Min-Max) Width", "Adjustment Range (Min-Max) Depth", "Adjustment Range (Min-Max) Height", "Minimum Water Pressure", "Maximum Water Pressure", "Return Panel Type", "Number of Panels", "Pipe Centres", "Fuel type", "Material", "Timer", "Overflow Included", "Installation Fixings Included", "Soft Closing door", "Soft Closing", "Diverter", "Demister", "Safety glass", "Easy Clean", "Frost protection", "Safety Cut Out", "Memory function", "Motion sensor", "Touch Sensor", "Shaving Socket", "Rimless Toilet", "Soft Close Seat", "Quick Release Seat", "Feet included"];
function specLabel(k) {
  const key = clean(k);
  for (const l of LABELS) if (key === l || key.startsWith(l + " ")) return l;
  if (key.split(" ").length > 6) return key.split(" ").slice(0, 4).join(" ");
  return key;
}
function cleanSpecs(table) {
  const out = {};
  for (const [k, v] of Object.entries(table || {})) {
    const val = clean(v);
    if (!val) continue; // tick/cross icons captured as "" — unknowable which, so omitted
    const label = specLabel(k);
    if (!label || /^brand$/i.test(label)) continue;
    out[titleCase(label.charAt(0).toUpperCase() + label.slice(1))] = val;
  }
  return out;
}

// ---------------------------------------------------------------- description
function buildDescription(raw, bullets) {
  let t = decode(raw || "")
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .replace(/([a-z.:;)!?%'"0-9])(n{1,2})(?=[A-Z])/g, (_, a, n) => a + "\n".repeat(n.length))
    .replace(/\brn;\s*$/, "")
    .replace(/View User Manual\s*»?/gi, "")
    .replace(/^All About Me\s*\n/i, "");
  const lines = t.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const html = [];
  if (Array.isArray(bullets) && bullets.length) {
    html.push("<ul>" + bullets.map((b) => `<li>${esc(clean(b))}</li>`).join("") + "</ul>");
  }
  let list = null;
  const flush = () => { if (list) { html.push("<ul>" + list.join("") + "</ul>"); list = null; } };
  for (const line of lines) {
    if (/^need to know$/i.test(line)) { flush(); html.push("<h3>Need to know</h3>"); list = []; continue; }
    const kv = line.match(/^([A-Z][^:]{1,40}):\s*(.+)$/);
    const featured = line.match(/^([A-Z][A-Za-z\s-]{2,40}):(\S.*)$/);
    if (list) { list.push(`<li>${kv ? `<strong>${esc(kv[1])}:</strong> ${esc(kv[2])}` : esc(line)}</li>`); continue; }
    if (featured || (kv && kv[2].length > 30)) {
      const [, head, body] = featured || kv;
      html.push(`<p><strong>${esc(head.trim())}:</strong> ${esc(body.trim())}</p>`);
      continue;
    }
    html.push(`<p>${esc(line)}</p>`);
  }
  flush();
  return html.join("\n");
}

// ---------------------------------------------------------------- category
// Placed into the taxonomy DB2 already uses for bathroom products.
const RULES = [
  // kitchen
  [/kitchen.*(tap|mixer)|sink mixer|boiling (hot )?(water )?(kitchen )?tap/, "kitchens", "kitchens", "kitchen-taps"],
  [/kitchen sink|bowl.*sink|composite sink/, "kitchens", "kitchens", "sinks"],
  // combinations first — their names contain every other keyword
  [/(toilet|wc).*(and|&).*(basin|sink).*(unit|vanity)|combination unit|combi(nation)? vanity/, "bathrooms", "bathroom-furniture", "combined-toilet-and-basin-vanity-units"],
  [/2 in 1|two in one|sink on top/, "bathrooms", "toilets-basins", "2-in-1-toilet-and-basins"],
  [/traditional.*suite/, "bathrooms", "suites", "traditional-suites"],
  [/(toilet|wc).*(and|&).*basin.*(suite|set|pack)|toilet and basin\b/, "bathrooms", "suites", "toilet-and-basin-suites"],
  [/\bsuite\b/, "bathrooms", "suites", "modern-suites"],
  [/accessor(y|ies) set|\d+ piece.*set|grab rails set/, "accessories", "accessories", "miscellaneous"],
  [/sample pack/, "bathrooms", "heating", "designer"],
  // wastes, wet room, tiles, plumbing
  [/bath waste|waste kit.*bath|bath.*waste kit|waste & overflow|waste and overflow/, "accessories", "accessories", "bath-wastes"],
  [/linear waste|waste (kit|pack|cover)|grate|shower waste|linear drain|shower drain|outlet elbow/, "accessories", "accessories", "shower-wastes"],
  [/basin waste|click clack|sprung waste|slotted waste|unslotted waste|overflow cover|waste cover upgrade/, "accessories", "accessories", "basin-wastes"],
  [/bottle trap|\btrap\b/, "accessories", "accessories", "bottle-traps"],
  [/tile-?ready|tray former|wet ?room (install|kit)|drainage kit|tile-?ready bench/, "bathrooms", "showers", "wetroom"],
  [/(edge|corner) profile|tile trim|\btrim\b/, "tiles", "tiletrim", ""],
  [/patterned.*tile/, "tiles", "patterned-tiles", ""],
  [/floor tile/, "tiles", "floor-tiles", ""],
  [/\btiles?\b(?!-?(able|ready))/, "tiles", "bathroom-tiles", ""],
  [/macerator|saniflo/, "bathrooms", "toilets-basins", "toilet-accessories"],
  [/stand ?pipes?$/, "accessories", "accessories", "wastes-and-plumbing-accessories"],
  [/radiator valve|\btrv\b|lockshield/, "bathrooms", "heating", "radiator-valves-and-accessories"],
  [/zigbee|smart hub|wireless thermostat|room thermostat/, "accessories", "thermostats", ""],
  // small accessories
  [/toilet brush/, "accessories", "accessories", "toilet-brushes"],
  [/toilet roll|roll holder|paper holder/, "accessories", "accessories", "toilet-roll-holders"],
  [/robe hook|towel hook|\bhook\b/, "accessories", "accessories", "robe-and-towel-hooks"],
  [/soap|dispenser/, "accessories", "accessories", "soap-dishes-and-dispensers"],
  [/tumbler|toothbrush/, "accessories", "accessories", "toothbrush-holders"],
  [/grab (rail|bar)|support rail/, "accessories", "accessories", "grab-rails"],
  [/towel ring|towel bar(?!.*radiator)|towel holder|towel rack/, "accessories", "accessories", "towel-rails-and-rings"],
  [/\bhose\b|shower bracket|^\s*bracket\b/, "bathrooms", "showers", "shower-accessories"],
  [/vanity shelf/, "bathrooms", "bathroom-furniture", "furniture-accessories"],
  [/^(?!.*radiator).*(organiser|\bshelf\b|basket|caddy)/, "accessories", "accessories", "shelves-and-baskets"],
  [/extractor|\bfan\b/, "accessories", "accessories", "bathroom-extractor-fans"],
  [/clean(er|ing)|sealant|adhesive/, "accessories", "accessories", "cleaning-products"],
  // heating
  [/radiator valve|valves?\b.*radiator|radiator.*valves?|\btrv\b|pipe cover|radiator (feet|bracket|key)|lockshield|t piece/, "bathrooms", "heating", "radiator-valves-and-accessories"],
  [/heating element|electric element/, "bathrooms", "heating", "heating-elements"],
  [/dual fuel/, "bathrooms", "heating", "dual-fuel"],
  [/(electric|smart).*(radiator|heater|towel rail|towel warmer)|(radiator|heater|towel rail).*electric/, "bathrooms", "heating", "electric"],
  [/towel (rail|radiator|warmer)|ladder rail|heated towel/, "bathrooms", "heating", "ladder"],
  [/column/, "bathrooms", "heating", "column"],
  [/traditional.*radiator|radiator.*traditional|cast iron/, "bathrooms", "heating", "traditional"],
  [/vertical.*radiator/, "bathrooms", "heating", "vertical"],
  [/radiator/, "bathrooms", "heating", "designer"],
  // mirrors, cabinets, furniture
  [/mirror(ed)?.*cabinet|cabinet.*mirror/, "bathrooms", "bathroom-furniture", "mirrored-bathroom-cabinets"],
  [/(led|illuminated|light(ed|s)?|backlit|heated).*mirror|mirror.*(led|illuminated|lights?\b)/, "bathrooms", "bathroom-mirrors", "illuminated"],
  [/magnifying.*mirror|makeup mirror|shaving mirror/, "bathrooms", "bathroom-mirrors", "magnifying"],
  [/mirror/, "bathrooms", "bathroom-mirrors", "non-illuminated"],
  [/(toilet|wc) unit|back to wall unit|btw unit/, "bathrooms", "bathroom-furniture", "wc-units"],
  [/cloakroom.*vanity|vanity.*cloakroom/, "bathrooms", "bathroom-furniture", "cloakroom"],
  [/double.*vanity|vanity.*double|twin basin/, "bathrooms", "bathroom-furniture", "double-basin"],
  [/corner.*vanity|vanity.*corner/, "bathrooms", "bathroom-furniture", "corner"],
  [/countertop.*vanity|vanity.*countertop|worktop/, "bathrooms", "bathroom-furniture", "countertop-basin-units"],
  [/(wall hung|wall mounted|floating).*vanity|vanity.*wall hung/, "bathrooms", "bathroom-furniture", "wall-hung"],
  [/vanity|sink unit/, "bathrooms", "bathroom-furniture", "floorstanding"],
  [/tall.*(cabinet|unit|storage)|tallboy/, "bathrooms", "bathroom-furniture", "tall"],
  [/cabinet|storage unit|side unit|cupboard|drawer unit/, "bathrooms", "bathroom-furniture", "storage-units"],
  [/\b(handles?|knobs?)\s*$/, "bathrooms", "bathroom-furniture", "furniture-handles"],
  [/furniture (leg|foot|feet|plinth)/, "bathrooms", "bathroom-furniture", "furniture-accessories"],
  // toilets
  [/shower seat|shower stool/, "bathrooms", "showers", "shower-accessories"],
  [/douche|bidet (shower|spray)/, "bathrooms", "showers", "shower-handsets"],
  [/^(?:(?!\btoilet\b(?! seat)).)*(toilet seat|wc seat|\bseat( (and|&) cover)?\s*$)/, "bathrooms", "toilets-basins", "toilet-seats"],
  [/flush (plate|button)/, "bathrooms", "toilets-basins", "flush-plates"],
  [/^(?:(?!\b(toilet|pan|wc)\b).)*(cistern|(support|wc|toilet|noise|installation) frame)/, "bathrooms", "toilets-basins", "concealed-cisterns-and-frames"],
  [/flush (plate|button)/, "bathrooms", "toilets-basins", "flush-plates"],
  [/bidet(?!.*tap)/, "bathrooms", "toilets-basins", "bidets"],
  [/wall hung.*(toilet|pan|wc)/, "bathrooms", "toilets-basins", "wall-hung"],
  [/high level/, "bathrooms", "toilets-basins", "high-level"],
  [/low level/, "bathrooms", "toilets-basins", "low-level"],
  [/back to wall.*(toilet|pan|wc)|btw (toilet|pan)/, "bathrooms", "toilets-basins", "back-to-wall"],
  [/comfort height/, "bathrooms", "toilets-basins", "comfort-height"],
  [/rimless/, "bathrooms", "toilets-basins", "rimless"],
  [/toilet|\bwc\b|\bpan\b/, "bathrooms", "toilets-basins", "close-coupled"],
  // showers (before taps: a "bath mixer shower set" is a shower)
  [/\d+(\.\d+)?\s*kw\b|electric shower|power shower/, "bathrooms", "showers", "electric-showers"],
  [/diverter/, "bathrooms", "showers", "shower-diverter-valves"],
  [/outdoor shower|bar (mixer|valve|diverter)|exposed.*(shower|valve)/, "bathrooms", "showers", "exposed-valve-showers"],
  [/shower (set|system|kit|pack)|mixer shower|thermostatic shower(?! valve)/, "bathrooms", "showers", "concealed-valve-showers"],
  [/(shower|concealed|thermostatic|manual) valve/, "bathrooms", "showers", "concealed-valves"],
  // taps
  [/tap (set|pack)|shower (and|&) tap pack|(shower|basin) mixer tap set/, "bathrooms", "taps", "bathroom-tap-sets"],
  [/bidet.*(tap|mixer)/, "bathrooms", "taps", "bidet-taps"],
  [/freestanding.*(tap|mixer|filler)|floor standing.*(tap|mixer|filler)/, "bathrooms", "taps", "freestanding"],
  [/bath shower mixer|bath\/shower mixer/, "bathrooms", "taps", "bath-shower-mixers"],
  [/tall.*(basin|mixer|tap)/, "bathrooms", "taps", "tall-basin-taps"],
  [/cloakroom.*(tap|mixer)/, "bathrooms", "taps", "cloakroom-taps"],
  [/wall mounted.*(tap|mixer|spout)/, "bathrooms", "taps", "wall-mounted"],
  [/3 tap hole|three tap hole|3th\b/, "bathrooms", "taps", "3-tap-hole"],
  [/pillar tap|basin taps\b|tap pair/, "bathrooms", "taps", "pillar-tap-pairs"],
  [/bath taps\b|bath tap pair/, "bathrooms", "taps", "bath-tap-pairs"],
  [/spout/, "bathrooms", "taps", "bath-and-basin-spouts"],
  [/bath (mixer|filler)|bath tap/, "bathrooms", "taps", "bath-mixers"],
  [/(basin|mono).*(mixer|tap(?! holes?))|\btaps?\b(?! holes?)|mixer/, "bathrooms", "taps", "mono-basin-mixers"],
  // shower enclosures, trays, panels, parts
  [/shower tray|stone resin tray|\btray\b/, "bathrooms", "showers", "shower-trays"],
  [/wall panel|shower panel|wetwall|splashback|panel adhesive/, "bathrooms", "showers", "bathroom-wall-panels"],
  [/bath screen/, "bathrooms", "baths", "bath-screens"],
  [/quadrant/, "bathrooms", "showers", "quadrant"],
  [/bi-?fold/, "bathrooms", "showers", "bi-fold"],
  [/pivot/, "bathrooms", "showers", "pivot"],
  [/hinged/, "bathrooms", "showers", "hinged"],
  [/sliding/, "bathrooms", "showers", "sliding"],
  [/walk[\s-]?in(?!.*bath)|wet ?room.*(screen|panel|glass|enclosure)|shower screen/, "bathrooms", "showers", "walk-in"],
  [/side panel|return panel/, "bathrooms", "showers", "side-panel"],
  [/enclosure|shower door|cubicle/, "bathrooms", "showers", "shower-enclosures"],
  [/rigid riser/, "bathrooms", "showers", "rigid-riser-kits"],
  [/slide rail|riser rail|rail kit/, "bathrooms", "showers", "shower-rail-kits"],
  [/shower arm|ceiling arm|wall arm/, "bathrooms", "showers", "shower-arms"],
  [/hand ?shower|handset|shower handle/, "bathrooms", "showers", "shower-handsets"],
  [/shower head|rainfall head|overhead/, "bathrooms", "showers", "fixed-heads"],
  [/niche|shower (shelf|seat|stool|curtain)|shower accessor/, "bathrooms", "showers", "shower-accessories"],
  // baths
  [/(claw|bath) feet|feet for/, "bathrooms", "baths", "bath-wastes-and-fittings"],
  [/bath panel|end panel|front panel|panel$/, "bathrooms", "baths", "bath-panels"],
  [/^(?!.*(screen|tap|mixer|filler|spout|waste|rack|caddy|pillow|\bmat\b|overflow|\bplug\b)).*\b(bath|bathtub)\b/, "bathrooms", "baths", "@bath"],
  // basins
  [/wash ?stand/, "bathrooms", "toilets-basins", "wash-stands"],
  [/semi pedestal|semi-pedestal/, "bathrooms", "toilets-basins", "semi-pedestal"],
  [/pedestal/, "bathrooms", "toilets-basins", "full-pedestal"],
  [/cloakroom.*basin|basin.*cloakroom/, "bathrooms", "toilets-basins", "cloakroom"],
  [/(wall hung|wall mounted).*basin/, "bathrooms", "toilets-basins", "wall-hung"],
  [/inset basin|semi recessed|semi-recessed/, "bathrooms", "toilets-basins", "semi-recessed"],
  [/corner basin/, "bathrooms", "toilets-basins", "corner"],
  [/basin|sink/, "bathrooms", "toilets-basins", "countertop"],
  // late catch-alls
  [/shower/, "bathrooms", "showers", "shower-accessories"],
];
const NOISE = /\b(almost perfect|only opened|refurbished|graded)\b\s*-?\s*/gi;
/** The product noun: the name before its "with …", " - Range" or ", …" tail. */
function coreOf(name) {
  const n = name.replace(NOISE, " ");
  return n.split(/\s(?:with|w\/|including|incl\.?|inc\.?|plus|for)\s|\s[-–]\s|,|\(/i)[0];
}
function classify(name, specs) {
  // tails that decide the type even though they sit after "with"
  const full = name.replace(NOISE, " ").toLowerCase();
  const core = coreOf(name).toLowerCase();
  if (/sink on top/.test(full)) return { department: "bathrooms", category: "toilets-basins", subCategory: "2-in-1-toilet-and-basins", rule: "sink-on-top" };
  if (/cabinet with cistern/.test(full)) return { department: "bathrooms", category: "toilets-basins", subCategory: "concealed-cisterns-and-frames", rule: "cabinet+cistern" };
  if (/\bbasin\b/.test(core) && /wash ?stand/.test(full)) return { department: "bathrooms", category: "toilets-basins", subCategory: "wash-stands", rule: "basin+washstand" };
  if (/mirror/.test(core) && !/cabinet/.test(core) && !/magnifying|makeup|shaving/.test(core)) {
    const lit = /\b(led|lights?|lighted|illuminated|backlit|light up)\b/.test(full);
    return { department: "bathrooms", category: "bathroom-mirrors", subCategory: lit ? "illuminated" : "non-illuminated", rule: "mirror" };
  }
  for (const text of [coreOf(name), name.replace(NOISE, " ")]) {
    const n = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `.replace(/^ | $/g, "");
    for (const [re, department, category, sub] of RULES) {
      if (!re.test(n)) continue;
      let subCategory = sub;
      if (sub === "@bath") {
        subCategory =
          /shower bath|p[\s-]shape|l[\s-]shape/.test(n) ? "shower-baths"
          : /roll top|slipper/.test(n) ? "roll-top-and-slipper"
          : /freestanding/.test(n) ? "freestanding-baths"
          : /corner|back to wall/.test(n) ? "corner-and-back-to-wall-baths"
          : /double ended/.test(n) ? "double-ended-baths"
          : /steel/.test(n) ? "steel-baths"
          : /small|compact|walk in/.test(n) ? "small-baths"
          : "single-ended-baths";
      }
      return { department, category, subCategory, rule: String(re) };
    }
  }
  return { department: "bathrooms", category: "", subCategory: "", rule: null, specsHint: specs?.["Product Type"] };
}

// ---------------------------------------------------------------- records
function toRecord(raw, refetch) {
  const ld = refetch?.jsonLd || raw?.jsonLd;
  if (!ld || !ld.name) return null;
  const offers = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
  let price = Number(refetch?.price ?? offers?.price ?? offers?.lowPrice);
  if (!(price > 0)) price = 0;
  const images = (Array.isArray(ld.image) ? ld.image : ld.image ? [ld.image] : [])
    .map((u) => (String(u).startsWith("http") ? u : ORIGIN + (String(u).startsWith("/") ? "" : "/") + u))
    // file names with spaces load on their site but Shopify rejects the URL
    .map((u) => encodeURI(decodeURI(String(u).trim())))
    // files listed by Better Bathrooms that 404 on their own site
    .filter((u) => !DEAD_IMAGES.has(decodeURI(u).split("/").pop()));
  const name = clean(ld.name);
  const specs = cleanSpecs(refetch?.tableSpecs || raw?.tableSpecs);
  return {
    url: ORIGIN + pathKey(refetch?.url || raw.url),
    key: pathKey(refetch?.url || raw.url),
    name,
    range: clean(ld.brand?.name || ""),
    sku: clean(ld.sku || ld.mpn || ""),
    colourLd: clean(ld.color || ""),
    material: clean(ld.material || ""),
    price,
    images: [...new Set(images)],
    bullets: (ld.disambiguatingDescription || []).map(clean).filter(Boolean),
    descriptionRaw: ld.description || "",
    specs,
    group: refetch?.group || null, // { id, axes:[..], selected:{axis:value}, members:[{sku,url,price,name,image}] }
    breadcrumb: refetch?.breadcrumb || null,
    parts: splitName(name),
  };
}

function main() {
  const capture = readJsonl(path.join(DIR, "bb-pdp.jsonl"));
  const refetchRows = readJsonl(path.join(WORK, "bb-refetch.jsonl"));
  const refetch = new Map(refetchRows.filter((r) => !r.error).map((r) => [pathKey(r.url), r]));

  // best capture row per page
  const pages = new Map();
  for (const r of capture) {
    const k = pathKey(r.url);
    const prev = pages.get(k);
    if (!prev || (!prev.jsonLd && r.jsonLd)) pages.set(k, r);
  }
  for (const [k, r] of refetch) if (!pages.has(k)) pages.set(k, { url: r.url });

  const report = { pages: pages.size, unusable: [], noPrice: [], confusions: [], unclassified: [], splitGroups: [] };
  const records = [];
  for (const [k, raw] of pages) {
    const rec = toRecord(raw, refetch.get(k));
    if (!rec) { report.unusable.push(ORIGIN + k); continue; }
    if (!(rec.price > 0)) report.noPrice.push(rec.url);
    records.push(rec);
  }

  // ---- group: Better Bathrooms' own ProductGroup first, then by stripped name
  const groups = new Map();
  const add = (gk, rec) => { if (!groups.has(gk)) groups.set(gk, []); groups.get(gk).push(rec); };
  const bySku = new Map(records.map((r) => [r.sku, r]));
  const bbGroupOf = new Map(); // sku -> group id, from any re-fetched page's member list
  for (const r of records) if (r.group?.id) for (const m of r.group.members || []) bbGroupOf.set(m.sku, r.group.id);
  for (const r of records) {
    const gid = r.group?.id || bbGroupOf.get(r.sku);
    if (gid) add(`bb:${gid}`, r);
    else add(`name:${keyOf(r.range)}|${keyOf(r.parts.rest)}`, r);
  }

  const products = [];
  const confusionUrls = new Set();
  for (const [gk, members] of groups) {
    const priced = members.filter((m) => m.price > 0);
    if (!priced.length) continue;
    const built = buildProduct(gk, priced, report);
    if (built.ok) { products.push(built.product); continue; }
    // not safely mergeable → singles, and worth a look on the live site
    report.splitGroups.push({ group: gk, reason: built.reason, pages: priced.map((m) => m.name) });
    priced.forEach((m) => { if (!refetch.has(m.key)) confusionUrls.add(m.url); });
    for (const m of priced) products.push(buildProduct(`single:${m.key}`, [m], report).product);
  }
  for (const u of report.unusable) if (!refetch.has(pathKey(u))) confusionUrls.add(u);
  for (const u of report.noPrice) if (!refetch.has(pathKey(u))) confusionUrls.add(u);

  // ---- report
  const cat = {};
  for (const p of products) {
    const k = `${p.department} > ${p.category} > ${p.subCategory}`;
    cat[k] = (cat[k] || 0) + 1;
    if (!p.category) report.unclassified.push(p.name);
  }
  const axes = {};
  for (const p of products) for (const o of p.shopifyOptions) axes[o.name] = (axes[o.name] || 0) + 1;
  const summary = {
    pages: pages.size,
    usablePages: records.length,
    unusablePages: report.unusable.length,
    pagesWithoutPrice: report.noPrice.length,
    products: products.length,
    productsWithVariants: products.filter((p) => p.variants.length > 1).length,
    variantsTotal: products.reduce((a, p) => a + p.variants.length, 0),
    maxVariants: Math.max(...products.map((p) => p.variants.length)),
    splitGroups: report.splitGroups.length,
    confusionPagesToRefetch: confusionUrls.size,
    unclassified: report.unclassified.length,
    optionAxes: axes,
  };
  fs.writeFileSync(path.join(WORK, "bb-final.json"), JSON.stringify(products, null, 1));
  fs.writeFileSync(path.join(WORK, "bb-confusions.json"), JSON.stringify([...confusionUrls], null, 1));
  fs.writeFileSync(path.join(WORK, "bb-report.json"), JSON.stringify({ summary, categories: cat, ...report }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  console.log("categories:");
  for (const [k, v] of Object.entries(cat).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
}

// ---------------------------------------------------------------- one product
function sizeNum(v) { const m = String(v).match(/\d+(?:\.\d+)?/g); return m ? m.map(Number) : [Infinity]; }
function cmpSize(a, b) { const x = sizeNum(a), y = sizeNum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; } return String(a).localeCompare(String(b)); }

function buildProduct(gk, members, report) {
  const multi = members.length > 1;
  const fromBB = gk.startsWith("bb:");
  let axisNames = [];
  const valuesOf = new Map();

  if (multi && fromBB) {
    // option values exactly as Better Bathrooms labels them on each page
    const axisSet = [];
    for (const m of members) for (const a of Object.keys(m.group?.selected || {})) if (!axisSet.includes(a)) axisSet.push(a);
    axisNames = axisSet;
    for (const m of members) valuesOf.set(m, axisNames.map((a) => m.group?.selected?.[a] || ""));
    // a member we did not re-fetch has no selected values: fall back to name parts
    const fb = members.filter((m) => !m.group?.selected);
    if (fb.length) {
      if (!axisNames.length) axisNames = ["Colour", "Size"];
      for (const m of fb) valuesOf.set(m, axisNames.map((a) => (/colou?r|finish/i.test(a) ? m.parts.colour || m.colourLd : /size|width|length|dimension/i.test(a) ? m.parts.size : /hand/i.test(a) ? m.parts.hand : "")));
    }
  } else if (multi) {
    const cand = [
      ["Colour", (m) => m.parts.colour || m.colourLd],
      ["Size", (m) => m.parts.size],
      ["Handing", (m) => m.parts.hand],
    ];
    const used = cand.filter(([, f]) => new Set(members.map(f)).size > 1);
    axisNames = used.map(([n]) => n);
    for (const m of members) valuesOf.set(m, used.map(([, f]) => f(m)));
  }

  if (multi) {
    // prune axes that do not vary; check every combination is complete and unique
    const keep = axisNames.map((_, i) => new Set(members.map((m) => valuesOf.get(m)[i])).size > 1);
    axisNames = axisNames.filter((_, i) => keep[i]);
    for (const m of members) valuesOf.set(m, valuesOf.get(m).filter((_, i) => keep[i]));
    if (!axisNames.length) return { ok: false, reason: "pages differ but no colour/size difference found" };
    if (axisNames.length > 3) return { ok: false, reason: "more than 3 option axes" };
    if (members.length > 100) return { ok: false, reason: "more than 100 variants" };
    const combos = new Set();
    for (const m of members) {
      const v = valuesOf.get(m);
      if (v.some((x) => !x)) return { ok: false, reason: `missing ${axisNames[v.findIndex((x) => !x)]} on "${m.name}"` };
      const c = v.join(" / ").toLowerCase();
      if (combos.has(c)) return { ok: false, reason: `duplicate option combination "${v.join(" / ")}"` };
      combos.add(c);
    }
  }

  // tidy axis names coming from BB labels ("choose your vanity width:")
  const stripped = (a) => titleCase(clean(a).replace(/^(please\s+)?(choose|select)\s+(your|a|the)?\s*/i, "").replace(/[:?]+$/, "").trim() || clean(a));
  const kind = (a) => (/colou?r|finish/i.test(a) ? "Colour" : /width|size|length|dimension/i.test(a) ? "Size" : /hand/i.test(a) ? "Handing" : null);
  // "Colour" / "Size" when the product has one such selector; the specific
  // label ("Vanity Unit Colour", "Handle Colour") when it has several
  const kinds = axisNames.map(kind);
  const labels = axisNames.map((a, i) => (kinds[i] && kinds.filter((k) => k === kinds[i]).length === 1 ? kinds[i] : stripped(a)));

  // order variants: by size, then colour
  const ordered = [...members].sort((a, b) => {
    const va = valuesOf.get(a) || [], vb = valuesOf.get(b) || [];
    const si = labels.indexOf("Size");
    if (si >= 0) { const d = cmpSize(va[si], vb[si]); if (d) return d; }
    return va.join("|").localeCompare(vb.join("|"));
  });
  const cheapest = [...members].sort((a, b) => a.price - b.price)[0];
  const lead = cheapest;

  // product name: the lead page's name without the words that vary
  let name = lead.name;
  if (multi) {
    let rest = ` ${lead.name} `;
    const kindsUsed = new Set(axisNames.map(kind));
    if (kindsUsed.has("Handing")) rest = rest.replace(HAND_RE, " ");
    if (kindsUsed.has("Colour")) rest = rest.replace(WOOD_RE, " ").replace(COLOUR_RE, " ");
    if (kindsUsed.has("Size")) { for (const re of SIZE_RES) rest = rest.replace(re, " "); rest = rest.replace(BTU_RE, " "); }
    name = tidyName(rest) || lead.name;
    // Better Bathrooms' group title when it reads like a product name; many are
    // internal labels ("Amelia multi-variation", "filtered elwoods")
    const gName = clean(lead.group?.name || "");
    const looksReal = gName.length >= 20 && /[A-Z]/.test(gName[0]) && / - /.test(gName) &&
      !/variation|options available|multi|filtered|^[A-Z]{2,}-/i.test(gName);
    if (fromBB && looksReal) name = gName;
  }

  const gallery = [...lead.images];
  for (const m of ordered) if (m !== lead && m.images[0]) gallery.push(m.images[0]);

  const variants = ordered.map((m, i) => {
    const vals = valuesOf.get(m) || [];
    const options = Object.fromEntries(labels.map((l, j) => [l, vals[j]]));
    return {
      name: multi ? vals.join(" / ") : m.name,
      sku: m.sku,
      options: multi ? options : {},
      ...(multi ? Object.fromEntries(vals.map((v, j) => [`option${j + 1}`, v])) : {}),
      price: m.price,
      stock: 500,
      imageUrl: m.images[0] || "",
      images: m.images,
      isDefault: m === lead,
      available: true,
      sourceUrl: m.url,
      position: i,
    };
  });

  const cls = classify(name, lead.specs);
  const specs = { ...lead.specs };
  if (/almost perfe|only opened|grade [a-z]\d|refurbished/i.test(lead.name)) specs.Condition = specs.Condition || "Graded / open box";
  if (lead.range && lead.range.toLowerCase() !== "better bathrooms") specs.Range = lead.range;
  if (!multi && lead.colourLd && !specs.Colour) specs.Colour = lead.colourLd;

  return {
    ok: true,
    product: {
      groupKey: gk,
      name,
      range: lead.range,
      description: buildDescription(lead.descriptionRaw, lead.bullets),
      price: Math.min(...members.map((m) => m.price)),
      images: [...new Set(gallery)],
      department: cls.department,
      category: cls.category,
      subCategory: cls.subCategory,
      classifiedBy: cls.rule,
      sku: lead.sku,
      specs,
      sourceUrl: lead.url,
      shopifyOptions: multi ? labels.map((l, j) => ({ name: l, position: j + 1, values: [...new Set(variants.map((v) => v.options[l]))] })) : [],
      variants,
    },
  };
}

main();
