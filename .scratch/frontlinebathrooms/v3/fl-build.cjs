/**
 * Frontline Bathrooms — build the DB1/Shopify-ready catalogue from v3/live.jsonl.
 * Reads local files only; writes only v3/fl-final.json + v3/fl-report.json.
 *
 * Grouping (Frontline's own, never guessed across ranges):
 *   1. pages whose option dropdowns point at each other are one family
 *      (union of page ids + option ids); every priced F code in the family is
 *      one variant (a code listed twice is kept once, at its own page's price)
 *   2. families that differ only by a colour/finish word at the end of the
 *      title, in the same range, merge into Colour × (their own option) —
 *      only when every combination stays unique
 * Prices exactly as shown on frontlinebathrooms.co.uk (inc. VAT). A variant
 * with no price is dropped; a product with no priced variant is left out.
 * Photos: the page gallery only (no logos, no related-product thumbnails);
 * a variant without its own photo uses the product's lead photo.
 */
const fs = require("fs");
const path = require("path");
const V3 = __dirname;
const rows = fs.readFileSync(path.join(V3, "live.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const clean = (s) => String(s || "").replace(/\s+/g, " ").replace(/\s*[–—]\s*/g, " – ").replace(/(\S)-\s+/g, "$1 – ").replace(/\s+-\s+/g, " – ").trim();
const SIZE_TOKEN = /\b(W\s?\d{3,4}\s*x\s*H\s?\d{3,4}(?:mm)?|H\s?\d{3,4}\s*x\s*W\s?\d{3,4}(?:mm)?|\d{3,4}(?:\s*x\s*\d{3,4}){1,2}\s*mm|\d{3,4}\s*mm)\b/i;
const sizeOf = (l) => { const m = clean(l).match(new RegExp(SIZE_TOKEN.source, "gi")); return m ? m[m.length - 1].replace(/\s+/g, " ").replace(/\s*x\s*/gi, " x ") : ""; };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
const JUNK_BRAND = /^F\d{4,}$/i;
const COLOURS = "Matt Black|Gloss Black|Black|Matt White|Gloss White|White|Chrome|Brushed Brass|Brass|Brushed Nickel|Nickel|Gun ?Metal|Gunmetal|Brushed Bronze|Bronze|Copper|Gold|Brushed Gold|Anthracite|Texture Anthracite|Textured Anthracite|Texture Black|Textured Black|Matt Grey|Grey|Gloss Grey|Light Grey|Dark Grey|Matt Green|Green|Sage|Matt Sand|Sand|Cashmere|Oak|Light Oak|Dark Oak|Natural Oak|Walnut|Matt Blue|Blue|Navy|Pink|Cream|Beige|Taupe|Stone|Concrete|Graphite|Charcoal|Onyx|Marble";
const COLOUR_TAIL = new RegExp(`\\s*[–-]\\s*((?:${COLOURS})(?:\\s*(?:&|and|\\/)\\s*(?:${COLOURS}))?)\\s*$`, "i");
const isSize = (v) => /^\s*(?:[WHD]\s?\d{3,4}(?:mm)?(?:\s*x\s*[WHD]\s?\d{3,4}(?:mm)?){0,2}|\d{3,4}(?:\s*x\s*\d{3,4}){0,2}\s*mm)\s*$/i.test(v);

// ---- category: Frontline category/type → an existing slug (DB2/BB-style bathroom tree + menu-linked subcategories)
const RULES = [
  [/seat hinge|hinge cover|pan to floor|pan fixing|wc fixing|toilet fixing/, "bathrooms", "toilets-basins", "toilet-accessories"],
  [/towel (holder|ring|hook)|robe hook/, "accessories", "accessories", "towel-rails-and-rings"],
  [/toilet roll|roll holder/, "accessories", "accessories", "toilet-roll-holders"],
  [/soap|dispenser/, "accessories", "accessories", "soap-dishes-and-dispensers"],
  [/tumbler|toothbrush/, "accessories", "accessories", "toothbrush-holders"],
  [/toilet brush/, "accessories", "accessories", "toilet-brushes"],
  [/towel (rail|warmer)|heated towel/, "bathrooms", "heating", "ladder"],
  [/electric towel|heating element/, "bathrooms", "heating", "electric"],
  [/radiator valve|shut off valve|t piece|\btrv\b/, "bathrooms", "heating", "radiator-valves-and-accessories"],
  [/pop.?up waste|click.?clack/, "accessories", "accessories", "basin-wastes"],
  [/stand ?pipes?/, "accessories", "accessories", "wastes-and-plumbing-accessories"],
  [/chain waste/, "accessories", "accessories", "bath-wastes"],
  [/radiator/, "bathrooms", "heating", "designer"],
  [/whirlpool|jet/, "bathrooms", "baths", "freestanding-baths"],
  [/freestanding bath|fluted freestanding/, "bathrooms", "baths", "freestanding-baths"],
  [/freestanding bath shower mixer|bath shower mixer/, "bathrooms", "taps", "bath-shower-mixers"],
  [/bath filler|bath tap|bath mixer/, "bathrooms", "taps", "bath-mixers"],
  [/tall basin|tall.*mono/, "bathrooms", "taps", "tall-basin-taps"],
  [/mini basin|cloak.*mono|mini.*mixer/, "bathrooms", "taps", "cloakroom-taps"],
  [/basin taps|pillar/, "bathrooms", "taps", "pillar-tap-pairs"],
  [/basin mono|basin mixer|mono basin|deck mounted valve/, "bathrooms", "taps", "mono-basin-mixers"],
  [/bath screen/, "bathrooms", "baths", "bath-screens"],
  [/bath panel/, "bathrooms", "baths", "bath-panels"],
  [/bath feet|bath waste|bath light|bath accessor/, "bathrooms", "baths", "bath-wastes-and-fittings"],
  [/freestanding bath/, "bathrooms", "baths", "freestanding-baths"],
  [/shower bath/, "bathrooms", "baths", "shower-baths"],
  [/corner bath/, "bathrooms", "baths", "corner-and-back-to-wall-baths"],
  [/double ended/, "bathrooms", "baths", "double-ended-baths"],
  [/single ended|straight bath|\bbath\b/, "bathrooms", "baths", "single-ended-baths"],
  [/shower column|shower pack|shower pacl/, "bathrooms", "showers", "concealed-valve-showers"],
  [/shower valve/, "bathrooms", "showers", "concealed-valves"],
  [/shower arm|ceiling arm/, "bathrooms", "showers", "shower-arms"],
  [/shower head/, "bathrooms", "showers", "fixed-heads"],
  [/slider rail|rail kit/, "bathrooms", "showers", "shower-rail-kits"],
  [/hand shower/, "bathrooms", "showers", "shower-handsets"],
  [/shower waste|outlet elbow/, "accessories", "accessories", "shower-wastes"],
  [/basin waste|overflow kit/, "accessories", "accessories", "basin-wastes"],
  [/bottle trap/, "accessories", "accessories", "bottle-traps"],
  [/shower seat|shower accessor|shower conponent|easy plumb/, "bathrooms", "showers", "shower-accessories"],
  [/quadrant/, "bathrooms", "showers", "quadrant"],
  [/bi-?fold/, "bathrooms", "showers", "bi-fold"],
  [/pivot/, "bathrooms", "showers", "pivot"],
  [/hinged/, "bathrooms", "showers", "hinged"],
  [/sliding|slider/, "bathrooms", "showers", "sliding"],
  [/walk-?in|wet ?room|drying area|stabilising bar|floor to ceiling/, "bathrooms", "showers", "walk-in"],
  [/side panel|inline panel/, "bathrooms", "showers", "side-panel"],
  [/enclosure|corner entry|pentagonal/, "bathrooms", "showers", "shower-enclosures"],
  [/shower tray|\btrays?\b|leg kit|riser kit|panel pack/, "bathrooms", "showers", "shower-trays"],
  [/wall panel sealant|wall panel adhesive|extrusion|moulding|wall panel|panelling|paneling|ceiling & wall|shower & wall/, "bathrooms", "showers", "bathroom-wall-panels"],
  [/laminate flooring|bathroom flooring/, "flooring", "laminate-flooring", ""],
  [/led mirror|led cabinet/, "bathrooms", "bathroom-mirrors", "illuminated"],
  [/mirror cabinet|mirrored cabinet|cabinet/, "bathrooms", "bathroom-furniture", "mirrored-bathroom-cabinets"],
  [/mirror/, "bathrooms", "bathroom-mirrors", "non-illuminated"],
  [/wc unit|back to wall toilet unit/, "bathrooms", "bathroom-furniture", "wc-units"],
  [/worktop|countertops?$/, "bathrooms", "bathroom-furniture", "countertop-basin-units"],
  [/tall (furniture )?unit/, "bathrooms", "bathroom-furniture", "tall"],
  [/furniture handles|\bhandles?\b(?!.*(tap|mixer|shower))/, "bathrooms", "bathroom-furniture", "furniture-handles"],
  [/column unit/, "bathrooms", "bathroom-furniture", "tall"],
  [/\blegs?\b|plinth|feet kit/, "bathrooms", "bathroom-furniture", "furniture-accessories"],
  [/wall hung unit|base unit|unit only|drawer unit|floor ?standing unit|furniture pack/, "bathrooms", "bathroom-furniture", "@vanity"],
  [/wall unit|door unit/, "bathrooms", "bathroom-furniture", "storage-units"],
  [/shelf|furniture set|furniture unit|laundry/, "bathrooms", "bathroom-furniture", "storage-units"],
  [/vanity|floorstanding unit/, "bathrooms", "bathroom-furniture", "@vanity"],
  [/bathroom tv/, "accessories", "accessories", "miscellaneous"],
  [/douche/, "bathrooms", "showers", "shower-handsets"],
  [/toilet seat/, "bathrooms", "toilets-basins", "toilet-seats"],
  [/flush plate|push button/, "bathrooms", "toilets-basins", "flush-plates"],
  [/frame support|flushing system|cistern|pipework|fittings/, "bathrooms", "toilets-basins", "concealed-cisterns-and-frames"],
  [/cloakroom|cloak basin|wall hung mini/, "bathrooms", "toilets-basins", "cloakroom"],
  [/semi pedestal|semi-pedestal/, "bathrooms", "toilets-basins", "semi-pedestal"],
  [/full pedestal|basin & pedestal|basin and pedestal/, "bathrooms", "toilets-basins", "full-pedestal"],
  [/semi-recess/, "bathrooms", "toilets-basins", "semi-recessed"],
  [/under counter/, "bathrooms", "toilets-basins", "inset"],
  [/countertop basin|over counter|solid surface/, "bathrooms", "toilets-basins", "countertop"],
  [/wall hung.*(wc|toilet|pan)|wall hung pan/, "bathrooms", "toilets-basins", "wall-hung"],
  [/back to wall.*(wc|toilet|pan)|btw/, "bathrooms", "toilets-basins", "back-to-wall"],
  [/comfort height/, "bathrooms", "toilets-basins", "comfort-height"],
  [/close coupled|wc pack|toilet|\bwc\b|\bpan\b/, "bathrooms", "toilets-basins", "close-coupled"],
  [/basin/, "bathrooms", "toilets-basins", "countertop"],
  [/accessor/, "accessories", "accessories", "miscellaneous"],
];
function classify(p) {
  const hay = [...(p.tax["product-type"] || []), p.title, ...(p.tax["product-category"] || [])].join(" | ").toLowerCase();
  for (const src of [(p.tax["product-type"] || []).join(" | ").toLowerCase() + " | " + p.title.toLowerCase(), hay]) {
    for (const [re, department, category, sub] of RULES) {
      if (!re.test(src)) continue;
      let subCategory = sub;
      if (sub === "@vanity") subCategory = /wall hung|wall-hung/.test(hay) ? "wall-hung" : /cloak/.test(hay) ? "cloakroom" : /countertop/.test(hay) ? "countertop-basin-units" : "floorstanding";
      return { department, category, subCategory, rule: String(re) };
    }
  }
  return null;
}

// ---- 1. families from the dropdowns
const byId = new Map(rows.filter((r) => !r.error).map((r) => [String(r.id), r]));
const parent = new Map();
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const union = (a, b) => { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); parent.set(find(a), find(b)); };
for (const r of byId.values()) {
  const id = String(r.id);
  if (!parent.has(id)) parent.set(id, id);
  for (const o of r.dropdown || []) union(id, String(o.id));
}
const families = new Map();
for (const r of byId.values()) { const k = find(String(r.id)); if (!families.has(k)) families.set(k, []); families.get(k).push(r); }

const report = { pages: rows.length, failedPages: rows.filter((r) => r.error).map((r) => r.url), noPrice: [], droppedVariantsNoPrice: 0, duplicateRefs: [], merges: [], skippedMerges: [], categoryMisses: [] };

/** "Additional Information" without price rows or the stray footer text */
function cleanInfo(info) {
  const out = {};
  for (const [k, v] of Object.entries(info || {})) {
    if (/^(price|category)/i.test(k)) continue;
    const val = String(v).split(/,\s*/).filter((x) => x && !/^frontline bathrooms$/i.test(x) && !JUNK_BRAND.test(x)).join(", ").trim();
    if (val) out[k.replace(/^Manufacture Code$/i, "Manufacturer Code")] = val;
  }
  return out;
}
/** every priced F code in the family, one variant each */
function variantsOf(pages) {
  const byRef = new Map();
  const lead = pages[0];
  const put = (ref, v) => {
    if (!ref || !(v.price > 0)) { report.droppedVariantsNoPrice++; return; }
    const prev = byRef.get(ref);
    if (prev) {
      if (prev.label !== v.label) report.duplicateRefs.push({ ref, a: `${prev.label} £${prev.price}`, b: `${v.label} £${v.price}` });
      // two different items under one code on Frontline: keep both, second gets a suffixed SKU
      if (clean(prev.label) !== clean(v.label) && ![...byRef.values()].some((x) => clean(x.label) === clean(v.label))) {
        const n = [...byRef.values()].filter((x) => x.ref === ref).length + 1;
        byRef.set(`${ref}#${n}`, { ...v, sku: `${ref}-${n}`, ref });
      }
      return;
    }
    byRef.set(ref, { ...v, sku: ref, ref });
  };
  for (const p of pages) {
    if (!p.optionPages.length && p.ref) put(p.ref, { label: p.title, price: p.price, images: p.images, features: p.features, info: cleanInfo(p.info), url: p.url, pageId: String(p.id) });
    for (const o of p.optionPages) put(o.ref, { label: o.label, price: o.price, images: o.images?.length ? o.images : p.images, features: o.features?.length ? o.features : p.features, info: { ...cleanInfo(p.info), ...cleanInfo(o.info) }, url: p.url, pageId: String(o.id) });
  }
  return [...byRef.values()];
}

/** colour named in a variant's own photo file (only when the file is named by that variant's F code) */
function colourFromPhoto(v) {
  for (const u of v.images || []) {
    const f = decodeURIComponent(String(u).split("/").pop()).replace(/[-_]+/g, " ");
    if (!f.toUpperCase().startsWith(String(v.ref).toUpperCase())) continue;
    const m = f.match(new RegExp(`\\b(${COLOURS})\\b`, "gi"));
    if (m) return titleCase(m[m.length - 1].toLowerCase());
  }
  return "";
}
const coloursIn = (l) => [...new Set((clean(l).match(new RegExp(`\\b(${COLOURS})\\b`, "gi")) || []).map((x) => x.toLowerCase()))].sort().join("+");

/** the words that differ between variant labels → the option value */
function optionValues(title, vs) {
  const labels = vs.map((v) => clean(v.label));
  const words = labels.map((l) => l.split(" "));
  let pre = 0;
  while (words.every((w) => w[pre] !== undefined && w[pre] === words[0][pre])) pre++;
  let suf = 0;
  while (words.every((w) => w.length - 1 - suf >= pre && w[w.length - 1 - suf] === words[0][words[0].length - 1 - suf])) suf++;
  const sizes = labels.map(sizeOf);
  if (sizes.every(Boolean) && new Set(sizes.map((x) => x.toLowerCase())).size === sizes.length) return sizes;
  return labels.map((l, i) => words[i].slice(pre, words[i].length - suf).join(" ").replace(/^[–\-\s]+|[–\-\s]+$/g, "").trim() || l);
}

// ---- build one product per family
report.duplicateListings = [];
let built = [];
for (const pages of families.values()) {
  pages.sort((a, b) => (a.optionPages.length ? 1 : 0) - (b.optionPages.length ? 1 : 0) || a.id - b.id);
  let vs = variantsOf(pages);
  const lead = pages.find((p) => p.images?.length) || pages[0];
  if (!vs.length) { report.noPrice.push({ title: lead.title, url: lead.url }); continue; }
  let values = vs.length > 1 ? optionValues(lead.title, vs) : [];
  if (values.length) {
    const keep = [], kv = [];
    values.forEach((val, i) => {
      const j = kv.findIndex((x) => x.toLowerCase() === val.toLowerCase());
      if (j < 0) { keep.push(vs[i]); kv.push(val); return; }
      // Frontline labelled two different codes the same: its own photo, named by
      // that code, often says what it really is ("F11211_…-Matt-Green")
      const fromPhoto = colourFromPhoto(vs[i]);
      const fixed = fromPhoto && !kv.some((x) => x.toLowerCase() === fromPhoto.toLowerCase()) ? fromPhoto : `${val} (${vs[i].sku})`;
      report.duplicateListings.push({ product: lead.title, value: val, first: keep[j].sku, second: vs[i].sku, secondShownAs: fixed });
      keep.push(vs[i]); kv.push(fixed);
    });
    vs = keep; values = kv;
    if (vs.length === 1) values = [];
  }
  built.push({ pages, lead, vs, values });
}

// ---- 2. merge colour siblings (same range, name equal apart from a colour tail)
const baseOf = (t) => { const m = clean(t).match(COLOUR_TAIL); return m ? { base: clean(t).slice(0, m.index).trim(), colour: titleCase(m[1].toLowerCase()) } : null; };
const sib = new Map();
for (const b of built) {
  const x = baseOf(b.lead.title);
  if (!x) continue;
  const key = `${(b.lead.tax.range || []).join("|")}::${x.base.toLowerCase()}`;
  if (!sib.has(key)) sib.set(key, []);
  sib.get(key).push({ b, colour: x.colour, base: x.base });
}
const merged = new Set();
const products = [];
for (const [key, group] of sib) {
  if (group.length < 2) continue;
  const colours = group.map((g) => g.colour.toLowerCase());
  const valuesClash = group.some((g) => g.b.values.some((v) => colours.includes(v.toLowerCase())));
  if (new Set(colours).size !== group.length || valuesClash) { report.skippedMerges.push({ key, reason: new Set(colours).size !== group.length ? "same colour twice" : "their own options already are colours" }); continue; }
  const inner = group.every((g) => g.b.vs.length > 1);
  const combos = new Set();
  let ok = true;
  const vs = [];
  for (const g of group) g.b.vs.forEach((v, i) => {
    const vals = inner ? [g.colour, g.b.values[i]] : [g.colour];
    const k = vals.join("|").toLowerCase();
    if (combos.has(k)) ok = false;
    combos.add(k);
    vs.push({ ...v, vals });
  });
  if (!ok || group.some((g) => g.b.vs.length > 1) !== inner) { report.skippedMerges.push({ key, reason: "option combinations not unique" }); continue; }
  const innerName = inner ? axisName(group.flatMap((g) => g.b.values)) : null;
  group.forEach((g) => merged.add(g.b));
  report.merges.push({ name: group[0].base, colours: group.map((g) => g.colour), variants: vs.length });
  products.push(assemble(group[0].b.lead, group.flatMap((g) => g.b.pages), vs, inner ? ["Colour", innerName] : ["Colour"], group[0].base));
}
for (const b of built) {
  if (merged.has(b)) continue;
  const multi = b.vs.length > 1;
  const axis = multi ? axisName(b.values) : null;
  const vs = b.vs.map((v, i) => ({ ...v, vals: multi ? [b.values[i]] : [] }));
  // a family whose option values are not unique cannot be one Shopify product → split
  if (multi && new Set(b.values.map((x) => x.toLowerCase())).size !== b.values.length) {
    report.skippedMerges.push({ key: b.lead.title, reason: "option values not unique — listed separately" });
    for (const v of b.vs) products.push(assemble(b.lead, b.pages, [{ ...v, vals: [] }], [], clean(v.label)));
    continue;
  }
  const name = multi ? commonName(b.lead.title, b.vs) : clean(b.vs[0].label || b.lead.title);
  products.push(assemble(b.lead, b.pages, vs, multi ? [axis] : [], name));
}

function axisName(values) {
  if (values.every(isSize)) return "Size";
  if (values.every((v) => /^(LH|RH|L\/H|R\/H|Left( Hand(ed)?)?|Right( Hand(ed)?)?)$/i.test(v.trim()))) return "Handing";
  if (values.every((v) => new RegExp(`^(?:${COLOURS})(?:\\s*(?:&|and|\\/)\\s*(?:${COLOURS}))?$`, "i").test(v))) return "Colour";
  return "Option";
}
function commonName(title, vs) {
  const x = baseOf(title);
  const t = clean(title);
  // the lead title minus a trailing option value it may carry
  return (x && vs.some((v) => clean(v.label).endsWith(x.colour)) ? x.base : t).replace(/\s*[–-]\s*$/, "");
}

function assemble(lead, pages, vs, axes, name) {
  const tax = lead.tax;
  const brandNames = (tax.brand || []).filter((b) => !JUNK_BRAND.test(b));
  const features = [...new Set(vs[0].features?.length ? vs[0].features : lead.features || [])];
  const bodyHtml = String(lead.description || "").trim();
  const desc = [bodyHtml, features.length ? "<h3>Key features</h3><ul>" + features.map((f) => `<li>${esc(f)}</li>`).join("") + "</ul>" : ""].filter(Boolean).join("\n");
  const specs = {};
  const leadInfo = cleanInfo(lead.info);
  const varying = new Set();
  for (const k of new Set(vs.flatMap((v) => Object.keys(v.info || {})))) if (new Set(vs.map((v) => (v.info || {})[k] || "")).size > 1) varying.add(k);
  for (const [k, v] of Object.entries(vs.length === 1 ? { ...leadInfo, ...(vs[0].info || {}) } : leadInfo)) if (!varying.has(k)) specs[k] = v;
  for (const f of features) { const m = f.match(/^([A-Za-z][A-Za-z /&()'-]{1,40}):\s*(.+)$/); if (m) specs[titleCase(m[1].trim())] = m[2].trim(); }
  if (brandNames.length && !specs.Brand) specs.Brand = brandNames.join(", ");
  if ((tax.range || []).length) specs.Range = tax.range.join(", ");
  if ((tax.collection || []).length) specs.Collection = tax.collection.filter((c) => !/^The /.test(c)).join(", ") || tax.collection.join(", ");
  if ((tax["product-type"] || []).length) specs["Product Type"] = tax["product-type"].join(", ");
  if (!(vs.length > 1) && (tax.width || []).length) specs.Size = tax.width.join(", ");
  const variants = vs.map((v, i) => {
    const options = Object.fromEntries(axes.map((a, j) => [a, v.vals[j]]));
    return {
      name: axes.length ? v.vals.join(" / ") : name,
      sku: v.sku,
      options: axes.length ? options : {},
      ...(axes.length ? Object.fromEntries(v.vals.map((x, j) => [`option${j + 1}`, x])) : {}),
      price: v.price,
      stock: 500,
      imageUrl: v.images?.[0] || "",
      images: v.images || [],
      isDefault: i === 0,
      available: true,
      sourceUrl: v.url,
      sourcePageId: v.pageId,
      position: i,
      ...(v.features?.length && JSON.stringify(v.features) !== JSON.stringify(features) ? { features: v.features } : {}),
      ...(vs.length > 1 && v.info ? { specs: Object.fromEntries(Object.entries(v.info).filter(([k]) => varying.has(k) && !/^(range|brand|collection)$/i.test(k))) } : {}),
      ...(v.info?.["Manufacturer Code"] ? { mpn: v.info["Manufacturer Code"] } : {}),
    };
  }).sort((a, b) => a.price - b.price || String(a.name).localeCompare(String(b.name))).map((v, i) => ({ ...v, position: i, isDefault: i === 0 }));
  const gallery = [...new Set([...(lead.images || []), ...variants.map((v) => v.imageUrl).filter(Boolean)])];
  const cls = classify({ tax, title: name + " " + lead.title }) || classify({ tax, title: name + " " + features.join(" ") });
  if (!cls) report.categoryMisses.push({ name, type: tax["product-type"], cats: tax["product-category"] });
  // Frontline gives no text for some products: describe them only from the facts it does give
  let description = desc;
  if (!String(bodyHtml).replace(/<[^>]+>/g, "").trim()) {
    const who = [specs.Brand && `by ${specs.Brand}`, specs.Range && `from the ${specs.Range} range`].filter(Boolean).join(", ");
    const facts = Object.entries(specs).filter(([k]) => !/^(brand|range|collection|product type|manufacturer code)$/i.test(k)).map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${esc(v)}</li>`);
    const opts = axes.length ? `<p>Available ${axes.map((a) => `${a.toLowerCase()}s`).join(" and ")}: ${axes.map((a) => [...new Set(vs.map((v) => v.vals[axes.indexOf(a)]))].join(", ")).join("; ")}.</p>` : "";
    description = [`<p>${esc(clean(name))}${who ? ` ${esc(who)}` : ""}.</p>`, opts, features.length ? "<h3>Key features</h3><ul>" + features.map((f) => `<li>${esc(f)}</li>`).join("") + "</ul>" : "", facts.length ? "<h3>Specifications</h3><ul>" + facts.join("") + "</ul>" : ""].filter(Boolean).join("\n");
    report.generatedDescriptions = (report.generatedDescriptions || 0) + 1;
  }
  return {
    groupKey: `fl:${pages.map((p) => p.id).sort((a, b) => a - b)[0]}`,
    name: clean(name),
    description,
    price: Math.min(...variants.map((v) => v.price)),
    images: gallery,
    department: cls?.department || "",
    category: cls?.category || "",
    subCategory: cls?.subCategory || "",
    classifiedBy: cls?.rule || null,
    sku: variants[0].sku,
    specs,
    sourceUrl: lead.url,
    sourcePageIds: pages.map((p) => p.id),
    frontline: { brand: brandNames, range: tax.range, collection: tax.collection, productType: tax["product-type"], productCategory: tax["product-category"] },
    shopifyOptions: axes.length ? axes.map((a, j) => ({ name: a, position: j + 1, values: [...new Set(variants.map((v) => v.options[a]))] })) : [],
    variants,
  };
}

// ---- output: one F code lives on exactly one product/variant
report.skuCollisions = [];
const seenSku = new Map();
for (const p of products) {
  p.variants = p.variants.filter((v) => {
    const k = String(v.sku).toUpperCase();
    const prev = seenSku.get(k);
    if (prev) {
      // same item listed on two Frontline pages → one listing; a different item under the same code → keep, suffixed SKU
      const cur = `${p.name} / ${v.name}`;
      const compatible = (x, y) => !x || !y || x.toLowerCase().replace(/mm/g, "") === y.toLowerCase().replace(/mm/g, "");
      const words = (x) => new Set(String(x).toLowerCase().replace(/[^a-z ]/g, " ").split(" ").filter((w) => w.length > 2 && !/^(mm|and|with|the|unit|matt|gloss|inc|excluding|including)$/.test(w)));
      const shared = [...words(prev.product.name)].filter((w) => words(p.name).has(w)).length;
      const sameKind = prev.product.category === p.category && prev.product.subCategory === p.subCategory || shared >= 2;
      const colourOf = (x) => coloursIn(x).replace(/\b(matt|gloss|textured?|brushed) /g, "");
      const same = prev.product !== p && sameKind && compatible(sizeOf(prev.label), sizeOf(cur)) && compatible(colourOf(prev.vname), colourOf(v.name));
      if (same) {
        report.skuCollisions.push({ sku: v.sku, action: prev.price === v.price ? "same item listed twice on Frontline — one listing kept" : `same item listed twice on Frontline at two prices (£${prev.price} kept, £${v.price} on the other page)`, keptOn: prev.label, droppedFrom: cur });
        return false;
      }
      let n = 2; while (seenSku.has(`${k}-${n}`)) n++;
      report.skuCollisions.push({ sku: v.sku, action: `different item — kept as ${v.sku}-${n}`, first: prev.label, second: `${p.name} / ${v.name}` });
      v.sku = `${v.sku}-${n}`;
      seenSku.set(v.sku.toUpperCase(), { product: p, price: v.price, label: `${p.name} / ${v.name}`, vname: v.name });
      return true;
    }
    seenSku.set(k, { product: p, price: v.price, label: `${p.name} / ${v.name}`, vname: v.name });
    return true;
  });
  if (p.shopifyOptions.length) {
    for (const o of p.shopifyOptions) o.values = [...new Set(p.variants.map((v) => v.options[o.name]))];
    p.shopifyOptions = p.shopifyOptions.filter((o) => o.values.length > 1 || p.variants.length === 1 ? o.values.length > 1 : true);
    if (p.variants.length === 1) { p.shopifyOptions = []; p.variants[0] = { ...p.variants[0], options: {}, name: p.name }; delete p.variants[0].option1; delete p.variants[0].option2; }
  }
  p.variants.forEach((v, i) => { v.position = i; v.isDefault = i === 0; });
  if (p.variants.length) { p.price = Math.min(...p.variants.map((v) => v.price)); p.sku = p.variants[0].sku; }
}
const final = products.filter((p) => p.variants.length && p.images.length && p.variants.every((v) => v.price > 0));
const noImage = products.filter((p) => !p.images.length).map((p) => p.name);
const cat = {};
for (const p of final) { const k = `${p.department} > ${p.category} > ${p.subCategory}`; cat[k] = (cat[k] || 0) + 1; }
const summary = {
  pagesCaptured: rows.length, pagesFailed: report.failedPages.length, families: families.size,
  productsWithoutPrice: report.noPrice.length, variantsDroppedNoPrice: report.droppedVariantsNoPrice, droppedNoImage: noImage.length,
  colourMerges: report.merges.length, products: final.length, productsWithVariants: final.filter((p) => p.variants.length > 1).length,
  variants: final.reduce((a, p) => a + p.variants.length, 0), maxVariants: Math.max(...final.map((p) => p.variants.length)),
  duplicateRefsOnFrontline: report.duplicateRefs.length, uncategorised: report.categoryMisses.length,
  optionAxes: final.flatMap((p) => p.shopifyOptions.map((o) => o.name)).reduce((a, n) => ((a[n] = (a[n] || 0) + 1), a), {}),
};
fs.writeFileSync(path.join(V3, "fl-final.json"), JSON.stringify(final, null, 1));
fs.writeFileSync(path.join(V3, "fl-report.json"), JSON.stringify({ summary, categories: cat, ...report, noImage }, null, 1));
console.log(JSON.stringify(summary, null, 1));
