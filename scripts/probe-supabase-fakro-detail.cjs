/**
 * Count Fakro-related rows in source Supabase (read-only).
 */
require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.migrate", override: false });

const BASE = process.env.SOURCE_SUPABASE_URL;
const KEY = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  Accept: "application/json",
};

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  const json = await res.json();
  return { status: res.status, json, range: res.headers.get("content-range") };
}

async function count(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
  });
  return res.headers.get("content-range");
}

async function main() {
  const cats = await get(
    "/rest/v1/shop_categories?select=id,name,slug,brand,image_path,sort_order,is_active&order=sort_order.asc",
  );
  console.log("All categories:", cats.json?.length);
  console.log(
    cats.json?.map((c) => `${c.brand || "-"} | ${c.name} (${c.slug})`).join("\n"),
  );

  const fakroCats = (cats.json || []).filter(
    (c) => String(c.brand || "").toLowerCase().includes("fakro"),
  );
  console.log("\nFakro categories:", fakroCats.length);
  console.log(JSON.stringify(fakroCats, null, 2));

  // Distinct brands
  const brands = [...new Set((cats.json || []).map((c) => c.brand).filter(Boolean))];
  console.log("\nDistinct brands:", brands);

  // Products whose category matches fakro category names
  const fakroNames = fakroCats.map((c) => c.name);
  if (fakroNames.length) {
    const or = fakroNames.map((n) => `category.eq.${encodeURIComponent(n)}`).join(",");
    console.log("\nProducts count by category names:", await count(`/rest/v1/shop_products?or=(${or})&select=id`));
    const sample = await get(
      `/rest/v1/shop_products?or=(${or})&select=sku,title,category,price,image_path,category_type_id,stock_quantity&limit=3`,
    );
    console.log("Sample products:", JSON.stringify(sample.json, null, 2));
  }

  // Also try title/sku containing FAKRO
  console.log(
    "\nProducts title ilike fakro:",
    await count("/rest/v1/shop_products?title=ilike.*fakro*&select=id"),
  );
  console.log(
    "Products sku ilike fakro/85:",
    await count("/rest/v1/shop_products?or=(sku.ilike.*fakro*,sku.ilike.85*)&select=id"),
  );

  // category types for fakro cats
  if (fakroCats.length) {
    const ids = fakroCats.map((c) => c.id).join(",");
    const types = await get(
      `/rest/v1/shop_category_types?category_id=in.(${ids})&select=*&order=sort_order.asc`,
    );
    console.log("\nFakro category types:", types.json?.length);
    console.log(JSON.stringify(types.json?.slice(0, 10), null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
