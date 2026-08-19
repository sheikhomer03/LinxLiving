/**
 * Index every image in RAK's public "Sanitaryware Data Cube 2026" Drive folder.
 *
 * RAK ship no image URLs with the price list — the pictures live in a shared
 * Drive tree (Range → Cut Outs / Lifestyle / Technical → …) whose files are
 * named by product code: "RAKWTN60BAS1.jpg", and combination shots naming every
 * code in the scene, "RAKWBU60500 - RAKWTN60BAS1.jpg". So the only way to pair
 * a picture with a row of the spreadsheet is to walk the whole tree and read the
 * filenames.
 *
 * No Drive API credentials are needed, and deliberately so: `embeddedfolderview`
 * renders a public folder as plain HTML, which is all a read of a shared folder
 * requires. Output is a manifest the importer consumes, so the crawl runs once
 * rather than on every import attempt.
 *
 *   node scripts/crawl-rak-drive-images.cjs
 *
 *   ROOT=<folderId>   crawl a different folder (default: the RAK data cube)
 *   OUT=<path>        manifest location
 *   CONCURRENCY=6     folders fetched at once
 */
const fs = require("fs");
const path = require("path");

const ROOT = String(
  process.env.ROOT || "1MMQXK1t_qapmLY7SHYA44KJBBatBnii3",
).trim();
const OUT = process.env.OUT
  ? path.resolve(process.env.OUT)
  : path.join(__dirname, "rak-drive-manifest.json");
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 6);

const IMAGE_EXT = /\.(jpe?g|png|webp|tiff?|gif)$/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|dwg|zip)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One folder's children. Drive answers with the same markup for every folder,
 * so entries are told apart by the link target: a folder links to
 * /drive/folders/<id>, a file to /file/d/<id>/view.
 */
async function listFolder(id, attempt = 1) {
  const url = `https://drive.google.com/embeddedfolderview?id=${id}#list`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 LinxRakDriveCrawler/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const entries = [];
    const re =
      /<div class="flip-entry" id="entry-([^"]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g;
    let m;
    while ((m = re.exec(html))) {
      entries.push({
        id: m[1],
        kind: m[2].includes("/drive/folders/") ? "folder" : "file",
        name: m[3]
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .trim(),
      });
    }
    return entries;
  } catch (error) {
    // Drive rate-limits a crawl of this size; a folder that comes back empty
    // because of it would silently lose a whole range's pictures, so failures
    // are retried before being reported.
    if (attempt >= 4) throw error;
    await sleep(1500 * attempt);
    return listFolder(id, attempt + 1);
  }
}

async function main() {
  const queue = [{ id: ROOT, trail: [] }];
  const files = [];
  const folders = [];
  const errors = [];
  let visited = 0;

  while (queue.length) {
    const batch = queue.splice(0, CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (node) => {
        try {
          return { node, entries: await listFolder(node.id) };
        } catch (error) {
          errors.push({ folder: node.trail.join("/"), id: node.id, error: error.message });
          return { node, entries: [] };
        }
      }),
    );

    for (const { node, entries } of results) {
      visited++;
      folders.push({ id: node.id, trail: node.trail });
      for (const entry of entries) {
        if (entry.kind === "folder") {
          queue.push({ id: entry.id, trail: [...node.trail, entry.name] });
        } else {
          files.push({
            id: entry.id,
            name: entry.name,
            trail: node.trail,
            type: IMAGE_EXT.test(entry.name)
              ? "image"
              : DOC_EXT.test(entry.name)
                ? "document"
                : "other",
          });
        }
      }
    }

    if (visited % 30 === 0 || !queue.length) {
      console.log(
        `  visited ${visited} folders · ${queue.length} queued · ${files.length} files`,
      );
    }
  }

  const manifest = {
    root: ROOT,
    crawledAt: new Date().toISOString(),
    folders: folders.length,
    files,
    errors,
  };
  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));

  const byType = files.reduce((acc, f) => {
    acc[f.type] = (acc[f.type] || 0) + 1;
    return acc;
  }, {});
  console.log(`\nFolders crawled: ${folders.length}`);
  console.log(`Files: ${files.length}`, byType);
  if (errors.length) console.log(`Folders that failed: ${errors.length}`);
  console.log(`Manifest: ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
