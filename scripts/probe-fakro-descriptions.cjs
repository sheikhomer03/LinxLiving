/**
 * Probe Fakro description / technical_specs coverage in source Supabase.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({
  path: path.join(__dirname, "..", ".env.migrate"),
  override: false,
});

const BASE = (process.env.SOURCE_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  Accept: "application/json",
  Prefer: "count=exact",
};

async function count(filter) {
  const res = await fetch(
    `${BASE}/rest/v1/shop_products?${filter}&select=id`,
    { headers: { ...headers, Range: "0-0" } },
  );
  return res.headers.get("content-range");
}

async function sample(filter, select, limit = 2) {
  const res = await fetch(
    `${BASE}/rest/v1/shop_products?${filter}&select=${select}&limit=${limit}`,
    { headers },
  );
  return res.json();
}

async function main() {
  const cat =
    "or=(category.eq.Pitched%20Roof%20Windows,category.eq.Flat%20Roof%20Windows,category.eq.Blinds%20%26%20Accessories,category.eq.Loft%20Ladders)";

  console.log("all fakro cats:", await count(cat));
  console.log(
    "long_description not null:",
    await count(`${cat}&long_description=not.is.null`),
  );
  console.log(
    "short_description not null:",
    await count(`${cat}&short_description=not.is.null`),
  );
  console.log(
    "technical_specs neq []:",
    await count(`${cat}&technical_specs=neq.[]`),
  );

  const withLong = await sample(
    `${cat}&long_description=not.is.null`,
    "sku,title,short_description,long_description,technical_specs,size,product_code,highlights",
  );
  console.log("\n--- sample with long_description ---");
  console.log(JSON.stringify(withLong, null, 2));

  const withTech = await sample(
    `${cat}&technical_specs=neq.[]`,
    "sku,title,technical_specs,short_description,long_description,highlights",
  );
  console.log("\n--- sample with technical_specs ---");
  console.log(JSON.stringify(withTech, null, 2));

  const gif = await sample(
    `${cat}&image_path=ilike.*.gif`,
    "sku,image_path,title",
    5,
  );
  console.log("\n--- gif samples ---");
  console.log(JSON.stringify(gif, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
