/**
 * Pull the supplier's self-hosted film into public/home/real-projects/ so the
 * homepage serves it from our own origin instead of hot-linking their CDN.
 *
 *   node scripts/download-natura-videos.cjs
 *   RENDITION=HD-720p-4.5Mbps node scripts/download-natura-videos.cjs
 *
 * naturaflooring.co.uk references exactly one video across its 68 pages — a
 * brand film on the homepage — and it is Shopify-hosted rather than embedded,
 * so it is the one that has to be mirrored. Confirmed by a rendered pass as
 * well as the static scan; see scripts/_tmp-natura-rendered-video.mjs.
 *
 * Shopify publishes the same file at several bitrates. 1080p is taken to match
 * what the folder already holds (protouch-iq.mp4 is 41.7 MB at the same
 * rendition); set RENDITION to trade quality for weight.
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "public", "home", "real-projects");
const RENDITION = process.env.RENDITION || "HD-1080p-7.2Mbps";
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

const VIDEOS = [
  {
    // The brand film in the homepage's wood section.
    src: `https://naturaflooring.co.uk/cdn/shop/videos/c/vp/3636a3fe604b4e06815fcac50020a109/3636a3fe604b4e06815fcac50020a109.${RENDITION}-59797215.mp4`,
    file: "wood-floor-story.mp4",
    /** Their own preview frame, used when ffmpeg is not available. */
    poster:
      "https://naturaflooring.co.uk/cdn/shop/files/preview_images/3636a3fe604b4e06815fcac50020a109.thumbnail.0000000000_1024x.jpg",
  },
];

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

(async () => {
  fs.mkdirSync(path.join(OUT, "posters"), { recursive: true });
  for (const v of VIDEOS) {
    const dest = path.join(OUT, v.file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log("skip ", mb(fs.statSync(dest).size).padStart(10), v.file);
    } else {
      const res = await fetch(v.src, { headers: UA });
      if (!res.ok) {
        console.log("FAIL ", res.status, v.file);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buf);
      console.log("saved", mb(buf.length).padStart(10), v.file);
    }

    // A poster is what the card paints until someone engages, so it must not
    // be skipped even when the mp4 is already there.
    const posterDest = path.join(OUT, "posters", v.file.replace(/\.mp4$/, ".jpg"));
    if (!fs.existsSync(posterDest) && v.poster) {
      const pr = await fetch(v.poster, { headers: UA });
      if (pr.ok) {
        fs.writeFileSync(posterDest, Buffer.from(await pr.arrayBuffer()));
        console.log("poster", mb(fs.statSync(posterDest).size).padStart(9), path.basename(posterDest));
      } else {
        console.log("poster FAIL", pr.status, "— run scripts/make-project-video-posters.cjs instead");
      }
    }
  }
  console.log("->", path.relative(path.join(__dirname, ".."), OUT));
})().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
