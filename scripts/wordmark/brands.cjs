/**
 * The supplier names burnt into the films we host ourselves.
 *
 * Read off the films rather than guessed: every frame of every self-hosted
 * film was OCR'd and this is what came back. It is not the brand table — most
 * of those never appear on screen, and several of these are ranges rather
 * than brands (butech, krion, urbatek, xtone are PORCELANOSA's; taurus is a
 * flooring range) — so it is maintained by re-running the search, not by
 * copying src/models/Brand.
 *
 * Deliberately absent: "otto". It is a substring of "BOTTOM FRAME", which is
 * on screen in panoramic-sliding-door, and the reader matches inside words on
 * purpose. Any name that hides inside an ordinary word has to be left out.
 *
 * Shared by scripts/replace-film-wordmark.cjs, which replaces these, and
 * scripts/refresh-film-posters.cjs, which picks a poster frame free of them.
 */
module.exports.BRAND_TERMS = [
  "porcelanosa",
  "cortizo",
  "britmet",
  "noken",
  "prowarm",
  "butech",
  "gamadecor",
  "krion",
  "urbatek",
  "xtone",
  "starwood",
  "taurus",
  "flooringsales.co.uk",
];
