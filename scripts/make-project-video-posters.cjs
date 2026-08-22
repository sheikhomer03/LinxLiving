/**
 * Poster frames for the homepage project films.
 *
 * The cards paint a lazily-loaded still and only fetch the mp4 once someone
 * hovers or presses play, so these posters are all the section costs on a
 * first visit. Grabbed a couple of seconds in — frame zero is often a fade
 * from black.
 *
 *   node scripts/make-project-video-posters.cjs
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DIR = path.join(__dirname, "..", "public", "home", "real-projects");
const OUT = path.join(DIR, "posters");
const AT_SECONDS = process.env.AT || "2";
const WIDTH = process.env.WIDTH || "560";

const mb = (n) => (n / 1024).toFixed(0) + " KB";

fs.mkdirSync(OUT, { recursive: true });
const videos = fs.readdirSync(DIR).filter((f) => /\.mp4$/i.test(f));
if (!videos.length) {
  console.log("no videos in", path.relative(process.cwd(), DIR));
  process.exit(0);
}

let total = 0;
for (const v of videos) {
  const dest = path.join(OUT, v.replace(/\.mp4$/i, ".jpg"));
  try {
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-ss", AT_SECONDS,
      "-i", path.join(DIR, v),
      "-frames:v", "1",
      "-vf", `scale=${WIDTH}:-2`,
      "-q:v", process.env.QUALITY || "7",
      dest,
    ]);
    const size = fs.statSync(dest).size;
    total += size;
    console.log("poster", mb(size).padStart(8), path.basename(dest));
  } catch (e) {
    console.log("FAIL  ", v, String(e.message).split("\n")[0]);
  }
}
console.log(`\n${videos.length} posters, ${mb(total)} total`);
