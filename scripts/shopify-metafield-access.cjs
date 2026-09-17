/**
 * Make the `linx.*` product metafields readable by the Storefront API.
 *
 * The sync has always written these (Admin API shows them populated), but a
 * metafield is invisible to the Storefront API unless a definition grants it
 * storefront access. Without this, a storefront query returns nothing for
 * every one of them and the data looks missing when it is not.
 *
 * Idempotent: creates a definition where none exists, and updates one that
 * exists without storefront access. Values already stored are untouched —
 * defining a metafield retroactively covers the metafields already written.
 *
 * Env:
 *   DRY_RUN=1   report what would change, write nothing
 */
const path = require("path");
const fs = require("fs");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (fs.existsSync(p)) require("dotenv").config({ path: p });
}

const DRY_RUN = process.env.DRY_RUN === "1";
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
const NAMESPACE = "linx";

/**
 * Every key the sync writes, plus the ones it is about to. Types must match
 * what is already stored — Shopify refuses a definition whose type disagrees
 * with existing values.
 */
const DEFINITIONS = [
  { key: "tagline", name: "Tagline", type: "single_line_text_field" },
  { key: "specs", name: "Specs", type: "json" },
  { key: "show_specs", name: "Show specs", type: "boolean" },
  { key: "schematic_image", name: "Schematic image", type: "single_line_text_field" },
  { key: "sub_category", name: "Sub category", type: "single_line_text_field" },
  { key: "installation_guide", name: "Installation guide", type: "multi_line_text_field" },
  { key: "insulating_set_price", name: "Insulating set price", type: "single_line_text_field" },
  { key: "flashing_finder", name: "Flashing finder", type: "json" },
  { key: "finishes", name: "Finishes", type: "json" },
  { key: "flashings", name: "Flashings", type: "json" },
  // Written from fix 2 onwards.
  { key: "attributes", name: "Attributes", type: "json" },
  { key: "product_sections", name: "Product sections", type: "json" },
  { key: "technical_drawings", name: "Technical drawings", type: "json" },
  { key: "features", name: "Features", type: "json" },
  { key: "tier_prices", name: "Tier prices", type: "json" },
  { key: "rrp_inc_vat", name: "RRP inc VAT", type: "single_line_text_field" },
  // Pooky's configurator axes — a lamp is assembled from these, so without
  // them the product page has nothing to build a selection from.
  { key: "bases", name: "Bases", type: "json" },
  { key: "shades", name: "Shades", type: "json" },
  { key: "pendants", name: "Pendants", type: "json" },
  { key: "wall_fittings", name: "Wall fittings", type: "json" },
  // Populated on nearly every product but never synced anywhere until now.
  { key: "efficiency", name: "Efficiency", type: "json" },
  { key: "dimension_rows", name: "Dimension rows", type: "json" },
  { key: "review_summary", name: "Review summary", type: "json" },
  { key: "size_options", name: "Size options", type: "json" },
  { key: "manuals", name: "Manuals", type: "json" },
];

async function adminToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  }
  const res = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  const j = await res.json();
  if (!j.access_token) {
    throw new Error("token exchange failed: " + JSON.stringify(j).slice(0, 200));
  }
  return j.access_token;
}

async function admin(token, query, variables) {
  const res = await fetch(`https://${DOMAIN}/admin/api/${VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 400));
  return j.data;
}

async function main() {
  const token = await adminToken();
  console.log("admin token: ok");
  console.log("store       : " + DOMAIN);
  console.log(DRY_RUN ? "mode        : DRY RUN\n" : "");

  const existing = await admin(
    token,
    `query($ns: String!) {
       metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: $ns) {
         nodes { key name type { name } access { storefront } }
       }
     }`,
    { ns: NAMESPACE },
  );

  const byKey = new Map(
    (existing.metafieldDefinitions.nodes || []).map((d) => [d.key, d]),
  );
  console.log("existing definitions in namespace `" + NAMESPACE + "`: " + byKey.size);
  for (const d of byKey.values()) {
    console.log(
      "  " + d.key.padEnd(24) + String(d.type?.name).padEnd(24) +
        "storefront=" + (d.access?.storefront || "?"),
    );
  }
  console.log("");

  let created = 0;
  let updated = 0;
  let alreadyOk = 0;
  let failed = 0;

  for (const def of DEFINITIONS) {
    const found = byKey.get(def.key);

    if (found && found.access?.storefront === "PUBLIC_READ") {
      alreadyOk += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log((found ? "[dry] would UPDATE " : "[dry] would CREATE ") + def.key);
      found ? (updated += 1) : (created += 1);
      continue;
    }

    try {
      if (found) {
        const r = await admin(
          token,
          `mutation($def: MetafieldDefinitionUpdateInput!) {
             metafieldDefinitionUpdate(definition: $def) {
               updatedDefinition { key }
               userErrors { field message }
             }
           }`,
          {
            def: {
              namespace: NAMESPACE,
              key: def.key,
              ownerType: "PRODUCT",
              access: { storefront: "PUBLIC_READ" },
            },
          },
        );
        const errs = r.metafieldDefinitionUpdate.userErrors || [];
        if (errs.length) {
          console.log("  UPDATE " + def.key + " -> " + errs.map((e) => e.message).join("; "));
          failed += 1;
        } else {
          console.log("  updated " + def.key);
          updated += 1;
        }
      } else {
        const r = await admin(
          token,
          `mutation($def: MetafieldDefinitionInput!) {
             metafieldDefinitionCreate(definition: $def) {
               createdDefinition { key }
               userErrors { field message code }
             }
           }`,
          {
            def: {
              namespace: NAMESPACE,
              key: def.key,
              name: def.name,
              type: def.type,
              ownerType: "PRODUCT",
              access: { storefront: "PUBLIC_READ" },
            },
          },
        );
        const errs = r.metafieldDefinitionCreate.userErrors || [];
        if (errs.length) {
          console.log("  CREATE " + def.key + " -> " + errs.map((e) => e.message).join("; "));
          failed += 1;
        } else {
          console.log("  created " + def.key);
          created += 1;
        }
      }
    } catch (e) {
      console.log("  ERROR " + def.key + " -> " + String(e.message).slice(0, 200));
      failed += 1;
    }
  }

  console.log(
    "\n" + (DRY_RUN ? "[dry] " : "") + "created " + created + ", updated " + updated +
      ", already correct " + alreadyOk + ", failed " + failed,
  );
  if (!DRY_RUN && (created || updated)) {
    console.log("\nStorefront API can now read these. Re-run the depth check to confirm.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
