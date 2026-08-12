/**
 * Migrate Linx Glass "Roof Lanterns" (CIRRUS in Supabase) → Linx Living under FAKRO brand.
 * Menus: Roof Lanterns → Style A / Style B
 * Products: all 58 with exact Cloudinary image URLs + full content fields.
 *
 * Usage:
 *   node scripts/migrate-roof-lanterns-to-fakro.cjs
 *   DRY_RUN=1 node scripts/migrate-roof-lanterns-to-fakro.cjs
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

const SOURCE_URL = (process.env.SOURCE_SUPABASE_URL || "").replace(/\/$/, "");
const SOURCE_KEY = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "1";
const DEFAULT_STOCK = Number(process.env.DEFAULT_STOCK || 25);
const MAX_GALLERY = Math.max(0, Number(process.env.MAX_GALLERY_IMAGES || 12));
const SOURCE_TAG = "roof-lanterns-supabase";
const DEPARTMENT = "rooflights-and-glass";

/** Live Glass TypeTile covers (Playwright scrape). */
const TYPE_TILE_IMAGES = {
  "style-a":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784796517/linx-products/cirrus/cir-a-1000x1250-1.png",
  "style-b":
    "https://res.cloudinary.com/dkuqdi0ho/image/upload/v1784797078/linx-products/cirrus/cir-b-1000x1250-1.png",
};

const headers = {
  apikey: SOURCE_KEY,
  Authorization: `Bearer ${SOURCE_KEY}`,
  Accept: "application/json",
};

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanText(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function supabaseGet(pathname) {
  const res = await fetch(`${SOURCE_URL}${pathname}`, { headers });
  if (!res.ok) {
    throw new Error(
      `Supabase ${res.status} ${pathname}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return res.json();
}

async function supabasePaged(pathname, pageSize = 1000) {
  const rows = [];
  let from = 0;
  for (;;) {
    const res = await fetch(`${SOURCE_URL}${pathname}`, {
      headers: {
        ...headers,
        Range: `${from}-${from + pageSize - 1}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok) {
      throw new Error(
        `Supabase page ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    const chunk = await res.json();
    if (!Array.isArray(chunk) || !chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function absUrl(pathOrUrl) {
  const raw = cleanText(pathOrUrl);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/fakro-products/")) {
    return `https://www.linxglass.co.uk${raw}`;
  }
  if (raw.startsWith("image/upload/")) {
    return `https://res.cloudinary.com/dkuqdi0ho/${raw}`;
  }
  return `https://res.cloudinary.com/dkuqdi0ho/image/upload/${raw.replace(/^\//, "")}`;
}

function buildImageList(primary, gallery) {
  const urls = [];
  const push = (u) => {
    const abs = absUrl(u);
    if (abs && !urls.includes(abs)) urls.push(abs);
  };
  push(primary);
  for (const g of gallery || []) push(g);
  return urls;
}

function applySpecRows(specs, rows) {
  for (const row of rows || []) {
    const key = cleanText(row.label || row.key || row.name);
    const value = cleanText(row.value ?? row.val);
    if (key && value && specs[key] == null) specs[key] = value;
  }
}

function buildSpecs(product) {
  const specs = {
    sku: product.sku,
    source: SOURCE_TAG,
    sourceId: product.id,
    glassBrand: "cirrus",
    glassCategory: product.category,
  };
  if (product.product_code) specs.productCode = product.product_code;
  if (product.size) specs.size = product.size;
  if (product.base_title) specs.baseTitle = product.base_title;
  if (product.sale_percent != null) specs.salePercent = product.sale_percent;

  if (Array.isArray(product.technical_specs) && product.technical_specs.length) {
    applySpecRows(specs, product.technical_specs);
  } else {
    applySpecRows(specs, [
      product.category && { label: "Product type", value: product.category },
      product.product_code && {
        label: "Product code",
        value: product.product_code,
      },
      product.sku && { label: "SKU", value: product.sku },
      product.size && { label: "Size", value: product.size },
      product.price != null && {
        label: "Price (ex VAT)",
        value: `£${product.price}`,
      },
      { label: "Material", value: "Aluminium" },
      { label: "Warranty", value: "10-year guarantee" },
      { label: "Availability", value: "3-5 working days" },
    ].filter(Boolean));
  }
  return specs;
}

function buildDescription(product) {
  const rawLong = String(product.long_description || "").trim();
  if (rawLong) {
    const cleaned = rawLong
      .split(/\n+/)
      .map((line) => cleanText(line))
      .filter(Boolean)
      .join("\n\n");
    if (cleaned) return cleaned;
  }
  const highlights = Array.isArray(product.highlights)
    ? product.highlights.map(cleanText).filter((h) => h && h.length > 20)
    : [];
  if (highlights.length) return [...new Set(highlights)].slice(0, 8).join("\n\n");

  const short = cleanText(product.short_description);
  if (short && short.length > 8) {
    return `${short}\n\nCIRRUS aluminium roof lantern — Style A and Style B systems that flood interiors with natural light while delivering outstanding thermal performance.\n\nSurvey, supply and professional installation available across London & the South East.`;
  }
  return `${cleanText(product.title) || "Roof Lantern"}\n\nCIRRUS aluminium roof lantern with outstanding thermal performance.\n\nSurvey, supply and professional installation available across London & the South East.`;
}

async function ensureMenu(db, { name, slug, parent, brandId, order, isActive, image, level }) {
  const menus = db.collection("menus");
  const query = parent
    ? { slug, parent, brand: brandId }
    : { slug, parent: null, brand: brandId };
  let menu = DRY_RUN ? null : await menus.findOne(query);
  const now = new Date();
  if (!menu) {
    const insert = {
      name,
      slug,
      parent: parent || null,
      brand: brandId,
      order: order ?? 0,
      isActive: isActive !== false,
      image: image || "",
      level: level || (parent ? "subcategory" : "category"),
      createdAt: now,
      updatedAt: now,
    };
    if (DRY_RUN) {
      menu = { ...insert, _id: `dry-${slug}` };
      console.log(`[dry] + menu ${name}`);
    } else {
      const r = await menus.insertOne(insert);
      menu = { ...insert, _id: r.insertedId };
      console.log(`+ menu ${name} (${slug})`);
    }
  } else if (!DRY_RUN) {
    await menus.updateOne(
      { _id: menu._id },
      {
        $set: {
          name,
          order: order ?? menu.order ?? 0,
          isActive: isActive !== false,
          ...(image ? { image } : {}),
          level: level || menu.level || (parent ? "subcategory" : "category"),
          brand: brandId,
          updatedAt: now,
        },
      },
    );
    console.log(`· menu ${name}`);
    menu = { ...menu, image: image || menu.image };
  }
  return menu;
}

async function main() {
  if (!SOURCE_URL || !SOURCE_KEY) {
    throw new Error("Missing SOURCE_SUPABASE_* in .env.migrate");
  }
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");

  console.log(DRY_RUN ? "Mode: DRY_RUN" : "Mode: WRITE");

  console.log("Fetching Roof Lanterns category…");
  const categories = await supabaseGet(
    "/rest/v1/shop_categories?slug=eq.roof-lanterns&select=*",
  );
  if (!categories.length) throw new Error("Roof Lanterns category not found");
  const cat = categories[0];
  console.log(`  ${cat.name} brand=${cat.brand} id=${cat.id}`);

  console.log("Fetching types…");
  const types = await supabaseGet(
    `/rest/v1/shop_category_types?category_id=eq.${cat.id}&select=*&order=sort_order.asc`,
  );
  console.log(`  ${types.length} types:`, types.map((t) => t.slug).join(", "));
  const typeById = new Map(types.map((t) => [t.id, t]));

  console.log("Fetching products…");
  let products = await supabasePaged(
    `/rest/v1/shop_products?category=eq.${encodeURIComponent("Roof Lanterns")}&select=*&order=sku.asc`,
  );
  console.log(`  ${products.length} products`);

  console.log("Fetching galleries…");
  const skus = [...new Set(products.map((p) => p.sku).filter(Boolean))];
  const galleryBySku = new Map();
  for (let i = 0; i < skus.length; i += 80) {
    const chunk = skus.slice(i, i + 80);
    const rows = await supabaseGet(
      `/rest/v1/shop_product_images?sku=in.(${chunk.map(encodeURIComponent).join(",")})&select=sku,image_url,sort_order&order=sort_order.asc`,
    );
    for (const row of rows) {
      if (!galleryBySku.has(row.sku)) galleryBySku.set(row.sku, []);
      galleryBySku.get(row.sku).push(row.image_url);
    }
  }
  console.log(`  gallery for ${galleryBySku.size} skus`);

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const brand = await db.collection("brands").findOne({ slug: "fakro" });
  if (!brand) throw new Error("FAKRO brand missing in Living Mongo");
  const brandId = brand._id;
  console.log(`Using brand FAKRO (${brandId})`);

  const parentMenu = await ensureMenu(db, {
    name: "Roof Lanterns",
    slug: "roof-lanterns",
    parent: null,
    brandId,
    order: cat.sort_order ?? 40,
    isActive: true,
    image: TYPE_TILE_IMAGES["style-a"],
    level: "category",
  });

  const menuByTypeId = new Map();
  for (const type of types) {
    const image =
      TYPE_TILE_IMAGES[type.slug] ||
      absUrl(type.image_path) ||
      TYPE_TILE_IMAGES["style-a"];
    const menu = await ensureMenu(db, {
      name: type.name,
      slug: type.slug || slugify(type.name),
      parent: parentMenu._id,
      brandId,
      order: type.sort_order ?? 0,
      isActive: type.is_active !== false,
      image,
      level: "subcategory",
    });
    menuByTypeId.set(type.id, menu);
  }

  const productsCol = db.collection("products");
  const report = { created: 0, updated: 0, errors: [] };

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const label = `${product.sku} · ${cleanText(product.title).slice(0, 50)}`;
    try {
      const type = product.category_type_id
        ? typeById.get(product.category_type_id)
        : null;
      const typeMenu = product.category_type_id
        ? menuByTypeId.get(product.category_type_id)
        : null;
      const subCategorySlug = typeMenu?.slug || type?.slug || "";

      const gallery = (galleryBySku.get(product.sku) || []).slice(0, MAX_GALLERY);
      const images = buildImageList(product.image_path, gallery);

      const price = Number(product.price);
      const stock =
        product.stock_quantity == null
          ? DEFAULT_STOCK
          : Number(product.stock_quantity);

      const highlights = Array.isArray(product.highlights)
        ? product.highlights.map(cleanText).filter(Boolean)
        : [];
      const technicalSpecs = Array.isArray(product.technical_specs)
        ? product.technical_specs
        : [];

      const now = new Date();
      const payload = {
        name: cleanText(product.title) || product.sku || "Roof Lantern",
        description: buildDescription(product),
        price: Number.isFinite(price) ? price : 0,
        images,
        department: DEPARTMENT,
        category: "roof-lanterns",
        subCategory: subCategorySlug,
        brand: brandId,
        brands: [brandId],
        linxSku: product.sku || "",
        manufacturerSku: product.sku || "",
        productCode: cleanText(product.product_code) || "",
        stock: Number.isFinite(stock) ? stock : DEFAULT_STOCK,
        tagline: [product.product_code, product.size]
          .map(cleanText)
          .filter(Boolean)
          .join(" · "),
        specs: buildSpecs(product),
        showSpecs: true,
        salePercent:
          product.sale_percent != null ? Number(product.sale_percent) : null,
        highlights,
        longDescription: cleanText(product.long_description) || "",
        installationGuide: cleanText(product.installation_guide) || "",
        descriptionSourceUrl: cleanText(product.description_source_url) || "",
        updatedAt: now,
      };

      // Keep technical specs in extras-friendly shape if schema supports
      if (technicalSpecs.length) {
        payload.technicalSpecs = technicalSpecs;
      }

      if (DRY_RUN) {
        if (i < 3) {
          console.log(
            `[dry] ${label} → roof-lanterns/${subCategorySlug} £${payload.price} imgs=${images.length}`,
          );
        }
        report.created++;
        continue;
      }

      const existing = await productsCol.findOne({
        $or: [
          { "specs.sku": product.sku, "specs.source": SOURCE_TAG },
          { linxSku: product.sku, brand: brandId },
          { "specs.sku": product.sku, brand: brandId },
        ],
      });

      if (existing) {
        const update = { ...payload };
        if (!images.length) delete update.images;
        await productsCol.updateOne({ _id: existing._id }, { $set: update });
        report.updated++;
      } else {
        await productsCol.insertOne({ ...payload, createdAt: now });
        report.created++;
      }

      if ((i + 1) % 20 === 0 || i === 0 || i === products.length - 1) {
        console.log(
          `  … ${i + 1}/${products.length} created=${report.created} updated=${report.updated}`,
        );
      }
    } catch (err) {
      report.errors.push({ sku: product.sku, error: err.message });
      console.error(`  ✗ ${label}:`, err.message);
    }
  }

  const verifyCount = await productsCol.countDocuments({
    brand: brandId,
    category: "roof-lanterns",
  });
  const bySub = await productsCol
    .aggregate([
      { $match: { brand: brandId, category: "roof-lanterns" } },
      { $group: { _id: "$subCategory", n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  console.log("\n========== ROOF LANTERNS → FAKRO ==========");
  console.log(`Created: ${report.created}`);
  console.log(`Updated: ${report.updated}`);
  console.log(`Mongo products under Fakro/roof-lanterns: ${verifyCount}`);
  console.log("By subtype:", bySub);
  if (report.errors.length) {
    console.log("Errors:", report.errors.slice(0, 10));
  }

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
