/**
 * Re-cut the homepage film posters onto a frame that carries no supplier name.
 *
 *   node scripts/refresh-film-posters.cjs            # report only
 *   node scripts/refresh-film-posters.cjs --apply
 *
 * A card in the Real projects rail shows its poster until someone presses
 * play, so the poster is the frame most people actually see. The films were
 * de-branded by scripts/replace-film-wordmark.cjs, but a name filmed on
 * location — a showroom sign, print on a pallet — stays in the picture, and
 * the downloader's fixed four-second grab can land straight on one.
 *
 * So rather than a fixed offset, each poster is cut from the first candidate
 * frame that Vision reads no supplier name in. Same size and quality as
 * scripts/download-porcelanosa-videos.cjs, which still makes the first cut.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const FILMS = path.join(ROOT, "public", "home", "real-projects");
const POSTERS = path.join(FILMS, "posters");
const SWIFT = path.join(__dirname, "wordmark");
const { BRAND_TERMS } = require("./wordmark/brands.cjs");
const TERMS = BRAND_TERMS.join(",");
/** The downloader's offset comes first; the rest are fallbacks. */
const CANDIDATES = [4, 6, 8, 10, 13, 16, 20, 25, 30, 2];
/** Failing all of those, walk the film at this interval. */
const SWEEP = 2;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
/**
 * Re-cut even when the poster on disk reads clean.
 *
 * That check runs on the 560px still, where a distant sign is below what
 * Vision can read — so a poster can pass it and still plainly show the name.
 * Use --force for any film known to carry one.
 */
const FORCE = argv.includes("--force");
const named = argv.filter((a) => !a.startsWith("--"));

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { maxBuffer: 1 << 28, ...opts });

const BIN = fs.mkdtempSync(path.join(os.tmpdir(), "poster-bin-"));
const OCR = path.join(BIN, "ocr");
sh("swiftc", ["-O", "-o", OCR, path.join(SWIFT, "ocr.swift")]);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "poster-"));
const reads = (file) =>
  sh(OCR, [TERMS], { input: file }).toString().split("\n")
    .some((r) => r.split("\t")[2] === "match");

/** Cut one frame at `time`, at the poster's size and quality. */
function cut(film, time, out) {
  sh("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(time), "-i", film,
    "-frames:v", "1", "-vf", "scale=560:-2", "-q:v", "7", out]);
}

/**
 * Whether a frame is free of the name — judged at full resolution.
 *
 * A poster is 560px wide, and at that size a name on a showroom wall is too
 * small for Vision to read. Checking the downscaled still passed two frames
 * that plainly show it, so the check gets the whole frame.
 */
function frameIsClean(film, time, probe) {
  sh("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(time), "-i", film,
    "-frames:v", "1", "-q:v", "2", probe]);
  return !reads(probe);
}

const posters = (named.length ? named : fs.readdirSync(POSTERS))
  .filter((f) => f.endsWith(".jpg"))
  .sort();

let clean = 0, recut = 0, stuck = 0;
for (const name of posters) {
  const poster = path.join(POSTERS, name);
  const film = path.join(FILMS, name.replace(/\.jpg$/i, ".mp4"));
  if (!fs.existsSync(film)) continue;

  // A poster that already reads clean is left exactly as it is — no point
  // re-encoding 25 stills to replace them with the same picture.
  if (!FORCE && !reads(poster)) { clean++; continue; }

  const at4 = path.join(work, name);
  const probe = path.join(work, `probe-${name}`);
  if (frameIsClean(film, CANDIDATES[0], probe)) {
    cut(film, CANDIDATES[0], at4);
    console.log(`${name}: re-cut at 4s (the film no longer shows the name there)`);
    if (APPLY) fs.copyFileSync(at4, poster);
    recut++;
    continue;
  }

  const duration = Number(sh("ffprobe", ["-v", "error", "-show_entries",
    "format=duration", "-of", "default=nw=1:nk=1", film]).toString());
  const sweep = [];
  for (let t = 1; t < duration - 0.5; t += SWEEP) sweep.push(t);
  const found = [...CANDIDATES.slice(1), ...sweep].find(
    (t) => t < duration - 0.5 && frameIsClean(film, t, probe),
  );
  if (found !== undefined) cut(film, found, at4);

  if (found === undefined) {
    console.log(`${name}: no clean frame among candidates, left alone`);
    stuck++;
    continue;
  }
  console.log(`${name}: re-cut at ${found}s (4s still shows the name)`);
  if (APPLY) fs.copyFileSync(at4, poster);
  recut++;
}

fs.rmSync(work, { recursive: true, force: true });
fs.rmSync(BIN, { recursive: true, force: true });
console.log(`\n${clean} already clean, ${recut} re-cut, ${stuck} with no clean frame`);
if (!APPLY) console.log("report only — pass --apply to write the posters");
