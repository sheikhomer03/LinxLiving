/**
 * Shared product → row mapping.
 *
 * Used by both the XLSX export (export-brand-products-xlsx.cjs) and the
 * Google Sheet sync (sync-products-to-google-sheet.cjs) so the two never
 * drift apart on columns or formatting.
 */

/** Column order. The Google Sheet header row must match this exactly. */
const COLUMNS = [
  "Product ID",
  "Brand",
  "Sub Brand",
  "Other Brands",
  "Product Name",
  "SKU",
  "Barcode",
  "Department",
  "Category",
  "Subcategory",
  "Price (£)",
  "Trade Price (£)",
  "Cost Price (£)",
  "VAT %",
  "Stock",
  "Stock Status",
  "Tagline",
  "Short Description",
  "Description",
  "Features",
  "Colours",
  "Materials",
  "Finish",
  "Sizes",
  "Dimensions",
  "Specs",
  "Warranty",
  "Lead Time (days)",
  "Variants",
  "Downloads",
  "Images",
  "Main Image",
  "Supplier",
  "Shopify ID",
  "Created At",
];

/**
 * Cell length cap. Long descriptions bloat the XLSX badly (~50MB at 8k chars)
 * and Google Sheets hard-caps a cell at 50000 chars.
 */
const DESC_MAX = Number(process.env.DESC_MAX) || 1500;

/** Strip HTML tags / entities so descriptions read cleanly in a cell. */
function plain(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cell(s, max = DESC_MAX) {
  const t = plain(s);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : "";
}

/** Flatten the free-form `dimensions` map / `dimensionRows` into one string. */
function dimsText(p) {
  const parts = [];
  if (p.dimensions && typeof p.dimensions === "object") {
    for (const [k, v] of Object.entries(p.dimensions)) {
      if (v == null || v === "") continue;
      parts.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
    }
  }
  for (const r of p.dimensionRows || []) {
    if (r?.label) parts.push(`${r.label}: ${r.value || ""}`.trim());
  }
  return cell(parts.join(" | "), 600);
}

function specsText(p) {
  const s = p.specs;
  if (!s || typeof s !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(s)) {
    if (v == null || v === "" || typeof v === "object") continue;
    parts.push(`${k}: ${v}`);
  }
  return cell(parts.join(" | "), 600);
}

/**
 * Load the brand / supplier lookups a row build needs.
 * @param {import("mongodb").Db} db
 */
async function loadLookups(db) {
  const brands = await db
    .collection("brands")
    .find({})
    .project({ name: 1, slug: 1 })
    .toArray();
  const brandById = new Map(brands.map((b) => [String(b._id), b]));

  const suppliers = await db
    .collection("suppliers")
    .find({})
    .project({ name: 1 })
    .toArray()
    .catch(() => []);
  const supplierById = new Map(suppliers.map((s) => [String(s._id), s]));

  return {
    brandName(id) {
      const b = id ? brandById.get(String(id)) : null;
      return b?.name || b?.slug || "";
    },
    supplierName(id) {
      return supplierById.get(String(id))?.name || "";
    },
  };
}

/** Build one keyed row object for a product document. */
function buildRow(p, lookups) {
  const primary = lookups.brandName(p.brand);
  const extra = (p.brands || [])
    .map((b) => lookups.brandName(b))
    .filter((n) => n && n !== primary);
  const imgs = (p.images || []).filter(
    (s) => typeof s === "string" && s.trim(),
  );
  const sku =
    p.linxSku ||
    p.productCode ||
    p.supplierSku ||
    p.manufacturerSku ||
    p.specs?.sku ||
    p.specs?.productCode ||
    p.specs?.SKU ||
    p.specs?.["Product code"] ||
    "";

  return {
    "Product ID": String(p._id || ""),
    Brand: primary || "(no brand)",
    "Sub Brand": p.subBrand || "",
    "Other Brands": extra.join(", "),
    "Product Name": p.name || "",
    SKU: String(sku || ""),
    Barcode: p.barcode || "",
    Department: p.department || "",
    Category: p.category || "",
    Subcategory: p.subCategory || "",
    "Price (£)": num(p.price),
    "Trade Price (£)": num(p.tradePrice),
    "Cost Price (£)": num(p.costPrice),
    "VAT %": num(p.vatRate),
    Stock: num(p.stock),
    "Stock Status": p.stockStatus || "",
    Tagline: cell(p.tagline, 500),
    "Short Description": cell(p.shortDescription, 600),
    Description: cell(p.description),
    Features: cell((p.features || []).join(" | "), 2000),
    Colours: cell(
      [
        ...(p.colours || []),
        ...(p.colorOptions || []).map((c) => c?.name).filter(Boolean),
      ].join(", "),
      1000,
    ),
    Materials: (p.materials || []).join(", "),
    Finish: p.finish || "",
    Sizes: (p.sizeOptions || []).map((s) => s?.name).filter(Boolean).join(", "),
    Dimensions: dimsText(p),
    Specs: specsText(p),
    Warranty: p.warranty || "",
    "Lead Time (days)": num(p.leadTimeDays),
    Variants: (p.variants || []).length,
    Downloads: (p.downloads || []).length,
    Images: imgs.length,
    "Main Image": imgs[0] || "",
    Supplier: lookups.supplierName(p.supplier),
    "Shopify ID": p.shopifyProductId || "",
    "Created At": p.createdAt
      ? new Date(p.createdAt).toISOString().slice(0, 19).replace("T", " ")
      : "",
  };
}

/** Build the variant rows for a product (empty when it has no variants). */
function buildVariantRows(p, lookups) {
  const primary = lookups.brandName(p.brand);
  return (p.variants || []).map((v) => ({
    Brand: primary || "(no brand)",
    "Product Name": p.name || "",
    "Variant Name": v?.name || "",
    "Variant SKU": v?.sku || "",
    "Variant Price (£)": num(v?.price),
    "Variant Trade Price (£)": num(v?.tradePrice),
    "Compare At (£)": num(v?.compareAtPrice),
    Stock: num(v?.stock),
    Available: v?.available === false ? "no" : "yes",
    "Option 1": v?.option1 || "",
    "Option 2": v?.option2 || "",
    "Option 3": v?.option3 || "",
    Barcode: v?.barcode || "",
  }));
}

/** Keyed row object → array in COLUMNS order (what the Sheets API wants). */
function rowToArray(row) {
  return COLUMNS.map((c) => {
    const v = row[c];
    return v == null ? "" : v;
  });
}

/** Sort comparator: brand → category → name. */
function compareRows(a, b) {
  return (
    String(a.Brand).localeCompare(String(b.Brand)) ||
    String(a.Category).localeCompare(String(b.Category)) ||
    String(a["Product Name"]).localeCompare(String(b["Product Name"]))
  );
}

module.exports = {
  COLUMNS,
  DESC_MAX,
  plain,
  cell,
  num,
  loadLookups,
  buildRow,
  buildVariantRows,
  rowToArray,
  compareRows,
};
