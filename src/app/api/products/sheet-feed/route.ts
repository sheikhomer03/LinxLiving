import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { Brand } from "@/models/Brand";
import { Supplier } from "@/models/Supplier";

/**
 * Product feed for the Google Sheet's Apps Script sync.
 *
 * Auth (same convention as /api/cron/supplier-sync):
 *   Authorization: Bearer $PRODUCT_SHEET_SECRET     — or ?secret=…
 *
 * Paging is a keyset cursor on (createdAt, _id) rather than skip/limit, so
 * products inserted mid-sync can't shift rows and cause skips or duplicates.
 *
 *   GET /api/products/sheet-feed?limit=500
 *   GET /api/products/sheet-feed?limit=500&afterDate=2026-08-01T00:00:00.000Z&afterId=<id>
 *   GET /api/products/sheet-feed?brand=Natura%20Flooring     — single brand
 *   GET /api/products/sheet-feed?columns=1                   — header row only
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Must stay in step with scripts/lib/product-rows.cjs. */
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
] as const;

const DESC_MAX = 1500;

function plain(html: unknown): string {
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

function cell(s: unknown, max = DESC_MAX): string {
  const t = plain(s);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function num(v: unknown): number | "" {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : "";
}

function dimsText(p: any): string {
  const parts: string[] = [];
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

function specsText(p: any): string {
  const s = p.specs;
  if (!s || typeof s !== "object") return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(s)) {
    if (v == null || v === "" || typeof v === "object") continue;
    parts.push(`${k}: ${v}`);
  }
  return cell(parts.join(" | "), 600);
}

/** Product document → array in COLUMNS order. */
function toRow(
  p: any,
  brandName: (id: unknown) => string,
  supplierName: (id: unknown) => string,
): (string | number)[] {
  const primary = brandName(p.brand);
  const extra = (p.brands || [])
    .map((b: unknown) => brandName(b))
    .filter((n: string) => n && n !== primary);
  const imgs = (p.images || []).filter(
    (s: unknown) => typeof s === "string" && s.trim(),
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

  return [
    String(p._id || ""),
    primary || "(no brand)",
    p.subBrand || "",
    extra.join(", "),
    p.name || "",
    String(sku || ""),
    p.barcode || "",
    p.department || "",
    p.category || "",
    p.subCategory || "",
    num(p.price),
    num(p.tradePrice),
    num(p.costPrice),
    num(p.vatRate),
    num(p.stock),
    p.stockStatus || "",
    cell(p.tagline, 500),
    cell(p.shortDescription, 600),
    cell(p.description),
    cell((p.features || []).join(" | "), 2000),
    cell(
      [
        ...(p.colours || []),
        ...(p.colorOptions || []).map((c: any) => c?.name).filter(Boolean),
      ].join(", "),
      1000,
    ),
    (p.materials || []).join(", "),
    p.finish || "",
    (p.sizeOptions || []).map((s: any) => s?.name).filter(Boolean).join(", "),
    dimsText(p),
    specsText(p),
    p.warranty || "",
    num(p.leadTimeDays),
    (p.variants || []).length,
    (p.downloads || []).length,
    imgs.length,
    imgs[0] || "",
    supplierName(p.supplier),
    p.shopifyProductId || "",
    p.createdAt
      ? new Date(p.createdAt).toISOString().slice(0, 19).replace("T", " ")
      : "",
  ];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.PRODUCT_SHEET_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const querySecret = url.searchParams.get("secret") || "";

  if (!secret || (bearer !== secret && querySecret !== secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Lets the Apps Script write its header without pulling any rows.
  if (url.searchParams.get("columns")) {
    return NextResponse.json({ columns: COLUMNS });
  }

  try {
    await connectDB();

    const limit = Math.min(
      2000,
      Math.max(1, parseInt(url.searchParams.get("limit") || "500", 10) || 500),
    );
    const afterDate = url.searchParams.get("afterDate");
    const afterId = url.searchParams.get("afterId");
    const brand = (url.searchParams.get("brand") || "").trim();

    const brands = await Brand.find({}, { name: 1, slug: 1 }).lean();
    const brandById = new Map(brands.map((b: any) => [String(b._id), b]));
    const brandName = (id: unknown) => {
      const b = id ? brandById.get(String(id)) : null;
      return (b as any)?.name || (b as any)?.slug || "";
    };

    const suppliers = await Supplier.find({}, { name: 1 }).lean();
    const supplierById = new Map(suppliers.map((s: any) => [String(s._id), s]));
    const supplierName = (id: unknown) =>
      (id ? (supplierById.get(String(id)) as any)?.name : "") || "";

    const query: Record<string, unknown> = {};

    // Keyset cursor: strictly after (createdAt, _id) of the last row sent.
    if (afterDate) {
      const d = new Date(afterDate);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "afterDate is not a valid date" },
          { status: 400 },
        );
      }
      query.$or = afterId
        ? [{ createdAt: { $gt: d } }, { createdAt: d, _id: { $gt: afterId } }]
        : [{ createdAt: { $gt: d } }];
    }

    if (brand) {
      const match = brands.filter(
        (b: any) =>
          String(b.name || "").toLowerCase() === brand.toLowerCase() ||
          String(b.slug || "").toLowerCase() === brand.toLowerCase(),
      );
      if (!match.length) {
        return NextResponse.json(
          {
            error: `No brand called "${brand}"`,
            available: brands.map((b: any) => b.name).filter(Boolean).sort(),
          },
          { status: 400 },
        );
      }
      query.brand = { $in: match.map((b: any) => b._id) };
    }

    const docs = await Product.find(query)
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .lean();

    const rows = docs.map((p: any) => toRow(p, brandName, supplierName));
    const last = docs[docs.length - 1] as any;

    return NextResponse.json({
      columns: COLUMNS,
      rows,
      count: rows.length,
      // Feed these back as afterDate/afterId to get the next page.
      nextAfterDate: last?.createdAt
        ? new Date(last.createdAt).toISOString()
        : null,
      nextAfterId: last ? String(last._id) : null,
      hasMore: rows.length === limit,
    });
  } catch (err: any) {
    console.error("[sheet-feed]", err);
    return NextResponse.json(
      { error: err?.message || "Feed failed" },
      { status: 500 },
    );
  }
}
