/**
 * Downscale AlunoTec's Palora P6 photography for the web.
 *
 * The supplier shipped 3840×2880 renders at ~20MB each — 217MB across 17
 * files. Cloudinary rejects uploads that large on our plan and no PDP wants a
 * 20MB hero, so they are resized to 2000px wide first. ffmpeg does the work
 * because nothing in the repo ships an image library.
 *
 * The small renders lifted out of the price-list PDFs are already web-sized
 * and are copied through untouched.
 *
 *   node scripts/prepare-alunotec-images.cjs
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PHOTOS = path.join(
  ROOT,
  "public",
  "AlunoTec-Cassette-Awning",
  "TransferNow-20260804megQEXGg",
);
const OUT = path.join(ROOT, "public", "alunotec", "web");

const FFMPEG = ["ffmpeg", "/c/ffmpeg/bin/ffmpeg", "C:\\ffmpeg\\bin\\ffmpeg.exe"].find(
  (candidate) => {
    try {
      execFileSync(candidate, ["-version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  },
);
if (!FFMPEG) throw new Error("ffmpeg not found — needed to resize the supplier renders");

/** Supplier filenames carry the configuration; keep it, drop the spaces. */
function slugify(name) {
  return name
    .replace(/\.jpe?g$/i, "")
    .replace(/[×x]/g, "x")
    .replace(/&/g, "-and-")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(PHOTOS).filter((f) => /\.jpe?g$/i.test(f));
console.log(`Resizing ${files.length} supplier render(s) → ${path.relative(ROOT, OUT)}`);

for (const file of files) {
  const src = path.join(PHOTOS, file);
  const dest = path.join(OUT, `${slugify(file)}.jpg`);
  execFileSync(
    FFMPEG,
    ["-y", "-loglevel", "error", "-i", src, "-vf", "scale=2000:-1", "-q:v", "4", dest],
    { stdio: "inherit" },
  );
  const before = Math.round(fs.statSync(src).size / 1024 / 1024);
  const after = Math.round(fs.statSync(dest).size / 1024);
  console.log(`  ${path.basename(dest)}  ${before}MB → ${after}KB`);
}

console.log("\nDone.");
