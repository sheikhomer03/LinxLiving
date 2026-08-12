/**
 * For every product that actually displays on the storefront (same filter as
 * getPublicProducts: non-empty category, price > 0, brand not hidden),
 * check EVERY image in its images[] array for reachability — not just the
 * cover image. Report a single combined list of products with one or more
 * broken/missing images. Read-only.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });
const fs = require("fs");
const { connectMongo } = require("./mongo-connect.cjs");

const CONCURRENCY = 20;

function isEmptyImage(v) {
  const s = String(v || "").trim();
  return !s || s === "-" || /^(null|undefined)$/i.test(s) || /^youtube:/i.test(s);
}

async function urlLoads(url) {
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "follow" });
    }
    const type = res.headers.get("content-type") || "";
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    if (type && !type.startsWith("image/")) return { ok: false, reason: `type ${type}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.cause?.code || e.message };
  }
}

async function checkAll(urls, onProgress) {
  const results = new Map();
  const queue = [...urls];
  let done = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, async () => {
    while (queue.length) {
      const url = queue.shift();
      results.set(url, await urlLoads(url));
      if (++done % 500 === 0) onProgress?.(done, urls.length);
    }
  });
  await Promise.all(workers);
  return results;
}

(async () => {
  await connectMongo();
  const db = require("mongoose").connection.db;

  const hiddenBrandRows = await db.collection("brands").find({
    $or: [{ isActive: false }, { slug: "britmet" }],
  }).project({ _id: 1 }).toArray();
  const hiddenIds = hiddenBrandRows.map((b) => b._id);

  const brands = await db.collection("brands").find({}).toArray();
  const brandById = new Map(brands.map((b) => [String(b._id), b]));
  const brandName = (id) => (id ? brandById.get(String(id))?.name || "?" : "—");

  const filter = {
    category: { $exists: true, $nin: [null, ""] },
    price: { $gt: 0 },
    brand: { $nin: hiddenIds },
  };

  const products = await db.collection("products").find(filter).project({
    name: 1, images: 1, brand: 1, department: 1, category: 1, subCategory: 1, price: 1, stock: 1,
  }).toArray();

  console.error(`Displaying products to scan: ${products.length}`);

  const urlSet = new Set();
  for (const p of products) {
    const imgs = Array.isArray(p.images) ? p.images : [];
    for (const u of imgs) {
      const s = String(u || "").trim();
      if (/^https?:\/\//i.test(s)) urlSet.add(s);
    }
  }
  console.error(`Distinct image URLs to check: ${urlSet.size}`);

  const results = await checkAll([...urlSet], (d, t) => {
    if (d % 2000 === 0) console.error(`  checked ${d}/${t}`);
  });

  const flagged = [];
  for (const p of products) {
    const rawImgs = Array.isArray(p.images) ? p.images : [];
    const validImgs = rawImgs.filter((u) => !isEmptyImage(u));
    if (!validImgs.length) {
      flagged.push({
        name: p.name, brand: brandName(p.brand), department: p.department || "",
        category: p.category || "", subCategory: p.subCategory || "",
        price: p.price, stock: p.stock, id: String(p._id),
        issue: "no-images", totalImages: rawImgs.length, brokenImages: [],
      });
      continue;
    }
    const broken = [];
    for (const u of validImgs) {
      const s = String(u).trim();
      if (!/^https?:\/\//i.test(s)) continue; // non-URL (shouldn't happen after isEmptyImage filter, but guard)
      const r = results.get(s);
      if (r && !r.ok) broken.push({ url: s, reason: r.reason });
    }
    if (broken.length) {
      flagged.push({
        name: p.name, brand: brandName(p.brand), department: p.department || "",
        category: p.category || "", subCategory: p.subCategory || "",
        price: p.price, stock: p.stock, id: String(p._id),
        issue: broken.length === validImgs.length ? "all-images-broken" : "some-images-broken",
        totalImages: validImgs.length, brokenImages: broken,
      });
    }
  }

  fs.writeFileSync("/tmp/displaying-image-issues.json", JSON.stringify(flagged, null, 1));
  console.error(`\nDONE. Displaying products scanned: ${products.length}, flagged with image issues: ${flagged.length}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
