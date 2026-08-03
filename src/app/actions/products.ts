"use server";

import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { isShopifyStorefrontEnabled } from "@/lib/shopify";

export interface ProductFilters {
  category?: string | string[];
  /** Brand slug(s) — match product.brand ObjectId only (never name / shared category). */
  brand?: string | string[];
  /** LINX department slug(s) — Department → Category → Subcategory */
  department?: string | string[];
  /**
   * When true with `department`, only match product.department (no menu-token OR).
   * Use for Configurator so mis-tagged / unrelated SKUs do not leak in.
   */
  departmentStrict?: boolean;
  /** Tile size(s) from specs.size (e.g. 600x600) */
  size?: string | string[];
  /**
   * When set with a parent `category`, requires both:
   * product.category = parent AND product.subCategory = this value.
   * Avoids slug collisions (e.g. fixed-frameless under pitched vs flat).
   */
  subCategory?: string | string[];
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  search?: string;
  page?: number;
  limit?: number;
  fields?: string; // e.g. "name price images category"
  /** Skip countDocuments when total/pages are unused (e.g. mega-menu). */
  skipCount?: boolean;
  /** Optional: category/subCategory slugs owned by selected brand(s) */
  brandCategorySlugs?: string[];
  /** Only products with at least one gallery image (mega-menu cards). */
  requireImages?: boolean;
  /** Only products with a Cloudinary (non-Shopify CDN) gallery image. */
  requireCloudinary?: boolean;
  /** Facet: stock status */
  stockStatus?: string | string[];
  /** Facet: material / colour / finish (string match on product arrays/fields) */
  material?: string | string[];
  colour?: string | string[];
  finish?: string | string[];
}

function asList(value?: string | string[]): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Brand ObjectIds that must not appear on the storefront:
 * inactive brands + HIDDEN_BRAND_SLUGS (e.g. Sterlingbuild).
 */
async function getExcludedStorefrontBrandIds(): Promise<unknown[]> {
  const { Brand } = await import("@/models/Brand");
  const { HIDDEN_BRAND_SLUGS } = await import("@/lib/hiddenBrands");
  const rows = await Brand.find({
    $or: [
      { isActive: false },
      ...(HIDDEN_BRAND_SLUGS.length
        ? [{ slug: { $in: HIDDEN_BRAND_SLUGS } }]
        : []),
    ],
  })
    .select("_id")
    .lean();
  return rows.map((b: any) => b._id);
}

/**
 * When Storefront catalog is enabled, overlay live Shopify price/stock only.
 * Images stay on Mongo/Cloudinary — Shopify CDN hotlinks often 404 and break next/image.
 */
async function enrichFromStorefront(products: any[]) {
  if (!isShopifyStorefrontEnabled() || !products.length) return products;

  try {
    const { fetchStorefrontProductById } = await import("@/lib/shopify/storefront");
    return Promise.all(
      products.map(async (product) => {
        if (!product.shopifyProductId) return product;
        try {
          const sf = await fetchStorefrontProductById(product.shopifyProductId);
          if (!sf) return product;
          return {
            ...product,
            name: sf.title || product.name,
            description: sf.description || product.description,
            price: sf.price ?? product.price,
            stock:
              typeof sf.totalInventory === "number"
                ? sf.totalInventory
                : product.stock,
            // Keep product.images (Cloudinary) — do not replace with Shopify CDN URLs
            shopifyVariantId: sf.variantId || product.shopifyVariantId,
            category: sf.productType || product.category,
          };
        } catch {
          return product;
        }
      }),
    );
  } catch {
    return products;
  }
}

export async function getPublicProducts(filters: ProductFilters = {}) {
  try {
    await connectDB();
    const {
      category,
      brand,
      department,
      departmentStrict = false,
      size,
      subCategory,
      brandCategorySlugs,
      minPrice,
      maxPrice,
      sort,
      search,
      page = 1,
      limit = 12,
      fields,
      skipCount = false,
      requireImages = false,
      requireCloudinary = false,
      stockStatus,
      material,
      colour,
      finish,
    } = filters;

    // No main category → not Active (hidden from storefront)
    const and: any[] = [
      { category: { $exists: true, $nin: [null, ""] } },
    ];

    if (requireImages) {
      and.push({ "images.0": { $exists: true } });
    }

    if (requireCloudinary) {
      and.push({
        images: {
          $elemMatch: {
            $regex: "cloudinary\\.com",
            $options: "i",
          },
        },
      });
    }

    // Hide inactive + intentionally hidden brands (e.g. Sterlingbuild)
    {
      const excludedIds = await getExcludedStorefrontBrandIds();
      if (excludedIds.length) {
        and.push({ brand: { $nin: excludedIds } });
      }
    }

    const cats = asList(category).filter((c) => c !== "all");
    const subCats = asList(subCategory).filter(Boolean);

    // Parent + subcategory (scoped) — preferred for type tiles
    if (cats.length === 1 && subCats.length === 1) {
      and.push({ category: cats[0], subCategory: subCats[0] });
    } else if (subCats.length === 1 && cats.length === 0) {
      and.push({ subCategory: subCats[0] });
    } else if (cats.length === 1) {
      and.push({
        $or: [{ category: cats[0] }, { subCategory: cats[0] }],
      });
    } else if (cats.length > 1) {
      and.push({
        $or: [
          { category: { $in: cats } },
          { subCategory: { $in: cats } },
        ],
      });
    }

    const brandSlugs = asList(brand);
    // Strict brand ownership: product.brand ObjectId only.
    // Do not OR category menu slugs or match on product name ("FAKRO …").
    if (brandSlugs.length) {
      const { Brand } = await import("@/models/Brand");
      const brandDocs = await Brand.find({
        slug: { $in: brandSlugs },
        isActive: true,
      })
        .select("_id")
        .lean();
      const brandIds = brandDocs.map((b: any) => b._id);
      if (brandIds.length) {
        and.push({ brand: { $in: brandIds } });
      } else {
        and.push({ _id: { $in: [] } });
      }
    } else if ((brandCategorySlugs || []).filter(Boolean).length) {
      // Legacy path when no brand slug is selected — category menus only.
      // Still excludes hidden brands via $nin above.
      const menuSlugs = (brandCategorySlugs || []).filter(Boolean);
      and.push({
        $or: [
          { category: { $in: menuSlugs } },
          { subCategory: { $in: menuSlugs } },
        ],
      });
    }

    const deptSlugs = asList(department);
    if (deptSlugs.length) {
      if (departmentStrict) {
        // Configurator / precise views — only explicitly tagged products
        and.push(
          deptSlugs.length === 1
            ? { department: deptSlugs[0] }
            : { department: { $in: deptSlugs } },
        );
      } else {
        // Catalogue: Department → Menus → Products, plus product.department
        const { Department } = await import("@/models/Department");
        const { Menu } = await import("@/models/Menu");
        const deptDocs = await Department.find({
          slug: { $in: deptSlugs },
          isActive: true,
        })
          .select("_id slug")
          .lean();
        const deptIds = deptDocs.map((d: any) => d._id);

        let menuTokens: string[] = [];
        if (deptIds.length) {
          const menus = await Menu.find({
            department: { $in: deptIds },
            isActive: { $ne: false },
          })
            .select("_id slug name parent")
            .lean();
          const parentIds = menus.map((m: any) => m._id);
          const children =
            parentIds.length > 0
              ? await Menu.find({
                  parent: { $in: parentIds },
                  isActive: { $ne: false },
                })
                  .select("slug name")
                  .lean()
              : [];
          menuTokens = [
            ...new Set(
              [...menus, ...children]
                .flatMap((m: any) => [m.slug, m.name])
                .filter(Boolean)
                .map((s: string) => String(s)),
            ),
          ];
        }

        const deptOr: any[] = [{ department: { $in: deptSlugs } }];
        if (menuTokens.length) {
          deptOr.push(
            { category: { $in: menuTokens } },
            { subCategory: { $in: menuTokens } },
          );
        }
        and.push({ $or: deptOr });
      }
    }

    const sizes = asList(size);
    if (sizes.length === 1) {
      and.push({ "specs.size": sizes[0] });
    } else if (sizes.length > 1) {
      and.push({ "specs.size": { $in: sizes } });
    }

    const stockStatuses = asList(stockStatus);
    if (stockStatuses.length === 1) {
      and.push({ stockStatus: stockStatuses[0] });
    } else if (stockStatuses.length > 1) {
      and.push({ stockStatus: { $in: stockStatuses } });
    }

    const materials = asList(material);
    if (materials.length === 1) {
      and.push({ materials: materials[0] });
    } else if (materials.length > 1) {
      and.push({ materials: { $in: materials } });
    }

    const colours = asList(colour);
    if (colours.length === 1) {
      and.push({ colours: colours[0] });
    } else if (colours.length > 1) {
      and.push({ colours: { $in: colours } });
    }

    const finishes = asList(finish);
    if (finishes.length === 1) {
      and.push({ finish: finishes[0] });
    } else if (finishes.length > 1) {
      and.push({ finish: { $in: finishes } });
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      const price: Record<string, number> = {};
      if (minPrice !== undefined) price.$gte = minPrice;
      if (maxPrice !== undefined) price.$lte = maxPrice;
      and.push({ price });
    }

    if (search) {
      // Escape regex metacharacters so user input is treated literally
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = { $regex: escaped, $options: "i" };
      // Match whole phrase OR every token (so "Quartz White 60x90" hits name/size)
      const tokens = escaped
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 1);
      const tokenClauses = tokens.map((token) => ({
        $or: [
          { name: { $regex: token, $options: "i" } },
          { sku: { $regex: token, $options: "i" } },
          { productCode: { $regex: token, $options: "i" } },
          { barcode: { $regex: token, $options: "i" } },
          { category: { $regex: token, $options: "i" } },
          { subCategory: { $regex: token, $options: "i" } },
          { "specs.size": { $regex: token, $options: "i" } },
        ],
      }));
      and.push({
        $or: [
          { name: rx },
          { sku: rx },
          { productCode: rx },
          { barcode: rx },
          { category: rx },
          { subCategory: rx },
          { department: rx },
          { "specs.size": rx },
          ...(tokenClauses.length > 1 ? [{ $and: tokenClauses }] : []),
        ],
      });
    }

    const query = and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and };

    let sortOption: any = { createdAt: -1 };
    if (sort === "price-asc") sortOption = { price: 1 };
    if (sort === "price-desc") sortOption = { price: -1 };
    if (sort === "name-asc") sortOption = { name: 1 };
    if (sort === "name-desc") sortOption = { name: -1 };
    if (sort === "newest") sortOption = { createdAt: -1 };

    let productsQuery = Product.find(query)
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    if (fields) {
      productsQuery = productsQuery.select(fields);
    }

    const [productsRaw, total] = await Promise.all([
      productsQuery,
      skipCount
        ? Promise.resolve(-1)
        : Product.countDocuments(query),
    ]);

    // Skip live Shopify enrich on list queries — N Storefront API calls made
    // category/search/mega painfully slow. Mongo price/stock is enough for grids.
    const products = productsRaw as any[];

    const resolvedTotal = skipCount
      ? products.length
      : total;

    return {
      products: serialize(products),
      total: resolvedTotal,
      page,
      limit,
      totalPages: skipCount ? 1 : Math.ceil(total / limit),
    };
  } catch (error) {
    console.error("Failed to fetch public products:", error);
    return {
      products: [],
      total: 0,
      page: 1,
      limit: 12,
      totalPages: 0,
    };
  }
}

export async function getProductsByCategory(categoryName: string) {
  try {
    await connectDB();
    const products = await Product.find({
      category: { $exists: true, $nin: [null, ""] },
      $or: [{ category: categoryName }, { subCategory: categoryName }],
    })
      .sort({ createdAt: -1 })
      .select("name price images category subCategory stock shopifyVariantId")
      .lean();
    return serialize(products);
  } catch (error) {
    console.error("Failed to fetch products by category:", error);
    return [];
  }
}

export async function getPublicProduct(id: string) {
  try {
    await connectDB();
    const product = await Product.findById(id).lean();
    if (!product) return null;
    if (!String((product as any).category || "").trim()) return null;

    // Hidden / inactive brand products are not public
    const brandId = (product as any).brand;
    if (brandId) {
      const excluded = await getExcludedStorefrontBrandIds();
      if (excluded.some((id) => String(id) === String(brandId))) {
        return null;
      }
    }

    const [enriched] = await enrichFromStorefront([product as any]);
    return serialize(enriched);
  } catch (error) {
    console.error("Failed to fetch public product:", error);
    return null;
  }
}

/**
 * One Cloudinary cover image per brand (for Shop by Brand tiles when brand.image is empty/broken).
 */
export async function getBrandCoverImages(brandIds: string[]) {
  try {
    await connectDB();
    const ids = brandIds
      .filter((id) => Boolean(id))
      .map((id) => {
        try {
          const mongoose = require("mongoose");
          return new mongoose.Types.ObjectId(id);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (!ids.length) return {} as Record<string, string>;

    const rows = await Product.aggregate<{ _id: unknown; images: string[] }>([
      {
        $match: {
          brand: { $in: ids },
          category: { $exists: true, $nin: [null, ""] },
          images: {
            $elemMatch: { $regex: "cloudinary\\.com", $options: "i" },
          },
        },
      },
      { $sort: { updatedAt: -1 } },
      {
        $group: {
          _id: "$brand",
          images: { $first: "$images" },
        },
      },
    ]);

    const { getProductDisplayImage } = await import("@/lib/productImage");
    const map: Record<string, string> = {};
    for (const row of rows) {
      const url = getProductDisplayImage(row.images);
      if (url) map[String(row._id)] = url;
    }
    return map;
  } catch (error) {
    console.error("getBrandCoverImages:", error);
    return {} as Record<string, string>;
  }
}

/**
 * Facet counts for catalogue filters (size / category / brand via menu slugs).
 * Pass `brand` to scope size/category/subcategory counts to those brand(s)
 * (Shop by Category / Shop by type tiles on a brand page).
 */
export async function getCatalogFacetCounts(input?: {
  brands?: { slug: string; name: string; categorySlugs: string[] }[];
  categories?: { slug: string; name: string }[];
  /** When set, category / subcategory / size counts are limited to these brand slug(s). */
  brand?: string | string[];
}) {
  try {
    await connectDB();
    const excludedIds = await getExcludedStorefrontBrandIds();
    const base: Record<string, unknown> = {
      category: { $exists: true, $nin: [null, ""] },
      ...(excludedIds.length ? { brand: { $nin: excludedIds } } : {}),
    };

    const brandSlugs = asList(input?.brand);
    let scopedBase: Record<string, unknown> = base;
    if (brandSlugs.length) {
      const { Brand } = await import("@/models/Brand");
      const brandDocs = await Brand.find({
        slug: { $in: brandSlugs },
        isActive: true,
      })
        .select("_id")
        .lean();
      const brandIds = brandDocs.map((b: any) => b._id);
      // Brand facet scope: exact brand id only (AND still excludes hidden brands)
      scopedBase = {
        category: { $exists: true, $nin: [null, ""] },
        ...(excludedIds.length ? { brand: { $nin: excludedIds } } : {}),
        ...(brandIds.length
          ? { brand: { $in: brandIds } }
          : { brand: { $in: [] } }),
      };
      // When both $nin and $in on brand, prefer $in alone (already subset of visible)
      if (brandIds.length) {
        scopedBase = {
          category: { $exists: true, $nin: [null, ""] },
          brand: { $in: brandIds },
        };
      }
    }

    const sizeAgg = await Product.aggregate<{ _id: string; count: number }>([
      { $match: scopedBase },
      {
        $group: {
          _id: "$specs.size",
          count: { $sum: 1 },
        },
      },
    ]);

    const categoryAgg = await Product.aggregate<{ _id: string; count: number }>([
      { $match: scopedBase },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
    ]);

    const subCategoryAgg = await Product.aggregate<{
      _id: { category: string; sub: string };
      count: number;
    }>([
      {
        $match: {
          ...scopedBase,
          subCategory: { $exists: true, $nin: [null, ""] },
        },
      },
      {
        $group: {
          _id: { category: "$category", sub: "$subCategory" },
          count: { $sum: 1 },
        },
      },
    ]);

    const sizeCounts: Record<string, number> = {};
    for (const row of sizeAgg) {
      if (row._id) sizeCounts[String(row._id)] = row.count;
    }

    // Display-only: brand names that have been stored in the category or
    // subCategory field are not real categories, so they are left out of the
    // filter lists. No product is modified — this only affects what is shown.
    const { Brand: BrandModel } = await import("@/models/Brand");
    const brandLabels = new Set(
      (await BrandModel.find({}).select("name slug").lean()).flatMap((b: any) =>
        [b.name, b.slug]
          .filter(Boolean)
          .map((v: string) => String(v).trim().toLowerCase()),
      ),
    );
    const isBrandLabel = (v: unknown) =>
      brandLabels.has(String(v || "").trim().toLowerCase());

    const categoryCounts: Record<string, number> = {};
    for (const row of categoryAgg) {
      if (row._id && !isBrandLabel(row._id)) {
        categoryCounts[String(row._id)] = row.count;
      }
    }

    /** Global by subcategory slug (legacy) */
    const subcategoryCounts: Record<string, number> = {};
    /** Scoped: `${parentSlug}::${childSlug}` → count */
    const subcategoryScopedCounts: Record<string, number> = {};
    for (const row of subCategoryAgg) {
      const parent = row._id?.category;
      const sub = row._id?.sub;
      if (!sub) continue;
      if (isBrandLabel(sub)) continue;
      subcategoryCounts[String(sub)] =
        (subcategoryCounts[String(sub)] || 0) + row.count;
      if (parent) {
        subcategoryScopedCounts[`${parent}::${sub}`] = row.count;
      }
    }

    const brandCounts: Record<string, number> = {};
    for (const brand of input?.brands || []) {
      const { Brand } = await import("@/models/Brand");
      const brandDoc = await Brand.findOne({ slug: brand.slug })
        .select("_id")
        .lean();
      if (!brandDoc?._id) {
        brandCounts[brand.slug] = 0;
        continue;
      }

      brandCounts[brand.slug] = await Product.countDocuments({
        ...base,
        brand: brandDoc._id,
      });
    }

    // Ensure requested categories appear even at 0
    for (const cat of input?.categories || []) {
      if (!(cat.slug in categoryCounts)) categoryCounts[cat.slug] = 0;
    }

    const maxPriceRow = await Product.findOne(scopedBase)
      .sort({ price: -1 })
      .select("price")
      .lean();
    const maxPrice = Number((maxPriceRow as any)?.price) || 0;

    return serialize({
      sizeCounts,
      categoryCounts,
      subcategoryCounts,
      subcategoryScopedCounts,
      brandCounts,
      maxPrice,
    });
  } catch (error) {
    console.error("Failed to fetch catalog facets:", error);
    return {
      sizeCounts: {},
      categoryCounts: {},
      subcategoryCounts: {},
      subcategoryScopedCounts: {},
      brandCounts: {},
      maxPrice: 0,
    };
  }
}

/** Primary images for cart/wishlist sync — same as product page hero. */
export async function getProductsDisplayImages(ids: string[]) {
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return { success: true, images: {} as Record<string, string> };

    await connectDB();
    const { getProductDisplayImage } = await import("@/lib/productImage");
    const products = await Product.find({ _id: { $in: unique } })
      .select("images")
      .lean();

    const images: Record<string, string> = {};
    for (const product of products as any[]) {
      images[product._id.toString()] = getProductDisplayImage(product.images);
    }

    return { success: true, images };
  } catch (error) {
    console.error("Failed to fetch product display images:", error);
    return { success: false, images: {} as Record<string, string> };
  }
}
