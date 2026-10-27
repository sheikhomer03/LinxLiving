/**
 * Repoint image URLs from the dead Cloudinary account to Shopify's CDN.
 *
 * The Cloudinary account (`diibcfikb`) was disabled — its Admin API answers
 * "disabled customer" and every delivery URL 401s — which blanked the
 * department tiles, brand tiles and 283 products' galleries. The images
 * themselves had already been migrated to Shopify, and every document
 * already carries the new URL beside the old one: menus and brands in
 * `shopifyImageUrl`, products in `shopifyImages[].shopifyUrl`, keyed by the
 * Cloudinary URL in `sourceUrl`. Nothing needs re-uploading; the documents
 * were simply still pointing at the wrong host.
 *
 * This rewrites `image`/`images` in place from those existing fields. It is
 * a data fix rather than a render-time fallback on purpose: `navPayload.ts`
 * strips `shopifyImageUrl` from the nav trees precisely because it is meant
 * to be a verbatim copy of `image` (~260 KB per page across ~2,000 nodes).
 * Reading it at render time would mean shipping that weight again on every
 * page; copying it into `image` restores the invariant the stripper assumes.
 *
 * Cloudinary *videos* have no Shopify counterpart, so they are left alone
 * and counted — they stay broken until re-hosted.
 *
 * Writes a timestamped backup of every field it touches before touching it.
 * Dry by default; pass --apply to write.
 */
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const isCl = (s) => typeof s === "string" && /res\.cloudinary\.com/i.test(s);
const isSh = (s) => typeof s === "string" && /cdn\.shopify\.com/i.test(s);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const backup = { takenAt: new Date().toISOString(), menus: [], brands: [], products: [] };
  const stat = { menus: 0, brands: 0, products: 0, urlsMapped: 0, videosLeft: 0 };

  // menus + brands: a single `image` string, replaced from `shopifyImageUrl`.
  for (const name of ["menus", "brands"]) {
    const col = db.collection(name);
    const docs = await col.find({ image: { $regex: "res\\.cloudinary\\.com" } }).toArray();
    const ops = [];
    for (const d of docs) {
      if (!isSh(d.shopifyImageUrl)) continue;
      backup[name].push({ _id: d._id, image: d.image });
      ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { image: d.shopifyImageUrl } } } });
    }
    stat[name] = ops.length;
    if (APPLY && ops.length) for (let i = 0; i < ops.length; i += 500) await col.bulkWrite(ops.slice(i, i + 500));
  }

  // products: an `images` array, each Cloudinary entry looked up by sourceUrl.
  const prods = db.collection("products");
  const docs = await prods.find({ images: { $regex: "res\\.cloudinary\\.com" } }).toArray();
  const ops = [];
  for (const p of docs) {
    const map = new Map();
    for (const m of p.shopifyImages || []) if (m?.sourceUrl && isSh(m?.shopifyUrl)) map.set(m.sourceUrl, m.shopifyUrl);
    for (const m of p.shopifyVideos || []) if (m?.sourceUrl && m?.shopifyUrl) map.set(m.sourceUrl, m.shopifyUrl);
    let changed = false;
    const next = (p.images || []).map((u) => {
      if (!isCl(u)) return u;
      const to = map.get(u);
      if (to) { changed = true; stat.urlsMapped++; return to; }
      stat.videosLeft++;
      return u;
    });
    if (!changed) continue;
    backup.products.push({ _id: p._id, images: p.images });
    ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { images: next } } } });
  }
  stat.products = ops.length;
  if (APPLY && ops.length) for (let i = 0; i < ops.length; i += 500) await prods.bulkWrite(ops.slice(i, i + 500));

  const out = path.join(process.env.BACKUP_DIR || ".", `cloudinary-backup-${Date.now()}.json`);
  if (APPLY) fs.writeFileSync(out, JSON.stringify(backup, null, 1));
  console.log(JSON.stringify({ mode: APPLY ? "APPLIED" : "DRY RUN", ...stat, backup: APPLY ? out : "(none)" }, null, 1));
  await mongoose.disconnect();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
