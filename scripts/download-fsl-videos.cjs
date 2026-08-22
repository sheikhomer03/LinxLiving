/**
 * Mirror flooringsales.co.uk's self-hosted clips into
 * public/home/real-projects/ so the homepage serves them from our own origin.
 *
 *   node scripts/download-fsl-videos.cjs
 *
 * The site 403s a bare Chrome user agent but serves an identified crawler —
 * same quirk scripts/fsl-session.cjs records.
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "public", "home", "real-projects");
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxVideoAudit/1.0",
};

const VIDEOS = [
  {
    src: "https://www.flooringsales.co.uk/wp-content/uploads/2023/03/return-reward-scheme-video.mov",
    file: "return-reward-scheme.mov",
  },
  {
    src: "https://www.flooringsales.co.uk/wp-content/uploads/2022/06/WhatsApp-Video-2022-06-10-at-3.49.51-PM.mp4",
    file: "save-to-phone-1.mp4",
  },
  {
    src: "https://www.flooringsales.co.uk/wp-content/uploads/2022/06/WhatsApp-Video-2022-06-10-at-3.24.49-PM.mp4",
    file: "save-to-phone-2.mp4",
  },
];

const mb = (n) => (n / 1024 / 1024).toFixed(1) + " MB";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const v of VIDEOS) {
    const dest = path.join(OUT, v.file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log("skip ", mb(fs.statSync(dest).size).padStart(10), v.file);
      continue;
    }
    try {
      const res = await fetch(v.src, { headers: UA });
      if (!res.ok) { console.log("FAIL ", res.status, v.file); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buf);
      console.log("saved", mb(buf.length).padStart(10), v.file);
    } catch (e) {
      console.log("ERR  ", v.file, e.message);
    }
  }
  console.log("->", path.relative(path.join(__dirname, ".."), OUT));
})().catch((e) => { console.error(e.stack); process.exit(1); });
