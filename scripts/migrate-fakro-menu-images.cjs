/**
 * Migrate Fakro category/subcategory cover images from Linx Glass (Supabase)
 * onto Linx Living menus — using the exact same Cloudinary URLs.
 *
 * Linx Glass sources:
 *  - Parent covers: shop_categories.image_path (active parents)
 *  - Type covers: shop_category_types.image_path (loft ladders)
 *  - Legacy flat categories (inactive) hold curated covers for pitched/blinds
 *    types that Living stores as subcategories
 *  - Fallback: first Cloudinary product image for that type (same as Glass Shop UI)
 *
 * Usage:
 *   node scripts/migrate-fakro-menu-images.cjs --dry
 *   node scripts/migrate-fakro-menu-images.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env.migrate"),
  override: false,
});

const { connectMongo } = require("./mongo-connect.cjs");

const DRY = process.argv.includes("--dry");
const BASE = process.env.SOURCE_SUPABASE_URL;
const KEY = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
const SOURCE_CLOUD = process.env.SOURCE_CLOUDINARY_CLOUD_NAME || "dkuqdi0ho";

if (!BASE || !KEY) {
  console.error("Missing SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  Accept: "application/json",
};

/**
 * Legacy Linx Glass shop_categories (inactive flat list) → Living parent/child slug.
 * These hold the curated covers Glass used for those product lines.
 */
const LEGACY_CAT_TO_LIVING = {
  "pitched-roof-windows": { parent: null, slug: "pitched-roof-windows" },
  "flat-roof-windows": { parent: null, slug: "flat-roof-windows" },
  "blinds-accessories": { parent: null, slug: "blinds-accessories" },
  "loft-ladders": { parent: null, slug: "loft-ladders" },
  "centre-pivot-roof-windows": {
    parent: "pitched-roof-windows",
    slug: "centre-pivot",
  },
  "top-hung-roof-windows": { parent: "pitched-roof-windows", slug: "top-hung" },
  "high-pivot-roof-windows": {
    parent: "pitched-roof-windows",
    slug: "high-pivot",
  },
  "balcony-windows": { parent: "pitched-roof-windows", slug: "balcony" },
  "l-shape-combination-roof-windows": {
    parent: "pitched-roof-windows",
    slug: "l-shape-combination",
  },
  "light-tunnels": { parent: "pitched-roof-windows", slug: "light-tunnels" },
  electricals: { parent: "pitched-roof-windows", slug: "electricals" },
  "flashing-kits": { parent: "pitched-roof-windows", slug: "flashing-kits" },
  "z-wave-electrical-roof-windows": {
    parent: "pitched-roof-windows",
    slug: "electric-solar",
  },
  "access-roof-windows": { parent: "flat-roof-windows", slug: "roof-access" },
  blinds: { parent: "blinds-accessories", slug: "blinds" },
  accessories: { parent: "blinds-accessories", slug: "accessories" },
};

async function supabaseGet(pathname) {
  const res = await fetch(`${BASE}${pathname}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status} ${pathname}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function supabasePaged(pathname) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const res = await fetch(`${BASE}${pathname}`, {
      headers: {
        ...headers,
        Range: `${from}-${from + pageSize - 1}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Supabase page ${res.status} ${pathname}: ${body.slice(0, 300)}`,
      );
    }
    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function cleanText(v) {
  return String(v || "").trim();
}

function slugify(name) {
  return cleanText(name)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveCoverUrl(pathOrUrl) {
  const raw = cleanText(pathOrUrl);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const cleaned = raw.replace(/^\//, "");
  if (cleaned.startsWith("image/upload/")) {
    return `https://res.cloudinary.com/${SOURCE_CLOUD}/${cleaned}`;
  }
  const file = cleaned.split("/").pop();
  if (file) {
    return `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/linx-products/linx-products/fakro/${file}`;
  }
  return `https://res.cloudinary.com/${SOURCE_CLOUD}/image/upload/${cleaned}`;
}

function isUsableImagePath(url) {
  const raw = cleanText(url);
  if (!raw) return false;
  if (/res\.cloudinary\.com/i.test(raw)) return true;
  if (/^https?:\/\//i.test(raw)) return true;
  if (/^\/?fakro-products\//i.test(raw)) return true;
  if (/\.(jpe?g|png|webp|gif)$/i.test(raw)) return true;
  return false;
}

async function main() {
  console.log(DRY ? "Mode: DRY RUN (no writes)" : "Mode: WRITE");

  const categories = await supabaseGet(
    "/rest/v1/shop_categories?brand=ilike.*fakro*&select=id,name,slug,image_path,sort_order,is_active&order=sort_order.asc",
  );
  const catIds = categories.map((c) => c.id);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const types =
    catIds.length === 0
      ? []
      : await supabaseGet(
          `/rest/v1/shop_category_types?category_id=in.(${catIds.join(",")})&select=id,category_id,name,slug,image_path,sort_order,is_active&order=sort_order.asc`,
        );

  console.log(
    `Linx Glass: ${categories.length} categories, ${types.length} types`,
  );

  // Desired image per Living menu key: "slug" for roots, "parent/slug" for children
  /** @type {Map<string, { image: string, source: string }>} */
  const desired = new Map();

  // 1) Active parent category covers
  for (const c of categories) {
    const slug = c.slug || slugify(c.name);
    const image = resolveCoverUrl(c.image_path);
    if (!image) continue;
    const mapping = LEGACY_CAT_TO_LIVING[slug];
    if (!mapping) continue;
    const key = mapping.parent
      ? `${mapping.parent}/${mapping.slug}`
      : mapping.slug;
    // Active parents / later type covers may overwrite; seed from all Glass cats first
    if (!desired.has(key) || c.is_active) {
      desired.set(key, {
        image,
        source: `shop_categories:${slug}${c.is_active ? "" : "(legacy)"}`,
      });
    }
  }

  // 2) Type covers from shop_category_types (highest priority for that type)
  for (const t of types) {
    const parent = catById.get(t.category_id);
    const parentSlug = parent?.slug || slugify(parent?.name || "");
    const slug = t.slug || slugify(t.name);
    const image = resolveCoverUrl(t.image_path);
    if (!image) continue;
    const key = `${parentSlug}/${slug}`;
    desired.set(key, {
      image,
      source: `shop_category_types:${key}`,
    });
  }

  // 3) Product fallback for types still missing (matches Glass Shop tile behaviour)
  const missingTypeKeys = types
    .map((t) => {
      const parent = catById.get(t.category_id);
      const parentSlug = parent?.slug || slugify(parent?.name || "");
      const slug = t.slug || slugify(t.name);
      return { type: t, key: `${parentSlug}/${slug}` };
    })
    .filter((x) => !desired.has(x.key));

  if (missingTypeKeys.length) {
    const typeIds = missingTypeKeys.map((x) => x.type.id);
    console.log(
      `Fetching product fallbacks for ${missingTypeKeys.length} types without cover…`,
    );
    const products = await supabasePaged(
      `/rest/v1/shop_products?category_type_id=in.(${typeIds.join(",")})&select=category_type_id,sku,image_path,is_active&order=sku.asc`,
    );
    const byType = new Map();
    for (const p of products) {
      if (!p.category_type_id || !isUsableImagePath(p.image_path)) continue;
      const list = byType.get(p.category_type_id) || [];
      list.push(p);
      byType.set(p.category_type_id, list);
    }
    for (const { type, key } of missingTypeKeys) {
      const list = byType.get(type.id) || [];
      // Prefer Cloudinary, then any usable path (local /fakro-products/ packshots)
      const ranked = [...list].sort((a, b) => {
        const ac = /cloudinary/i.test(a.image_path || "") ? 1 : 0;
        const bc = /cloudinary/i.test(b.image_path || "") ? 1 : 0;
        if (bc !== ac) return bc - ac;
        const aa = a.is_active === false ? 0 : 1;
        const ba = b.is_active === false ? 0 : 1;
        return ba - aa;
      });
      const pick = ranked[0];
      if (!pick?.image_path) continue;
      desired.set(key, {
        image: resolveCoverUrl(pick.image_path),
        source: `product_fallback:${pick.sku}`,
      });
    }
  }

  // Parent blinds/loft without image: use first child cover
  for (const parentSlug of ["blinds-accessories", "loft-ladders"]) {
    if (desired.has(parentSlug)) continue;
    const child = [...desired.entries()].find(([k]) =>
      k.startsWith(`${parentSlug}/`),
    );
    if (child) {
      desired.set(parentSlug, {
        image: child[1].image,
        source: `from_child:${child[0]}`,
      });
    }
  }

  console.log(`\nDesired covers (${desired.size}):`);
  for (const [key, v] of [...desired.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    console.log(`  ${key}\n    ← ${v.source}\n    ${v.image}`);
  }

  await connectMongo();
  const db = require("mongoose").connection.db;
  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  if (!brand) throw new Error("FAKRO brand missing in Linx Living Mongo");

  const menus = await db
    .collection("menus")
    .find({ brand: brand._id })
    .project({ name: 1, slug: 1, parent: 1, image: 1 })
    .toArray();

  const parents = menus.filter((m) => !m.parent);
  const children = menus.filter((m) => m.parent);
  const parentById = new Map(parents.map((p) => [String(p._id), p]));
  const parentBySlug = new Map(parents.map((p) => [p.slug, p]));

  /** @type {Map<string, any[]>} */
  const menusByKey = new Map();
  for (const p of parents) {
    const arr = menusByKey.get(p.slug) || [];
    arr.push(p);
    menusByKey.set(p.slug, arr);
  }
  for (const ch of children) {
    const p = parentById.get(String(ch.parent));
    if (!p) continue;
    const key = `${p.slug}/${ch.slug}`;
    const arr = menusByKey.get(key) || [];
    arr.push(ch);
    menusByKey.set(key, arr);
  }

  const report = {
    updated: [],
    skippedSame: [],
    missingMenu: [],
    noImage: [],
  };

  for (const [key, { image, source }] of desired) {
    const targets = menusByKey.get(key) || [];
    if (!targets.length) {
      report.missingMenu.push({ key, image, source });
      continue;
    }
    for (const menu of targets) {
      if ((menu.image || "") === image) {
        report.skippedSame.push({ key, id: String(menu._id) });
        continue;
      }
      if (!DRY) {
        await db.collection("menus").updateOne(
          { _id: menu._id },
          { $set: { image, updatedAt: new Date() } },
        );
      }
      report.updated.push({
        key,
        id: String(menu._id),
        name: menu.name,
        before: menu.image || "",
        after: image,
        source,
      });
    }
  }

  // Living menus with no desired image
  for (const [key, list] of menusByKey) {
    if (desired.has(key)) continue;
    for (const m of list) {
      report.noImage.push({
        key,
        name: m.name,
        current: m.image || "",
      });
    }
  }

  console.log("\n── Result ──");
  console.log(
    `${DRY ? "Would update" : "Updated"}: ${report.updated.length}`,
  );
  console.log(`Already same: ${report.skippedSame.length}`);
  console.log(`Desired but no Living menu: ${report.missingMenu.length}`);
  console.log(`Living menus without Glass cover: ${report.noImage.length}`);

  for (const row of report.updated) {
    console.log(
      `\n  ${row.key} (${row.name})\n    source: ${row.source}\n    after:  ${row.after}\n    before: ${row.before || "(empty)"}`,
    );
  }
  if (report.missingMenu.length) {
    console.log("\nUnmatched desired keys:", report.missingMenu);
  }
  if (report.noImage.length) {
    console.log("\nStill no cover:");
    for (const row of report.noImage) {
      console.log(`  ${row.key} — ${row.name}`);
    }
  }

  const fs = require("fs");
  const out = require("path").join(
    __dirname,
    "_tmp-fakro-menu-images-report.json",
  );
  fs.writeFileSync(out, JSON.stringify({ desired: Object.fromEntries(desired), report }, null, 2));
  console.log(`\nWrote ${out}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
