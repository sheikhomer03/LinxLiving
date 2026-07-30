"use server";

import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { isShopifyStorefrontEnabled } from "@/lib/shopify";

export interface ProductFilters {
  category?: string | string[];
  /** Brand slug(s) — products whose category belongs to those brands’ menus */
  brand?: string | string[];
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
 * When Storefront catalog is enabled, overlay live Shopify price/stock/images
 * onto Mongo products (keeps Mongo _id for PDP links + Linx-only fields).
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
            images: sf.images?.length
              ? sf.images.map((i) => i.url)
              : product.images,
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
    } = filters;

    // No main category → not Active (hidden from storefront)
    const and: any[] = [
      { category: { $exists: true, $nin: [null, ""] } },
    ];

    if (requireImages) {
      and.push({ "images.0": { $exists: true } });
    }

    // Hide products belonging to inactive brands (e.g. LINX TRADE)
    {
      const { Brand } = await import("@/models/Brand");
      const inactive = await Brand.find({ isActive: false }).select("_id").lean();
      const inactiveIds = inactive.map((b: any) => b._id);
      if (inactiveIds.length) {
        and.push({ brand: { $nin: inactiveIds } });
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
    // Brand filter must use brand ObjectId only. OR-ing category/menu slugs
    // mixes products across brands that share slugs (e.g. pitched-roof-windows).
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
      const menuSlugs = (brandCategorySlugs || []).filter(Boolean);
      and.push({
        $or: [
          { category: { $in: menuSlugs } },
          { subCategory: { $in: menuSlugs } },
        ],
      });
    }

    const sizes = asList(size);
    if (sizes.length === 1) {
      and.push({ "specs.size": sizes[0] });
    } else if (sizes.length > 1) {
      and.push({ "specs.size": { $in: sizes } });
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
      and.push({ name: { $regex: escaped, $options: "i" } });
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

    const products = await enrichFromStorefront(productsRaw as any[]);

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
    const [enriched] = await enrichFromStorefront([product as any]);
    return serialize(enriched);
  } catch (error) {
    console.error("Failed to fetch public product:", error);
    return null;
  }
}

/**
 * Facet counts for catalogue filters (size / category / brand via menu slugs).
 */
export async function getCatalogFacetCounts(input?: {
  brands?: { slug: string; name: string; categorySlugs: string[] }[];
  categories?: { slug: string; name: string }[];
}) {
  try {
    await connectDB();
    const { Brand } = await import("@/models/Brand");
    const inactive = await Brand.find({ isActive: false }).select("_id").lean();
    const inactiveIds = inactive.map((b: any) => b._id);
    const base: Record<string, unknown> = {
      category: { $exists: true, $nin: [null, ""] },
      ...(inactiveIds.length ? { brand: { $nin: inactiveIds } } : {}),
    };

    const sizeAgg = await Product.aggregate<{ _id: string; count: number }>([
      { $match: base },
      {
        $group: {
          _id: "$specs.size",
          count: { $sum: 1 },
        },
      },
    ]);

    const categoryAgg = await Product.aggregate<{ _id: string; count: number }>([
      { $match: base },
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
      { $match: { ...base, subCategory: { $exists: true, $nin: [null, ""] } } },
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

    const categoryCounts: Record<string, number> = {};
    for (const row of categoryAgg) {
      if (row._id) categoryCounts[String(row._id)] = row.count;
    }

    /** Global by subcategory slug (legacy) */
    const subcategoryCounts: Record<string, number> = {};
    /** Scoped: `${parentSlug}::${childSlug}` → count */
    const subcategoryScopedCounts: Record<string, number> = {};
    for (const row of subCategoryAgg) {
      const parent = row._id?.category;
      const sub = row._id?.sub;
      if (!sub) continue;
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

    const maxPriceRow = await Product.findOne(base)
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
