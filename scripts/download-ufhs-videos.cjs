/**
 * Pull the supplier's self-hosted film into public/home/real-projects/ so the
 * homepage serves it from our own origin instead of hot-linking their CDN.
 *
 * The rest of the section's videos are YouTube and stay embedded.
 *
 *   node scripts/download-ufhs-videos.cjs
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "public", "home", "real-projects");
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

const VIDEOS = [
  {
    // Runs on the supplier's homepage, /pages/protouch-iq and
    // /collections/thermostats — their ProTouch IQ thermostat film.
    src: "https://www.theunderfloorheatingstore.com/cdn/shop/videos/c/vp/97cbc154447e4cebbbf6189169f94ed1/97cbc154447e4cebbbf6189169f94ed1.HD-1080p-7.2Mbps-56663797.mp4",
    file: "protouch-iq.mp4",
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
    const res = await fetch(v.src, { headers: UA });
    if (!res.ok) { console.log("FAIL ", res.status, v.file); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log("saved", mb(buf.length).padStart(10), v.file);
  }
  console.log("->", path.relative(path.join(__dirname, ".."), OUT));
})().catch((e) => { console.error(e.stack); process.exit(1); });
