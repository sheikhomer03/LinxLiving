/**
 * Remove images that Shopify could not process because the file does not
 * exist on betterbathrooms.com (their product data still lists it).
 *
 * Only Better Bathrooms products (specs.source = "bb-scrape"). Per product:
 * find media with status FAILED, confirm the source URL is dead (non-200),
 * delete that media from the Shopify product, and drop it from the DB2
 * gallery and pairing. A variant whose own image was the dead one moves to
 * its next working image.
 *
 *   node scripts/bb-fix-dead-images.cjs [--apply]
 */
require("tsx/cjs");
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local"), quiet: true });
require("dns").setServers((process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean));
const { MongoClient } = require("mongodb");
const { shopifyAdminRequest } = require("../src/lib/shopify/admin.ts");

const APPLY = process.argv.includes("--apply");

async function isDead(url) {
  try {
    const r = await fetch(url, { method: "HEAD", headers: { "user-agent": "Mozilla/5.0" } });
    return !r.ok || !/^image\//.test(r.headers.get("content-type") || "");
  } catch { return true; }
}

(async () => {
  const c = new MongoClient(process.env.MONGODB_URL2);
  await c.connect();
  const col = c.db().collection("products");
  const rows = await col.find({ "specs.source": "bb-scrape", "shopifyImages.shopifyUrl": { $in: ["", null] } }).toArray();
  let removed = 0;
  for (const p of rows) {
    const d = await shopifyAdminRequest(`query($id:ID!){ product(id:$id){ media(first:250){ nodes{ id status } } } }`, { id: p.shopifyProductId });
    const failed = new Set(d.product.media.nodes.filter((n) => n.status === "FAILED").map((n) => n.id));
    const dead = [];
    for (const im of p.shopifyImages || []) if (!im.shopifyUrl && failed.has(im.mediaId) && (await isDead(im.sourceUrl))) dead.push(im);
    if (!dead.length) { console.log(`skip ${p.name} — empty link is not a dead source`); continue; }
    const deadUrls = new Set(dead.map((x) => x.sourceUrl));
    const images = (p.images || []).filter((u) => !deadUrls.has(u));
    const shopifyImages = (p.shopifyImages || []).filter((x) => !deadUrls.has(x.sourceUrl));
    const variants = (p.variants || []).map((v) => {
      if (!deadUrls.has(v.imageUrl)) return v;
      const next = (v.images || []).find((u) => !deadUrls.has(u)) || images[0] || "";
      const pair = shopifyImages.find((x) => x.sourceUrl === next);
      return { ...v, imageUrl: next, images: (v.images || []).filter((u) => !deadUrls.has(u)), shopifyMediaId: pair?.mediaId || "", shopifyImageUrl: pair?.shopifyUrl || "" };
    });
    console.log(`${APPLY ? "fix" : "would fix"} ${p.name} — remove ${dead.map((x) => x.sourceUrl.split("/").pop()).join(", ")}`);
    if (!APPLY) continue;
    const res = await shopifyAdminRequest(
      `mutation($id:ID!,$m:[ID!]!){ productDeleteMedia(productId:$id, mediaIds:$m){ deletedMediaIds mediaUserErrors{ message } } }`,
      { id: p.shopifyProductId, m: dead.map((x) => x.mediaId) },
    );
    const errs = res.productDeleteMedia.mediaUserErrors;
    if (errs.length) { console.log("   Shopify error:", errs.map((e) => e.message).join("; ")); continue; }
    await col.updateOne({ _id: p._id }, { $set: { images, shopifyImages, variants } });
    removed += dead.length;
  }
  console.log(`${APPLY ? "removed" : "would remove"} dead images: ${APPLY ? removed : "see above"}`);
  await c.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
