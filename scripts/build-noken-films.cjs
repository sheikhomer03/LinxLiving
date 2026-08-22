/**
 * Turn the bathroom-supplier video survey into homepage film cards.
 *
 *   node scripts/build-noken-films.cjs
 *
 * Reads scripts/_tmp-noken-verified.json (written by _tmp-noken-verify.cjs off
 * the scan in _tmp-noken-video-scan.cjs) and writes
 * src/components/home/nokenFilms.ts.
 *
 * Their titles cannot be de-branded by rule the way britmet's could. They come
 * in four incompatible shapes — ALL-CAPS category strings ("BRASSWARE - MOOD -
 * CARTRIDGE REPLACEMENT"), plain questions ("How to fix the shower tray?"),
 * emoji-prefixed ones with a trailing brand clause, and a dozen left in
 * Spanish — and forty-odd of the how-tos are the same job performed on a
 * different range, so a mechanical strip yields ten cards all reading
 * "Replacing a tap cartridge". Each id therefore carries an explicit label and
 * title below, written from what the film actually shows.
 *
 * Two rules drive the wording, both inherited from the rail itself:
 *   - no supplier name, and no range name either — "Mood" becomes a
 *     square-profile basin tap, "Swan" a cast-mineral one, in the same way
 *     build-britmet-films.cjs translates its roofing ranges;
 *   - where several films share a job, the card names what differs, so the
 *     rail never shows the same sentence twice.
 */
const fs = require("fs");
const path = require("path");

const IN = path.join(__dirname, "_tmp-noken-verified.json");
const OUT = path.join(__dirname, "..", "src", "components", "home", "nokenFilms.ts");

/**
 * Ids surveyed but deliberately not carded, with the reason. Named rather than
 * silently dropped so the call is visible.
 */
const EXCLUDED = {
  "youtube:dC48r5MzsP4": "removed from YouTube — oEmbed answers 404",
  "vimeo:816537142": "the supplier re-hosts this one itself; the mirrored copy is carded instead",
};

/** [label, title], keyed by `<kind>:<id>`. */
const CARDS = {
  // ---- Taps, mixers and shower heads -------------------------------------
  "youtube:z2wgqSi0nKE": ["Taps & showers", "Replacing the cartridge in a traditional floor-mounted bath tap"],
  "youtube:StXo8bC7HlA": ["Taps & showers", "Replacing the cartridge in a contemporary floor-mounted bath tap"],
  "youtube:CyNz-Cs-M10": ["Taps & showers", "Replacing the cartridge in a minimalist floor-mounted bath tap"],
  "youtube:R9qQqfRVpj0": ["Taps & showers", "How the diverter cartridge works on a floor-mounted bath mixer"],
  "youtube:AAzV2t_XftI": ["Taps & showers", "Replacing the cartridge in a square-profile basin tap"],
  "youtube:_tBwlMeHAks": ["Taps & showers", "Replacing the aerator on a square-profile basin tap"],
  "youtube:N-cwKhKHiqA": ["Taps & showers", "Replacing the cartridge in a single-lever basin tap"],
  "youtube:l-uWO5awHto": ["Taps & showers", "Replacing the cartridge in a curved basin tap"],
  "youtube:mOntNv72YJc": ["Taps & showers", "Replacing the cartridge in a compact basin tap"],
  "youtube:HnhmCeqgtYo": ["Taps & showers", "Replacing the cartridge in a lever mixer"],
  "youtube:BcTazYK34AM": ["Taps & showers", "Replacing the headworks in monobloc pillar taps"],
  "youtube:mUr_OYRlFJk": ["Taps & showers", "Changing a standard mixer tap cartridge"],
  "youtube:wkBZcx9EHC8": ["Taps & showers", "Changing the cartridge in a monobloc mixer tap"],
  "youtube:of_uMNrgrJg": ["Taps & showers", "Replacing a thermostatic tap cartridge"],
  "youtube:pS7F8rmY25s": ["Taps & showers", "Calibrating a thermostatic cartridge"],
  "youtube:16WXIwJALeM": ["Taps & showers", "Replacing the cartridge in a cast-mineral tap"],
  "youtube:H1VbiqeUMFo": ["Taps & showers", "Replacing the cartridge in a kitchen pillar tap"],
  "youtube:5rvriQVx3lc": ["Taps & showers", "Changing the cartridge in a slimline kitchen tap"],
  "youtube:9Q8wjMQVvDg": ["Taps & showers", "Replacing the cartridge in a pull-out kitchen tap"],
  "youtube:sxPBt-wEys8": ["Taps & showers", "Replacing a concealed tap aerator"],
  "youtube:kkis89TthDQ": ["Taps & showers", "Changing a concealed basin-tap aerator"],
  "youtube:eutnaX9CS4I": ["Taps & showers", "Removing a standard aerator"],
  "youtube:8NPWcgzQ1nE": ["Taps & showers", "Removing a curved-range aerator"],
  "youtube:XoT3cRJUn9s": ["Taps & showers", "Removing a coin-slot aerator"],
  "youtube:klHe4COjWq8": ["Taps & showers", "Swapping a water breaker for an aerator"],
  "youtube:sl6PYf6c12Y": ["Taps & showers", "Stripping and rebuilding a sensor basin tap"],
  "youtube:jB4IMje7xFU": ["Taps & showers", "Installing a mains-powered sensor basin mixer"],
  "youtube:-SihNfGlbDE": ["Taps & showers", "Installing a battery-powered sensor basin mixer"],
  "youtube:6DUt6yybyto": ["Taps & showers", "Installing and commissioning a five-in-one kitchen tap"],
  "youtube:0IpEMieP0Oc": ["Taps & showers", "Changing the water filter in a filtered kitchen tap"],
  "youtube:dV89OQcoxmc": ["Taps & showers", "Changing the CO₂ cylinder in a sparkling-water kitchen tap"],
  "youtube:PxktJmrJhqI": ["Taps & showers", "Running the cleaning cycle on a filtered kitchen tap"],
  "youtube:6X8EyFkk-_Q": ["Taps & showers", "Extra-flat rain shower heads with a safety valve"],
  "youtube:s74cA1FpD-g": ["Taps & showers", "A ceiling-recessed shower head"],
  "youtube:J08STIpsOoo": ["Taps & showers", "Pairing the remote control for a shower head"],
  "youtube:kWXt-6DzPQE": ["Taps & showers", "Using a sanitary shower set correctly"],

  // ---- Concealed and thermostatic valves ---------------------------------
  "youtube:AQnLlcdst8w": ["Shower valves", "Installing a concealed thermostatic valve box"],
  "youtube:uh9aI6sWP3A": ["Shower valves", "Installing a single-outlet concealed valve box"],
  "youtube:wEwwAM12LYg": ["Shower valves", "Installing a multi-outlet concealed valve box"],
  "youtube:YHxaISohNu0": ["Shower valves", "A slimline concealed thermostatic valve"],
  "youtube:eslPkyRBiY0": ["Shower valves", "A recessed slimline thermostatic valve box"],
  "youtube:ao9gyioi0fE": ["Shower valves", "A concealed thermostatic shower valve"],
  "youtube:Hk-uAgYJxeo": ["Shower valves", "Fitting a thermostatic valve with adjustable flow"],
  "youtube:4dB7sXyeOnw": ["Shower valves", "Stripping and rebuilding a thermostatic shower column"],
  "youtube:Mcpzt75_ZG0": ["Shower valves", "Fitting a pressure-balance extension kit"],
  "youtube:KXOuUYJW3SQ": ["Shower valves", "Replacing the cartridges in a concealed shower valve"],

  // ---- Toilets, cisterns and frames --------------------------------------
  "youtube:e-8lpKAdZ3w": ["Toilets & cisterns", "Installing a wall-hung pan"],
  "youtube:QQH4gJEq_zA": ["Toilets & cisterns", "Installing a wall-hung toilet on a concealed frame"],
  "youtube:EwfCrMWLCls": ["Toilets & cisterns", "Installing a square-profile wall-hung toilet"],
  "youtube:pH-SV8OjJ60": ["Toilets & cisterns", "A contemporary wall-hung pan"],
  "youtube:hDa1Oue6ZtI": ["Toilets & cisterns", "Installing a wall-hung toilet on plasterboard and solid walls"],
  "youtube:4yricKxMceY": ["Toilets & cisterns", "Correcting the rock on a wall-hung toilet"],
  "youtube:RMtIISygkA0": ["Toilets & cisterns", "Installing a concealed cistern frame on a solid wall"],
  "youtube:NvAY7YgrydM": ["Toilets & cisterns", "Building a concealed cistern into a solid wall"],
  "youtube:JS74SpQd4Ms": ["Toilets & cisterns", "Installing a one-piece floor-standing toilet"],
  "youtube:8wdljsT7OhE": ["Toilets & cisterns", "Installing a one-piece toilet, step by step"],
  "youtube:1VQWbZ4KdhQ": ["Toilets & cisterns", "Installing a toilet with a rear-inlet cistern"],
  "youtube:CLFxNbuRKrU": ["Toilets & cisterns", "Fitting the mechanism in an accessible one-piece toilet"],
  "youtube:lkDxF1IU2yQ": ["Toilets & cisterns", "Adjusting the push-button rods on a one-piece toilet"],
  "youtube:p3n_S-w_QVY": ["Toilets & cisterns", "Increasing the flush volume on a one-piece toilet"],
  "youtube:-cVS2ZgM88E": ["Toilets & cisterns", "Fitting a dual-flush push button"],
  "youtube:qY1tMe-nr8A": ["Toilets & cisterns", "Replacing the fill valve in a one-piece toilet"],
  "youtube:khersBhfbZE": ["Toilets & cisterns", "Replacing the flush valve in a one-piece toilet"],
  "youtube:M1a1_zQneWY": ["Toilets & cisterns", "Replacing a toilet fill-valve connector"],
  "youtube:2oggmbkDxCY": ["Toilets & cisterns", "Stripping and adjusting a contract cistern flush mechanism"],
  "youtube:jTmgCGGnhzA": ["Toilets & cisterns", "Replacing the valves in a reduced-height concealed cistern"],
  "youtube:P5GlQIJIN8w": ["Toilets & cisterns", "Replacing the flush and fill valves in a cistern frame"],
  "youtube:8_8fllH4GG8": ["Toilets & cisterns", "Setting the flush on a concealed cistern"],
  "youtube:v_oMvVdooJI": ["Toilets & cisterns", "Fitting a concealed cistern flush plate"],
  "youtube:ow2TNX2JQG0": ["Toilets & cisterns", "Fitting the flush plate on a reduced-height frame"],
  "youtube:-DeOmNzQipI": ["Toilets & cisterns", "Fitting an odour-extraction adaptor kit"],
  "youtube:5OKNAr000-g": ["Toilets & cisterns", "Preventing toilet splashing"],
  "vimeo:232316973": ["Toilets & cisterns", "A rimless pan that stays clean"],

  // ---- Toilet seats ------------------------------------------------------
  "youtube:VNTKBb-4Q2w": ["Toilet seats", "Fitting a seat to a wall-hung pan"],
  "youtube:Z5KHrUG9Hb0": ["Toilet seats", "Fitting a slimline toilet seat"],
  "youtube:RKeZgHjxBcU": ["Toilet seats", "Fitting a wrapover toilet seat"],
  "youtube:fswmLSGt6B8": ["Toilet seats", "Fitting a soft-close toilet seat"],
  "youtube:hMY2WVuWlXc": ["Toilet seats", "Fitting a soft-close seat and cover"],
  "youtube:JUS0rzD6274": ["Toilet seats", "Replacing soft-close cartridges in a compact toilet seat"],
  "youtube:6Qj7m7tMAUE": ["Toilet seats", "Replacing soft-close cartridges in a wrapover seat"],
  "vimeo:210220556": ["Toilet seats", "A lift-off seat and cover"],
  "vimeo:572931213": ["Toilet seats", "Soft-close comfort on a toilet lid"],
  "vimeo:277614707": ["Toilet seats", "The advantages of soft close"],

  // ---- Smart bathrooms and sensors ---------------------------------------
  "youtube:iYUc5OiaVRU": ["Smart bathrooms", "How a smart toilet works"],
  "youtube:XC-ux1QuB-Q": ["Smart bathrooms", "How a compact smart toilet works"],
  "youtube:1hJHtk1Y-DM": ["Smart bathrooms", "How a project-spec smart toilet works"],
  "youtube:PaYS1x4xBUo": ["Smart bathrooms", "A smart toilet with advanced comfort functions"],
  "youtube:_ahc457dpuY": ["Smart bathrooms", "Installing a compact smart toilet"],
  "youtube:MgmH34CKYV8": ["Smart bathrooms", "Installing a project-spec smart toilet"],
  "youtube:i6Da4tDNTh4": ["Smart bathrooms", "Removing and refitting a smart toilet seat"],
  "youtube:HZZIFhOW8SM": ["Smart bathrooms", "Removing and refitting a compact smart toilet seat"],
  "youtube:B0z1zbODIcc": ["Smart bathrooms", "Replacing the deodorising cartridge in a smart toilet"],
  "youtube:C2JFz5TeOWg": ["Smart bathrooms", "Replacing the extractor in an odour-extraction frame"],
  "youtube:WAqU3EtG6M4": ["Smart bathrooms", "Replacing the filter in an odour-extraction frame"],
  "youtube:QptQJQfTYTY": ["Smart bathrooms", "A multifunction filtered kitchen tap"],
  "youtube:2ph2bPBc6_s": ["Smart bathrooms", "Installing a sensor flush valve"],
  "youtube:Qf2vvl6amCM": ["Smart bathrooms", "Adjusting the infrared sensor on a urinal"],
  "youtube:ABsv68um7Ic": ["Smart bathrooms", "Avoiding problems with infrared sensors"],
  "youtube:yshzErwP-xY": ["Smart bathrooms", "Using a sensor remote control"],
  "youtube:9WSVvs-y6wk": ["Smart bathrooms", "Using the remote control on a touchless soap dispenser"],
  "vimeo:204496445": ["Smart bathrooms", "An intelligent toilet"],
  "vimeo:1079700266": ["Smart bathrooms", "A filtered kitchen tap, close up"],
  "vimeo:133141481": ["Smart bathrooms", "A bathroom range in augmented reality"],

  // ---- Baths and bath panels ---------------------------------------------
  "youtube:4ZsC5pxFvOM": ["Baths", "Installing a freestanding bath and floor-mounted tap"],
  "youtube:0L61jx69Vyk": ["Baths", "Fitting a bath panel"],
  "youtube:bM2HJ_s2ud4": ["Baths", "Fitting a modular bath panel"],
  "youtube:jVRpvOtInd4": ["Baths", "Removing and refitting a round bath panel"],
  "youtube:6qIsnIrEEX0": ["Baths", "Replacing a bath waste kit"],
  "vimeo:258949450": ["Baths", "Wellness sensations in the bath"],
  "vimeo:335338224": ["Baths", "A whirlpool bath full of sensation"],

  // ---- Shower trays ------------------------------------------------------
  "youtube:RyI2A84boqg": ["Shower trays", "Cutting a shower tray to size"],
  "youtube:37KrN7uyx_s": ["Shower trays", "Repairing a shower tray"],
  "youtube:uSTviCsYDy0": ["Shower trays", "Installing a cast-stone shower tray"],
  "youtube:Gu3POukGLwQ": ["Shower trays", "Installing a mineral-stone shower tray"],

  // ---- Bathroom furniture ------------------------------------------------
  "youtube:CFpXtBc7GNs": ["Bathroom furniture", "Closing the gap between a vanity unit and the wall"],
  "youtube:0b_ITnQRjqc": ["Bathroom furniture", "Adjusting the height of a vanity drawer"],
  "youtube:DiB0UzUHgqs": ["Bathroom furniture", "Removing and refitting a vanity drawer"],
  "youtube:dq1ZHjU3HGM": ["Bathroom furniture", "Setting the runners on a vanity drawer"],
  "youtube:rFEpadYcvS8": ["Bathroom furniture", "Installing a faceted vanity unit"],

  // ---- Heated towel rails ------------------------------------------------
  "youtube:J52JbSwZq-w": ["Heated towel rails", "Bleeding a heated towel rail"],
  "youtube:4D5EUoqE4jc": ["Heated towel rails", "Purging an electric heated towel rail"],
  "youtube:4qyKAZJTLuE": ["Heated towel rails", "How the smart thermostat works"],
  "youtube:GOjcLDoLOXw": ["Heated towel rails", "How the eco thermostat works"],
  "youtube:5c957BLl2og": ["Heated towel rails", "How the programmable thermostat works"],
  "youtube:p-f7XGrPhlU": ["Heated towel rails", "Using the programmable thermostat remote control"],
  "youtube:0IKGDbofAzs": ["Heated towel rails", "Locking and unlocking the thermostat keypad"],

  // ---- Care and maintenance ----------------------------------------------
  "youtube:Nu5DLDYw2XE": ["Bathroom care", "Disinfecting a thermostatic valve with hot water"],
  "youtube:7PmwrHddjP4": ["Bathroom care", "Removing micro-scratches from solid-surface finishes"],
  "youtube:QJJlJL39M_Q": ["Bathroom care", "Polishing cast-mineral baths and basins"],
  "youtube:W8XCd_3amSE": ["Bathroom care", "Repairing a scratch on a transparent resin bath or basin"],
  "youtube:MQ6NfjBQvxo": ["Bathroom care", "Caring for a cast-mineral surface"],
  "youtube:Z16yAhrFRi4": ["Bathroom care", "A care system for bathroom surfaces"],
  "youtube:_xLSHDIn_d4": ["Bathroom care", "Extending the life of a shower head"],
  "youtube:-VWeZ_-6Ldk": ["Bathroom care", "Finding the spare parts list for a product"],

  // ---- Design, collections and brand films -------------------------------
  "vimeo:386662398": ["Bathroom design", "Water as a state of inspiration"],
  "vimeo:253212171": ["Bathroom design", "We create the difference"],
  "vimeo:460085862": ["Bathroom design", "We all need me-time"],
  "vimeo:185444513": ["Bathroom design", "Ceramic, up close"],
  "vimeo:517104225": ["Bathroom design", "Choosing a metal finish in the finish studio"],
  "vimeo:580704558": ["Bathroom design", "A matt black finish"],
  "vimeo:182108031": ["Bathroom design", "Created by water — a sculptural collection"],
  "vimeo:175496153": ["Bathroom design", "Inside the sculptural collection"],
  "vimeo:180139972": ["Bathroom design", "Discovering the sculptural collection"],
  "vimeo:179013445": ["Bathroom design", "A designer collection by an architecture studio"],
  "vimeo:913664252": ["Bathroom design", "An architect on fifteen years of a bathroom collection"],
  "vimeo:291645746": ["Bathroom design", "Upcoming tradition — a designer tap collection"],
  "vimeo:145537538": ["Bathroom design", "A premium collection by a Spanish architect"],
  "vimeo:159379541": ["Bathroom design", "Small designer bathrooms where every centimetre counts"],
  "vimeo:130191619": ["Bathroom design", "A designer on exclusivity in design"],
  "vimeo:130191620": ["Bathroom design", "An architect on architectural tradition"],
  "vimeo:137117242": ["Bathroom design", "The power of a unique design"],
  "vimeo:77968822": ["Bathroom design", "Innovation in Japan"],
  "vimeo:289839297": ["Bathroom design", "A new licensing agreement for packaging"],
  "vimeo:356868879": ["Bathroom design", "Feel with a simple touch — a thermostatic shower column"],
  "youtube:QLUK7xfnV-8": ["Bathroom design", "A seventies-inspired bathroom, with an interior designer"],

  // ---- Showrooms, fairs and projects -------------------------------------
  "vimeo:206024935": ["Showrooms", "Inside the 2017 showroom"],
  "vimeo:254324446": ["Showrooms", "Inside the 2018 showroom"],
  "vimeo:296371223": ["Real projects", "Professional assistance on site"],
  "vimeo:221393100": ["Real projects", "Working with the group's partners"],
  "vimeo:386432643": ["Real projects", "An invitation to the international exhibition"],
  "vimeo:249635784": ["Real projects", "Highlights from the 2018 international exhibition"],
  "vimeo:313752536": ["Real projects", "Highlights from the 26th international exhibition"],
  "vimeo:371192038": ["Real projects", "Bathrooms at a hotel interiors show"],
  "vimeo:356641766": ["Real projects", "At a Paris design fair"],
  "vimeo:547470839": ["Real projects", "On the stand at a Bologna trade fair"],
  "vimeo:129890868": ["Real projects", "An architect on innovation"],

  // ---- Water and energy --------------------------------------------------
  "vimeo:846152297": ["Sustainability", "How much water and energy a shower uses"],
  "vimeo:812405611": ["Sustainability", "A shower system built to save energy"],
  "vimeo:128120121": ["Sustainability", "Cold-water opening taps"],
  "vimeo:310969527": ["Sustainability", "A commitment to water"],
  "vimeo:400917465": ["Sustainability", "Washing hands, saving water"],
  "youtube:pA0M0FM52ZM": ["Sustainability", "Cold-start taps that save energy"],
  "youtube:KwFk21p0NZo": ["Sustainability", "Thirty per cent of production energy from solar"],
};

/**
 * The three films served off the supplier's own origin, mirrored into
 * public/home/real-projects/ by scripts/download-noken-videos.cjs. Written here
 * rather than derived, since a local file carries no oEmbed record to read a
 * title or a still from. Listed first so the rail opens on our own footage.
 */
const SELF_HOSTED = [
  ["Sustainability", "Water as a shared resource", "water-forest"],
  ["Sustainability", "Comparing the energy two showers use", "shower-energy-comparison"],
  ["Bathroom design", "An award-winning sculpted tap and basin", "sculpted-tap-award"],
];

/**
 * maxresdefault only exists for videos uploaded above 720p; asking for one that
 * is not there yields YouTube's grey placeholder rather than a 404, so the card
 * would paint a blank. Checked per id, falling back to hqdefault, which always
 * exists.
 */
async function ytPoster(id) {
  const max = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
  try {
    const r = await fetch(max, { method: "HEAD" });
    if (r.ok) return max;
  } catch {}
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

(async () => {
  const { live } = require(IN);
  const byKey = new Map(live.map((r) => [`${r.kind}:${r.id}`, r]));

  // A live id with no card is a gap in the map above, not a silent drop.
  const missing = live.map((r) => `${r.kind}:${r.id}`).filter((k) => !CARDS[k] && !EXCLUDED[k]);
  if (missing.length) {
    console.log(`WARN ${missing.length} live ids have no card:`);
    for (const k of missing) console.log("   ", k, "—", byKey.get(k).title);
  }

  const films = [];
  for (const [label, title, file] of SELF_HOSTED) {
    films.push({
      label,
      title,
      src: `/home/real-projects/${file}.mp4`,
      poster: `/home/real-projects/posters/${file}.jpg`,
    });
  }

  for (const [key, [label, title]] of Object.entries(CARDS)) {
    const rec = byKey.get(key);
    if (!rec) {
      console.log("SKIP (not live in survey):", key);
      continue;
    }
    films.push(
      rec.kind === "youtube"
        ? { label, title, youtubeId: rec.id, poster: await ytPoster(rec.id) }
        : { label, title, vimeoId: rec.id, poster: rec.thumb || "" },
    );
  }

  const header = `// GENERATED by scripts/build-noken-films.cjs — do not edit by hand.
// Bathroom films surveyed from a supplier site (1,189 English pages; the site
// republishes each page under twelve locale prefixes, which the survey skips),
// filtered to ids that still play, and de-branded — no supplier name and no
// range name, so the cards describe the job rather than the catalogue.
// Three are served from our own origin, mirrored by
// scripts/download-noken-videos.cjs. Re-run the build to refresh.
import type { ProjectFilm } from "@/components/home/RealProjects";

export const NOKEN_FILMS: ProjectFilm[] = ${JSON.stringify(films, null, 2)};
`;
  fs.writeFileSync(OUT, header);

  const tally = {};
  for (const f of films) {
    const k = f.src ? "self-hosted" : f.youtubeId ? "youtube" : "vimeo";
    tally[k] = (tally[k] || 0) + 1;
  }
  console.log(`${films.length} films:`, tally);
  console.log("->", path.relative(path.join(__dirname, ".."), OUT));
})().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
