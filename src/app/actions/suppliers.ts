"use server";

import connectDB from "@/lib/mongodb";
import { Supplier } from "@/models/Supplier";
import { Brand } from "@/models/Brand";
import { Product } from "@/models/Product";
import { revalidatePath } from "next/cache";
import { uploadImageToCloudinary } from "@/app/actions/storage";
import mongoose from "mongoose";
import { calculateSellPrice } from "@/lib/pricingEngine";

function slugFromName(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseSupplierForm(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const slug =
    String(formData.get("slug") || "").trim() || slugFromName(name);
  const contactName = String(formData.get("contactName") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const whatsapp = String(formData.get("whatsapp") || "").trim() || phone;
  const website = String(formData.get("website") || "").trim();
  const address = String(formData.get("address") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const isActive = formData.get("isActive") !== "false";
  const isImport = formData.get("isImport") === "true";
  const order = parseInt(String(formData.get("order") || "0"), 10) || 0;
  const priority = parseInt(String(formData.get("priority") || "100"), 10) || 100;
  const leadRaw = String(formData.get("defaultLeadTimeDays") || "").trim();
  const defaultLeadTimeDays = leadRaw === "" ? null : Number(leadRaw);
  const marginRaw = String(formData.get("defaultMarginPercent") || "").trim();
  const defaultMarginPercent =
    marginRaw === "" ? 35 : Number(marginRaw);
  const integrationType = String(
    formData.get("integrationType") || "manual",
  ).trim();
  const apiEndpoint = String(formData.get("apiEndpoint") || "").trim();
  const feedUrl = String(formData.get("feedUrl") || "").trim();
  const feedFormat = String(formData.get("feedFormat") || "").trim();
  const country = String(formData.get("country") || "GB").trim() || "GB";
  const currency = String(formData.get("currency") || "GBP").trim() || "GBP";
  let logo = String(formData.get("logoUrl") || "").trim();
  const removeLogo = formData.get("removeLogo") === "true";
  if (removeLogo) logo = "";

  return {
    name,
    slug,
    contactName,
    email,
    phone,
    whatsapp,
    website,
    address,
    notes,
    isActive,
    isImport,
    order,
    priority,
    country,
    currency,
    integrationType,
    apiEndpoint,
    feedUrl,
    feedFormat,
    defaultLeadTimeDays:
      defaultLeadTimeDays != null && Number.isFinite(defaultLeadTimeDays)
        ? defaultLeadTimeDays
        : null,
    defaultMarginPercent: Number.isFinite(defaultMarginPercent)
      ? defaultMarginPercent
      : 35,
    logo,
    logoFile: formData.get("logo"),
    removeLogo,
  };
}

async function resolveLogoUrl(
  logoFile: FormDataEntryValue | null,
  currentLogo: string,
) {
  if (
    logoFile &&
    typeof logoFile !== "string" &&
    "arrayBuffer" in logoFile &&
    (logoFile as File).size > 0
  ) {
    const upload = await uploadImageToCloudinary(
      logoFile as File,
      "linx-living/suppliers",
    );
    if (!upload.success || !upload.url) {
      throw new Error("Logo upload failed");
    }
    return upload.url;
  }
  return currentLogo;
}

export async function getSuppliers() {
  try {
    await connectDB();
    const suppliers = await Supplier.find()
      .sort({ order: 1, name: 1 })
      .lean();
    return {
      success: true,
      suppliers: JSON.parse(JSON.stringify(suppliers)),
    };
  } catch (error) {
    console.error("Failed to fetch suppliers:", error);
    return { success: false, suppliers: [] };
  }
}

export async function getActiveSuppliers() {
  try {
    await connectDB();
    const suppliers = await Supplier.find({ isActive: true })
      .sort({ order: 1, name: 1 })
      .lean();
    return {
      success: true,
      suppliers: JSON.parse(JSON.stringify(suppliers)),
    };
  } catch (error) {
    console.error("Failed to fetch active suppliers:", error);
    return { success: false, suppliers: [] };
  }
}

export async function getSupplier(id: string) {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const supplier = await Supplier.findById(id).lean();
    return supplier ? JSON.parse(JSON.stringify(supplier)) : null;
  } catch (error) {
    console.error("Failed to fetch supplier:", error);
    return null;
  }
}

/** Resolve supplier for a product: product.supplier → brand.supplier */
export async function getSupplierForProduct(productId: string) {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(productId)) return null;
    const product = await Product.findById(productId)
      .select("supplier brand")
      .lean();
    if (!product) return null;

    let supplierId =
      (product as any).supplier != null
        ? String((product as any).supplier)
        : "";

    if (!supplierId && (product as any).brand) {
      const brand = await Brand.findById((product as any).brand)
        .select("supplier")
        .lean();
      if ((brand as any)?.supplier) {
        supplierId = String((brand as any).supplier);
      }
    }

    if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
      return null;
    }

    const supplier = await Supplier.findOne({
      _id: supplierId,
      isActive: true,
    }).lean();
    return supplier ? JSON.parse(JSON.stringify(supplier)) : null;
  } catch (error) {
    console.error("Failed to resolve product supplier:", error);
    return null;
  }
}

export async function createSupplier(formData: FormData) {
  try {
    await connectDB();
    const data = parseSupplierForm(formData);
    if (!data.name) return { success: false, error: "Name is required" };

    const existing = await Supplier.findOne({ slug: data.slug });
    if (existing) {
      return { success: false, error: "A supplier with this slug already exists" };
    }

    let logo = data.logo;
    try {
      logo = await resolveLogoUrl(data.logoFile, logo);
    } catch (e: any) {
      return { success: false, error: e?.message || "Logo upload failed" };
    }

    const supplier = await Supplier.create({
      name: data.name,
      slug: data.slug,
      contactName: data.contactName,
      email: data.email,
      phone: data.phone,
      whatsapp: data.whatsapp,
      website: data.website,
      address: data.address,
      notes: data.notes,
      logo,
      isActive: data.isActive,
      isImport: data.isImport,
      order: data.order,
      priority: data.priority,
      country: data.country,
      currency: data.currency,
      integrationType: data.integrationType,
      apiEndpoint: data.apiEndpoint,
      feedUrl: data.feedUrl,
      feedFormat: data.feedFormat,
      defaultLeadTimeDays: data.defaultLeadTimeDays,
      defaultMarginPercent: data.defaultMarginPercent,
    });

    revalidatePath("/admin/suppliers");
    return {
      success: true,
      supplier: JSON.parse(JSON.stringify(supplier)),
    };
  } catch (error) {
    console.error("Failed to create supplier:", error);
    return { success: false, error: "Creation failed" };
  }
}

export async function updateSupplier(id: string, formData: FormData) {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return { success: false, error: "Invalid supplier" };
    }

    const data = parseSupplierForm(formData);
    if (!data.name) return { success: false, error: "Name is required" };

    const slugTaken = await Supplier.findOne({
      slug: data.slug,
      _id: { $ne: id },
    });
    if (slugTaken) {
      return { success: false, error: "A supplier with this slug already exists" };
    }

    const current = await Supplier.findById(id);
    if (!current) return { success: false, error: "Supplier not found" };

    let logo = data.removeLogo ? "" : data.logo || current.logo || "";
    try {
      logo = await resolveLogoUrl(data.logoFile, logo);
    } catch (e: any) {
      return { success: false, error: e?.message || "Logo upload failed" };
    }

    const updated = await Supplier.findByIdAndUpdate(
      id,
      {
        name: data.name,
        slug: data.slug,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        whatsapp: data.whatsapp,
        website: data.website,
        address: data.address,
        notes: data.notes,
        logo,
        isActive: data.isActive,
        isImport: data.isImport,
        order: data.order,
        priority: data.priority,
        country: data.country,
        currency: data.currency,
        integrationType: data.integrationType,
        apiEndpoint: data.apiEndpoint,
        feedUrl: data.feedUrl,
        feedFormat: data.feedFormat,
        defaultLeadTimeDays: data.defaultLeadTimeDays,
        defaultMarginPercent: data.defaultMarginPercent,
      },
      { new: true },
    );

    revalidatePath("/admin/suppliers");
    revalidatePath("/admin/brands");
    revalidatePath("/admin/products");
    return {
      success: true,
      supplier: JSON.parse(JSON.stringify(updated)),
    };
  } catch (error) {
    console.error("Failed to update supplier:", error);
    return { success: false, error: "Update failed" };
  }
}

export async function deleteSupplier(id: string) {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return { success: false, error: "Invalid supplier" };
    }

    const brandCount = await Brand.countDocuments({ supplier: id });
    const productCount = await Product.countDocuments({ supplier: id });
    if (brandCount > 0 || productCount > 0) {
      return {
        success: false,
        error: `Cannot delete: linked to ${brandCount} brand(s) and ${productCount} product(s). Unlink them first or set inactive.`,
      };
    }

    await Supplier.findByIdAndDelete(id);
    revalidatePath("/admin/suppliers");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete supplier:", error);
    return { success: false, error: "Delete failed" };
  }
}

export async function getSupplierByBrandSlug(brandSlug: string) {
  try {
    await connectDB();
    const slug = String(brandSlug || "").trim().toLowerCase();
    if (!slug) return null;
    const brand = await Brand.findOne({ slug }).select("supplier").lean();
    if (!(brand as any)?.supplier) return null;
    const supplier = await Supplier.findOne({
      _id: (brand as any).supplier,
      isActive: true,
    }).lean();
    return supplier ? JSON.parse(JSON.stringify(supplier)) : null;
  } catch (error) {
    console.error("Failed to fetch supplier by brand:", error);
    return null;
  }
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const splitRow = (line: string) => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  const headers = splitRow(lines[0]).map((h) =>
    h.toLowerCase().replace(/\s+/g, ""),
  );
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function numOrNull(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * CSV columns (header row required):
 *   sku | supplierSku | productId | costPrice | marginPercent | leadTimeDays | stock | applyMargin
 *
 * Match priority: productId → supplierSku → sku (specs.sku)
 * Optional: supplierId to also set product.supplier
 * applyMargin=1 recalculates sell price from cost + margin
 */
export async function importSupplierCostCsv(formData: FormData) {
  try {
    await connectDB();
    const file = formData.get("file");
    const supplierIdRaw = String(formData.get("supplierId") || "").trim();
    const defaultSupplierId =
      supplierIdRaw && mongoose.Types.ObjectId.isValid(supplierIdRaw)
        ? supplierIdRaw
        : null;

    if (!file || typeof file === "string" || !("arrayBuffer" in file)) {
      return { success: false, error: "CSV file is required" };
    }

    const text = Buffer.from(await (file as File).arrayBuffer()).toString(
      "utf8",
    );
    const rows = parseCsv(text);
    if (!rows.length) {
      return { success: false, error: "CSV has no data rows" };
    }

    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = i + 2;
      const productId = (row.productid || row.id || "").trim();
      const supplierSku = (row.suppliersku || row.supplier_sku || "").trim();
      const sku = (row.sku || row.productcode || row.product_code || "").trim();

      let product: any = null;
      if (productId && mongoose.Types.ObjectId.isValid(productId)) {
        product = await Product.findById(productId);
      }
      if (!product && supplierSku) {
        product = await Product.findOne({ supplierSku });
      }
      if (!product && sku) {
        product = await Product.findOne({ "specs.sku": sku });
      }
      if (!product) {
        skipped += 1;
        if (errors.length < 20) {
          errors.push(`Line ${line}: product not found`);
        }
        continue;
      }

      const costPrice = numOrNull(row.costprice || row.cost || "");
      const marginPercent = numOrNull(
        row.marginpercent || row.margin || row.margin_percent || "",
      );
      const leadTimeDays = numOrNull(
        row.leadtimedays || row.leadtime || row.lead_time_days || "",
      );
      const stock = numOrNull(row.stock || row.qty || "");
      const applyMargin =
        String(row.applymargin || row.apply_margin || "").trim() === "1" ||
        String(formData.get("applyMargin") || "") === "true";

      const deliveryCost = numOrNull(row.deliverycost || row.delivery || "");
      const now = new Date();
      const $set: Record<string, unknown> = { updatedAt: now };
      if (supplierSku) $set.supplierSku = supplierSku;
      if (costPrice != null) {
        $set.costPrice = costPrice;
        $set.priceSyncedAt = now;
      }
      if (deliveryCost != null) $set.deliveryCost = deliveryCost;
      if (marginPercent != null) $set.marginPercent = marginPercent;
      if (leadTimeDays != null) $set.leadTimeDays = leadTimeDays;
      if (stock != null) {
        const qty = Math.max(0, Math.floor(stock));
        $set.stock = qty;
        $set.isOutOfStock = qty <= 0;
        $set.stockSyncedAt = now;
      }

      const rowSupplier = (row.supplierid || "").trim();
      const supplierToSet =
        rowSupplier && mongoose.Types.ObjectId.isValid(rowSupplier)
          ? rowSupplier
          : defaultSupplierId;
      if (supplierToSet) $set.supplier = supplierToSet;

      if (applyMargin && costPrice != null && costPrice >= 0) {
        const priced = calculateSellPrice({
          costPrice,
          deliveryCost:
            deliveryCost ?? (product as any).deliveryCost ?? null,
          importCost: (product as any).importCost,
          dutyCost: (product as any).dutyCost,
          packagingCost: (product as any).packagingCost,
          handlingCost: (product as any).handlingCost,
          overheadCost: (product as any).overheadCost,
          marginPercent:
            marginPercent ?? (product as any).marginPercent ?? 35,
          vatRate: (product as any).vatRate ?? 20,
        });
        $set.price = priced.sellPriceExVat;
        $set.priceSyncedAt = now;
      }

      await Product.updateOne({ _id: product._id }, { $set });
      updated += 1;
    }

    revalidatePath("/admin/products");
    revalidatePath("/admin/suppliers");
    revalidatePath("/");
    return {
      success: true,
      updated,
      skipped,
      total: rows.length,
      errors,
    };
  } catch (error) {
    console.error("CSV import failed:", error);
    return { success: false, error: "CSV import failed" };
  }
}
