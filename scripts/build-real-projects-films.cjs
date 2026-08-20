/**
 * Generate the homepage "Real projects" film list from the video audits.
 *
 *   node scripts/build-real-projects-films.cjs
 *
 * Writes src/components/home/realProjectsFilms.ts. Dead embeds are dropped —
 * a deleted YouTube or Vimeo id renders as "Video unavailable", and roughly
 * one in twelve of the ids found on supplier sites is dead.
 *
 * Titles are de-branded: the section carries films from every brand we stock,
 * so no single supplier's name should appear on a card. Automatic stripping
 * gets the common shapes ("… | PORCELANOSA Grupo", "… by X", "… de X"); skim
 * the output for range names it could not know about.
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "src", "components", "home", "realProjectsFilms.ts");
const verified = JSON.parse(
  fs.readFileSync(path.join(__dirname, "_tmp-porc-verified.json"), "utf8"),
);

/** Brand and range names that must not reach a card. */
const BRANDS = [
  "PORCELANOSA Grupo", "PORCELANOSA Group", "Porcelanosa Grupo", "Porcelanosa Group",
  "PORCELANOSA", "Porcelanosa", "L'Antic Colonial", "LAntic Colonial", "Antic Colonial",
  "Gamadecor", "Butech", "Noken", "Krion", "KRION", "Urbatek", "XTONE", "Xtone",
  "Venis", "VENIS", "Par-ker", "Par-Ker", "PAR-KER", "Parker", "Highker", "HIGHKER",
  "XLight", "XLIGHT", "Xlight", "Starwood", "STARWOOD", "Solid Ker", "SolidKer",
  "Ceramic Park", "Grupo",
];

function debrand(raw) {
  let s = String(raw || "").trim();
  s = s.split("|")[0].trim();                          // "Title | BRAND"
  s = s.replace(/^[A-Z]{2}\s*-\s*\.?\s*\+?\s*/, "");  // "EN - . + …" locale stubs
  s = s.replace(/#\S+/g, "");                          // campaign hashtags
  for (const b of BRANDS) {
    const esc = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Case-insensitive on both passes: their titles mix "Gamadecor" and
    // "GAMADECOR", and a case-sensitive strip left the shouted ones intact.
    s = s.replace(new RegExp(`\\s*(?:by|de|from|of)\\s+${esc}\\b`, "gi"), "");
    s = s.replace(new RegExp(`\\b${esc}\\b`, "gi"), "");
  }
  s = s.replace(/\s{2,}/g, " ")
       .replace(/\s*[-–—:,.]+\s*$/, "")
       .replace(/^\s*[-–—:,.+]+\s*/, "")
       .trim();
  return s;
}

/** Coarse grouping so 200+ cards stay navigable behind filter chips. */
const CATEGORIES = [
  ["Showrooms", /showroom|tienda|espacio|store|exhibition|expo|feria|inaugura|isaloni|cersaie|fashion week|stand/i],
  ["Projects", /project|proyecto|hotel|office|oficina|residen|apartment|villa|house|casa|shopping|centro|obra/i],
  ["Kitchens & baths", /kitchen|cocina|bath|baño|bano|shower|ducha|washbasin|lavabo|sanitary|griferia|grifer|mueble/i],
  ["Materials & tech", /tech|technolog|ceramic|cerámic|ceramic|porcelan|porcelán|gres|surface|material|anti-?slip|qualit|thicker|extrafine|formato|instalaci|installation|zócalo|zocalo/i],
  ["Sustainability", /eco|sustainab|sostenib|water|agua|recycl|recicl|energy|energ|nature|natura|green|responsab|covid/i],
  ["Awards", /award|premio|contest|concurso|challenge/i],
  ["Collections", /collection|colecci|serie|catalog|catálog|novedad|trend|lifestyle|moment/i],
];
function categorise(title) {
  for (const [name, re] of CATEGORIES) if (re.test(title)) return name;
  return "Real projects";
}

/**
 * A de-branded title that is still worth reading. Some of their videos are
 * titled with nothing but a brand name, which leaves an empty string once the
 * brand is stripped — those fall back to the category.
 */
function safeTitle(raw, label) {
  const t = debrand(raw);
  if (t.length >= 4) return t.charAt(0).toUpperCase() + t.slice(1);
  return label === "Real projects" ? "A project film" : `${label} film`;
}

const films = [];
const seen = new Set();

function add(film) {
  const key = film.youtubeId || film.vimeoId || film.src;
  if (!key || seen.has(key)) return;
  seen.add(key);
  films.push(film);
}

/** The self-hosted films mirrored by download-porcelanosa-videos.cjs. */
const SELF_HOSTED = [
  ["Showrooms", "A walkthrough of a finished showroom", "virtual-showroom-tour"],
  ["Showrooms", "Inside a natural stone showroom", "virtual-showroom-stone"],
  ["Collections", "Summer collection film", "summer-dreams-campaign"],
  ["Collections", "Solid surface collection", "solid-surface-collection"],
  ["Sustainability", "How the material is made responsibly", "sustainability-overview"],
  ["Sustainability", "Cleaner air", "sustainability-air"],
  ["Sustainability", "Energy in production", "sustainability-energy"],
  ["Sustainability", "Water reuse", "sustainability-water"],
  ["Sustainability", "Working with nature", "sustainability-nature"],
  ["Sustainability", "Recycling the offcuts", "sustainability-recycling"],
  ["Real projects", "Behind the scenes at the factory", "group-overview"],
  ["Real projects", "Offsite construction, start to finish", "offsite-construction"],
  ["Materials & tech", "What the surface can take", "material-qualities"],
  ["Materials & tech", "Standing up to temperature change", "quality-temperature-change"],
  ["Materials & tech", "Warm underfoot", "quality-warmth"],
  ["Materials & tech", "Built for heavy traffic", "quality-heavy-traffic"],
  ["Real projects", "A project film", "trendbook-film-1"],
  ["Collections", "Season trailer", "trendbook-trailer"],
];
for (const [label, title, file] of SELF_HOSTED) {
  add({
    label,
    title,
    src: `/home/real-projects/${file}.mp4`,
    poster: `/home/real-projects/posters/${file}.jpg`,
  });
}

for (const v of verified.youtube) {
  if (!v.live) continue;
  const label = categorise(debrand(v.title || ""));
  add({
    label,
    title: safeTitle(v.title, label),
    youtubeId: v.id,
    poster: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
  });
}

for (const v of verified.vimeo) {
  if (!v.live) continue;
  const label = categorise(debrand(v.title || ""));
  add({ label, title: safeTitle(v.title, label), vimeoId: v.id, poster: v.thumbnail || "" });
}

const header = `// GENERATED by scripts/build-real-projects-films.cjs — do not edit by hand.
// Films surveyed from supplier sites, de-branded and filtered to ids that
// still play. Re-run the script to refresh.
import type { ProjectFilm } from "@/components/home/RealProjects";

export const GENERATED_FILMS: ProjectFilm[] = ${JSON.stringify(films, null, 2)};
`;

fs.writeFileSync(OUT, header);
const byCat = {};
for (const f of films) byCat[f.label] = (byCat[f.label] || 0) + 1;
console.log("films written:", films.length);
console.log("by category:", JSON.stringify(byCat, null, 1));
console.log("->", path.relative(path.join(__dirname, ".."), OUT));
console.log("\nsample titles:");
films.slice(0, 12).forEach((f) => console.log(`  [${f.label}] ${f.title}`));
