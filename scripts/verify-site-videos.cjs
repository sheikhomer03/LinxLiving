/**
 * Check every embed a site scan found and record whether it still plays.
 *
 *   NAME=natura node scripts/verify-site-videos.cjs
 *
 * Reads scripts/<NAME>-video-scan.json (from scan-site-videos.cjs) and writes
 * scripts/_tmp-<NAME>-verified.json, so a film build can re-run without going
 * back to the network.
 *
 * Liveness comes from the thumbnail, not oEmbed: oEmbed 404s under rate
 * limiting as well as for deleted videos, so it cannot tell "gone" from "asked
 * too fast". A dead id serves a tiny grey placeholder at every size and a live
 * one serves a real jpeg — the same test scripts/audit-supplier-videos.cjs
 * uses. The size that answered is recorded too, since asking for maxres where
 * there is none paints a grey 120x90 box on the card.
 *
 * Self-hosted files are checked with a HEAD request instead: a broken link is
 * one that does not answer, or answers with something that is not a video.
 */
const fs = require("fs");
const path = require("path");

const NAME = process.env.NAME;
if (!NAME) throw new Error("Set NAME, e.g. NAME=natura");
const IN = path.join(__dirname, `${NAME}-video-scan.json`);
const OUT = path.join(__dirname, `_tmp-${NAME}-verified.json`);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const RETRIES = Number(process.env.RETRIES || 4);
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

const scan = JSON.parse(fs.readFileSync(IN, "utf8"));

async function mapPool(items, concurrency, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) { const n = i++; await worker(items[n], n); }
    }),
  );
}

/** Live videos serve a real thumbnail; dead ones 404 or serve a placeholder. */
async function ytLive(id) {
  for (const size of ["maxresdefault", "hqdefault"]) {
    try {
      const r = await fetch(`https://i.ytimg.com/vi/${id}/${size}.jpg`, { headers: UA });
      if (!r.ok) continue;
      if (Number(r.headers.get("content-length") || 0) > 2000) return size;
    } catch { /* try the next size */ }
  }
  return null;
}

async function ytTitle(id) {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
      { headers: UA },
    );
    if (r.ok) return (await r.json()).title || "";
  } catch { /* an unnamed film is survivable; a dead one is not */ }
  return "";
}

async function vimeoMeta(id) {
  try {
    const r = await fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${id}`, { headers: UA });
    if (!r.ok) return null;
    const j = await r.json();
    return { title: j.title || "", thumbnail: j.thumbnail_url || "" };
  } catch { return null; }
}

/**
 * A self-hosted file is live if it answers and says it is a video.
 *
 * Retried, and asked twice by two methods, because "did not answer" is not the
 * same as "is not there". britmet.co.uk connect-times-out under any sustained
 * load and serves its media through a case-correcting redirect
 * (Liteslate-3-Way-2.mp4 -> liteslate-3-way-2.mp4); an unretried single HEAD
 * called that file dead when it answers 206 video/mp4 perfectly well. A false
 * negative here silently drops a real video, which is worse than a slow check.
 */
async function fileLive(url, attempt = 0) {
  for (const method of ["GET", "HEAD"]) {
    try {
      const r = await fetch(url, {
        method,
        // Range keeps a GET probe cheap on a 40 MB file.
        headers: method === "GET" ? { ...UA, Range: "bytes=0-2000" } : UA,
        redirect: "follow",
      });
      if (!r.ok && r.status !== 206) continue;
      const type = r.headers.get("content-type") || "";
      const range = r.headers.get("content-range") || "";
      const size = Number(range.split("/")[1] || r.headers.get("content-length") || 0);
      if (/video|octet-stream|mp4|webm/i.test(type) || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(r.url)) {
        return { type, size, url: r.url };
      }
    } catch { /* try the other method, then back off and retry */ }
  }
  if (attempt < RETRIES) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return fileLive(url, attempt + 1);
  }
  return null;
}

(async () => {
  const rows = scan.summary;
  const out = { base: scan.base, youtube: [], vimeo: [], file: [] };
  let done = 0;

  await mapPool(rows, CONCURRENCY, async (r) => {
    const common = { contentPages: r.contentPages, productPages: r.productPages, page: r.pages[0] };
    if (r.kind === "youtube") {
      const id = r.ref.split(":")[1];
      const poster = await ytLive(id);
      const title = poster ? await ytTitle(id) : "";
      out.youtube.push({ id, live: Boolean(poster), poster, title, ...common });
    } else if (r.kind === "vimeo") {
      const id = r.ref.split(":")[1];
      const meta = await vimeoMeta(id);
      out.vimeo.push({ id, live: Boolean(meta), title: meta?.title || "", thumbnail: meta?.thumbnail || "", ...common });
    } else if (r.kind === "file") {
      const info = await fileLive(r.ref);
      // `resolved` is what actually answered — the host may correct the case
      // or move the path — and is what a mirror script should fetch.
      out.file.push({
        url: r.ref,
        resolved: info?.url || r.ref,
        live: Boolean(info),
        bytes: info?.size || 0,
        type: info?.type || "",
        ...common,
      });
    }
    if (++done % 25 === 0) console.log(`  ${done}/${rows.length}`);
  });

  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  const tally = (list) => `${list.filter((v) => v.live).length}/${list.length}`;
  console.log(`\nyoutube: ${tally(out.youtube)} still play`);
  console.log(`vimeo:   ${tally(out.vimeo)} still play`);
  console.log(`files:   ${tally(out.file)} reachable`);
  const mb = out.file.filter((f) => f.live).reduce((a, f) => a + f.bytes, 0) / 1024 / 1024;
  if (out.file.length) console.log(`         ${mb.toFixed(1)} MB to mirror`);
  console.log("->", path.relative(path.join(__dirname, ".."), OUT));
})().catch((e) => { console.error(e.stack); process.exit(1); });
