/**
 * Pull the supplier's self-hosted film into public/home/real-projects/ so the
 * homepage serves it from our own origin instead of hot-linking their site.
 *
 *   node scripts/download-britmet-videos.cjs
 *
 * britmet.co.uk references 69 videos across 449 pages; 68 are YouTube embeds
 * and this is the only file it hosts itself.
 *
 * The URL is the lower-cased one. Their server answers the mixed-case path in
 * the page markup with a 301 to this, and it connect-times-out often enough
 * that a single unretried request reported the file as missing — see the note
 * on fileLive() in scripts/verify-site-videos.cjs.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "..", "public", "home", "real-projects");
const RETRIES = Number(process.env.RETRIES || 5);
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

const VIDEOS = [
  {
    src: "https://www.britmet.co.uk/images/videos/products/liteslate-3-way-2.mp4",
    file: "lightweight-slate-panels.mp4",
    page: "https://www.britmet.co.uk/liteslate.asp",
  },
];

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function fetchRetrying(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { ...UA, Referer: "https://www.britmet.co.uk/" }, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e) {
    if (attempt >= RETRIES) throw e;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return fetchRetrying(url, attempt + 1);
  }
}

(async () => {
  fs.mkdirSync(path.join(OUT, "posters"), { recursive: true });
  for (const v of VIDEOS) {
    const dest = path.join(OUT, v.file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log("skip ", mb(fs.statSync(dest).size).padStart(10), v.file);
    } else {
      const res = await fetchRetrying(v.src);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buf);
      console.log("saved", mb(buf.length).padStart(10), v.file);
    }

    // No preview frame is published for this one, so the poster is grabbed a
    // couple of seconds in — frame zero is often a fade from black.
    const posterDest = path.join(OUT, "posters", v.file.replace(/\.mp4$/, ".jpg"));
    if (!fs.existsSync(posterDest)) {
      try {
        execFileSync("ffmpeg", [
          "-y", "-loglevel", "error",
          "-ss", process.env.AT || "2",
          "-i", dest,
          "-frames:v", "1",
          "-vf", "scale=560:-2",
          "-q:v", "7",
          posterDest,
        ]);
        console.log("poster", mb(fs.statSync(posterDest).size).padStart(9), path.basename(posterDest));
      } catch (e) {
        console.log("poster FAIL —", String(e.message).split("\n")[0]);
      }
    }
  }
  console.log("->", path.relative(path.join(__dirname, ".."), OUT));
})().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
