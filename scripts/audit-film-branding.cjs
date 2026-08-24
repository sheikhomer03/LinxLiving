/**
 * Which homepage films still show a supplier's name.
 *
 *   node scripts/audit-film-branding.cjs
 *   node scripts/audit-film-branding.cjs --json   # just the names, for a filter
 *
 * scripts/replace-film-wordmark.cjs replaces a name laid over a flat card, and
 * deliberately leaves one that is part of the scene — lettered on a building,
 * printed on a pallet, inside the supplier's own app. This says which films are
 * in the second category, by reading every frame back.
 *
 * That list is the basis for what the rail carries: a film earns its place by
 * having no supplier name readable in it. Re-run this after changing the films
 * or scripts/wordmark/brands.cjs, and update STILL_BRANDED in RealProjects.tsx
 * to match.
 *
 * Embedded films (YouTube, Vimeo) cannot be audited or fixed — they play from
 * the supplier's own servers — so they are counted and skipped.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { BRAND_TERMS } = require("./wordmark/brands.cjs");

const ROOT = path.join(__dirname, "..");
const FILMS = path.join(ROOT, "public", "home", "real-projects");
const SOURCES = [
  "src/components/home/RealProjects.tsx",
  "src/components/home/realProjectsFilms.ts",
  "src/components/home/fakroFilms.ts",
  "src/components/home/britmetFilms.ts",
  "src/components/home/nokenFilms.ts",
  "src/components/home/pookyFilms.ts",
];
const JSON_ONLY = process.argv.includes("--json");
const RATE = 1;

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { maxBuffer: 1 << 28, ...opts });

const bin = fs.mkdtempSync(path.join(os.tmpdir(), "film-audit-"));
const ocr = path.join(bin, "ocr");
sh("swiftc", ["-O", "-o", ocr, path.join(__dirname, "wordmark", "ocr.swift")]);

/** Every film the rail references, by how it is hosted. */
function railFilms() {
  const seen = new Set();
  const selfHosted = [];
  let embedded = 0;
  for (const rel of SOURCES) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const m of text.matchAll(/"?(src|youtubeId|vimeoId)"?:\s*(?:encodeURI\()?"([^"]+)"/g)) {
      const [, kind, value] = m;
      if (seen.has(value)) continue;
      seen.add(value);
      if (kind !== "src") { embedded++; continue; }
      const name = path.basename(value.split("?")[0]).replace(/\.mp4$/i, "");
      const file = path.join(FILMS, `${name}.mp4`);
      if (fs.existsSync(file)) selfHosted.push({ name, file });
    }
  }
  return { selfHosted, embedded };
}

const { selfHosted, embedded } = railFilms();
const terms = BRAND_TERMS.join(",");
const branded = [];

for (const { name, file } of selfHosted) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "film-frames-"));
  sh("ffmpeg", ["-v", "error", "-i", file, "-vf", `fps=${RATE}`, "-q:v", "2",
    path.join(work, "%05d.jpg"), "-y"]);
  const frames = fs.readdirSync(work).filter((f) => f.endsWith(".jpg")).sort();
  const out = sh(ocr, [terms], {
    input: frames.map((f) => path.join(work, f)).join("\n"),
  }).toString();
  const found = new Map();
  for (const row of out.split("\n")) {
    const cols = row.split("\t");
    if (cols[2] !== "match") continue;
    const term = cols[9];
    found.set(term, (found.get(term) || 0) + 1);
  }
  fs.rmSync(work, { recursive: true, force: true });
  if (found.size) branded.push({ name, names: Object.fromEntries(found) });
  if (!JSON_ONLY) {
    const summary = found.size
      ? [...found].map(([t, n]) => `${t}x${n}`).join(", ")
      : "clean";
    console.log(`  ${name.padEnd(30)} ${summary}`);
  }
}

fs.rmSync(bin, { recursive: true, force: true });

if (JSON_ONLY) {
  console.log(JSON.stringify(branded.map((b) => b.name), null, 2));
} else {
  const clean = selfHosted.length - branded.length;
  console.log(`\n${selfHosted.length} self-hosted films: ${clean} clean, ${branded.length} still showing a name`);
  console.log(`${embedded} embedded films cannot be audited or changed — they play from the supplier's servers`);
}
