/**
 * Find how Fakro products are linked (category / category_type_id).
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
  return res.json();
}

async function count(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
  });
  return res.headers.get("content-range");
}

async function main() {
  const cats = await get(
    "/rest/v1/shop_categories?brand=eq.fakro&select=id,name,slug,is_active",
  );
  const catIds = cats.map((c) => c.id);
  const types = await get(
    `/rest/v1/shop_category_types?category_id=in.(${catIds.join(",")})&select=id,category_id,name,slug,is_active`,
  );
  console.log("Fakro types:", types.length);
  const typeIds = types.map((t) => t.id);

  // Products by category_type_id
  if (typeIds.length) {
    // chunk in. queries
    const chunk = typeIds.slice(0, 20);
    console.log(
      "Products by type id (first 20 types):",
      await count(
        `/rest/v1/shop_products?category_type_id=in.(${chunk.join(",")})&select=id`,
      ),
    );
    const sample = await get(
      `/rest/v1/shop_products?category_type_id=in.(${chunk.join(",")})&select=sku,title,category,category_type_id,price,image_path&limit=5`,
    );
    console.log("Sample by type:", JSON.stringify(sample, null, 2));
  }

  // Distinct product.category values
  const allCats = await get(
    "/rest/v1/shop_products?select=category&limit=1000",
  );
  const distinct = [...new Set(allCats.map((p) => p.category))].sort();
  console.log("\nDistinct product.category values:", distinct.length);
  console.log(distinct.join("\n"));

  // Active fakro category names only
  const active = cats.filter((c) => c.is_active);
  console.log("\nActive fakro cats:", active.map((c) => c.name));

  for (const name of active.map((c) => c.name)) {
    const c = await count(
      `/rest/v1/shop_products?category=eq.${encodeURIComponent(name)}&select=id`,
    );
    console.log(`  ${name}: ${c}`);
  }

  // Maybe products use parent mega category names like Pitched Roof Windows via join
  // Check products with image path containing /fakro/
  console.log(
    "\nimage_path ilike fakro:",
    await count("/rest/v1/shop_products?image_path=ilike.*fakro*&select=id"),
  );
  const imgSample = await get(
    "/rest/v1/shop_products?image_path=ilike.*fakro*&select=sku,title,category,category_type_id,price,image_path&limit=5",
  );
  console.log(JSON.stringify(imgSample, null, 2));

  // Images table
  console.log(
    "\nshop_product_images count:",
    await count("/rest/v1/shop_product_images?select=id"),
  );
  console.log(
    "variants count:",
    await count("/rest/v1/shop_product_variants?select=id"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
