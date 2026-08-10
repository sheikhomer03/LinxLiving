"use server";

import connectDB from "@/lib/mongodb";
import { User } from "@/models/User";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { Menu } from "@/models/Menu";
import { Brand } from "@/models/Brand";
import { Collection } from "@/models/Collection";
import { Supplier } from "@/models/Supplier";
import { cache } from "react";
import { revalidatePath, updateTag, unstable_cache } from "next/cache";
import { uploadImageToCloudinary } from "@/app/actions/storage";
import mongoose from "mongoose";
import {
  createShopifyProduct,
  deleteShopifyProduct,
  isShopifySyncEnabled,
  updateShopifyProduct,
} from "@/lib/shopify";
import { parseProductExtrasFromFormData } from "@/lib/productExtras";

function numOrNull(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function slugifyLabel(value: string) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Parse optional Brand.subBrands[] from FormData JSON (array of names or {name,slug}). */
function parseSubBrandsFromFormData(formData: FormData): { name: string; slug: string }[] {
  const raw = String(formData.get("subBrands") || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: { name: string; slug: string }[] = [];
    for (const item of parsed) {
      const name =
        typeof item === "string"
          ? item.trim()
          : String(item?.name || "").trim();
      if (!name) continue;
      const slug =
        (typeof item === "object" && item?.slug
          ? slugifyLabel(String(item.slug))
          : "") || slugifyLabel(name);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push({ name, slug });
    }
    return out;
  } catch {
    return [];
  }
}

function parseOptionalSubBrandSlug(formData: FormData) {
  return slugifyLabel(String(formData.get("subBrand") || "").trim());
}

function parseProductCostingFromFormData(formData: FormData) {
  return {
    linxSku: String(formData.get("linxSku") || "").trim(),
    supplierSku: String(formData.get("supplierSku") || "").trim(),
    manufacturerSku: String(formData.get("manufacturerSku") || "").trim(),
    costPrice: numOrNull(String(formData.get("costPrice") || "")),
    importCost: numOrNull(String(formData.get("importCost") || "")),
    deliveryCost: numOrNull(String(formData.get("deliveryCost") || "")),
    dutyCost: numOrNull(String(formData.get("dutyCost") || "")),
    packagingCost: numOrNull(String(formData.get("packagingCost") || "")),
    handlingCost: numOrNull(String(formData.get("handlingCost") || "")),
    overheadCost: numOrNull(String(formData.get("overheadCost") || "")),
    marginPercent: numOrNull(String(formData.get("marginPercent") || "")),
    vatRate: numOrNull(String(formData.get("vatRate") || "")) ?? 20,
    leadTimeDays: numOrNull(String(formData.get("leadTimeDays") || "")),
    warranty: String(formData.get("warranty") || "").trim(),
    complianceCertificates: (() => {
      try {
        const raw = String(formData.get("complianceCertificates") || "[]");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
          ? parsed.map((u) => String(u).trim()).filter(Boolean)
          : [];
      } catch {
        return [];
      }
    })(),
  };
}

async function resolveBrandName(brandId: string | null) {
  if (!brandId || !mongoose.Types.ObjectId.isValid(brandId)) return null;
  const brand = await Brand.findById(brandId).select("name").lean();
  return brand?.name ?? null;
}

async function syncProductToShopify(
  product: {
    _id: { toString(): string };
    name: string;
    description: string;
    price: number;
    stock: number;
    category: string;
    subCategory?: string | null;
    brand?: string | null;
    images?: string[];
    tagline?: string | null;
    specs?: Record<string, unknown>;
    showSpecs?: boolean | null;
    schematicImage?: string | null;
    installationGuide?: string | null;
    insulatingSetPrice?: number | null;
    flashingFinder?: unknown;
    finishes?: unknown;
    flashings?: unknown;
    shopifyProductId?: string | null;
    shopifyVariantId?: string | null;
  },
  mode: "create" | "update",
) {
  if (!isShopifySyncEnabled()) return { synced: false as const };

  try {
    const brandName = await resolveBrandName(
      product.brand ? String(product.brand) : null,
    );
    const payload = {
      name: product.name,
      description: product.description,
      price: product.price,
      stock: product.stock,
      category: product.category,
      subCategory: product.subCategory,
      brandName,
      images: product.images ?? [],
      tagline: product.tagline,
      specs: product.specs ?? {},
      showSpecs: product.showSpecs,
      schematicImage: product.schematicImage,
      installationGuide: product.installationGuide,
      insulatingSetPrice: product.insulatingSetPrice,
      flashingFinder: product.flashingFinder,
      finishes: product.finishes,
      flashings: product.flashings,
      shopifyProductId: product.shopifyProductId,
      shopifyVariantId: product.shopifyVariantId,
    };

    const ids =
      mode === "create" || !product.shopifyProductId
        ? await createShopifyProduct(payload)
        : await updateShopifyProduct(payload);

    await Product.findByIdAndUpdate(product._id, {
      shopifyProductId: ids.productId,
      shopifyVariantId: ids.variantId,
      shopifySyncError: null,
      shopifySyncedAt: new Date(),
    });

    return { synced: true as const, ...ids };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Shopify sync failed";
    console.error("Shopify product sync failed:", message);
    await Product.findByIdAndUpdate(product._id, {
      shopifySyncError: message,
      shopifySyncedAt: new Date(),
    });
    return { synced: false as const, error: message };
  }
}

export async function getProducts(page = 1, limit = 50, search = "") {
  try {
    await connectDB();
    const skip = (page - 1) * limit;
    const q = String(search || "").trim();
    const filter: Record<string, unknown> = {};
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = { $regex: escaped, $options: "i" };
      const tokens = escaped
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 1);
      const tokenClauses = tokens.map((token) => ({
        $or: [
          { name: { $regex: token, $options: "i" } },
          { category: { $regex: token, $options: "i" } },
          { subCategory: { $regex: token, $options: "i" } },
          { sku: { $regex: token, $options: "i" } },
          { productCode: { $regex: token, $options: "i" } },
          { barcode: { $regex: token, $options: "i" } },
          { "specs.size": { $regex: token, $options: "i" } },
        ],
      }));
      filter.$or = [
        { name: rx },
        { category: rx },
        { subCategory: rx },
        { department: rx },
        { sku: rx },
        { productCode: rx },
        { barcode: rx },
        { "specs.size": rx },
        ...(tokenClauses.length > 1 ? [{ $and: tokenClauses }] : []),
      ];
    }
    const [products, totalCount] = await Promise.all([
      Product.find(filter)
        .select("name price stock category subCategory images")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);
    return {
      products: JSON.parse(JSON.stringify(products)),
      totalCount,
    };
  } catch (error) {
    console.error("Failed to fetch products:", error);
    return { products: [], totalCount: 0 };
  }
}

export async function getProduct(id: string) {
  try {
    await connectDB();
    const product = await Product.findById(id);
    if (!product) return null;
    return JSON.parse(JSON.stringify(product));
  } catch (error) {
    console.error("Failed to fetch product:", error);
    return null;
  }
}

export async function createProduct(formData: FormData) {
  try {
    await connectDB();

    // Extract product details from FormData
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const price = parseFloat(formData.get("price") as string);
    const stock = parseInt(formData.get("stock") as string);
    const category = String(formData.get("category") || "").trim();
    const subCategory = category
      ? String(formData.get("subCategory") || "").trim()
      : "";
    const department = String(formData.get("department") || "").trim();
    const brand = ((formData.get("brand") as string) || "").trim() || null;
    const subBrand = parseOptionalSubBrandSlug(formData);
    const supplierRaw = String(formData.get("supplier") || "").trim();
    const supplier =
      supplierRaw && mongoose.Types.ObjectId.isValid(supplierRaw)
        ? supplierRaw
        : null;
    const costing = parseProductCostingFromFormData(formData);
    const specs = JSON.parse((formData.get("specs") as string) || "{}");
    const showSpecs = formData.get("showSpecs") === "true";
    const tagline = formData.get("tagline") as string;
    let schematicImage = formData.get("schematicImage") as string;
    const extras = parseProductExtrasFromFormData(formData);
    const { parseKeyValueEntries } = await import("@/lib/productFeaturePacking");
    const featureEntries = parseKeyValueEntries(
      formData.get("featureEntries"),
    );
    const packingEntries = parseKeyValueEntries(
      formData.get("packingEntries"),
    );
    const { parseColorOptions } = await import("@/lib/productColors");
    const colorOptions = parseColorOptions(formData.get("colorOptions"));
    const colours = colorOptions.map((c) => c.name).filter(Boolean);
    const { parseSizeOptions } = await import("@/lib/productSizes");
    const sizeOptions = parseSizeOptions(formData.get("sizeOptions"));
    const { parseProductDownloads } = await import("@/lib/productDownloads");
    const downloads = parseProductDownloads(formData.get("downloads"));
    const { parseFilesDocumentation } = await import(
      "@/lib/productFilesDocumentation"
    );
    const filesDocumentation = parseFilesDocumentation(
      formData.get("filesDocumentation"),
    );
    const { parseBritmetDocsFromForm } = await import(
      "@/lib/productBritmetDocs"
    );
    const britmetDocs = parseBritmetDocsFromForm(formData);
    const { parseSuitability } = await import("@/lib/productSuitability");
    const suitability = parseSuitability(formData.get("suitability"));
    const {
      parseNamedGuides,
      parseUsageItems,
      trimRichText,
    } = await import("@/lib/productOttoSections");
    const delivery = trimRichText(formData.get("delivery"));
    const howItsMade = trimRichText(formData.get("howItsMade"));
    const productAndSampleOrders = trimRichText(
      formData.get("productAndSampleOrders"),
    );
    const installationMaintenanceGuides = parseNamedGuides(
      formData.get("installationMaintenanceGuides"),
    );
    const usage = parseUsageItems(formData.get("usage"));
    const {
      parsePookyBases,
      parsePookyShades,
      parsePookyPendants,
      parsePookyWallFittings,
      parsePookyEfficiency,
    } = await import("@/lib/productPookySections");
    const bases = parsePookyBases(formData.get("bases"));
    const shades = parsePookyShades(formData.get("shades"));
    const pendants = parsePookyPendants(formData.get("pendants"));
    const wallFittings = parsePookyWallFittings(formData.get("wallFittings"));
    const efficiency = parsePookyEfficiency(formData.get("efficiency"));

    const schematicFile = formData.get("schematicFile") as File;
    if (schematicFile && schematicFile.size > 0) {
      const uploadResult = await uploadImageToCloudinary(schematicFile);
      if (uploadResult.success && uploadResult.url) {
        schematicImage = uploadResult.url;
      }
    }

    // Process images
    const imageUrls: string[] = [];
    const existingImages = JSON.parse(
      (formData.get("images") as string) || "[]",
    );
    imageUrls.push(...existingImages);

    const imageFiles = formData.getAll("imageFiles") as File[];
    for (const file of imageFiles) {
      if (file.size > 0) {
        const uploadResult = await uploadImageToCloudinary(file);
        if (uploadResult.success && uploadResult.url) {
          imageUrls.push(uploadResult.url);
        }
      }
    }

    const product = await Product.create({
      name,
      description,
      price,
      stock,
      category,
      subCategory,
      department,
      brand,
      subBrand,
      supplier,
      ...costing,
      isOutOfStock: stock <= 0,
      specs,
      showSpecs,
      featureEntries,
      packingEntries,
      colorOptions,
      colours,
      sizeOptions,
      downloads,
      filesDocumentation,
      ...britmetDocs,
      suitability,
      delivery,
      howItsMade,
      productAndSampleOrders,
      installationMaintenanceGuides,
      usage,
      bases,
      shades,
      pendants,
      wallFittings,
      efficiency,
      images: imageUrls,
      tagline,
      schematicImage,
      ...extras,
    });

    const shopify = await syncProductToShopify(product.toObject(), "create");
    const refreshed = await Product.findById(product._id);

    revalidatePath("/admin/products");
    revalidatePath("/admin");
    revalidatePath("/");
    updateTag("navigation");
    return {
      success: true,
      product: JSON.parse(JSON.stringify(refreshed ?? product)),
      shopify,
    };
  } catch (error) {
    console.error("Failed to create product:", error);
    return { success: false, error: "Creation failed" };
  }
}

export async function updateProduct(id: string, formData: FormData) {
  try {
    await connectDB();

    // Extract product details from FormData
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const price = parseFloat(formData.get("price") as string);
    const stock = parseInt(formData.get("stock") as string);
    const category = String(formData.get("category") || "").trim();
    const subCategory = category
      ? String(formData.get("subCategory") || "").trim()
      : "";
    const department = String(formData.get("department") || "").trim();
    const brand = ((formData.get("brand") as string) || "").trim() || null;
    const subBrand = parseOptionalSubBrandSlug(formData);
    const supplierRaw = String(formData.get("supplier") || "").trim();
    const supplier =
      supplierRaw && mongoose.Types.ObjectId.isValid(supplierRaw)
        ? supplierRaw
        : null;
    const costing = parseProductCostingFromFormData(formData);
    const specs = JSON.parse((formData.get("specs") as string) || "{}");
    const showSpecs = formData.get("showSpecs") === "true";
    const tagline = formData.get("tagline") as string;
    let schematicImage = formData.get("schematicImage") as string;
    const extras = parseProductExtrasFromFormData(formData);
    const { parseKeyValueEntries } = await import("@/lib/productFeaturePacking");
    const featureEntries = parseKeyValueEntries(
      formData.get("featureEntries"),
    );
    const packingEntries = parseKeyValueEntries(
      formData.get("packingEntries"),
    );
    const { parseColorOptions } = await import("@/lib/productColors");
    const colorOptions = parseColorOptions(formData.get("colorOptions"));
    const colours = colorOptions.map((c) => c.name).filter(Boolean);
    const { parseSizeOptions } = await import("@/lib/productSizes");
    const sizeOptions = parseSizeOptions(formData.get("sizeOptions"));
    const { parseProductDownloads } = await import("@/lib/productDownloads");
    const downloads = parseProductDownloads(formData.get("downloads"));
    const { parseFilesDocumentation } = await import(
      "@/lib/productFilesDocumentation"
    );
    const filesDocumentation = parseFilesDocumentation(
      formData.get("filesDocumentation"),
    );
    const { parseBritmetDocsFromForm } = await import(
      "@/lib/productBritmetDocs"
    );
    const britmetDocs = parseBritmetDocsFromForm(formData);
    const { parseSuitability } = await import("@/lib/productSuitability");
    const suitability = parseSuitability(formData.get("suitability"));
    const {
      parseNamedGuides,
      parseUsageItems,
      trimRichText,
    } = await import("@/lib/productOttoSections");
    const delivery = trimRichText(formData.get("delivery"));
    const howItsMade = trimRichText(formData.get("howItsMade"));
    const productAndSampleOrders = trimRichText(
      formData.get("productAndSampleOrders"),
    );
    const installationMaintenanceGuides = parseNamedGuides(
      formData.get("installationMaintenanceGuides"),
    );
    const usage = parseUsageItems(formData.get("usage"));
    const {
      parsePookyBases,
      parsePookyShades,
      parsePookyPendants,
      parsePookyWallFittings,
      parsePookyEfficiency,
    } = await import("@/lib/productPookySections");
    const bases = parsePookyBases(formData.get("bases"));
    const shades = parsePookyShades(formData.get("shades"));
    const pendants = parsePookyPendants(formData.get("pendants"));
    const wallFittings = parsePookyWallFittings(formData.get("wallFittings"));
    const efficiency = parsePookyEfficiency(formData.get("efficiency"));

    const schematicFile = formData.get("schematicFile") as File;
    if (schematicFile && schematicFile.size > 0) {
      const uploadResult = await uploadImageToCloudinary(schematicFile);
      if (uploadResult.success && uploadResult.url) {
        schematicImage = uploadResult.url;
      }
    }

    // Process images
    const imageUrls: string[] = [];
    const existingImages = JSON.parse(
      (formData.get("images") as string) || "[]",
    );
    imageUrls.push(...existingImages);

    const imageFiles = formData.getAll("imageFiles") as File[];
    for (const file of imageFiles) {
      if (file.size > 0) {
        const uploadResult = await uploadImageToCloudinary(file);
        if (uploadResult.success && uploadResult.url) {
          imageUrls.push(uploadResult.url);
        }
      }
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      {
        name,
        description,
        price,
        stock,
        category,
        subCategory,
        department,
        brand,
        subBrand,
        supplier,
        ...costing,
        isOutOfStock: stock <= 0,
        specs,
        showSpecs,
        featureEntries,
        packingEntries,
        colorOptions,
        colours,
        sizeOptions,
        downloads,
        filesDocumentation,
        ...britmetDocs,
        suitability,
        delivery,
        howItsMade,
        productAndSampleOrders,
        installationMaintenanceGuides,
        usage,
        bases,
        shades,
        pendants,
        wallFittings,
        efficiency,
        images: imageUrls,
        tagline,
        schematicImage,
        ...extras,
      },
      { new: true },
    );

    if (!updatedProduct) {
      return { success: false, error: "Product not found" };
    }

    const shopify = await syncProductToShopify(
      updatedProduct.toObject(),
      "update",
    );
    const refreshed = await Product.findById(id);

    revalidatePath("/admin/products");
    revalidatePath("/", "layout");
    updateTag("navigation");
    return {
      success: true,
      product: JSON.parse(JSON.stringify(refreshed ?? updatedProduct)),
      shopify,
    };
  } catch (error) {
    console.error("Failed to update product:", error);
    return { success: false, error: "Update failed" };
  }
}

export async function deleteProduct(id: string) {
  try {
    await connectDB();
    const existing = await Product.findById(id).select("shopifyProductId");
    if (existing?.shopifyProductId && isShopifySyncEnabled()) {
      try {
        await deleteShopifyProduct(existing.shopifyProductId);
      } catch (error) {
        console.error("Shopify product delete failed:", error);
        // Still delete locally so admin is not blocked
      }
    }
    await Product.findByIdAndDelete(id);
    revalidatePath("/admin/products");
    revalidatePath("/admin");
    revalidatePath("/");
    updateTag("navigation");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete product:", error);
    return { success: false, error: "Deletion failed" };
  }
}

export async function getCustomers(page = 1, limit = 50, search = "") {
  try {
    await connectDB();
    const skip = (page - 1) * limit;
    const q = String(search || "").trim();
    const filter: Record<string, unknown> = { role: "user" };
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = { $regex: escaped, $options: "i" };
      filter.$or = [{ name: rx }, { email: rx }];
    }
    const [customers, totalCount] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    return {
      customers: JSON.parse(JSON.stringify(customers)),
      totalCount,
    };
  } catch (error) {
    console.error("Failed to fetch customers:", error);
    return { customers: [], totalCount: 0 };
  }
}

export async function deleteCustomer(id: string) {
  try {
    await connectDB();
    await User.findByIdAndDelete(id);
    revalidatePath("/admin/customers");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete customer:", error);
    return { success: false, error: "Deletion failed" };
  }
}

export async function getCustomerWithOrders(id: string) {
  try {
    await connectDB();
    const customer = await User.findById(id);
    if (!customer) return null;

    const orders = await Order.find({ user: id }).sort({ createdAt: -1 });

    return {
      customer: JSON.parse(JSON.stringify(customer)),
      orders: JSON.parse(JSON.stringify(orders)),
    };
  } catch (error) {
    console.error("Failed to fetch customer details:", error);
    return null;
  }
}

// --- Brands ---

export async function getBrands() {
  try {
    await connectDB();
    // Ensure Supplier model is registered for populate
    void Supplier;
    const brands = await Brand.find()
      .populate("supplier", "name slug email phone whatsapp website logo isActive")
      .sort({ order: 1, name: 1 })
      .lean();
    return {
      success: true,
      brands: JSON.parse(JSON.stringify(brands)),
    };
  } catch (error) {
    console.error("Failed to fetch brands:", error);
    return { success: false, brands: [] };
  }
}

export async function getActiveBrands() {
  try {
    await connectDB();
    const brands = await Brand.find({ isActive: true })
      .sort({ order: 1, name: 1 })
      .lean();
    return {
      success: true,
      brands: JSON.parse(JSON.stringify(brands)),
    };
  } catch (error) {
    console.error("Failed to fetch active brands:", error);
    return { success: false, brands: [] };
  }
}

function buildMenuTreeFromFlat(menus: any[]) {
  const menuMap = new Map<string, any>();
  const tree: any[] = [];

  menus.forEach((menu: any) => {
    const menuObj = {
      ...menu,
      _id: menu._id.toString(),
      parent: menu.parent ? menu.parent.toString() : null,
      brand: menu.brand ? menu.brand.toString() : null,
      subBrand: String(menu.subBrand || "").trim().toLowerCase(),
      subBrands: Array.isArray(menu.subBrands)
        ? menu.subBrands
            .map((s: any) => String(s || "").trim().toLowerCase())
            .filter(Boolean)
        : String(menu.subBrand || "").trim()
          ? [String(menu.subBrand).trim().toLowerCase()]
          : [],
      department: menu.department ? menu.department.toString() : null,
      children: [] as any[],
    };
    menuMap.set(menuObj._id, menuObj);
  });

  menus.forEach((menu: any) => {
    const id = menu._id.toString();
    const menuObj = menuMap.get(id);
    if (menu.parent) {
      const parent = menuMap.get(menu.parent.toString());
      if (parent) {
        // Keep brand trees isolated when parent/child brands diverge
        const parentBrand = parent.brand ? String(parent.brand) : "";
        const childBrand = menuObj.brand ? String(menuObj.brand) : "";
        if (!parentBrand || !childBrand || parentBrand === childBrand) {
          parent.children.push(menuObj);
        } else {
          tree.push(menuObj);
        }
      } else {
        tree.push(menuObj);
      }
    } else {
      tree.push(menuObj);
    }
  });

  return tree;
}

function firstImageFromMenuTree(menus: any[]): string {
  for (const menu of menus || []) {
    if (typeof menu?.image === "string" && menu.image.trim()) {
      return menu.image.trim();
    }
    for (const child of menu?.children || []) {
      if (typeof child?.image === "string" && child.image.trim()) {
        return child.image.trim();
      }
    }
  }
  return "";
}

function collectMenuSlugs(menus: any[]): string[] {
  const slugs = new Set<string>();
  for (const menu of menus || []) {
    if (menu?.slug) slugs.add(String(menu.slug));
    for (const child of menu?.children || []) {
      if (child?.slug) slugs.add(String(child.slug));
    }
  }
  return [...slugs];
}

/**
 * Brand → menu tree for the navbar. Same on every page and changes only when
 * brands or menus change, but it re-queried on every request (~550ms). Cached
 * under the shared "navigation" tag. Output is unchanged.
 */
export async function getBrandMenuTrees() {
  return cachedBrandMenuTrees();
}

const cachedBrandMenuTrees = unstable_cache(
  async () => buildBrandMenuTrees(),
  ["brand-menu-trees-v25"],
  { revalidate: 300, tags: ["navigation"] },
);

async function buildBrandMenuTrees() {
  try {
    await connectDB();
    // Storefront-only read: brands listed in HIDDEN_BRAND_SLUGS are filtered
    // out of the navbar, homepage and catalogue. Nothing is deleted — the
    // records stay in the database and the admin area (getBrands) still shows
    // them, so hiding is reversible by editing that one list.
    const { HIDDEN_BRAND_SLUGS } = await import("@/lib/hiddenBrands");
    const brands = await Brand.find({
      isActive: true,
      slug: { $nin: HIDDEN_BRAND_SLUGS },
    })
      .sort({ order: 1, name: 1 })
      .lean();
    const menus = await Menu.find().sort({ order: 1, name: 1 }).lean();
    const fullTree = buildMenuTreeFromFlat(menus);

    // Display-only: a brand's own name is not a category. Where one has leaked
    // into the menu tree it is hidden here — the menu record is left untouched
    // in the database and still appears in the admin area.
    const allBrandLabels = new Set(
      (await Brand.find({}).select("name slug").lean()).flatMap((b: any) =>
        [b.name, b.slug]
          .filter(Boolean)
          .map((v: string) => String(v).trim().toLowerCase()),
      ),
    );
    const stripBrandLabels = (nodes: any[]): any[] =>
      (nodes || [])
        .filter(
          (n) =>
            !allBrandLabels.has(String(n?.name || "").trim().toLowerCase()) &&
            !allBrandLabels.has(String(n?.slug || "").trim().toLowerCase()),
        )
        .map((n) => ({ ...n, children: stripBrandLabels(n.children || []) }));

    // Drop accessory menus that only have unpriced products (storefront rule).
    // Important: an unpriced accessory parent (e.g. Noken "Towel Warmers") can
    // still have non-accessory children ("Electric Source"). Keeping the parent
    // just because kids remain would still list that brand under Accessories.
    // Drop the accessory shell and promote surviving children instead.
    const { isAccessoryCategory } = await import("@/lib/accessories");
    const {
      getPricedBrandCategoryKeys,
      brandCategoryKey,
    } = await import("@/lib/pricedBrandCategories");
    const pricedKeys = await getPricedBrandCategoryKeys();

    const pruneMenus = (brandId: string, nodes: any[]): any[] => {
      const out: any[] = [];
      for (const node of nodes || []) {
        const kids = pruneMenus(brandId, node.children || []);
        const isAcc = isAccessoryCategory(node.name, node.slug);
        if (isAcc) {
          const hasPriced = pricedKeys.has(
            brandCategoryKey(brandId, node.slug),
          );
          if (!hasPriced) {
            out.push(...kids);
            continue;
          }
        }
        out.push({ ...node, children: kids });
      }
      return out;
    };

    const brandHasPriced = (brandId: string) => {
      const prefix = `${brandId}::`;
      for (const key of pricedKeys) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    };

    const result = brands.map((brand: any) => {
      const brandId = brand._id.toString();
      const brandMenus = pruneMenus(
        brandId,
        stripBrandLabels(
          fullTree.filter((menu) => {
            const menuBrand = menu.brand ? String(menu.brand) : "";
            return menuBrand === brandId;
          }),
        ),
      );
      const ownImage =
        typeof brand.image === "string" && brand.image.trim()
          ? brand.image.trim()
          : "";
      const uiName = String(brand.uiName || "").trim();
      return {
        _id: brandId,
        /** Real brand name (admin / backend handle). */
        name: brand.name,
        /** Optional shared storefront label. */
        uiName,
        /** Prefer uiName for customer-facing labels. */
        displayName: uiName || String(brand.name || ""),
        slug: brand.slug,
        order: brand.order,
        image: ownImage || firstImageFromMenuTree(brandMenus),
        hasPricedProducts: brandHasPriced(brandId),
        subBrands: Array.isArray(brand.subBrands)
          ? brand.subBrands
              .map((sb: any) => ({
                name: String(sb?.name || "").trim(),
                slug: String(sb?.slug || "").trim().toLowerCase(),
              }))
              .filter((sb: { name: string; slug: string }) => sb.name && sb.slug)
          : [],
        menus: brandMenus,
      };
    });

    // Brands still without an image → product by brand id, then by category menu slugs
    // (Linx Living products often have category menus but brand: null).
    const needingProductImage = result.filter((b) => !b.image);
    if (needingProductImage.length) {
      const { getProductDisplayImage } = await import("@/lib/productImage");
      const brandObjectIds = needingProductImage
        .filter((b) => mongoose.Types.ObjectId.isValid(b._id))
        .map((b) => new mongoose.Types.ObjectId(b._id));

      const productImages = await Product.aggregate<{
        _id: unknown;
        images: string[];
      }>([
        {
          $match: {
            brand: { $in: brandObjectIds },
            images: { $exists: true, $type: "array", $ne: [] },
          },
        },
        {
          $addFields: {
            hasSubcategory: {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $ifNull: ["$subCategory", ""] }, ""] },
                    { $ne: ["$subCategory", null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
        { $sort: { hasSubcategory: -1, updatedAt: -1 } },
        {
          $group: {
            _id: "$brand",
            images: { $first: "$images" },
          },
        },
      ]);

      const imageByBrandId = new Map<string, string>();
      for (const row of productImages) {
        const src = getProductDisplayImage(row.images);
        if (src) imageByBrandId.set(String(row._id), src);
      }

      for (const brand of result) {
        if (!brand.image) {
          brand.image = imageByBrandId.get(brand._id) || "";
        }
      }

      const stillNeeding = result.filter((b) => !b.image);
      for (const brand of stillNeeding) {
        const slugs = collectMenuSlugs(brand.menus);
        if (!slugs.length) continue;

        const product = await Product.findOne({
          $and: [
            {
              $or: [
                { category: { $in: slugs } },
                { subCategory: { $in: slugs } },
              ],
            },
            {
              $or: [
                { brand: null },
                { brand: { $exists: false } },
                ...(mongoose.Types.ObjectId.isValid(brand._id)
                  ? [{ brand: new mongoose.Types.ObjectId(brand._id) }]
                  : []),
              ],
            },
            { "images.0": { $exists: true } },
          ],
        })
          .sort({ updatedAt: -1 })
          .select("images")
          .lean();

        const src = getProductDisplayImage((product as any)?.images);
        if (src) brand.image = src;
      }
    }

    return { success: true, brands: JSON.parse(JSON.stringify(result)) };
  } catch (error) {
    console.error("Failed to fetch brand menu trees:", error);
    return { success: false, brands: [] };
  }
}

export async function createBrand(formData: FormData) {
  try {
    await connectDB();
    const name = (formData.get("name") as string)?.trim();
    const uiName = String(formData.get("uiName") || "").trim();
    const slug =
      (formData.get("slug") as string)?.trim() ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const order = parseInt((formData.get("order") as string) || "0", 10);
    const isActive = formData.get("isActive") !== "false";
    const supplierRaw = String(formData.get("supplier") || "").trim();
    const supplier =
      supplierRaw && mongoose.Types.ObjectId.isValid(supplierRaw)
        ? supplierRaw
        : null;
    const imageFile = formData.get("image");
    let image = ((formData.get("imageUrl") as string) || "").trim();
    const subBrands = parseSubBrandsFromFormData(formData);

    if (
      imageFile &&
      typeof imageFile !== "string" &&
      "arrayBuffer" in imageFile &&
      (imageFile as File).size > 0
    ) {
      const upload = await uploadImageToCloudinary(
        imageFile as File,
        "linx-living/brands",
      );
      if (!upload.success || !upload.url) {
        return { success: false, error: "Image upload failed" };
      }
      image = upload.url;
    }

    const existing = await Brand.findOne({ slug });
    if (existing) {
      return { success: false, error: "A brand with this slug already exists" };
    }

    const brand = await Brand.create({
      name,
      uiName,
      slug,
      order,
      isActive,
      supplier,
    });
    await Brand.collection.updateOne(
      { _id: brand._id },
      { $set: { image: image || "", supplier, subBrands, uiName } },
    );

    const saved = await Brand.collection.findOne({ _id: brand._id });

    if (isShopifySyncEnabled()) {
      try {
        const { pushBrandAsCollection } = await import(
          "@/lib/shopify/sync-collection"
        );
        const shopifyId = await pushBrandAsCollection({
          name,
          slug,
          image: image || "",
        });
        if (shopifyId) {
          await Brand.collection.updateOne(
            { _id: brand._id },
            {
              $set: {
                shopifyCollectionId: shopifyId,
                shopifySyncedAt: new Date(),
                shopifySyncError: null,
              },
            },
          );
        }
      } catch (error) {
        console.error("Shopify brand sync failed:", error);
        await Brand.collection.updateOne(
          { _id: brand._id },
          {
            $set: {
              shopifySyncError:
                error instanceof Error ? error.message : "Brand sync failed",
            },
          },
        );
      }
    }

    const refreshed = await Brand.collection.findOne({ _id: brand._id });
    revalidatePath("/admin/brands");
    revalidatePath("/");
    updateTag("navigation");
    return { success: true, brand: JSON.parse(JSON.stringify(refreshed || saved)) };
  } catch (error) {
    console.error("Failed to create brand:", error);
    return { success: false, error: "Creation failed" };
  }
}

export async function updateBrand(id: string, formData: FormData) {
  try {
    await connectDB();
    const name = (formData.get("name") as string)?.trim();
    const uiName = String(formData.get("uiName") || "").trim();
    const slug = (formData.get("slug") as string)?.trim();
    const order = parseInt((formData.get("order") as string) || "0", 10);
    const isActive = formData.get("isActive") !== "false";
    const supplierRaw = String(formData.get("supplier") || "").trim();
    const supplier =
      supplierRaw && mongoose.Types.ObjectId.isValid(supplierRaw)
        ? new mongoose.Types.ObjectId(supplierRaw)
        : null;
    const imageFile = formData.get("image");
    const removeImage = formData.get("removeImage") === "true";
    let image = ((formData.get("imageUrl") as string) || "").trim();
    const subBrands = parseSubBrandsFromFormData(formData);
    const hasNewFile =
      !!imageFile &&
      typeof imageFile !== "string" &&
      "arrayBuffer" in imageFile &&
      (imageFile as File).size > 0;

    if (hasNewFile) {
      const upload = await uploadImageToCloudinary(
        imageFile as File,
        "linx-living/brands",
      );
      if (!upload.success || !upload.url) {
        return { success: false, error: "Image upload failed" };
      }
      image = upload.url;
    } else if (removeImage) {
      image = "";
    }

    const duplicate = await Brand.findOne({ slug, _id: { $ne: id } });
    if (duplicate) {
      return { success: false, error: "A brand with this slug already exists" };
    }

    const shouldUpdateImage =
      hasNewFile || removeImage || formData.has("imageUrl");

    const baseSet: Record<string, unknown> = {
      name,
      uiName,
      slug,
      order,
      isActive,
      supplier,
      subBrands,
      updatedAt: new Date(),
    };
    if (shouldUpdateImage) baseSet.image = image;

    await Brand.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set: baseSet },
    );

    const brand = await Brand.collection.findOne({
      _id: new mongoose.Types.ObjectId(id),
    });

    if (brand && isShopifySyncEnabled()) {
      try {
        const { pushBrandAsCollection } = await import(
          "@/lib/shopify/sync-collection"
        );
        const shopifyId = await pushBrandAsCollection({
          name: brand.name,
          slug: brand.slug,
          image: brand.image || "",
          shopifyCollectionId: brand.shopifyCollectionId,
        });
        if (shopifyId) {
          await Brand.collection.updateOne(
            { _id: brand._id },
            {
              $set: {
                shopifyCollectionId: shopifyId,
                shopifySyncedAt: new Date(),
                shopifySyncError: null,
              },
            },
          );
        }
      } catch (error) {
        console.error("Shopify brand sync failed:", error);
      }
    }

    const refreshed = await Brand.collection.findOne({
      _id: new mongoose.Types.ObjectId(id),
    });
    revalidatePath("/admin/brands");
    revalidatePath("/");
    updateTag("navigation");
    return { success: true, brand: JSON.parse(JSON.stringify(refreshed || brand)) };
  } catch (error) {
    console.error("Failed to update brand:", error);
    return { success: false, error: "Update failed" };
  }
}

export async function deleteBrand(id: string) {
  try {
    await connectDB();
    const menuCount = await Menu.countDocuments({ brand: id });
    if (menuCount > 0) {
      return {
        success: false,
        error:
          "Cannot delete a brand that has menus assigned. Reassign or delete menus first.",
      };
    }

    const existing = await Brand.findById(id).select("shopifyCollectionId");
    if (existing?.shopifyCollectionId && isShopifySyncEnabled()) {
      try {
        const { deleteShopifyCollection } = await import(
          "@/lib/shopify/sync-collection"
        );
        await deleteShopifyCollection(existing.shopifyCollectionId);
      } catch (error) {
        console.error("Shopify brand delete failed:", error);
      }
    }

    await Brand.findByIdAndDelete(id);
    revalidatePath("/admin/brands");
    revalidatePath("/");
    updateTag("navigation");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete brand:", error);
    return { success: false, error: "Deletion failed" };
  }
}

// --- Collections ---

export async function getCollections() {
  try {
    await connectDB();
    const collections = await Collection.find()
      .sort({ order: 1, name: 1 })
      .populate("products", "name images price")
      .lean();
    return {
      success: true,
      collections: JSON.parse(JSON.stringify(collections)),
    };
  } catch (error) {
    console.error("Failed to fetch collections:", error);
    return { success: false, collections: [] };
  }
}

export async function getActiveCollections() {
  try {
    await connectDB();
    const collections = await Collection.find({ isActive: true })
      .sort({ order: 1, name: 1 })
      .populate("products", "name images price")
      .lean();
    return {
      success: true,
      collections: JSON.parse(JSON.stringify(collections)),
    };
  } catch (error) {
    console.error("Failed to fetch active collections:", error);
    return { success: false, collections: [] };
  }
}

export async function getCollectionBySlug(slug: string) {
  try {
    await connectDB();
    const collection = await Collection.findOne({ slug, isActive: true })
      .populate("products", "name images price category stock")
      .lean();
    if (!collection) return null;
    return JSON.parse(JSON.stringify(collection));
  } catch (error) {
    console.error("Failed to fetch collection:", error);
    return null;
  }
}

function parseProductIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id) => typeof id === "string" && id.trim())
      : [];
  } catch {
    return raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }
}

export async function createCollection(formData: FormData) {
  try {
    await connectDB();
    const name = (formData.get("name") as string)?.trim();
    const slug =
      (formData.get("slug") as string)?.trim() ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const description = ((formData.get("description") as string) || "").trim();
    const order = parseInt((formData.get("order") as string) || "0", 10);
    const isActive = formData.get("isActive") !== "false";
    const productIds = parseProductIds(formData.get("productIds") as string);
    const imageFile = formData.get("image");
    let image = ((formData.get("imageUrl") as string) || "").trim();

    if (
      imageFile &&
      typeof imageFile !== "string" &&
      "arrayBuffer" in imageFile &&
      (imageFile as File).size > 0
    ) {
      const upload = await uploadImageToCloudinary(
        imageFile as File,
        "linx-living/collections",
      );
      if (!upload.success || !upload.url) {
        return { success: false, error: "Image upload failed" };
      }
      image = upload.url;
    }

    const existing = await Collection.findOne({ slug });
    if (existing) {
      return {
        success: false,
        error: "A collection with this slug already exists",
      };
    }

    const collection = await Collection.create({
      name,
      slug,
      description,
      order,
      isActive,
      products: productIds.map((id) => new mongoose.Types.ObjectId(id)),
    });

    await Collection.collection.updateOne(
      { _id: collection._id },
      { $set: { image: image || "" } },
    );

    const saved = await Collection.collection.findOne({ _id: collection._id });

    if (isShopifySyncEnabled()) {
      try {
        const { pushCollectionToShopify } = await import(
          "@/lib/shopify/sync-collection"
        );
        const shopifyId = await pushCollectionToShopify({
          name,
          slug,
          description,
          image: image || "",
          productIds,
        });
        if (shopifyId) {
          await Collection.collection.updateOne(
            { _id: collection._id },
            {
              $set: {
                shopifyCollectionId: shopifyId,
                shopifySyncedAt: new Date(),
                shopifySyncError: null,
              },
            },
          );
        }
      } catch (error) {
        console.error("Shopify collection sync failed:", error);
      }
    }

    const refreshed = await Collection.collection.findOne({
      _id: collection._id,
    });
    revalidatePath("/admin/collections");
    revalidatePath("/");
    updateTag("navigation");
    return {
      success: true,
      collection: JSON.parse(JSON.stringify(refreshed || saved)),
    };
  } catch (error) {
    console.error("Failed to create collection:", error);
    return { success: false, error: "Creation failed" };
  }
}

export async function updateCollection(id: string, formData: FormData) {
  try {
    await connectDB();
    const name = (formData.get("name") as string)?.trim();
    const slug = (formData.get("slug") as string)?.trim();
    const description = ((formData.get("description") as string) || "").trim();
    const order = parseInt((formData.get("order") as string) || "0", 10);
    const isActive = formData.get("isActive") !== "false";
    const productIds = parseProductIds(formData.get("productIds") as string);
    const imageFile = formData.get("image");
    const removeImage = formData.get("removeImage") === "true";
    let image = ((formData.get("imageUrl") as string) || "").trim();
    const hasNewFile =
      !!imageFile &&
      typeof imageFile !== "string" &&
      "arrayBuffer" in imageFile &&
      (imageFile as File).size > 0;

    if (hasNewFile) {
      const upload = await uploadImageToCloudinary(
        imageFile as File,
        "linx-living/collections",
      );
      if (!upload.success || !upload.url) {
        return { success: false, error: "Image upload failed" };
      }
      image = upload.url;
    } else if (removeImage) {
      image = "";
    }

    const duplicate = await Collection.findOne({ slug, _id: { $ne: id } });
    if (duplicate) {
      return {
        success: false,
        error: "A collection with this slug already exists",
      };
    }

    const shouldUpdateImage =
      hasNewFile || removeImage || formData.has("imageUrl");

    const updatePayload: Record<string, unknown> = {
      name,
      slug,
      description,
      order,
      isActive,
      products: productIds.map((pid) => new mongoose.Types.ObjectId(pid)),
      updatedAt: new Date(),
    };

    if (shouldUpdateImage) {
      updatePayload.image = image;
    }

    await Collection.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set: updatePayload },
    );

    const collection = await Collection.collection.findOne({
      _id: new mongoose.Types.ObjectId(id),
    });

    if (collection && isShopifySyncEnabled()) {
      try {
        const { pushCollectionToShopify } = await import(
          "@/lib/shopify/sync-collection"
        );
        const shopifyId = await pushCollectionToShopify({
          name: collection.name,
          slug: collection.slug,
          description: collection.description || "",
          image: collection.image || "",
          productIds: (collection.products || []).map((p: any) => String(p)),
          shopifyCollectionId: collection.shopifyCollectionId,
        });
        if (shopifyId) {
          await Collection.collection.updateOne(
            { _id: collection._id },
            {
              $set: {
                shopifyCollectionId: shopifyId,
                shopifySyncedAt: new Date(),
                shopifySyncError: null,
              },
            },
          );
        }
      } catch (error) {
        console.error("Shopify collection sync failed:", error);
        await Collection.collection.updateOne(
          { _id: collection._id },
          {
            $set: {
              shopifySyncError:
                error instanceof Error
                  ? error.message
                  : "Collection sync failed",
            },
          },
        );
      }
    }

    const refreshed = await Collection.collection.findOne({
      _id: new mongoose.Types.ObjectId(id),
    });

    revalidatePath("/admin/collections");
    revalidatePath("/");
    updateTag("navigation");
    if (slug) revalidatePath(`/collections/${slug}`);
    return {
      success: true,
      collection: JSON.parse(JSON.stringify(refreshed || collection)),
    };
  } catch (error) {
    console.error("Failed to update collection:", error);
    return { success: false, error: "Update failed" };
  }
}

export async function deleteCollection(id: string) {
  try {
    await connectDB();
    const existing = await Collection.findById(id).select("shopifyCollectionId");
    if (existing?.shopifyCollectionId && isShopifySyncEnabled()) {
      try {
        const { deleteShopifyCollection } = await import(
          "@/lib/shopify/sync-collection"
        );
        await deleteShopifyCollection(existing.shopifyCollectionId);
      } catch (error) {
        console.error("Shopify collection delete failed:", error);
      }
    }
    await Collection.findByIdAndDelete(id);
    revalidatePath("/admin/collections");
    revalidatePath("/");
    updateTag("navigation");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete collection:", error);
    return { success: false, error: "Deletion failed" };
  }
}

// --- Menus ---

export async function getMenus() {
  try {
    await connectDB();
    const menus = await Menu.find().sort({ order: 1, name: 1 });
    return { success: true, menus: JSON.parse(JSON.stringify(menus)) };
  } catch (error) {
    console.error("Failed to fetch menus:", error);
    return { success: false, menus: [] };
  }
}

export async function getMenuTree() {
  try {
    await connectDB();
    const { getExcludedStorefrontBrandIds } = await import(
      "@/lib/excludedStorefrontBrands"
    );
    const excludedIds = await getExcludedStorefrontBrandIds();
    const menus = await Menu.find(
      excludedIds.length
        ? {
            $or: [
              { brand: null },
              { brand: { $exists: false } },
              { brand: { $nin: excludedIds } },
            ],
          }
        : {},
    )
      .sort({ order: 1, name: 1 })
      .lean();
    const tree = buildMenuTreeFromFlat(menus);
    return { success: true, tree: JSON.parse(JSON.stringify(tree)) };
  } catch (error) {
    console.error("Failed to fetch menu tree:", error);
    return { success: false, tree: [] };
  }
}

export async function createMenu(formData: FormData) {
  try {
    await connectDB();
    const name = formData.get("name") as string;
    const slug = formData.get("slug") as string;
    const parent = (formData.get("parent") as string) || null;
    const order = parseInt((formData.get("order") as string) || "0");
    const brandInput = (formData.get("brand") as string) || null;
    const departmentInput = ((formData.get("department") as string) || "").trim();
    let subBrand = parseOptionalSubBrandSlug(formData);
    const imageFile = formData.get("image");
    let image = ((formData.get("imageUrl") as string) || "").trim();

    let brand: string | null = brandInput;
    let department: string | null =
      departmentInput && mongoose.Types.ObjectId.isValid(departmentInput)
        ? departmentInput
        : null;
    const level = parent ? "subcategory" : "category";
    if (parent) {
      const parentMenu = await Menu.findById(parent).lean();
      if (parentMenu?.brand) {
        brand = parentMenu.brand.toString();
      }
      if (parentMenu?.department) {
        department = parentMenu.department.toString();
      }
      if (parentMenu?.subBrand) {
        subBrand = String(parentMenu.subBrand || "").trim().toLowerCase();
      }
    }

    if (
      imageFile &&
      typeof imageFile !== "string" &&
      "arrayBuffer" in imageFile &&
      (imageFile as File).size > 0
    ) {
      const upload = await uploadImageToCloudinary(
        imageFile as File,
        "linx-living/menus",
      );
      if (!upload.success || !upload.url) {
        return { success: false, error: "Image upload failed" };
      }
      image = upload.url;
    }

    const menu = await Menu.create({
      name,
      slug,
      parent: parent || null,
      order,
      brand: brand || null,
      subBrand: subBrand || "",
      department: department || null,
      level,
    });

    // Persist image via native driver so a stale Mongoose schema cannot strip it
    await Menu.collection.updateOne(
      { _id: menu._id },
      {
        $set: {
          image: image || "",
          brand: brand ? new mongoose.Types.ObjectId(brand) : null,
          subBrand: subBrand || "",
          department: department
            ? new mongoose.Types.ObjectId(department)
            : null,
          level,
        },
      },
    );

    const saved = await Menu.collection.findOne({ _id: menu._id });

    if (isShopifySyncEnabled()) {
      try {
        const { pushMenuAsCollection } = await import(
          "@/lib/shopify/sync-collection"
        );
        let brandSlug: string | null = null;
        if (brand) {
          const b = await Brand.findById(brand).select("slug").lean();
          brandSlug = b?.slug || null;
        }
        const matched = await Product.find({
          $or: [
            { category: slug },
            { subCategory: slug },
            { category: name },
            { subCategory: name },
          ],
          shopifyProductId: { $ne: null },
        })
          .select("_id")
          .limit(50)
          .lean();
        let parentSlug: string | null = null;
        if (parent) {
          const parentDoc = await Menu.findById(parent).select("slug").lean();
          parentSlug = parentDoc?.slug || null;
        }
        const shopifyId = await pushMenuAsCollection({
          name,
          slug,
          image: image || "",
          brandSlug,
          parentSlug,
          order,
          productIds: matched.map((p: any) => String(p._id)),
        });
        if (shopifyId) {
          await Menu.collection.updateOne(
            { _id: menu._id },
            {
              $set: {
                shopifyCollectionId: shopifyId,
                shopifySyncedAt: new Date(),
              },
            },
          );
        }
      } catch (error) {
        console.error("Shopify menu sync failed:", error);
      }
    }

    const refreshed = await Menu.collection.findOne({ _id: menu._id });
    revalidatePath("/admin/menus");
    revalidatePath("/");
    updateTag("navigation");
    return { success: true, menu: JSON.parse(JSON.stringify(refreshed || saved)) };
  } catch (error) {
    console.error("Failed to create menu:", error);
    return { success: false, error: "Creation failed" };
  }
}

export async function updateMenu(id: string, formData: FormData) {
  try {
    await connectDB();
    const name = formData.get("name") as string;
    const slug = formData.get("slug") as string;
    const parent = (formData.get("parent") as string) || null;
    const order = parseInt((formData.get("order") as string) || "0");
    const brandInput = (formData.get("brand") as string) || null;
    const departmentInput = ((formData.get("department") as string) || "").trim();
    let subBrand = parseOptionalSubBrandSlug(formData);
    const hasSubBrandField = formData.has("subBrand");
    const imageFile = formData.get("image");
    const removeImage = formData.get("removeImage") === "true";
    let image = ((formData.get("imageUrl") as string) || "").trim();
    const hasNewFile =
      !!imageFile &&
      typeof imageFile !== "string" &&
      "arrayBuffer" in imageFile &&
      (imageFile as File).size > 0;

    let brand: string | null = brandInput;
    let department: string | null =
      departmentInput && mongoose.Types.ObjectId.isValid(departmentInput)
        ? departmentInput
        : null;
    const level = parent ? "subcategory" : "category";
    if (parent) {
      const parentMenu = await Menu.findById(parent).lean();
      if (parentMenu?.brand) {
        brand = parentMenu.brand.toString();
      }
      if (parentMenu?.department) {
        department = parentMenu.department.toString();
      }
      if (parentMenu?.subBrand) {
        subBrand = String(parentMenu.subBrand || "").trim().toLowerCase();
      }
    } else if (!brand) {
      const existing = await Menu.findById(id).lean();
      brand = existing?.brand ? existing.brand.toString() : null;
      if (!department && existing?.department) {
        department = existing.department.toString();
      }
      if (!hasSubBrandField && existing?.subBrand) {
        subBrand = String(existing.subBrand || "").trim().toLowerCase();
      }
    }

    if (hasNewFile) {
      const upload = await uploadImageToCloudinary(
        imageFile as File,
        "linx-living/menus",
      );
      if (!upload.success || !upload.url) {
        return { success: false, error: "Image upload failed" };
      }
      image = upload.url;
    } else if (removeImage) {
      image = "";
    }

    const departmentOid = department
      ? new mongoose.Types.ObjectId(department)
      : null;
    const update: Record<string, unknown> = {
      name,
      slug,
      parent: parent || null,
      order,
      brand: brand ? new mongoose.Types.ObjectId(brand) : null,
      subBrand: subBrand || "",
      department: departmentOid,
      level,
    };

    const shouldUpdateImage =
      hasNewFile || removeImage || formData.has("imageUrl");

    if (shouldUpdateImage) {
      update.image = image;
    }

    // Use native collection update for image so a stale Mongoose schema cannot strip it
    if (shouldUpdateImage) {
      await Menu.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        {
          $set: {
            name,
            slug,
            parent: parent || null,
            order,
            image,
            brand: brand ? new mongoose.Types.ObjectId(brand) : null,
            subBrand: subBrand || "",
            department: departmentOid,
            level,
            updatedAt: new Date(),
          },
        },
      );
    } else {
      await Menu.findByIdAndUpdate(id, update, { new: true });
    }

    const menu = await Menu.collection.findOne({
      _id: new mongoose.Types.ObjectId(id),
    });

    if (menu && isShopifySyncEnabled()) {
      try {
        const { pushMenuAsCollection } = await import(
          "@/lib/shopify/sync-collection"
        );
        let brandSlug: string | null = null;
        if (menu.brand) {
          const b = await Brand.findById(menu.brand).select("slug").lean();
          brandSlug = b?.slug || null;
        }
        const matched = await Product.find({
          $or: [
            { category: menu.slug },
            { subCategory: menu.slug },
            { category: menu.name },
            { subCategory: menu.name },
          ],
          shopifyProductId: { $ne: null },
        })
          .select("_id")
          .limit(50)
          .lean();
        let parentSlug: string | null = null;
        if (menu.parent) {
          const parentDoc = await Menu.findById(menu.parent)
            .select("slug")
            .lean();
          parentSlug = parentDoc?.slug || null;
        }
        const shopifyId = await pushMenuAsCollection({
          name: menu.name,
          slug: menu.slug,
          image: menu.image || "",
          brandSlug,
          parentSlug,
          order: menu.order ?? 0,
          shopifyCollectionId: menu.shopifyCollectionId,
          productIds: matched.map((p: any) => String(p._id)),
        });
        if (shopifyId) {
          await Menu.collection.updateOne(
            { _id: menu._id },
            {
              $set: {
                shopifyCollectionId: shopifyId,
                shopifySyncedAt: new Date(),
              },
            },
          );
        }
      } catch (error) {
        console.error("Shopify menu update sync failed:", error);
      }
    }

    const refreshed = await Menu.collection.findOne({
      _id: new mongoose.Types.ObjectId(id),
    });

    revalidatePath("/admin/menus");
    revalidatePath("/");
    updateTag("navigation");
    if (refreshed && (refreshed as any).slug) {
      revalidatePath(`/category/${(refreshed as any).slug}`);
    }
    return { success: true, menu: JSON.parse(JSON.stringify(refreshed || menu)) };
  } catch (error) {
    console.error("Failed to update menu:", error);
    return { success: false, error: "Update failed" };
  }
}

export async function deleteMenu(id: string) {
  try {
    await connectDB();
    // Check if it has children
    const childrenCount = await Menu.countDocuments({ parent: id });
    if (childrenCount > 0) {
      return {
        success: false,
        error:
          "Cannot delete menu with sub-categories. Delete sub-categories first.",
      };
    }

    const existing = await Menu.findById(id).select("shopifyCollectionId");
    if (existing?.shopifyCollectionId && isShopifySyncEnabled()) {
      try {
        const { deleteShopifyCollection } = await import(
          "@/lib/shopify/sync-collection"
        );
        await deleteShopifyCollection(existing.shopifyCollectionId);
      } catch (error) {
        console.error("Shopify menu delete sync failed:", error);
      }
    }

    await Menu.findByIdAndDelete(id);
    revalidatePath("/admin/menus");
    revalidatePath("/");
    updateTag("navigation");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete menu:", error);
    return { success: false, error: "Deletion failed" };
  }
}

/** Deduped per request (generateMetadata + page share one read). */
export const getMenuBySlug = cache(async (slug: string) => {
  try {
    await connectDB();
    const menu = await Menu.findOne({ slug }).lean();
    if (!menu) return null;
    return JSON.parse(JSON.stringify(menu));
  } catch (error) {
    console.error("Failed to fetch menu by slug:", error);
    return null;
  }
});

export async function getFirstSubCategorySlug() {
  try {
    await connectDB();
    const [subCategory, firstMenu] = await Promise.all([
      Menu.findOne({ parent: { $ne: null } })
        .sort({ order: 1 })
        .select("slug")
        .lean(),
      Menu.findOne({ parent: null }).sort({ order: 1 }).select("slug").lean(),
    ]);
    return subCategory?.slug || firstMenu?.slug || null;
  } catch (error) {
    console.error("Failed to fetch first sub-category slug:", error);
    return null;
  }
}
