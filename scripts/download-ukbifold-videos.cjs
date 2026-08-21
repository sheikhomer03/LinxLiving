/**
 * Pull the supplier's self-hosted films into public/home/real-projects/ so the
 * homepage serves them from our own origin instead of hot-linking their host.
 *
 *   node scripts/download-ukbifold-videos.cjs
 *
 * ukbifolddoorfactory.co.uk references three videos and hosts all three
 * itself; none are embedded. Two of the three are the same file uploaded
 * twice — 2023/03 and 2023/07 are both 28,703,957 bytes with an identical
 * hash — so it is mirrored once and shown once.
 *
 * The URLs point at ukbifold.wpengine.com, the WP Engine origin behind the
 * public domain, because that is what the pages themselves reference.
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

/**
 * `posterAt` is per film and deliberately late.
 *
 * Both open on a full-screen manufacturer logo card, so the usual two-second
 * grab produced a poster that was a white rectangle with a supplier's badge on
 * it — the one thing a card in this rail must not show. These timestamps land
 * on the product instead: the door against a landscape, and the hinge detail.
 */
const VIDEOS = [
  {
    src: "https://ukbifold.wpengine.com/wp-content/uploads/2023/07/Cor-Vision-Plus-English-version.mp4",
    file: "panoramic-sliding-door.mp4",
    posterAt: "20",
    // Also referenced from the 2023/03 path on the sliding-door page; same file.
    page: "https://www.ukbifolddoorfactory.co.uk/cor-vision-plus-panoramic-sliding-door/",
  },
  {
    src: "https://ukbifold.wpengine.com/wp-content/uploads/2023/03/Arch-invisible-The-first-invisible-opening-system-in-the-market.mp4",
    file: "hidden-sash-window.mp4",
    posterAt: "35",
    page: "https://www.ukbifolddoorfactory.co.uk/hidden-sash-tilt-turn/",
  },
];

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function fetchRetrying(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: UA, redirect: "follow" });
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

    const posterDest = path.join(OUT, "posters", v.file.replace(/\.mp4$/, ".jpg"));
    if (!fs.existsSync(posterDest)) {
      try {
        execFileSync("ffmpeg", [
          "-y", "-loglevel", "error",
          "-ss", process.env.AT || v.posterAt || "3",
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
