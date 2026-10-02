/**
 * Frontline: the last two variant photos still on the supplier.
 *
 * On these variants `images` holds [hero (Shopify), own photo (supplier)] and
 * `shopifyImages` is an empty list, so the photo is never shown. Its READY
 * Shopify File already exists. The fix gives the variant one pair per image in
 * the same order — hero first (the product's existing media), then the photo —
 * and points images[1] at the File. The gallery then shows the hero first as
 * before, then the variant's own photo, then everything it showed already.
 *
 * Touches only variants[vi].images.1 and variants[vi].shopifyImages on the two
 * products below. Backed up, guarded on the old values, verified after.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/frontline-fix-two-variants.cjs [--write]
 */
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p, quiet: true });
}

const { EJSON, Int32 } = mongoose.mongo.BSON;
const WRITE = process.argv.includes("--write");
const DIR = path.join(__dirname, "..", "image-audit", "frontline");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const TARGETS = [
  { id: "6abcf8a9cd37dbea4893c384", vi: 0 },
  { id: "6abcf8a9cd37dbea4893c438", vi: 3 },
];

const say = (s = "") => process.stdout.write(`${s}\n`);
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const isShopify = (u) => /^https:\/\/cdn\.shopify\.com\//i.test(clean(u));
const isSupplier = (u) => /^https?:\/\/(www\.)?frontlinebathrooms\.co\.uk\/wp-content\//i.test(clean(u));

async function loads(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
      if (r.ok && (r.headers.get("content-type") || "").startsWith("image/")) return true;
      if (r.status === 404 || r.status === 410) return false;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  return false;
}

/** ProductSection's gallery for a chosen variant (galleryImages). */
function variantGallery(doc, v) {
  const map = {};
  for (const p of [...(doc.shopifyImages || []), ...(doc.variants || []).flatMap((x) => x.shopifyImages || [])]) {
    const shopify = clean(p.shopifyUrl);
    if (!shopify) continue;
    map[clean(p.sourceUrl) || shopify] = shopify;
    map[shopify] = shopify;
  }
  const only = (list) => list.map((s) => map[s] || "").filter(Boolean);
  const base = doc.images || [];
  const mirrored = [...(v.shopifyImages || [])]
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
    .map((p) => clean(p.shopifyUrl))
    .filter(Boolean);
  if (mirrored.length) return only([...mirrored, ...base.filter((s) => !mirrored.includes(s))]);
  const img = clean(v.imageUrl);
  if (!img) return only(base);
  return only([img, ...base.filter((s, i, arr) => s !== img && arr.indexOf(s) === i)]);
}

(async () => {
  const state = JSON.parse(fs.readFileSync(path.join(DIR, "state.json"), "utf8"));
  const conn = await connectMongo(process.env.MONGODB_URI);
  const col = conn.db.collection("products");
  const backupFile = path.join(DIR, `backup-two-variants-${STAMP}.ejson.jsonl`);
  let ok = 0;

  for (const { id, vi } of TARGETS) {
    const d = await col.findOne({ _id: new mongoose.Types.ObjectId(id) }, { promoteValues: false });
    const v = d.variants[vi];
    const [hero, photo] = v.images || [];
    const fail = (why) => say(`  ${id} v${vi}: SKIPPED — ${why}`);

    // Preconditions: exactly the shape described above.
    if ((v.images || []).length !== 2 || !isShopify(hero) || !isSupplier(photo)) { fail("images not [shopify hero, supplier photo]"); continue; }
    if (!Array.isArray(v.shopifyImages) || v.shopifyImages.length) { fail("shopifyImages is not an empty list"); continue; }
    // Same file; the "?v=" version stamp may differ.
    const bare = (u) => clean(u).split("?")[0];
    const heroPair = (d.shopifyImages || []).find((p) => bare(p.shopifyUrl) === bare(hero));
    if (!heroPair) { fail("hero has no product pair"); continue; }
    const file = Object.values(state.files).find((f) => clean(f.source) === clean(photo) && f.url && f.id);
    if (!file) { fail("no READY File for the photo"); continue; }
    if (!(await loads(file.url)) || !(await loads(hero))) { fail("a Shopify URL does not load"); continue; }

    // Pairs shaped like the product's own (same keys, same order).
    const mk = (src, url, mediaId, pos) => {
      const out = {};
      for (const k of Object.keys(heroPair)) {
        if (k === "sourceUrl") out[k] = src;
        else if (k === "shopifyUrl") out[k] = url;
        else if (k === "mediaId") out[k] = mediaId;
        else if (k === "position") out[k] = new Int32(pos);
        else out[k] = heroPair[k];
      }
      return out;
    };
    const newImages = [hero, file.url];
    // The hero pair shows exactly the URL the gallery shows today (the product's
    // copy); its source is the variant's existing entry, which stays as is.
    // The hero pair uses the hero entry exactly as the gallery list holds it,
    // so the page's de-duplication recognises it; "?v=" is only Shopify's
    // version stamp on the same file.
    const newPairs = [mk(hero, clean(hero), heroPair.mediaId, 0), mk(file.url, file.url, file.id, 1)];

    // The gallery: hero first as before, then the photo, then the rest unchanged.
    const before = variantGallery(d, v);
    const next = { ...d, variants: d.variants.map((x, k) => (k === vi ? { ...x, images: newImages, shopifyImages: newPairs } : x)) };
    const after = variantGallery(next, next.variants[vi]);
    const expected = [before[0], file.url, ...before.slice(1)];
    const bareU = (u) => clean(u).split("?")[0];
    if (after.length !== expected.length || after.some((u, i) => bareU(u) !== bareU(expected[i])) || new Set(after.map(bareU)).size !== after.length) {
      fail(`gallery would be ${after.length} not ${expected.length} as expected`);
      const short = (u) => u.split("/").pop();
      say(`    before:   ${before.map(short).join(" | ")}\n    after:    ${after.map(short).join(" | ")}\n    expected: ${expected.map(short).join(" | ")}\n    imageUrl: ${short(clean(v.imageUrl))}  hero: ${short(clean(hero))}  pair: ${short(clean(heroPair.shopifyUrl))}`);
      continue;
    }
    say(`  ${id} v${vi} (${v.name}): gallery ${before.length} → ${after.length}, adds its own photo second`);
    if (!WRITE) continue;

    fs.appendFileSync(backupFile, `${EJSON.stringify(d, { relaxed: false })}\n`);
    const res = await col.updateOne(
      { _id: d._id, [`variants.${vi}.images`]: v.images, [`variants.${vi}.shopifyImages`]: v.shopifyImages },
      { $set: { [`variants.${vi}.images`]: newImages, [`variants.${vi}.shopifyImages`]: newPairs } },
    );
    if (res.modifiedCount !== 1) { fail("not written (changed since read)"); continue; }

    // Verify: only the two planned paths differ.
    const a = await col.findOne({ _id: d._id }, { promoteValues: false });
    const strip = (doc) => {
      const c = EJSON.parse(EJSON.stringify(doc, { relaxed: false }), { relaxed: false });
      delete c.variants[vi].images;
      delete c.variants[vi].shopifyImages;
      return EJSON.stringify(c, { relaxed: false });
    };
    const sameElsewhere = strip(a) === strip(d);
    const galleryOk = JSON.stringify(variantGallery(a, a.variants[vi]).map(bareU)) === JSON.stringify(expected.map(bareU));
    if (sameElsewhere && galleryOk) ok++;
    say(`  ${id}: written; nothing else changed: ${sameElsewhere}; gallery as expected: ${galleryOk}`);
  }
  if (WRITE) say(`backup: ${backupFile}\nverified: ${ok}/${TARGETS.length}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
