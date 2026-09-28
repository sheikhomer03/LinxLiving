/**
 * Build the Topps Tiles catalogue from the API capture (topps-api-scrape.cjs).
 *
 * One listing per real product, every colour / size / finish as a variant:
 *  - Topps' own configurable products give the grouping exactly
 *    (options.configurable maps each option value to its child products).
 *  - Standalone products that are the same item in several sizes / colours
 *    (drill bits by diameter, grout by colour and weight, joints by depth)
 *    are merged when their names differ ONLY by their own option attribute
 *    values and every member has a unique combination. Anything ambiguous
 *    stays a separate listing.
 *  - Samples, URL-less placeholders and virtual rows are left out.
 *
 * Each variant carries its own price, was-price, SKU, images and how it is
 * sold (tile / box / sheet / unit) with its coverage and £/m².
 *
 * Output: .scratch/toppstiles/v2/topps-final.json + topps-audit.json
 * Reads nothing from, and writes nothing to, any database.
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "../.scratch/toppstiles/v2");
const SITE = "https://www.toppstiles.co.uk";
const MEDIA = `${SITE}/static/media/catalog`;
const SWATCH = `${SITE}/static/media/attribute/swatch`;
const MAX_VARIANT_IMAGES = 4;
const MAX_PRODUCT_MEDIA = 240;

const A = JSON.parse(fs.readFileSync(path.join(DIR, "attributes.json"), "utf8"));
const RAW = fs.readFileSync(path.join(DIR, "raw-products.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const byId = new Map(RAW.map((p) => [p.id, p]));

// ---------- attribute helpers ----------
const optLabel = (code, v) => {
  const o = A[code]?.options?.[String(v)];
  return o ? String(o.label || "").trim() : "";
};
const optSwatch = (code, v) => {
  const s = A[code]?.options?.[String(v)]?.swatch;
  return s ? `${SWATCH}${s}` : "";
};
const labels = (code, v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => optLabel(code, x)).filter(Boolean);

/** Option axes Topps configures, with the name the shopper sees. */
const AXIS_NAME = {
  product_colour: "Colour", trim_product_colour: "Colour", grout_product_colour: "Colour",
  adhesive_product_colour: "Colour", maintenance_product_colour: "Colour",
  size: "Size", tools_accessories_size: "Size", grout_size: "Size", adhesive_size: "Size",
  maintenance_size: "Size", wet_room_size: "Size", underfloor_heading_size: "Size",
  primary_tile_finish: "Finish", pack_size: "Pack Size", trim_depth: "Depth",
  trim_shape: "Shape", trim_size: "Length", blade_material: "Blade Material", flooring_format: "Format",
};
const AXIS_ORDER = ["product_colour", "trim_product_colour", "grout_product_colour", "adhesive_product_colour",
  "maintenance_product_colour", "size", "tools_accessories_size", "grout_size", "adhesive_size", "maintenance_size",
  "wet_room_size", "underfloor_heading_size", "pack_size", "trim_depth", "trim_shape", "trim_size",
  "primary_tile_finish", "blade_material", "flooring_format"];
const OPTION_ATTRS = new Set(AXIS_ORDER);

/** Spec rows, in the order Topps' own PDP spec table lists them. */
const SPEC_ATTRS = ["brand", "range", "product_colour", "size", "tile_finish", "tile_material",
  "tile_type", "tile_shape", "tiles_depth", "coverage_pack_m2", "tiles_per_box_visible", "tiles_per_pallet_visible",
  "tile_suitability", "suitable_rooms", "tiling_environment", "special_features", "application", "number_of_coats",
  "coverage", "working_time", "drying_time", "pot_life", "shelf_life", "weight", "weight_per_m2", "trim_colour",
  "trim_product_colour", "trim_material", "trim_shape", "trim_depth", "trim_size", "max_cutting_thickness",
  "max_cutting_length", "max_diagonal_cut", "materials_suitable_for_cutting", "dimensions", "board_depth",
  "technical_spec", "surface", "cementitous", "flexible_cementitous", "ready_mixed", "grout_product_colour",
  "grout_type", "grout_size", "grout_suitability", "joint_size_suitability", "joint_width", "material",
  "wall_surface", "floor_surface", "silicone_product_colour", "maintenance_type", "maintenance_size",
  "maintenance_product_colour", "accessory_type", "tool_type", "tools_accessories_size", "blade_material",
  "wet_room_type", "wet_room_size", "adhesive_type", "adhesive_product_colour", "adhesive_size", "door_bar_shape",
  "underfloor_heating_size", "underfloor_heating_type", "underfloor_heading_size", "pack_size", "flooring_type",
  "fitting_type", "flooring_format"];
const SPEC_LABEL = { tiles_depth: "Thickness (cm)", coverage_pack_m2: "Coverage per pack", tiles_per_box_visible: "Tiles per box",
  tiles_per_pallet_visible: "Tiles per pallet", weight: "Weight (kg)", weight_per_m2: "Weight per m² (kg)", brand: "Manufacturer" };

function attrValue(p, code) {
  const v = p[code];
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "";
  const def = A[code];
  if (def && (def.input === "select" || def.input === "multiselect" || Object.keys(def.options || {}).length)) {
    const l = labels(code, v);
    if (l.length) return l.join(", ");
    if (typeof v === "number" || Array.isArray(v)) return "";
  }
  if (typeof v === "object") return "";
  return String(v).trim();
}
function specsOf(p) {
  const out = {};
  for (const code of SPEC_ATTRS) {
    const v = attrValue(p, code);
    if (!v || /^(0|no)$/i.test(v)) continue;
    const label = SPEC_LABEL[code] || A[code]?.label || code;
    if (!out[label]) out[label] = v;
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- text ----------
const plain = (html) => String(html || "")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|h\d)>/gi, "\n").replace(/<li[^>]*>/gi, "")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ")
  .split("\n").map((s) => s.trim()).filter(Boolean).join("\n");
const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim();
const isPlaceholderName = (s) => /_configurable$/i.test(String(s || ""));

// ---------- images ----------
function mediaOf(p) {
  const imgs = [], videos = [];
  const media = [...(p.media || [])].sort((a, b) => (a.position ?? -1) - (b.position ?? -1));
  // base image first
  media.sort((a, b) => ((b.labels || []).includes("base") ? 1 : 0) - ((a.labels || []).includes("base") ? 1 : 0));
  for (const m of media) {
    if (!m.image) continue;
    const labs = m.labels || [];
    if (m.video) {
      const id = (String(m.video).match(/vimeo\.com\/(\d+)/) || [])[1];
      const yt = (String(m.video).match(/(?:youtu\.be\/|v=)([\w-]{6,})/) || [])[1];
      if (id) videos.push({ host: "vimeo", externalId: id, src: `vimeo:${id}`, posterUrl: `${MEDIA}${m.image}`, position: m.position ?? null, alt: m.alt_text || "" });
      else if (yt) videos.push({ host: "youtube", externalId: yt, src: `youtube:${yt}`, posterUrl: `${MEDIA}${m.image}`, position: m.position ?? null, alt: m.alt_text || "" });
      continue;
    }
    if (labs.includes("customerphoto")) continue;
    imgs.push(`${MEDIA}${m.image}`);
  }
  if (!imgs.length && p.image) imgs.push(`${MEDIA}${p.image}`);
  return { imgs: [...new Set(imgs)], videos };
}

// ---------- selling unit / calculator ----------
function sellInfo(c) {
  const unit = optLabel("sold_by", c.sold_by); // Single Tile | Box | Sheet | ""
  const cov = typeof c.coverage_m2 === "number" && c.coverage_m2 > 0 ? c.coverage_m2 : null;
  if (!unit || !cov) return { sellUnit: "Unit", coverageM2: null, pricePerSqm: null, tilesPerBox: null };
  const u = /tile/i.test(unit) ? "Tile" : /box/i.test(unit) ? "Box" : "Sheet";
  return {
    sellUnit: u,
    coverageM2: cov,
    pricePerSqm: Math.round((Number(c.price) / cov) * 100) / 100,
    tilesPerBox: Number(c.tiles_per_box_visible) || (u === "Box" ? Number(c.tiles_per_box) || null : null),
  };
}

// ---------- category mapping onto slugs that already exist in DB1 ----------
const NATURAL = /marble|limestone|travertine|slate|quartzite|natural mosaic|sandstone|granite/i;
function categorise(lead, kids) {
  const name = cleanName(lead.name);
  const cp = String(lead.category_path || "") + " " + (lead.breadcrumbs || []).map((b) => b.label).join(" ");
  const all = [lead, ...kids];
  const mats = new Set(all.flatMap((p) => labels("tile_material", p.tile_material)));
  const subs = new Set(all.flatMap((p) => labels("product_subtype", p.product_subtype)));
  const types = new Set(all.flatMap((p) => labels("tile_type", p.tile_type)));
  const flooringType = new Set(all.flatMap((p) => labels("flooring_type", p.flooring_type)));
  const set = lead.attribute_set;
  const n = name.toLowerCase();
  const r = (department, category, subCategory) => ({ department, category, subCategory });

  if (set === 11 || all.some((p) => p.sold_by)) {
    const m = [...mats].join(" ") + " " + [...flooringType].join(" ");
    if (/vinyl|spc|lvt/i.test(m) || /luxury vinyl|lvt/i.test(n + cp)) return r("flooring", "floor-and-wall", "vinyl-flooring");
    if (/laminate/i.test(m)) return r("flooring", "floor-and-wall", "laminates");
    if (/wood/i.test(m)) return r("flooring", "engineered-wood-flooring", "wide-engineered-wood-flooring");
    if (subs.has("Splashbacks") || subs.has("Bathroom Panels") || /pvc|aluminium/i.test(m) || /splashback|wall panel|multipanel/i.test(n)) return r("wall-panels", "floor-and-wall", "panels");
    if (subs.has("Mosaic Tiles") || /mosaic/i.test(n)) return r("tiles", "floor-and-wall", "mosaics-and-decorations");
    if (NATURAL.test(m)) return r("tiles", "floor-and-wall", "natural-stone");
    const kidNames = kids.map((k) => String(k.name || "")).join(" ");
    if (subs.has("Outdoor Tiles") || /outdoor|paving|garden/i.test(n + " " + cp) || (kids.length && kids.every((k) => /outdoor/i.test(String(k.name || ""))))) return r("tiles", "outdoor-tiles", "stone-tiles");
    if (types.has("Wall") && !types.has("Floor")) return r("tiles", "floor-and-wall", "wall-tiles");
    if (types.size) return r("tiles", "floor-and-wall", "floor-tiles");
    if (/border|skirting|capping|strip|corner|dado|moulding|listello|pencil/i.test(n)) return r("tiles", "floor-and-wall", "mosaics-and-decorations");
    return r("tiles", "floor-and-wall", "wall-tiles");
  }
  if (set === 12 || /\bgrout\b/i.test(n)) return r("accessories", "installation-materials", "grouting-materials");
  if (set === 13 || /trim|profile|movement joint|door bar|skirting|end cap/i.test(n)) {
    if (/door bar|threshold|transition/i.test(n)) return r("accessories", "accessories", "thresholds");
    if (/skirting/i.test(n)) return r("accessories", "mb-accessories", "skirting-board");
    return r("accessories", "installation-materials", "decorative-profiles");
  }
  if (set === 16 || /adhesive/i.test(n)) return r("accessories", "adhesives-levellers", "tile-adhesive");
  if (set === 20 || /underfloor heating|warmup|thermostat/i.test(n + cp)) {
    if (/thermostat|probe|rcd|residual circuit/i.test(n)) return r("heating", "electric-underfloor-heating", "");
    if (/cable|wire/i.test(n)) return r("heating", "electric-underfloor-heating", "underfloor-heating-cables");
    if (/insulat|board|tape/i.test(n)) return r("accessories", "insulation-fixings", "insulation-boards");
    return r("heating", "electric-underfloor-heating", "underfloor-heating-mats");
  }
  if (/levell?ing compound|level it|level fast|level max|self.levell/i.test(n)) return r("accessories", "adhesives-levellers", "self-levelling-compound");
  if (/primer|prime/i.test(n)) return r("accessories", "adhesives-levellers", "floor-primer");
  if (/tile levelling|levelling (clip|kit|wedge|pliers|system|cap)|rush level|spin doctor|wedge|clip/i.test(n + " " + cp)) return r("accessories", "installation-materials", "leveling-systems");
  if (/wet room tray|fundo|aquabase|shower tray/i.test(n)) return r("bathrooms", "bathrooms", "shower-trays");
  if (/drain|grate|channel/i.test(n)) return r("accessories", "installation-materials", "kits-and-grates-for-showers");
  if (/tanking|waterproof|sealing tape|scrim|membrane/i.test(n + " " + cp)) return r("accessories", "installation-materials", "waterproofing");
  if (/matting|decoupl|uncoupl|ditra/i.test(n + " " + cp)) return r("accessories", "installation-materials", "decoupling");
  if (/backer|board|hardie|jackoboard|wedi|sanoasa|mensolo|bench/i.test(n + " " + cp)) return r("accessories", "insulation-fixings", "insulation-boards");
  if (/shelf/i.test(n)) return r("accessories", "accessories", "shelf");
  if (/silicone|sealant|caulk/i.test(n)) return r("accessories", "adhesive-grout-silicone", "ancillaries");
  if (set === 17 || /clean|sealer|protector|remover|maintenance|fila|lithofin|wipes/i.test(n + " " + cp)) return r("accessories", "installation-materials", "cleaning-and-protection-products");
  if (set === 21 || /tool|cutter|blade|drill|trowel|float|sponge|bucket|mixer|nipper|saw|spacer|hammer|tape measure|level|knee pad|glove|square|scraper|rubi|dex|sigma|kit/i.test(n + " " + cp)) return r("accessories", "adhesives-levellers", "tiling-tools");
  return r("accessories", "accessories", "general");
}

// ---------- listing assembly ----------
const isSample = (p) => /\bsample\b/i.test(String(p.name || ""));
const pub = (p) => p.url && p.type_id !== "virtual" && !isSample(p);

function variantFrom(c, axes, parentUrl) {
  const options = {};
  for (const ax of axes) options[ax.name] = optLabel(ax.code, c[ax.code]) || (ax.fromName ? ax.fromName(c) : "");
  const { imgs, videos } = mediaOf(c);
  const s = sellInfo(c);
  const org = Number(c.org_price);
  const price = Math.round(Number(c.price) * 100) / 100;
  const attrs = Object.entries(specsOf(c)).map(([label, value]) => ({ label, value }));
  if (s.sellUnit !== "Unit") {
    attrs.unshift(
      { label: "Sold per", value: s.sellUnit === "Tile" ? "Single tile" : s.sellUnit },
      { label: `Coverage per ${s.sellUnit.toLowerCase()} (m²)`, value: String(s.coverageM2) },
      { label: "Price per m²", value: `£${s.pricePerSqm.toFixed(2)}` },
    );
  }
  return {
    name: Object.values(options).filter(Boolean).join(" / ") || cleanName(c.name),
    title: cleanName(c.name),
    sku: String(c.sku || ""),
    externalId: String(c.id),
    options,
    price,
    compareAtPrice: org > price ? Math.round(org * 100) / 100 : null,
    imageUrl: imgs[0] || "",
    images: imgs.slice(0, MAX_VARIANT_IMAGES),
    allImages: imgs,
    videos,
    weight: Number(c.weight) || null,
    available: c.oosVisible !== 1,
    sourceUrl: c.url ? SITE + c.url : parentUrl,
    sampleSku: c.free_sample_sku ? String(c.free_sample_sku) : "",
    attributes: attrs,
    ...s,
    _raw: c,
  };
}

function buildListing({ key, lead, children, axes, sourceType }) {
  const parentUrl = SITE + (lead.url || children[0].url);
  let variants = children.map((c) => variantFrom(c, axes, parentUrl));
  // order by Topps' own option order, default child first
  const defaultId = lead.first_simple_sku ? String(lead.first_simple_sku) : "";
  variants.sort((a, b) => (b.sku === defaultId) - (a.sku === defaultId));

  const d0 = () => variants[0];
  resolveCollisions(variants, axes);

  // drop axes that hold a single value — they become specs, not choices —
  // and an axis that only restates another one ("Ash" / "Regal Ash")
  const usedAxes = [];
  for (const ax of axes.filter((ax) => new Set(variants.map((v) => v.options[ax.name])).size > 1)) {
    const mirrors = usedAxes.some((prev) => {
      const f = new Map(), g = new Map();
      return variants.every((v) => {
        const a = v.options[prev.name], b = v.options[ax.name];
        if ((f.has(a) && f.get(a) !== b) || (g.has(b) && g.get(b) !== a)) return false;
        f.set(a, b); g.set(b, a); return true;
      });
    });
    if (!mirrors) usedAxes.push(ax);
  }
  const fixed = {};
  for (const ax of axes) if (!usedAxes.includes(ax)) {
    const v = variants[0].options[ax.name];
    if (v) fixed[ax.name === "Finish" ? "Finish" : ax.name] = v;
  }
  for (const v of variants) {
    const o = {};
    for (const ax of usedAxes) o[ax.name] = v.options[ax.name];
    v.options = o;
    usedAxes.forEach((ax, i) => (v[`option${i + 1}`] = o[ax.name] || ""));
    v.name = Object.values(o).join(" / ") || v.title;
  }

  // product name
  let name = cleanName(lead.name);
  const single = variants.length === 1;
  // a one-child range is that product: its own name, not the range's
  if (single && sourceType === "configurable" && cleanName(d0().title)) name = cleanName(d0().title);
  if (isPlaceholderName(name) || !name) {
    const t = String(lead.meta?.title || "").replace(/\s*\|\s*Topps Tiles\s*$/i, "").trim();
    name = t && !isPlaceholderName(t) ? t : cleanName(children[0].name);
  }

  // a listing that offers several sizes should not carry one of them in its name
  for (const ax of usedAxes) {
    const vals = [...new Set(variants.map((v) => v.options[ax.name]))].filter((x) => /\d/.test(x)).sort((a, b) => b.length - a.length);
    for (const val of vals) {
      const nums = val.match(/\d+(?:\.\d+)?/g) || [];
      const tolerant = nums.length > 1 ? nums.map(esc).join("\\s*(?:mm|cm)?\\s*x\\s*") + "\\s*(?:mm|cm)?" : null;
      for (const form of [esc(val), tolerant].filter(Boolean)) {
        const re = new RegExp(`\\s*\\(?${form}\\)?(?=\\s|$)`, "i");
        if (re.test(name)) name = name.replace(re, "").trim();
      }
    }
  }

  // gallery: range shots, then each variant's own images, within Shopify's media cap
  const { imgs: leadImgs, videos: leadVideos } = sourceType === "configurable" ? mediaOf(lead) : { imgs: [], videos: [] };
  let gallery = [...new Set([...variants[0].images, ...leadImgs])];
  const room = () => MAX_PRODUCT_MEDIA - new Set([...gallery, ...variants.map((v) => v.imageUrl)]).size;
  for (const v of variants) {
    const keep = [];
    for (const u of v.images) {
      if (gallery.includes(u) || u === v.imageUrl || room() > 0) { keep.push(u); if (!gallery.includes(u) && u !== v.imageUrl) gallery.push(u); }
    }
    v.images = keep;
  }
  gallery = [...new Set(gallery)];
  const videos = [];
  const seenV = new Set();
  for (const vid of [...leadVideos, ...variants.flatMap((v) => v.videos)]) if (!seenV.has(vid.src)) { seenV.add(vid.src); videos.push(vid); }

  // selling unit / calculator
  const units = new Set(variants.map((v) => v.sellUnit));
  const covs = new Set(variants.map((v) => v.coverageM2));
  const areaSold = variants.some((v) => v.sellUnit !== "Unit");
  const uniformCalc = areaSold && units.size === 1 && covs.size === 1 && !units.has("Unit");
  const d = variants[0];

  const cat = categorise(lead, children);

  // specs: common to every variant + lead's own
  const common = {};
  const perVar = variants.map((v) => Object.fromEntries(v.attributes.map((a) => [a.label, a.value])));
  for (const [k, v] of Object.entries(perVar[0])) if (perVar.every((x) => x[k] === v)) common[k] = v;
  const specs = { ...(variants.length === 1 ? specsOf(d._raw) : {}), ...common, ...fixed };
  for (const ax of usedAxes) delete specs[ax.name];
  specs.sku = variants.length === 1 ? d.sku : "";
  specs.Range = specs.Range || cleanName(lead.product_name_1 || "");
  if (!specs.Range) delete specs.Range;
  // calculator keys the PDP reads through pickSpec(): sqmPerBox / tilesPerBox / orderUnit
  if (uniformCalc) {
    specs.sqmPerBox = d.coverageM2;
    specs.packCoverageM2 = d.coverageM2;
    specs.orderUnit = d.sellUnit === "Box" ? "Pack" : d.sellUnit === "Sheet" ? "Sheet" : "Tiles";
    if (d.tilesPerBox) specs.tilesPerBox = d.tilesPerBox;
    if (d.sellUnit !== "Box") specs.tilesPerSqm = Math.round((1 / d.coverageM2) * 1000) / 1000;
  }
  const swatches = {};
  for (const ax of usedAxes) if (A[ax.code]?.isSwatch || /colour/i.test(ax.code)) {
    swatches[ax.name] = {};
    for (const c of children) { const l = optLabel(ax.code, c[ax.code]); const s = optSwatch(ax.code, c[ax.code]); if (l && s) swatches[ax.name][l] = s; }
  }

  // description: lead line, then one spec per line (the PDP bullets each line)
  const prose = single
    ? plain(d._raw.description || d._raw.short_description || lead.description || lead.short_description || "")
    : plain(lead.description || lead.short_description || d._raw.description || d._raw.short_description || "");
  const specLines = Object.entries(specs)
    .filter(([k, v]) => v !== "" && v != null && !/^(sku|sqmPerBox|packCoverageM2|orderUnit|tilesPerBox|tilesPerSqm)$/.test(k))
    .map(([k, v]) => `${k}: ${v}`);
  const description = [prose || name, ...specLines].join("\n");

  return {
    key,
    name,
    sourceType,
    sourceUrl: parentUrl,
    sourceProductId: key,
    sourceSku: String(lead.sku || d.sku || ""),
    ...cat,
    price: Math.min(...variants.map((v) => v.price)),
    compareAtPrice: d.compareAtPrice,
    images: gallery,
    externalVideos: videos,
    description,
    shortDescription: plain((single ? d._raw.short_description : lead.short_description) || lead.short_description || d._raw.short_description || "").slice(0, 400),
    metaTitle: String(lead.meta?.title || "").trim(),
    metaDescription: String(lead.meta?.description || "").trim(),
    specs,
    swatches,
    shopifyOptions: usedAxes.map((ax, i) => ({ name: ax.name, position: i + 1, values: [...new Set(variants.map((v) => v.options[ax.name]))] })),
    variantGroups: usedAxes.map((ax) => ax.name),
    calc: { areaSold, uniformCalc, units: [...units], coverages: [...covs] },
    sampleSku: d.sampleSku,
    weight: d.weight,
    variants: variants.map(({ _raw, allImages, videos: _v, title, ...v }, i) => ({ ...v, position: i, isDefault: i === 0 })),
  };
}

/**
 * Two variants with the same option values cannot both be chosen. Topps does
 * this in two ways: two colours sharing one label ("Grey" for both Cemento and
 * Valletta Grey), and configurables whose children differ only in dimensions.
 * The first is named apart with the word that differs in the product names;
 * the second gets a Size axis from `dimensions` (or, failing that, an Option
 * axis from the differing words).
 */
function resolveCollisions(variants, axes) {
  const key = (v) => JSON.stringify(axes.map((ax) => v.options[ax.name]));
  const clash = () => {
    const m = new Map();
    for (const v of variants) m.set(key(v), [...(m.get(key(v)) || []), v]);
    return [...m.values()].filter((g) => g.length > 1);
  };
  if (variants.length < 2 || !clash().length) return;
  const words = (s) => cleanName(s).replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
  if (!axes.length) {
    const dims = variants.map((v) => String(v._raw.dimensions || "").trim());
    if (dims.every(Boolean) && new Set(dims).size === variants.length) {
      axes.push({ code: "_dimensions", name: "Size" });
      variants.forEach((v, i) => (v.options.Size = dims[i]));
      return;
    }
  }
  for (const group of clash()) {
    const lists = group.map((v) => words(v.title));
    const common = lists.reduce((a, b) => a.filter((w) => b.includes(w)));
    group.forEach((v, i) => {
      const extra = lists[i].filter((w) => !common.includes(w)).join(" ");
      if (!extra) return;
      if (axes.length) {
        const ax = axes.find((a) => /colour/i.test(a.name)) || axes[0];
        // a measurement is the whole value; a word ("Cemento") qualifies it
        v.options[ax.name] = /\d/.test(extra) ? extra : `${extra} ${v.options[ax.name] || ""}`.trim();
      } else {
        v.options.Option = extra;
      }
    });
    if (!axes.length && group.every((v) => v.options.Option)) axes.push({ code: "_name", name: "Option" });
  }
}

function axesFor(codes) {
  const ordered = AXIS_ORDER.filter((c) => codes.includes(c));
  const names = new Map();
  return ordered.map((code) => {
    let name = AXIS_NAME[code] || A[code]?.label || code;
    if (names.has(name)) name = A[code]?.label || code; // two "Size" axes → use Topps' own label
    names.set(name, code);
    return { code, name };
  });
}

// 1) Topps configurables
const listings = [];
const audit = { skipped: {}, merges: [], mergeRejected: [], collisions: [], warnings: [] };
const skip = (why, p) => { (audit.skipped[why] = audit.skipped[why] || []).push(`${p.id} ${cleanName(p.name)}`); };
const claimed = new Set();
for (const p of RAW) {
  if (p.type_id !== "configurable") continue;
  if (!p.url) { skip("configurable without a page", p); continue; }
  const kids = (p.directChildrenIds || []).map((id) => byId.get(id)).filter(Boolean).filter((c) => !isSample(c) && c.type_id !== "virtual");
  if (!kids.length) { skip("configurable without children", p); continue; }
  kids.forEach((k) => claimed.add(k.id));
  const axes = axesFor(Object.keys(p.options?.configurable || {}));
  listings.push(buildListing({ key: `topps:${p.id}`, lead: p, children: kids, axes, sourceType: "configurable" }));
}

// 2) standalones: merge same item in several sizes / colours
const singles = RAW.filter((p) => p.type_id !== "configurable" && !p.parent && !claimed.has(p.id));
const usable = [];
for (const p of singles) {
  if (isSample(p)) { skip("sample", p); continue; }
  if (p.type_id === "virtual") { skip("virtual (no page)", p); continue; }
  if (!p.url) { skip("no page on topps (not sold online)", p); continue; }
  if (!(Number(p.price) > 0)) { skip("no price", p); continue; }
  if (isPlaceholderName(p.name) && !mediaOf(p).imgs.length) { skip("placeholder with no content", p); continue; }
  usable.push(p);
}
function stripLabels(name, p) {
  let n = ` ${cleanName(name)} `;
  const ls = [];
  for (const code of OPTION_ATTRS) { const l = optLabel(code, p[code]); if (l) ls.push(l, ...l.split(/\s+/).slice(1).length ? [l.split(/\s+/).slice(-1)[0]] : []); }
  // Matrix-style colour kits carry the colour only in the name
  for (const l of ls.sort((a, b) => b.length - a.length)) n = n.replace(new RegExp(`(?<![\\w.])${esc(l)}(?![\\w])`, "i"), " ");
  return n.replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
const MATRIX = /^(Matrix® Grout) (.+?) (2\.5kg)$/;
const groups = new Map();
for (const p of usable) {
  const nm = cleanName(p.name);
  let base, nameAxis = null;
  const mm = nm.match(MATRIX);
  if (mm) { base = `${mm[1]} ${mm[3]}`.toLowerCase(); nameAxis = mm[2]; }
  else base = stripLabels(nm, p);
  const k = [p.attribute_set, p.brand || "", p.category_path || "", base].join("|");
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push({ p, nameAxis });
}
for (const [k, members] of groups) {
  const ps = members.map((m) => m.p);
  if (ps.length === 1) {
    listings.push(buildListing({ key: `topps:${ps[0].id}`, lead: ps[0], children: ps, axes: [], sourceType: "simple" }));
    continue;
  }
  let axes;
  if (members.every((m) => m.nameAxis)) {
    const colour = new Map(members.map((m) => [m.p.id, m.nameAxis]));
    axes = [{ code: "_name_colour", name: "Colour", fromName: (c) => colour.get(c.id) }];
  } else {
    const varying = [...OPTION_ATTRS].filter((code) => new Set(ps.map((p) => optLabel(code, p[code]))).size > 1);
    axes = axesFor(varying);
  }
  const tuple = (p) => axes.map((ax) => (ax.fromName ? ax.fromName(p) : optLabel(ax.code, p[ax.code]))).join("§");
  const ok = axes.length > 0 && ps.every((p) => axes.every((ax) => (ax.fromName ? ax.fromName(p) : optLabel(ax.code, p[ax.code])))) && new Set(ps.map(tuple)).size === ps.length;
  if (!ok) {
    audit.mergeRejected.push({ base: k.split("|").pop(), products: ps.map((p) => cleanName(p.name)) });
    for (const p of ps) listings.push(buildListing({ key: `topps:${p.id}`, lead: p, children: [p], axes: [], sourceType: "simple" }));
    continue;
  }
  const lead = [...ps].sort((a, b) => a.price - b.price)[0];
  const key = `topps:m:${ps.map((p) => p.id).sort((a, b) => a - b).join("-")}`;
  const L = buildListing({ key, lead, children: ps, axes, sourceType: "merged" });
  // merged listing name: strip the option values from the lead's name
  const nm = cleanName(lead.name);
  const mm = nm.match(MATRIX);
  L.name = mm ? `${mm[1]} ${mm[3]}` : (() => {
    let n = ` ${nm} `;
    for (const ax of axes) { const l = optLabel(ax.code, lead[ax.code]); if (l) n = n.replace(new RegExp(`(?<![\\w.])${esc(l)}(?![\\w])`, "i"), " "); }
    return n.replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").trim();
  })();
  audit.merges.push({ name: L.name, axes: axes.map((a) => a.name), variants: L.variants.map((v) => `${v.name} £${v.price}`) });
  listings.push(L);
}

// 2b) a standalone listing that is more colours / sizes of a Topps range joins it
const norm = (s) => cleanName(s).toLowerCase().replace(/[™®]/g, "");
for (const L of [...listings]) {
  if (L.sourceType === "configurable" || !L.variants.length) continue;
  const host = listings.find((H) => H !== L && H.sourceType === "configurable" && norm(H.name) === norm(L.name) &&
    H.department === L.department && H.category === L.category && H.shopifyOptions.length &&
    (L.shopifyOptions.length ? L.shopifyOptions.every((o) => H.variantGroups.includes(o.name)) : false) &&
    H.variantGroups.every((g) => L.variants.every((v) => v.options[g])));
  if (!host) continue;
  const taken = new Set(host.variants.map((v) => JSON.stringify(host.variantGroups.map((g) => v.options[g]))));
  if (L.variants.some((v) => taken.has(JSON.stringify(host.variantGroups.map((g) => v.options[g]))))) continue;
  for (const v of L.variants) {
    host.variantGroups.forEach((g, i) => (v[`option${i + 1}`] = v.options[g]));
    v.position = host.variants.length; v.isDefault = false;
    host.variants.push(v);
  }
  host.shopifyOptions = host.variantGroups.map((g, i) => ({ name: g, position: i + 1, values: [...new Set(host.variants.map((v) => v.options[g]))] }));
  host.images = [...new Set([...host.images, ...L.images])].slice(0, MAX_PRODUCT_MEDIA);
  host.price = Math.min(host.price, L.price);
  host.absorbed = [...(host.absorbed || []), L.sourceUrl];
  audit.merges.push({ name: host.name, axes: host.variantGroups, variants: L.variants.map((v) => `${v.name} £${v.price} (joined Topps range)`) });
  listings.splice(listings.indexOf(L), 1);
}
// two different Topps products can share a name — keep both, told apart by SKU
const nameCount = new Map();
for (const L of listings) nameCount.set(L.name, (nameCount.get(L.name) || 0) + 1);
const seenName = new Map();
for (const L of listings) if (nameCount.get(L.name) > 1) {
  const n = (seenName.get(L.name) || 0) + 1; seenName.set(L.name, n);
  if (n > 1) L.name = `${L.name} (${L.variants[0].sku})`;
}

// 3) checks
for (const L of listings) {
  const seen = new Map();
  for (const v of L.variants) {
    const t = JSON.stringify(v.options);
    if (L.variants.length > 1 && seen.has(t)) audit.collisions.push({ product: L.name, options: v.options, skus: [seen.get(t), v.sku] });
    seen.set(t, v.sku);
    if (!(v.price > 0)) audit.warnings.push(`${L.name} / ${v.name}: no price`);
    if (!v.imageUrl) audit.warnings.push(`${L.name} / ${v.name}: no image`);
    if (v.sellUnit !== "Unit" && Math.abs(v.pricePerSqm * v.coverageM2 - v.price) > 0.05) audit.warnings.push(`${L.name} / ${v.name}: £/m² × coverage ≠ price`);
  }
  if (!L.images.length) audit.warnings.push(`${L.name}: empty gallery`);
  if (L.variants.length > 100) audit.warnings.push(`${L.name}: ${L.variants.length} variants (> Shopify 100)`);
  if (L.shopifyOptions.length > 3) audit.warnings.push(`${L.name}: ${L.shopifyOptions.length} option axes (> Shopify 3)`);
}

const summary = {
  listings: listings.length,
  variants: listings.reduce((n, l) => n + l.variants.length, 0),
  withOptions: listings.filter((l) => l.shopifyOptions.length).length,
  bySource: listings.reduce((o, l) => ((o[l.sourceType] = (o[l.sourceType] || 0) + 1), o), {}),
  calculator: {
    uniform: listings.filter((l) => l.calc.uniformCalc).length,
    mixedSoldByQuantity: listings.filter((l) => l.calc.areaSold && !l.calc.uniformCalc).length,
    unitOnly: listings.filter((l) => !l.calc.areaSold).length,
  },
  categories: listings.reduce((o, l) => { const k = `${l.department}/${l.category}/${l.subCategory}`; o[k] = (o[k] || 0) + 1; return o; }, {}),
  skipped: Object.fromEntries(Object.entries(audit.skipped).map(([k, v]) => [k, v.length])),
  merges: audit.merges.length,
  mergeRejected: audit.mergeRejected.length,
  collisions: audit.collisions.length,
  warnings: audit.warnings.length,
};
fs.writeFileSync(path.join(DIR, "topps-final.json"), JSON.stringify(listings, null, 1));
fs.writeFileSync(path.join(DIR, "topps-audit.json"), JSON.stringify({ summary, ...audit }, null, 1));
console.log(JSON.stringify(summary, null, 1));
