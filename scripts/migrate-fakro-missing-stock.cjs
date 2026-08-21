/**
 * Backfill Fakro stock (and any remaining £0 prices) from Linx Glass Supabase
 * and Shopify Storefront when linked.
 *
 *   node --require ./scripts/mongo-dns.cjs scripts/migrate-fakro-missing-stock.cjs
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
const LOG = path.join(__dirname, "_tmp-fakro-stock-migrate.log");

const SOURCE_URL = (process.env.SOURCE_SUPABASE_URL || "").replace(/\/$/, "");
const SOURCE_KEY = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;

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
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

async function fetchShopifyInventory(shopifyProductId) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN || "";
  const token = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "";
  if (!domain || !token || !shopifyProductId) return null;
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
          totalInventory
          priceRange { minVariantPrice { amount } }
        }
      }`,
      variables: { id: gid },
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const inv = json?.data?.product?.totalInventory;
  const price = Number(json?.data?.product?.priceRange?.minVariantPrice?.amount);
  return {
    stock: typeof inv === "number" ? inv : null,
    price: Number.isFinite(price) && price > 0 ? price : null,
  };
}

(async () => {
  fs.writeFileSync(LOG, `Fakro stock migrate ${new Date().toISOString()}\n`);
  await connectMongo(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  if (!brand) throw new Error("Fakro brand not found");

  const targets = await db
    .collection("products")
    .find({
      brand: brand._id,
      $or: [{ stock: { $lte: 0 } }, { stock: null }, { stock: { $exists: false } }],
    })
    .project({ name: 1, stock: 1, price: 1, shopifyProductId: 1, specs: 1 })
    .toArray();

  log(`Zero-stock Fakro products: ${targets.length}`);

  const skus = [
    ...new Set(
      targets
        .map((p) => String(p.specs?.sku || p.specs?.productCode || "").trim())
        .filter(Boolean),
    ),
  ];
  const bySku = new Map();
  if (SOURCE_URL && SOURCE_KEY && skus.length) {
    for (let i = 0; i < skus.length; i += 50) {
      const chunk = skus.slice(i, i + 50);
      const rows = await supabaseGet(
        `/rest/v1/shop_products?sku=in.(${chunk.map(encodeURIComponent).join(",")})&select=sku,price,stock_quantity,title`,
      );
      for (const row of rows || []) bySku.set(String(row.sku).trim(), row);
      log(`  supabase chunk ${i}: ${rows?.length || 0}`);
    }
  }

  let updated = 0;
  let stillMissing = 0;

  for (const p of targets) {
    const sku = String(p.specs?.sku || p.specs?.productCode || "").trim();
    const glass = sku ? bySku.get(sku) : null;
    let stock =
      glass?.stock_quantity != null ? Number(glass.stock_quantity) : NaN;
    let price = glass?.price != null ? Number(glass.price) : NaN;
    let source = "supabase";

    if ((!Number.isFinite(stock) || stock <= 0) && p.shopifyProductId) {
      const sf = await fetchShopifyInventory(p.shopifyProductId);
      if (sf?.stock != null && sf.stock > 0) {
        stock = sf.stock;
        source = "shopify-storefront";
      }
      if ((!Number.isFinite(price) || price <= 0) && sf?.price) {
        price = sf.price;
      }
    }

    if (!Number.isFinite(stock) || stock < 0) {
      stillMissing += 1;
      log(`NO STOCK ${sku || p._id} mongo=${p.stock} glass=${glass?.stock_quantity ?? "-"}`);
      continue;
    }

    // Only bump stock when we have a positive source value; don't wipe with 0
    // if Glass also has 0 (leave as-is unless Shopify gave a value).
    if (stock <= 0 && Number(p.stock) <= 0) {
      stillMissing += 1;
      log(`STILL ZERO ${sku || p._id}`);
      continue;
    }

    const set = {
      stock,
      updatedAt: new Date(),
      "specs.stockSource": source,
      "specs.stockMigratedAt": new Date().toISOString(),
    };
    if (Number.isFinite(price) && price > 0 && (!(Number(p.price) > 0))) {
      set.price = price;
      set["specs.priceSource"] = source;
    }

    if (DRY_RUN) {
      log(`[dry] ${sku} stock ${p.stock} → ${stock} via ${source}`);
    } else {
      await db.collection("products").updateOne({ _id: p._id }, { $set: set });
      log(`UPDATED ${sku} stock ${p.stock} → ${stock} via ${source}`);
    }
    updated += 1;
  }

  log(`\nDone updated=${updated} stillMissing=${stillMissing}${DRY_RUN ? " (dry)" : ""}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
