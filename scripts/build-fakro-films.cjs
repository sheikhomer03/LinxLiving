/**
 * Turn the fakro video scan into homepage film cards.
 *
 *   node scripts/build-fakro-films.cjs            # curated tiers only
 *   TIERS=project,howto,product,smart,corporate node scripts/build-fakro-films.cjs
 *
 * Reads scripts/_tmp-fakro-verified.json (ids that still play, with titles)
 * and writes src/components/home/fakroFilms.ts.
 *
 * Why a tier filter exists
 * ------------------------
 * fakro.com references 332 videos, 321 of which still play — but they are not
 * 321 project films. Roughly two in five are model-code support content:
 * pairing a Z-Wave wall switch, an advanced-options walkthrough for a WiFi
 * module, a catalogue entry per flashing variant. The section's own rule is
 * that a card names no supplier, and stripping the brand off "FAKRO roof
 * windows - EGV flashing (double lapped tiles)" leaves either a model code or
 * the word "flashing" repeated forty times. Neither belongs in a rail a
 * shopper reads.
 *
 * So each film is sorted into a tier, and TIERS decides which reach the page.
 * Nothing is deleted — flip the env var and the excluded tiers are generated
 * too, so the call stays reversible and visible rather than baked in.
 */
const fs = require("fs");
const path = require("path");

const IN = path.join(__dirname, "_tmp-fakro-verified.json");
const OUT = path.join(__dirname, "..", "src", "components", "home", "fakroFilms.ts");
const TIERS = new Set((process.env.TIERS || "project,howto").split(",").map((s) => s.trim()));

/** Their name, their sub-brands, and one misspelling of their own name. */
const BRANDS = [
  "FAKRO Group", "FAKRO GB", "FAKRO USA", "FAKRO PRO", "FAKRO", "Fakro", "FAKTO",
  "GREENVIEW", "GrennView", "GreenView", "Greenview", "INNOVIEW", "InnoView", "innoView",
  "preSelect MAX", "preSelect", "proSky", "Duet", "EUROTOP", "Thermo",
];

/**
 * Model codes. Two- to four-letter prefixes with optional digits and suffix —
 * FTP-V, ZWS12, SFD-H, LXB-U, DEZ-A. Matched only as whole words so ordinary
 * words in a sentence survive.
 */
const MODEL_CODE = /\b(?:[A-Z]{2,4}[0-9]{0,3}(?:[-+][A-Z0-9]{1,3})?)\b/g;
/** Codes that are really words, which the pattern above would eat. */
const NOT_A_CODE = new Set([
  "A", "I", "THE", "AND", "NEW", "YOU", "ALL", "BIM", "CEO", "USA", "EU", "GB",
  "UK", "LED", "PVC", "U6", "U8", "OK", "WON", "WHAT", "THIS", "DID",
]);

const SMART = /\b(?:Z-?Wave|ZW[A-Z]{0,2}\d*|ZR[A-Z]\d*|ARZ|AMZ|VMZ|ARF|WiFi|Wi-Fi)\b/i;
const HOWTO = /\b(?:fitting instruction|installation|instruction|how to|assembly|quick start|montaz|nameplate|name plate)\b/i;
const CORPORATE =
  /\b(?:trade\s?show|trade fair|targi|expo|BAU|BUDMA|Batimat|Batibouw|Construma|Praha|Munich|Las Vegas|showroom|tournament|soccer|cup|Christmas|Design Days|Homebuilding|Joinery|sponsor|European Commission|timelaps|time-?lapse)\b/i;
const PROJECT =
  /\b(?:case study|penthouse|housing|attic transformed|balcony|inspired by|harmony|behind the scenes|years together|35 years|about company|reflecting on|sustainab|energy efficiency|your moments|new era|new standard|new generation|production|side of nature)\b/i;

/**
 * Label, and the plain noun a de-branded title can fall back to.
 *
 * Every noun is plural-tolerant. An earlier revision matched `\bladder\b`,
 * which does not fire on "Loft Ladders" — the `s` blocks the word boundary —
 * so a third of the ladder, window and door films were labelled with the
 * catch-all instead of their own family. Flat roofs are tested before roof
 * windows because "flat roof window" belongs under the former.
 */
const FAMILIES = [
  // "scene" and "switch" only count alongside a control system: "Behind the
  // Scenes" is a campaign film, not a Z-Wave scene.
  ["Smart home", /\b(?:Z-?Wave|WiFi|Wi-Fi)\b|\b(?:wall|light) switche?s?\b|\b(?:smoke|rain|wind) sensors?\b/i],
  ["Light tunnels", /\blight tunnels?\b/i],
  ["Loft ladders", /\b(?:loft ladders?|attic ladders?|ladders?|balustrades?|hatch(?:es)?|treads?|stile ends?|slats?|brackets?|unloading mechanism)\b/i],
  ["Blinds", /\b(?:blinds?|roller shutters?|awnings?|panel tracks?|venetian|pleated|cassete|cassette)\b/i],
  ["Flashings", /\b(?:flashings?|gable system)\b/i],
  ["Flat roofs", /\b(?:flat roofs?|skylights?)\b/i],
  ["Garage doors", /\b(?:garage doors?|bramy)\b/i],
  ["Doors", /\b(?:doors?)\b/i],
  ["Roof windows", /\b(?:roof windows?|windows?|roof access|rafters?|membranes?|internal linings?)\b/i],
];

function debrand(raw) {
  let s = String(raw || "").trim();
  s = s.split("|")[0].trim();
  s = s.replace(/#\S+/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "");
  for (const b of BRANDS) {
    const esc = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`\\s*(?:by|from|presents:?)\\s+${esc}\\b`, "gi"), "");
    s = s.replace(new RegExp(`\\b${esc}\\b`, "gi"), "");
  }
  s = s.replace(MODEL_CODE, (m) => (NOT_A_CODE.has(m.toUpperCase()) ? m : ""));
  /*
   * Clear up after the codes. A title listing three variants — "vertical slat
   * XRP, XRU, XRW" — loses the codes but keeps their separators, and reached a
   * card as `vertical slat , ,`. Empty brackets and a trailing variant letter
   * in quotes are the same wreckage in other shapes.
   */
  s = s
    .replace(/\s*,\s*(?=,|[-–—]|$)/g, "")
    .replace(/,\s*,/g, ",")
    .replace(/\(\s*["']?\s*[A-Z0-9]?\s*["']?\s*\)/g, "")
    .replace(/[-–—]\s*["'][A-Z]["']\s*$/i, "")
    .replace(/\s*2\s*\/\s*2\s*$/, " (part 2)")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—:,.+/]+\s*$/, "")
    .replace(/^\s*[-–—:,.+/()]+\s*/, "")
    .trim();
  return s;
}

/**
 * Say what happens in the film the way the rest of the rail says it.
 *
 * Their titles lead with "Installation - ", "Installation of", "How to Install
 * the …" and "… - fitting instruction", four spellings of one idea. The cards
 * around them read "Fitting a top-hung roof window", so these are rewritten to
 * match rather than left as a supplier's support-video naming convention.
 */
function asFitting(s) {
  let t = s
    .replace(/^presents:?\s*/i, "")
    .replace(/^installation instructions? for the\s+/i, "Fitting the ")
    .replace(/^fitting instructions?\s*[-–—:]\s*/i, "Fitting ")
    .replace(/^installation\s+(?:of\s+)?[-–—]?\s*/i, "Fitting ")
    .replace(/^how to install\s+(?:the\s+|a\s+)?/i, "Fitting ")
    .replace(/\s*[-–—]?\s*(?:step-by-step\s+)?fitting guide!?\s*$/i, "")
    .replace(/\s*[-–—]?\s*quick\s*&\s*easy(?:\s+DIY)?\s+guide!?\s*$/i, "")
    .replace(/\s*[-–—]?\s*step-by-step guide!?\s*$/i, "")
    .replace(/\s*[-–—]?\s*installation video\s*$/i, "")
    .replace(/\s*[-–—]?\s*fitting instructions?\s*$/i, "")
    .replace(/\s*[-–—]?\s*assembly\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—:,.]+\s*$/, "")
    .trim();
  // A title left dangling on a preposition or conjunction lost its object with
  // the model code — "reflecting on 35 years of", "energy efficient and".
  // Lower case only: a trailing capital is a variant marker, not a stray word.
  // "Roller blind electrical contact A" must keep its A.
  t = t.replace(/\s+(?:of|for|on|with|and|&|in|to|from|the|a|an)\s*$/, "").trim();
  if (/^fitting\b/i.test(t)) {
    const rest = sentenceCase(t.replace(/^fitting\s+/i, ""));
    // No article in front of a plural: "Fitting L-shaped windows", not "a".
    const plural = /\b(?:windows|doors|ladders|blinds|slats|linings|tunnels|ends|brackets)\b/i.test(
      rest.replace(/\s*\(part \d\)\s*$/i, ""),
    );
    if (!rest) t = "";
    else if (/^(?:a|an|the)\b/i.test(rest)) t = `Fitting ${rest}`;
    else t = plural ? `Fitting ${rest}` : `Fitting ${article(rest)} ${rest}`;
  }
  // Titles that are not instructions are left in their own case. Sentence-
  // casing them flattened the proper nouns they are mostly made of — place
  // names, a designer's name, the founder's — and "penthouse in historic
  // vienna" is worse than the Title Case it replaced.
  return t;
}

/**
 * Their titles are Title Case ("Fire Resistant Folding Wooden Loft Ladder");
 * the rail is sentence case. Words that are wholly capitalised are left alone
 * — those are acronyms and size codes, not shouting — and so is the leading
 * letter of a hyphenated form like "L-shaped", which is a shape, not a word.
 */
function sentenceCase(s) {
  return s
    .split(/\b/)
    .map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
    .join("")
    .replace(/\b([A-Z])-([a-z])/g, (m, a, b) => `${a}-${b}`);
}

/**
 * "an" goes by sound, not spelling. These titles are full of shape and size
 * codes whose names begin with a vowel sound behind a consonant letter —
 * "an L-shaped window", not "a L-shaped window".
 */
const SOUNDS_VOWEL = /^(?:[aeiou]|[FHLMNRSX](?![a-z])|hour|honest)/;
const article = (s) => (SOUNDS_VOWEL.test(s) ? "an" : "a");

/** The one-of noun for each family, for titles built from scratch. */
const SINGULAR = {
  "Smart home": "window control",
  "Light tunnels": "light tunnel",
  "Loft ladders": "loft ladder",
  Blinds: "blind",
  Flashings: "flashing",
  "Flat roofs": "flat roof window",
  "Garage doors": "garage door",
  Doors: "door",
  "Roof windows": "roof window",
  "Real projects": "range",
};

function familyOf(title) {
  for (const [label, re] of FAMILIES) if (re.test(title)) return label;
  return "Real projects";
}

function tierOf(title) {
  if (SMART.test(title)) return "smart";
  if (CORPORATE.test(title)) return "corporate";
  if (PROJECT.test(title)) return "project";
  if (HOWTO.test(title)) return "howto";
  return "product";
}

/**
 * A card title that reads as English. Anything that survives de-branding as a
 * fragment, a bare model code, or a non-Latin title falls back to a phrase
 * built from its family — the same guard the porcelanosa build uses, which is
 * what keeps "FAKRO - ZWMA" from reaching a card as an empty string.
 */
function cardTitle(raw, label, tier) {
  const t = asFitting(debrand(raw));
  const asciiish = t.replace(/[^\x00-\x7F]/g, "").length >= t.length * 0.9;
  if (t.length >= 12 && asciiish && /[a-z]{3}/.test(t)) {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  /*
   * Nothing readable survived — the source was a bare model code, a code plus
   * "fitting instruction", or a title in another language. Describe the film
   * by its family instead of shipping a fragment: "DR DE DM DX Nameplate"
   * reached a card as "Fitting the range" before this.
   */
  // No family either, so there is nothing true left to say about it. Better
  // dropped and reported than shipped as "Fitting a range".
  if (label === "Real projects") return null;
  const noun = SINGULAR[label];
  if (/name\s?plate|data plate/i.test(raw)) return `Where to find the ${noun} data plate`;
  return tier === "howto" ? `Fitting ${article(noun)} ${noun}` : `A closer look at the ${noun}`;
}

/**
 * Titles no rule can reach, written by hand after watching what each film is.
 *
 * Three kinds end up here: a title that was only ever a model code and a noun
 * ("LMP Metal Attic Ladder"), one whose subject lived entirely in the code
 * that had to go ("LWE Energy Efficient and LWT Super Thermo"), and their
 * social-media shouting, which is not how this rail speaks. `label` overrides
 * the family too where the automatic one landed wrong.
 */
const OVERRIDES = {
  qvnLdbUdUzo: { title: "A look inside the company" },
  ordoecUK2m0: { title: "Fitting an energy-efficient loft ladder", label: "Loft ladders" },
  "8Z2N5BoYm84": { title: "Where to find a roof window's data plate" },
  K7XAP2BbL3A: { title: "Fitting a roller blind, start to finish" },
  XzJm2PSqYvE: { title: "Fitting a semi-open roller blind" },
  zLDeJ9D4HW0: { title: "Fitting internal window linings" },
  RO6RW2ShTf4: { title: "Fitting a metal attic ladder" },
  qZMOUH7HBy8: { title: "Where to find a light tunnel's data plate" },
  iudYF3YwjtI: { title: "Where to find a loft ladder's data plate" },
  cDOb5lTuuew: { title: "The founder on thirty-five years of the business" },
  FCTt9n_JVgQ: { title: "Fitting a ladder unloading mechanism" },
  "62CRw9cvKhk": { title: "A skylight balcony on a TV home makeover" },
  "GKV-8abw8V0": { title: "Thirty-five years, and the range today" },
  cwlSTNfIpqA: { title: "The balcony window, close up", label: "Roof windows" },
  "aaYu-aRUqnE": { title: "Fitting an insulated metal loft ladder", label: "Loft ladders" },
  "8mZqTRY6PPU": { title: "Fitting an insulated scissor loft ladder", label: "Loft ladders" },
  // Two films for the same part, metal and wooden, distinguished only by the
  // -M / -W suffix the code strip removes. Named apart by hand or they collide.
  YtXT46HKl20: { title: "Fitting metal loft ladder stile ends", label: "Loft ladders" },
  "SAG50-zoreM": { title: "Fitting wooden loft ladder stile ends", label: "Loft ladders" },
  "-HK4OnTbhi4": { title: "Fitting loft ladder mounting brackets", label: "Loft ladders" },
  "9y8ac04ylUA": { title: "Concealed slats for a flush finish", label: "Loft ladders" },
  enqLIvVNmoA: { title: "Assembling a loft ladder upper hatch", label: "Loft ladders" },
  a42b78BJZBk: { title: "Fitting a flat roof window kerb", label: "Flat roofs" },
  pcN9ZLlzjAE: { title: "A roof window that opens into a balcony", label: "Roof windows" },
};

const verified = JSON.parse(fs.readFileSync(IN, "utf8"));
const films = [];
const seen = new Set();
const counts = {};

const collisions = [];
const unnamed = [];
const titlesUsed = new Set();

function add(film, tier) {
  counts[tier] = (counts[tier] || 0) + 1;
  if (!TIERS.has(tier)) return;
  const key = film.youtubeId || film.vimeoId;
  if (!key || seen.has(key)) return;
  if (!film.title) {
    unnamed.push(key);
    return;
  }
  /*
   * Distinct films, identical card. Five installation videos differ only by
   * the window code in their title, so once the code is stripped they all read
   * "Fitting a roof window" — five cards a shopper cannot tell apart, showing
   * what is essentially the same job. The first is kept and the rest are
   * reported, never dropped silently.
   */
  if (titlesUsed.has(film.title)) {
    collisions.push(`${film.title}  [${key}]`);
    return;
  }
  titlesUsed.add(film.title);
  seen.add(key);
  films.push(film);
}

for (const v of verified.youtube) {
  if (!v.live) continue;
  const tier = tierOf(v.title);
  const over = OVERRIDES[v.id] || {};
  const label = over.label || familyOf(v.title);
  add(
    {
      label,
      title: over.title || cardTitle(v.title, label, tier),
      youtubeId: v.id,
      // Whichever size the verify step found actually exists — asking for
      // maxres where there is none paints a grey 120x90 placeholder.
      poster: `https://i.ytimg.com/vi/${v.id}/${v.poster || "hqdefault"}.jpg`,
    },
    tier,
  );
}

for (const v of verified.vimeo) {
  if (!v.live) continue;
  const tier = tierOf(v.title);
  const label = familyOf(v.title);
  add({ label, title: cardTitle(v.title, label, tier), vimeoId: v.id, poster: v.thumbnail || "" }, tier);
}

const header = `// GENERATED by scripts/build-fakro-films.cjs — do not edit by hand.
// Skylight and roof-window films surveyed from fakro.com (691 pages), filtered
// to ids that still play, de-branded, and limited to the tiers named in that
// script. Re-run it to refresh.
import type { ProjectFilm } from "@/components/home/RealProjects";

export const FAKRO_FILMS: ProjectFilm[] = ${JSON.stringify(films, null, 2)};
`;
fs.writeFileSync(OUT, header);

const byLabel = {};
for (const f of films) byLabel[f.label] = (byLabel[f.label] || 0) + 1;
console.log("tiers found:   ", JSON.stringify(counts));
console.log("tiers included:", [...TIERS].join(", "));
console.log("films written: ", films.length);
console.log("by label:      ", JSON.stringify(byLabel));
console.log("->", path.relative(path.join(__dirname, ".."), OUT));
if (unnamed.length) {
  console.log(`\ndropped ${unnamed.length} film(s) whose title was nothing but a model code:`);
  unnamed.forEach((id) => console.log("  ", id));
}
if (collisions.length) {
  console.log(`\ncollapsed ${collisions.length} film(s) whose card was a duplicate of one already kept:`);
  collisions.forEach((c) => console.log("  ", c));
}
console.log("\nsample:");
films.slice(0, 15).forEach((f) => console.log(`  [${f.label}] ${f.title}`));
