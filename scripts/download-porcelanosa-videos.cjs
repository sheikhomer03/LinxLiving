/**
 * Mirror porcelanosa.com's self-hosted films into public/home/real-projects/.
 *
 *   node scripts/download-porcelanosa-videos.cjs
 *
 * Their masters are big — 318 MB across 18 files, one of them 56 MB — so
 * anything over BIG_MB is re-encoded to 720p on the way in. A homepage cannot
 * carry the originals, and the section only ever shows a poster until someone
 * presses play anyway.
 *
 * Five files referenced by /en/news/ (landing/news/rcs/*-Showroom-1080.mp4)
 * are skipped: they 404 on their own site under every path variant tried,
 * while the structurally identical landing/cualidades/rcs/* files serve fine.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BASE = "https://www.porcelanosa.com";
const OUT = path.join(__dirname, "..", "public", "home", "real-projects");
const POSTERS = path.join(OUT, "posters");
const TMP = path.join(__dirname, "_tmp-porc-dl");
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LinxVideoAudit/1.0",
};
const BIG_MB = Number(process.env.BIG_MB || 12);
const mb = (n) => (n / 1048576).toFixed(1) + " MB";

/** source path → local filename, brand-free and descriptive. */
const VIDEOS = [
  ["recursos/virtual/virtual-showroom-porcelanosa.mp4", "virtual-showroom-tour.mp4"],
  ["recursos/virtual/virtual-showroom-xtone.mp4", "virtual-showroom-stone.mp4"],
  ["recursos/videos/2026-07-summer-dreams-porcelanosa-1080.mp4", "summer-dreams-campaign.mp4"],
  ["recursos/videos/video_solidker_1080.mp4", "solid-surface-collection.mp4"],
  ["recursos/videos/porcelanosa_eco_en_1080.mp4", "sustainability-overview.mp4"],
  ["recursos/videos/porcelanosa_eco_air_540.mp4", "sustainability-air.mp4"],
  ["recursos/videos/porcelanosa_eco_energy_540.mp4", "sustainability-energy.mp4"],
  ["recursos/videos/porcelanosa_eco_water_540.mp4", "sustainability-water.mp4"],
  ["recursos/videos/porcelanosa_eco_nature_540.mp4", "sustainability-nature.mp4"],
  ["recursos/videos/porcelanosa_eco_recycling_540.mp4", "sustainability-recycling.mp4"],
  ["recursos/porcelanosa-grupo/porcelanosa_grupo.hero.mp4", "group-overview.mp4"],
  ["recursos/videos/offsite_lite-720.mp4", "offsite-construction.mp4"],
  ["landing/cualidades/rcs/master-cualidades-en.mp4", "material-qualities.mp4"],
  ["landing/cualidades/rcs/cambio-temperatura-en.mp4", "quality-temperature-change.mp4"],
  ["landing/cualidades/rcs/calidos-en.mp4", "quality-warmth.mp4"],
  ["landing/cualidades/rcs/alto-transito-en.mp4", "quality-heavy-traffic.mp4"],
  ["/trendbook/app/uploads/2019/01/1204363923.mp4", "trendbook-film-1.mp4"],
  ["/trendbook/app/uploads/2019/04/TRAILER-MARÇ-ONLINE_v2-1.mp4", "trendbook-trailer.mp4"],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(POSTERS, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  let got = 0, skipped = 0, failed = 0, before = 0, after = 0;

  for (const [src, file] of VIDEOS) {
    const dest = path.join(OUT, file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      skipped++; after += fs.statSync(dest).size;
      console.log("skip  ", mb(fs.statSync(dest).size).padStart(9), file);
      continue;
    }
    const url = /^https?:/.test(src) ? src : `${BASE}/${src.replace(/^\//, "")}`;
    try {
      const res = await fetch(encodeURI(url), { headers: UA });
      if (!res.ok) { failed++; console.log("FAIL  ", res.status, file); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      before += buf.length;

      if (buf.length > BIG_MB * 1048576) {
        const raw = path.join(TMP, file);
        fs.writeFileSync(raw, buf);
        execFileSync("ffmpeg", [
          "-y", "-loglevel", "error", "-i", raw,
          "-vf", "scale='min(1280,iw)':-2",
          "-c:v", "libx264", "-preset", "medium", "-crf", "26",
          "-movflags", "+faststart", "-c:a", "aac", "-b:a", "96k",
          dest,
        ]);
        fs.rmSync(raw, { force: true });
        const size = fs.statSync(dest).size;
        after += size;
        console.log("shrunk", mb(size).padStart(9), file, `(from ${mb(buf.length)})`);
      } else {
        fs.writeFileSync(dest, buf);
        after += buf.length;
        console.log("saved ", mb(buf.length).padStart(9), file);
      }
      got++;
    } catch (e) {
      failed++;
      console.log("ERR   ", file, e.message);
    }
  }

  // Poster per video, a few seconds in to clear any fade from black.
  let posters = 0;
  for (const [, file] of VIDEOS) {
    const v = path.join(OUT, file);
    if (!fs.existsSync(v)) continue;
    const p = path.join(POSTERS, file.replace(/\.mp4$/i, ".jpg"));
    if (fs.existsSync(p)) { posters++; continue; }
    try {
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error", "-ss", process.env.AT || "4",
        "-i", v, "-frames:v", "1", "-vf", "scale=560:-2", "-q:v", "7", p,
      ]);
      posters++;
    } catch { /* leave it out rather than ship a broken poster */ }
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\ndownloaded ${got}, already present ${skipped}, failed ${failed}`);
  console.log(`source ${mb(before)} -> stored ${mb(after)} | posters ${posters}`);
})().catch((e) => { console.error(e.stack); process.exit(1); });
