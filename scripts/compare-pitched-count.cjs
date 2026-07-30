const path = require("path");
const dns = require("dns");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

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
  Prefer: "count=exact",
};

async function main() {
  const src = await fetch(
    `${BASE}/rest/v1/shop_products?category=eq.Pitched%20Roof%20Windows&select=id`,
    { headers: { ...headers, Range: "0-0" } },
  );
  const sourceRange = src.headers.get("content-range");

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  const mongo = await db.collection("products").countDocuments({
    brand: brand._id,
    category: "pitched-roof-windows",
  });
  const mongoOrSub = await db.collection("products").countDocuments({
    brand: brand._id,
    $or: [
      { category: "pitched-roof-windows" },
      { subCategory: "pitched-roof-windows" },
    ],
  });

  console.log(
    JSON.stringify(
      {
        linxGlass_PitchedRoofWindows: sourceRange,
        mongo_category_pitched: mongo,
        mongo_category_or_subCategory: mongoOrSub,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
