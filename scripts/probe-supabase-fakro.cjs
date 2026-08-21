/**
 * Probe source Supabase schema for Fakro migration (read-only).
 * Usage: node scripts/probe-supabase-fakro.cjs
 */
require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.migrate", override: false });

const BASE = process.env.SOURCE_SUPABASE_URL;
const KEY = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;

if (!BASE || !KEY) {
  console.error("Missing SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SERVICE_ROLE_KEY in .env.migrate");
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  Accept: "application/json",
};

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function main() {
  console.log("Probing", BASE.replace(/https?:\/\//, ""));

  // OpenAPI paths
  const openapi = await get("/rest/v1/");
  if (openapi.status === 200 && openapi.json?.definitions) {
    const tables = Object.keys(openapi.json.definitions).sort();
    console.log("\nTables:", tables.join(", "));
    for (const t of tables) {
      const props = openapi.json.definitions[t]?.properties || {};
      console.log(`\n[${t}]`, Object.keys(props).join(", "));
    }
  } else if (openapi.status === 200 && openapi.json?.paths) {
    const paths = Object.keys(openapi.json.paths)
      .map((p) => p.replace(/^\//, ""))
      .filter(Boolean)
      .sort();
    console.log("\nPaths/tables:", paths.join(", "));
  } else {
    console.log("OpenAPI status", openapi.status, typeof openapi.json);
  }

  // Heuristic table samples
  const candidates = [
    "products",
    "product",
    "categories",
    "category",
    "brands",
    "brand",
    "collections",
    "menus",
    "catalog_products",
    "shop_products",
  ];

  for (const table of candidates) {
    const r = await get(`/rest/v1/${table}?select=*&limit=1`);
    if (r.status === 200 && Array.isArray(r.json)) {
      console.log(`\nSample ${table} (${r.json.length}):`, JSON.stringify(r.json[0] || null, null, 2)?.slice(0, 1200));
      const countRes = await fetch(`${BASE}/rest/v1/${table}?select=id`, {
        headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
      });
      console.log(`Count header ${table}:`, countRes.headers.get("content-range"));
    }
  }

  // Search for fakro
  for (const table of ["brands", "brand", "categories", "products"]) {
    const r = await get(
      `/rest/v1/${table}?or=(name.ilike.*fakro*,slug.ilike.*fakro*,brand.ilike.*fakro*,vendor.ilike.*fakro*)&select=*&limit=5`,
    );
    if (r.status === 200 && Array.isArray(r.json) && r.json.length) {
      console.log(`\nFakro hits in ${table}:`, r.json.length, JSON.stringify(r.json, null, 2).slice(0, 1500));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
