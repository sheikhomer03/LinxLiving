/**
 * Pull the bathroom supplier's self-hosted films into public/home/real-projects/
 * so the homepage serves them from our own origin instead of hot-linking theirs.
 *
 *   node scripts/download-noken-videos.cjs
 *
 * noken.com is a WordPress site that embeds almost everything — 129 YouTube
 * how-to clips and 46 Vimeo brand films across its 1,189 English pages, all of
 * which stay embedded. Only three files are served off their own origin, and
 * those are the ones mirrored here. Surveyed by
 * scripts/_tmp-noken-video-scan.cjs.
 *
 * The energy film is their own re-host of a Vimeo original (the id is in the
 * filename); the mirrored copy is used and the Vimeo duplicate is dropped in
 * scripts/build-noken-films.cjs, so the rail plays it off our origin.
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "public", "home", "real-projects");
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://www.noken.com/",
};

const VIDEOS = [
  {
    // The looping background film on their water-conservation page.
    src: "https://www.noken.com/wp-content/themes/noken/images/video-waterforest.mp4",
    file: "water-forest.mp4",
  },
  {
    // Sits in a blog piece on wellness showers; their own copy of Vimeo 816537142.
    src: "https://www.noken.com/wp-content/uploads/2024/07/Noken_Energy_comparativa-vimeo-816537142-hls-akfire_interconnect_quic-2508.mp4",
    file: "shower-energy-comparison.mp4",
  },
  {
    // The design-award film for their cast-mineral basin and tap series.
    src: "https://www.noken.com/wp-content/uploads/2024/03/SWAN_PREMIO.mp4",
    file: "sculpted-tap-award.mp4",
  },
];

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

(async () => {
  fs.mkdirSync(path.join(OUT, "posters"), { recursive: true });
  for (const v of VIDEOS) {
    const dest = path.join(OUT, v.file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log("skip ", mb(fs.statSync(dest).size).padStart(10), v.file);
      continue;
    }
    const res = await fetch(v.src, { headers: UA });
    if (!res.ok) {
      console.log("FAIL ", res.status, v.file);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log("saved", mb(buf.length).padStart(10), v.file);
  }
  // Posters are grabbed by scripts/make-project-video-posters.cjs — none of
  // the three ships a still of its own.
  //
  // That script samples at two seconds, which is wrong for the energy film:
  // it opens on a near-flat title card, and the frame it takes there weighs
  // 2 KB against the 14 KB of a real one. Re-run it for that file with AT=14,
  // or the card paints an almost-blank panel:
  //
  //   AT=14 node scripts/make-project-video-posters.cjs
  console.log("->", path.relative(path.join(__dirname, ".."), OUT));
})().catch((e) => { console.error(e.stack); process.exit(1); });
