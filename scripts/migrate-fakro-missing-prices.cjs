/**
 * Fetch prices for zero-price Fakro SKUs from Linx Glass Supabase + Shopify.
 * Then write prices into Living Mongo.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/migrate-fakro-missing-prices.cjs
 *   DRY_RUN=1 ...
 */
const path = require("path");
const dns = require("dns");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({
  path: path.join(__dirname, "..", ".env.migrate"),
  override: false,
});

const servers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (servers.length) dns.setServers(servers);

const mongoose = require("mongoose");
const { connectMongo } = require("./mongo-connect.cjs");

const DRY_RUN = process.env.DRY_RUN === "1";
const LOG = path.join(__dirname, "_tmp-fakro-price-migrate.log");

const SOURCE_URL = (
  process.env.SOURCE_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SOURCE_KEY =
  process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SOURCE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function log(...args) {
  const line = args.map(String).join(" ");
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

async function supabaseGet(pathname) {
  const res = await fetch(`${SOURCE_URL}${pathname}`, {
    headers: {
      apikey: SOURCE_KEY,
      Authorization: `Bearer ${SOURCE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchShopifyPrice(shopifyProductId) {
  if (!shopifyProductId) return null;
  if (!process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN && !process.env.SHOPIFY_STORE_DOMAIN) {
    // Try admin REST if available — skip if no storefront
  }
  try {
    const { fetchStorefrontProductById } = require("../src/lib/shopify/storefront.ts");
    // may not work from cjs without ts — use raw graphql instead
  } catch {
    /* use raw */
  }

  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    "";
  const token = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "";
  if (!domain || !token) return null;

  const gid = String(shopifyProductId).startsWith("gid://")
    ? shopifyProductId
    : `gid://shopify/Product/${shopifyProductId}`;

  const res = await fetch(`https://${domain}/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({
      query: `query($id: ID!) {
        product(id: $id) {
          title
          priceRange { minVariantPrice { amount } }
        }
      }`,
      variables: { id: gid },
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const amount = json?.data?.product?.priceRange?.minVariantPrice?.amount;
  const n = Number(amount);
  return Number.isFinite(n) && n > 0 ? n : null;
}

(async () => {
  fs.writeFileSync(LOG, `Fakro price migrate ${new Date().toISOString()}\n`);
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
  if (!SOURCE_URL || !SOURCE_KEY) {
    throw new Error("Missing SOURCE_SUPABASE_* in .env.migrate");
  }

  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({
    $or: [{ slug: "fakro" }, { name: /^fakro$/i }],
  });
  if (!brand) throw new Error("Fakro brand not found");

  const zeroPrice = await db
    .collection("products")
    .find({
      brand: brand._id,
      $or: [{ price: { $lte: 0 } }, { price: null }, { price: { $exists: false } }],
    })
    .project({
      name: 1,
      price: 1,
      shopifyProductId: 1,
      specs: 1,
      category: 1,
    })
    .toArray();

  log(`Zero-price Fakro products: ${zeroPrice.length}`);
  if (!zeroPrice.length) {
    await mongoose.disconnect();
    return;
  }

  const skus = [
    ...new Set(
      zeroPrice
        .map((p) => String(p.specs?.sku || p.specs?.productCode || "").trim())
        .filter(Boolean),
    ),
  ];

  const bySku = new Map();
  // Batch fetch from Supabase
  for (let i = 0; i < skus.length; i += 40) {
    const chunk = skus.slice(i, i + 40);
    const inList = chunk.map(encodeURIComponent).join(",");
    try {
      const rows = await supabaseGet(
        `/rest/v1/shop_products?sku=in.(${inList})&select=id,sku,title,price,image_path`,
      );
      for (const row of rows || []) {
        if (row.sku) bySku.set(String(row.sku).trim(), row);
      }
      log(`  supabase chunk ${i}: ${rows?.length || 0} rows`);
    } catch (e) {
      log(`  supabase chunk fail: ${e.message}`);
    }
  }

  // Also try title search for CIRRUS lanterns if SKU miss
  for (const p of zeroPrice) {
    const sku = String(p.specs?.sku || "").trim();
    if (sku && bySku.has(sku)) continue;
    const title = String(p.name || "").trim();
    if (!title) continue;
    try {
      const rows = await supabaseGet(
        `/rest/v1/shop_products?title=eq.${encodeURIComponent(title)}&select=id,sku,title,price,image_path&limit=3`,
      );
      if (rows?.[0]) {
        bySku.set(sku || rows[0].sku, rows[0]);
        log(`  title match: ${title.slice(0, 50)} → £${rows[0].price}`);
      }
    } catch (e) {
      log(`  title search fail: ${e.message}`);
    }
  }

  let updated = 0;
  let stillMissing = 0;
  const report = [];

  for (const p of zeroPrice) {
    const sku = String(p.specs?.sku || p.specs?.productCode || "").trim();
    const glass = (sku && bySku.get(sku)) || null;
    let price = glass?.price != null ? Number(glass.price) : NaN;
    let source = "supabase";

    if (!Number.isFinite(price) || price <= 0) {
      const shopifyPrice = await fetchShopifyPrice(p.shopifyProductId);
      if (shopifyPrice) {
        price = shopifyPrice;
        source = "shopify-storefront";
      }
    }

    if (!Number.isFinite(price) || price <= 0) {
      stillMissing += 1;
      report.push({
        sku,
        name: p.name,
        status: "NO_PRICE",
        glassPrice: glass?.price ?? null,
      });
      log(`NO PRICE ${sku || p._id} ${p.name.slice(0, 60)}`);
      continue;
    }

    report.push({
      sku,
      name: p.name,
      status: "OK",
      price,
      source,
      glassPrice: glass?.price ?? null,
    });

    if (DRY_RUN) {
      log(`[dry] ${sku} £${price} via ${source}`);
    } else {
      await db.collection("products").updateOne(
        { _id: p._id },
        {
          $set: {
            price,
            updatedAt: new Date(),
            "specs.priceSource": source,
            "specs.priceMigratedAt": new Date().toISOString(),
          },
        },
      );
      log(`UPDATED ${sku} £${price} via ${source}`);
    }
    updated += 1;
  }

  fs.writeFileSync(
    path.join(__dirname, "_tmp-fakro-price-migrate-report.json"),
    JSON.stringify({ at: new Date().toISOString(), updated, stillMissing, report }, null, 2),
  );
  log(`\nDone updated=${updated} stillMissing=${stillMissing}${DRY_RUN ? " (dry)" : ""}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  fs.appendFileSync(LOG, String(e) + "\n");
  process.exit(1);
});
