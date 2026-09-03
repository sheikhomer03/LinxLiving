/**
 * Audit where PORCELANOSA Grupo product images actually live:
 *   - Cloudinary: are the staged assets still in the brand folder?
 *   - Shopify:    does live Shopify media match product.shopifyImages?
 *   - Liveness:   do the URLs in product.images actually load?
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/audit-porcelanosa-hosting.cjs
 */
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");
const { v2: cloudinary } = require("cloudinary");

const BRAND_ID = "6a6b9647d17a2adf5d0d2b35";
const CLOUDINARY_FOLDER = "linx-living/products/porcelanosagrupo";
const OUT = process.env.OUT || path.join(__dirname, "_tmp-porce-hosting-audit.json");
const LIVENESS_SAMPLE = Number(process.env.LIVENESS_SAMPLE || 120);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function shopifyToken(domain) {
  const staticToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (staticToken) return staticToken.trim();
  const res = await fetch("https://" + domain + "/admin/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("Shopify token failed: " + JSON.stringify(json).slice(0, 200));
  return json.access_token;
}

async function graphql(domain, version, token, query, variables) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(
      "https://" + domain + "/admin/api/" + version + "/graphql.json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables }),
      },
    );
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 300));
    return json.data;
  }
  throw new Error("Shopify GraphQL gave up after retries");
}

async function listCloudinaryFolder(folder) {
  const ids = new Set();
  let next = null;
  do {
    const res = await cloudinary.api.resources({
      type: "upload",
      prefix: folder + "/",
      max_results: 500,
      next_cursor: next || undefined,
    });
    for (const r of res.resources || []) ids.add(r.public_id);
    next = res.next_cursor || null;
  } while (next);
  return ids;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function stripQuery(u) {
  return String(u || "").split("?")[0];
}

async function checkUrls(urls, concurrency) {
  const results = {};
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
      while (next < urls.length) {
        const u = urls[next++];
        try {
          const res = await fetch(u, {
            method: "GET",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
              Range: "bytes=0-0",
            },
          });
          results[u] = res.status;
        } catch (e) {
          results[u] = "ERR " + e.message.slice(0, 40);
        }
      }
    }),
  );
  return results;
}

(async () => {
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const docs = await db
    .collection("products")
    .find(
      { brand: new mongoose.Types.ObjectId(BRAND_ID) },
      { projection: { name: 1, images: 1, shopifyImages: 1, shopifyProductId: 1, shopifyHandle: 1 } },
    )
    .toArray();
  console.log("products: " + docs.length);

  const report = { cloudinary: {}, shopify: {}, liveness: {}, perProduct: [] };

  // ---- Cloudinary ---------------------------------------------------------
  console.log("\nListing Cloudinary folder " + CLOUDINARY_FOLDER + " ...");
  let cloudIds = new Set();
  try {
    cloudIds = await listCloudinaryFolder(CLOUDINARY_FOLDER);
    console.log("  cloudinary assets in folder: " + cloudIds.size);
  } catch (e) {
    console.log("  cloudinary list failed: " + e.message);
  }
  const expectedCloud = [];
  for (const d of docs) {
    const handle = d.shopifyHandle || "";
    if (!handle) continue;
    for (let i = 0; i < (d.images || []).length; i += 1) {
      expectedCloud.push(CLOUDINARY_FOLDER + "/" + handle + "-" + (i + 1));
    }
  }
  const missingCloud = expectedCloud.filter((id) => !cloudIds.has(id));
  report.cloudinary = {
    folder: CLOUDINARY_FOLDER,
    assetsInFolder: cloudIds.size,
    expectedFromDb: expectedCloud.length,
    missing: missingCloud.length,
    missingSample: missingCloud.slice(0, 20),
  };
  console.log(
    "  expected " + expectedCloud.length + " staged assets, missing " + missingCloud.length,
  );

  // ---- Shopify live media -------------------------------------------------
  const domain = String(process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const version = process.env.SHOPIFY_API_VERSION || "2025-07";
  const withShopify = docs.filter((d) => d.shopifyProductId);
  console.log("\nChecking live Shopify media for " + withShopify.length + " products ...");
  const liveMedia = new Map();
  try {
    const token = await shopifyToken(domain);
    const query = `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id handle status media(first:50){ nodes{ ... on MediaImage { id image { url } } } } } } }`;
    const batches = chunk(withShopify.map((d) => d.shopifyProductId), 40);
    let i = 0;
    for (const ids of batches) {
      const data = await graphql(domain, version, token, query, { ids });
      for (const node of data.nodes || []) {
        if (!node || !node.id) continue;
        liveMedia.set(node.id, {
          handle: node.handle,
          status: node.status,
          urls: (node.media && node.media.nodes ? node.media.nodes : [])
            .map((m) => (m && m.image ? stripQuery(m.image.url) : ""))
            .filter(Boolean),
        });
      }
      i += 1;
      process.stdout.write("  batch " + i + "/" + batches.length + "\r");
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log("\n  live products returned: " + liveMedia.size);
  } catch (e) {
    console.log("\n  shopify check failed: " + e.message);
  }

  let shopMissing = 0;
  let shopCountDiff = 0;
  let shopUrlDiff = 0;
  let shopNoMedia = 0;
  const shopIssues = [];
  for (const d of withShopify) {
    const live = liveMedia.get(d.shopifyProductId);
    if (!live) {
      shopMissing += 1;
      shopIssues.push({ id: String(d._id), name: d.name, issue: "product not found in Shopify" });
      continue;
    }
    const dbUrls = (d.shopifyImages || []).map((s) => stripQuery(s.shopifyUrl || s.sourceUrl)).filter(Boolean);
    if (!live.urls.length) {
      shopNoMedia += 1;
      shopIssues.push({ id: String(d._id), name: d.name, issue: "no media on Shopify product" });
      continue;
    }
    if (live.urls.length !== dbUrls.length) shopCountDiff += 1;
    const a = [...new Set(dbUrls)].sort().join("|");
    const b = [...new Set(live.urls)].sort().join("|");
    if (a !== b) {
      shopUrlDiff += 1;
      if (shopIssues.length < 200) {
        shopIssues.push({
          id: String(d._id),
          name: d.name,
          issue: "db shopifyImages != live media",
          db: dbUrls.length,
          live: live.urls.length,
        });
      }
    }
  }
  report.shopify = {
    productsChecked: withShopify.length,
    liveFound: liveMedia.size,
    notFoundInShopify: shopMissing,
    noMediaOnShopify: shopNoMedia,
    mediaCountDiffers: shopCountDiff,
    mediaUrlsDiffer: shopUrlDiff,
    issuesSample: shopIssues.slice(0, 30),
  };
  console.log(
    "  not in Shopify " + shopMissing + " | no media " + shopNoMedia + " | url mismatch " + shopUrlDiff,
  );

  // ---- Liveness of product.images ----------------------------------------
  const allImageUrls = [...new Set(docs.flatMap((d) => d.images || []))];
  const byHost = {};
  for (const u of allImageUrls) {
    let h = "(bad)";
    try {
      h = new URL(u).hostname;
    } catch {}
    (byHost[h] = byHost[h] || []).push(u);
  }
  console.log("\nDistinct image URLs: " + allImageUrls.length);
  const liveness = {};
  for (const [host, urls] of Object.entries(byHost)) {
    const pick = urls.slice(0, LIVENESS_SAMPLE);
    const res = await checkUrls(pick, 8);
    const codes = {};
    for (const s of Object.values(res)) codes[s] = (codes[s] || 0) + 1;
    liveness[host] = { totalUrls: urls.length, sampled: pick.length, statuses: codes };
    console.log("  " + host + ": " + urls.length + " urls, sample statuses " + JSON.stringify(codes));
  }
  report.liveness = liveness;

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("\nreport -> " + OUT);
  await mongoose.disconnect();
})();
