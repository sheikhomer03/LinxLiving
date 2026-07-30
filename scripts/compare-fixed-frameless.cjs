/**
 * Compare Fixed & Frameless under Pitched Roof Windows: source Supabase vs Mongo.
 *
 * Env:
 *   SOURCE_SUPABASE_URL
 *   SOURCE_SUPABASE_SERVICE_ROLE_KEY
 *   MONGODB_URI (from .env)
 */
const path = require("path");
const dns = require("dns");
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

const BASE = (process.env.SOURCE_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  Accept: "application/json",
  Prefer: "count=exact",
};

async function supabaseGet(pathname) {
  const res = await fetch(`${BASE}${pathname}`, { headers });
  const json = await res.json();
  return { status: res.status, json, range: res.headers.get("content-range") };
}

async function supabaseCount(pathname) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: { ...headers, Range: "0-0" },
  });
  return res.headers.get("content-range");
}

async function main() {
  if (!BASE || !KEY) {
    throw new Error(
      "Missing SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  console.log("=== SOURCE (Linx Glass Supabase) ===");

  const pitched = await supabaseGet(
    "/rest/v1/shop_categories?brand=ilike.*fakro*&name=eq.Pitched%20Roof%20Windows&select=id,name,slug,brand",
  );
  const pitchedCat = pitched.json?.[0];
  console.log("Pitched category:", pitchedCat);

  const flat = await supabaseGet(
    "/rest/v1/shop_categories?brand=ilike.*fakro*&name=eq.Flat%20Roof%20Windows&select=id,name,slug",
  );
  const flatCat = flat.json?.[0];
  console.log("Flat category:", flatCat);

  const pitchedTypes = pitchedCat
    ? await supabaseGet(
        `/rest/v1/shop_category_types?category_id=eq.${pitchedCat.id}&select=id,name,slug,sort_order&order=sort_order.asc`,
      )
    : { json: [] };
  console.log(
    "Pitched types:",
    (pitchedTypes.json || []).map((t) => `${t.slug} (${t.name})`).join(", "),
  );

  const fixedPitched = (pitchedTypes.json || []).find(
    (t) => t.slug === "fixed-frameless" || /fixed/i.test(t.name),
  );
  console.log("Fixed & Frameless (pitched):", fixedPitched);

  const flatTypes = flatCat
    ? await supabaseGet(
        `/rest/v1/shop_category_types?category_id=eq.${flatCat.id}&select=id,name,slug`,
      )
    : { json: [] };
  const fixedFlat = (flatTypes.json || []).find(
    (t) => t.slug === "fixed-frameless" || /fixed/i.test(t.name),
  );
  console.log("Fixed & Frameless (flat):", fixedFlat);

  if (fixedPitched) {
    console.log(
      "Products with category_type_id = pitched fixed:",
      await supabaseCount(
        `/rest/v1/shop_products?category_type_id=eq.${fixedPitched.id}&select=id`,
      ),
    );
    console.log(
      "Products category=Pitched + type pitched-fixed:",
      await supabaseCount(
        `/rest/v1/shop_products?category=eq.Pitched%20Roof%20Windows&category_type_id=eq.${fixedPitched.id}&select=id`,
      ),
    );
    const sample = await supabaseGet(
      `/rest/v1/shop_products?category_type_id=eq.${fixedPitched.id}&select=sku,title,category,category_type_id&limit=5`,
    );
    console.log("Sample pitched-fixed:", JSON.stringify(sample.json, null, 2));
  }

  if (fixedFlat) {
    console.log(
      "Products with category_type_id = flat fixed:",
      await supabaseCount(
        `/rest/v1/shop_products?category_type_id=eq.${fixedFlat.id}&select=id`,
      ),
    );
  }

  // Both fixed-frameless type ids combined (what our migrate did by slug only)
  if (fixedPitched && fixedFlat) {
    console.log(
      "Products in EITHER fixed type id:",
      await supabaseCount(
        `/rest/v1/shop_products?or=(category_type_id.eq.${fixedPitched.id},category_type_id.eq.${fixedFlat.id})&select=id`,
      ),
    );
  }

  console.log("\n=== TARGET (Mongo) ===");
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  const bySub = await db
    .collection("products")
    .countDocuments({ brand: brand._id, subCategory: "fixed-frameless" });
  const byPitched = await db.collection("products").countDocuments({
    brand: brand._id,
    category: "pitched-roof-windows",
    subCategory: "fixed-frameless",
  });
  const byFlat = await db.collection("products").countDocuments({
    brand: brand._id,
    category: "flat-roof-windows",
    subCategory: "fixed-frameless",
  });
  const byFilterOr = await db.collection("products").countDocuments({
    brand: brand._id,
    $or: [
      { category: "fixed-frameless" },
      { subCategory: "fixed-frameless" },
    ],
  });
  const byCat = await db
    .collection("products")
    .aggregate([
      { $match: { brand: brand._id, subCategory: "fixed-frameless" } },
      { $group: { _id: "$category", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();

  console.log(
    JSON.stringify(
      { bySub, byPitched, byFlat, byFilterOr, byCat },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
