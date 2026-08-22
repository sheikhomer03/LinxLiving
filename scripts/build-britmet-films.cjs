/**
 * Turn the britmet video scan into homepage film cards.
 *
 *   node scripts/build-britmet-films.cjs
 *
 * Reads scripts/_tmp-britmet-verified.json and writes
 * src/components/home/britmetFilms.ts.
 *
 * Everything that plays is mapped. Unlike the fakro build there is no tier
 * filter and no duplicate-collapsing here: a card whose title would clash with
 * one already written is disambiguated by its range instead of dropped, so the
 * only films missing from the output are the ones that genuinely cannot play.
 *
 * Their titles are far more regular than most suppliers' — "How To: <task>
 * with Britmet <Range> Lightweight Roofing" and "Intro to: <Range>" — so the
 * de-branding is mostly a matter of removing the trailing brand clause and
 * translating the range name into the plain English the rail speaks.
 */
const fs = require("fs");
const path = require("path");

const IN = path.join(__dirname, "_tmp-britmet-verified.json");
const OUT = path.join(__dirname, "..", "src", "components", "home", "britmetFilms.ts");

/**
 * Ids that cannot be embedded, with the reason.
 *
 * A video can be perfectly alive on YouTube and still be useless here: if the
 * owner turns off embedding, the rail's iframe renders "Video unavailable".
 * That is broken for this purpose, so it is excluded — and named, so the call
 * is visible rather than silent. Checked via playableInEmbed on the watch
 * page; oEmbed answering 401 is the same signal.
 */
const NOT_EMBEDDABLE = {
  "1ik2kXeiL7Q": "embedding disabled by the owner (drone film of a flat-to-pitch conversion)",
};

/**
 * Range names translated to plain English.
 *
 * Taken from the wording on each range's own page rather than invented —
 * liteslate.asp calls itself synthetic slate, tactray90.asp calls itself a
 * structural roof lining — so the cards stay accurate without carrying a
 * product name the rail is not allowed to print.
 */
const RANGES = [
  [/\bliteslate\b/i, "synthetic slate range"],
  [/\bslate\s?2000\b/i, "lightweight slate range"],
  [/\bpantile\s?2000\b/i, "pantile range"],
  [/\bultratile\b/i, "lightweight tile range"],
  [/\bvillatile\b/i, "villa tile range"],
  [/\bplaintile\b/i, "plain tile range"],
  [/\bprofile\s?49\b/i, "profiled sheet range"],
  [/\becopan(\s?plus)?\b/i, "roof panel range"],
  [/\btactray\s?90\b/i, "structural roof lining"],
  [/\bbritframe\b/i, "roof frame system"],
  [/\bshingle\b/i, "shingle tile range"],
];

/** The brand clause, in every spelling their channel uses. */
const BRAND =
  /\s*(?:with|from|for)?\s*britmet(?:\s+tileform)?(?:\s+lightweight\s+(?:metal\s+)?roof(?:ing|\s+tiles|\s+slates)?)?(?:'s)?\s*/gi;

/**
 * The same descriptive clause without the brand in front of it.
 *
 * Their titles put the range between the two — "with Britmet Slate 2000
 * Lightweight Metal Roof Tiles" — so removing the brand and then the range
 * leaves the tail stranded, and a card read "Tiling a roof lightweight metal
 * roof tiles". Run only after BRAND, and only on the tail.
 */
const BRAND_TAIL = /\s*(?:with|from|for)?\s*lightweight\s+(?:metal\s+)?roof(?:ing|\s+tiles|\s+slates)?\s*$/i;

/** A preposition left holding nothing once the brand clause went. */
const DANGLING = /\s+(?:with|for|from|and|the|a|an|of)\s*$/i;

const LABELS = [
  ["Cladding", /\bvertical\b|\bcladding\b/i],
  ["Flashings", /\bflashing|\bsoaker\b|\bvalley\b/i],
  ["Insulation", /\bpir\b|\binsulation\b|\bbreather membrane\b|\btacmat\b/i],
  ["Rainwater goods", /\brainwater\b|\bgutter/i],
  ["Soffits & fascias", /\bsoffit|\bfascia/i],
  ["Roof lights", /\broof ?light|\bwindow\b/i],
  ["Ridges & hips", /\bridge\b|\bhip\b|\bverge\b|\bbarge\b|\beave/i],
  ["Roofing systems", /\bintro to\b|\brange\b|\bsystem\b/i],
  ["Case studies", /\btime-?lapse\b|\brenovation\b|\bcase study\b|\bconversion\b|\bsite\b/i],
  ["Industry", /\braac\b|\bconcrete\b|\bnbs\b|\bschools\b|\bitv\b|\bspecification\b/i],
  ["Sponsorship", /\bmotorsport\b|\bricciardo\b|\bpowell\b|\bseries\b|\bshow\b/i],
  ["Finishes", /\bpaint\b|\bstipple\b|\btouch up\b/i],
  ["Roof tiling", /\btile\b|\btiles\b|\bbatten|\bsheet/i],
];

function rangeOf(title) {
  for (const [re, plain] of RANGES) if (re.test(title)) return plain;
  return null;
}

function debrand(raw) {
  let s = String(raw || "").trim();
  s = s.split("|")[0].trim();                       // "… | Britmet Lightweight Roofing"
  s = s.replace(BRAND, " ");
  for (const [re] of RANGES) s = s.replace(re, " ");
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.replace(BRAND_TAIL, "");
  s = s.replace(DANGLING, "");
  return s
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.:;])/g, "$1")
    .replace(/^\s*[-–—:,.]+\s*/, "")
    .replace(/\s*[-–—:,.']+\s*$/, "")
    .trim();
}

/** "How To: Install a Ridge" -> "Fitting a ridge". */
function phrase(raw) {
  let s = debrand(raw);
  const intro = /^intro to:?\s*$/i.test(s) || /^intro to\b/i.test(raw);
  if (intro) {
    const plain = rangeOf(raw);
    return plain ? `A look at the ${plain}` : "A look at the range";
  }
  /*
   * "<Range> Installation Guide" — here the range name *is* the subject, so
   * stripping it leaves the film with nothing to be called. Rebuild from the
   * plain-English range instead of discarding a film that plays perfectly
   * well; this is what dropped the structural-lining guide before.
   */
  if (/installation guide/i.test(raw)) {
    const plain = rangeOf(raw);
    if (plain) return `Fitting the ${plain.replace(/ range$/, " range")}`;
  }
  s = s
    .replace(/^how to:?\s*/i, "")
    .replace(/^(install|installing|fit|fitting|tile|tiling|lay|laying|set out|cut|use)\b/i, (m) => {
      const map = {
        install: "Fitting", installing: "Fitting", fit: "Fitting", fitting: "Fitting",
        tile: "Tiling", tiling: "Tiling", lay: "Laying", laying: "Laying",
        "set out": "Setting out", cut: "Cutting", use: "Using",
      };
      return map[m.toLowerCase()] || m;
    })
    .replace(/\s*installation guide\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!s) return "";
  // Their How-To titles are Title Case; the rail is sentence case. Words that
  // are wholly capitalised stay put — those are acronyms, not shouting.
  s = s
    .split(/\b/)
    .map((w, i) => (i > 0 && /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
    .join("");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function labelOf(title) {
  for (const [label, re] of LABELS) if (re.test(title)) return label;
  return "Roofing";
}

/**
 * Titles the rules cannot reach, written by hand.
 *
 * Mostly films whose whole subject was the range name that has to come off
 * ("Install Britmet Ultratile Lightweight Roof Tiles" strips to nothing), a
 * couple where the source grammar does not survive the rewrite, and the three
 * that are not really about roofing at all — those keep a plain, accurate
 * description rather than a channel headline.
 */
const OVERRIDES = {
  "JaLsV-IwKvM": { title: "Fitting the lightweight tile range", label: "Roof tiling" },
  "1Awzw7lCl8c": { title: "Cutting and bending a shingle hip end cap", label: "Ridges & hips" },
  RwTmMgb8H0c: { title: "Fitting shingle tiles", label: "Roof tiling" },
  LrNyrUE2W7c: { title: "Anti-vandal testing on lightweight slates", label: "Roofing" },
  LIRtk3vwgPA: { title: "Anti-vandal testing on pantiles", label: "Roofing" },
  "09TTy1Zz1XI": { title: "Fitting rainwater goods", label: "Rainwater goods" },
  zEazbVkJ3yA: { title: "Fitting soffits and fascias", label: "Soffits & fascias" },
  // A third-party news report embedded on their RAAC page, not their own film.
  "t6MN6-VsGgM": { title: "A news report on RAAC concrete in schools", label: "Industry" },
  "WKf-zHKVrgo": { title: "A sponsored driver's racing season", label: "Sponsorship" },
  rbDhI7FKEVQ: { title: "A sponsored race round at Hooton Park", label: "Sponsorship" },
};

const verified = JSON.parse(fs.readFileSync(IN, "utf8"));
const films = [];
const titlesUsed = new Map();
const skipped = [];

function add(film, sourceTitle) {
  if (!film.title) {
    skipped.push(`${film.youtubeId || film.src} — no title could be built`);
    return;
  }
  /*
   * Distinct films must not share a card. Where two would, the range they
   * belong to is what tells them apart, so it goes on the end rather than one
   * of them being dropped: every film that plays gets mapped.
   */
  if (titlesUsed.has(film.title)) {
    const plain = rangeOf(sourceTitle || "");
    let next = plain ? `${film.title} — ${plain.replace(/ range$/, "")}` : film.title;
    let n = 2;
    while (titlesUsed.has(next)) next = `${film.title} (${n++})`;
    film.title = next;
  }
  titlesUsed.set(film.title, true);
  films.push(film);
}

for (const v of verified.youtube) {
  if (!v.live) {
    skipped.push(`${v.id} — no longer plays`);
    continue;
  }
  if (NOT_EMBEDDABLE[v.id]) {
    skipped.push(`${v.id} — ${NOT_EMBEDDABLE[v.id]}`);
    continue;
  }
  const over = OVERRIDES[v.id] || {};
  add(
    {
      label: over.label || labelOf(v.title),
      title: over.title || phrase(v.title),
      youtubeId: v.id,
      poster: `https://i.ytimg.com/vi/${v.id}/${v.poster || "hqdefault"}.jpg`,
    },
    v.title,
  );
}

/**
 * The one film they host themselves, mirrored by download-britmet-videos.cjs.
 *
 * Shot portrait — ffprobe reports 720x1280 — so it is letterboxed rather than
 * cropped. Filling a 16:9 card with a 9:16 source would show a slice down the
 * middle of the frame and cut the roof out of a roofing film.
 */
add({
  label: "Roofing systems",
  title: "Synthetic slate panels, close up",
  src: "/home/real-projects/lightweight-slate-panels.mp4",
  poster: "/home/real-projects/posters/lightweight-slate-panels.jpg",
  portrait: true,
});

const header = `// GENERATED by scripts/build-britmet-films.cjs — do not edit by hand.
// Roofing films surveyed from britmet.co.uk (449 pages), de-branded, with the
// range names translated to plain English. Every film that plays is here; see
// the script for the ones that cannot be embedded. Re-run it to refresh.
import type { ProjectFilm } from "@/components/home/RealProjects";

export const BRITMET_FILMS: ProjectFilm[] = ${JSON.stringify(films, null, 2)};
`;
fs.writeFileSync(OUT, header);

const byLabel = {};
for (const f of films) byLabel[f.label] = (byLabel[f.label] || 0) + 1;
console.log("films written:", films.length);
console.log("by label:     ", JSON.stringify(byLabel));
if (skipped.length) {
  console.log(`\nnot mapped (${skipped.length}):`);
  skipped.forEach((s) => console.log("  ", s));
}
console.log("->", path.relative(path.join(__dirname, ".."), OUT));
console.log("\nsample:");
films.slice(0, 12).forEach((f) => console.log(`  [${f.label}] ${f.title}`));
