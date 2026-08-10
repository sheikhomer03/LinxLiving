/**
 * Probe one Fakro blind product vs related content tables.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({
  path: path.join(__dirname, "..", ".env.migrate"),
  override: false,
});

const dns = require("dns");
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
};

async function get(pathname) {
  const res = await fetch(`${BASE}${pathname}`, { headers });
  const json = await res.json();
  return { status: res.status, json };
}

async function main() {
  const skus = ["ADFAAA22506", "ADFAAAA22606", "ADFAAAA22602"];
  for (const sku of skus) {
    const r = await get(
      `/rest/v1/shop_products?sku=eq.${encodeURIComponent(sku)}&select=*`,
    );
    console.log("\n==== SOURCE", sku, "====");
    const p = r.json?.[0];
    if (!p) {
      console.log("not found");
      continue;
    }
    console.log(
      JSON.stringify(
        {
          sku: p.sku,
          title: p.title,
          short_description: p.short_description,
          long_description: p.long_description,
          highlights: p.highlights,
          technical_specs: p.technical_specs,
          installation_guide: p.installation_guide,
          category: p.category,
          category_type_id: p.category_type_id,
        },
        null,
        2,
      ),
    );
  }

  // Discover any description-like tables
  const tables = [
    "shop_product_descriptions",
    "shop_category_descriptions",
    "product_descriptions",
    "shop_content",
    "shop_product_content",
    "shop_type_descriptions",
    "shop_category_types",
  ];
  for (const t of tables) {
    const r = await get(`/rest/v1/${t}?select=*&limit=1`);
    console.log(`table ${t}:`, r.status, Array.isArray(r.json) ? `rows=${r.json.length}` : typeof r.json);
    if (r.status === 200 && r.json?.[0]) {
      console.log("  keys:", Object.keys(r.json[0]).join(", "));
    }
  }

  // Sample blinds with long_description
  const blindsLong = await get(
    `/rest/v1/shop_products?category=eq.Blinds%20%26%20Accessories&long_description=not.is.null&select=sku,short_description,long_description,highlights&limit=2`,
  );
  console.log("\nblinds with long_description:", JSON.stringify(blindsLong.json, null, 2));

  // Sample blinds highlights non-empty
  const blindsHi = await get(
    `/rest/v1/shop_products?category=eq.Blinds%20%26%20Accessories&highlights=neq.[]&select=sku,short_description,highlights,long_description&limit=2`,
  );
  console.log("\nblinds with highlights:", JSON.stringify(blindsHi.json, null, 2));

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const mongo = await db.collection("products").findOne(
    { _id: new mongoose.Types.ObjectId("6a68f90ce6f26f4a21190345") },
    { projection: { name: 1, description: 1, specs: 1, "specs.sku": 1 } },
  );
  console.log("\n==== MONGO product ====");
  console.log(
    JSON.stringify(
      {
        name: mongo?.name,
        sku: mongo?.specs?.sku,
        description: mongo?.description,
        specs: mongo?.specs,
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
