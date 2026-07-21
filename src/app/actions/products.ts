"use server";

import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";

export interface ProductFilters {
  category?: string | string[];
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  search?: string;
  page?: number;
  limit?: number;
  fields?: string; // e.g. "name price images category"
  /** Skip countDocuments when total/pages are unused (e.g. mega-menu). */
  skipCount?: boolean;
}

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export async function getPublicProducts(filters: ProductFilters = {}) {
  try {
    await connectDB();
    const {
      category,
      minPrice,
      maxPrice,
      sort,
      search,
      page = 1,
      limit = 12,
      fields,
      skipCount = false,
    } = filters;

    const and: any[] = [];

    if (category && category !== "all") {
      const cats = (Array.isArray(category) ? category : [category]).filter(
        (c) => c && c !== "all",
      );
      if (cats.length === 1) {
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
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      const price: Record<string, number> = {};
      if (minPrice !== undefined) price.$gte = minPrice;
      if (maxPrice !== undefined) price.$lte = maxPrice;
      and.push({ price });
    }

    if (search) {
      // Name-only regex avoids full description scans; text index remains for future use
      and.push({ name: { $regex: search, $options: "i" } });
    }

    const query = and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and };

    let sortOption: any = { createdAt: -1 };
    if (sort === "price-asc") sortOption = { price: 1 };
    if (sort === "price-desc") sortOption = { price: -1 };
    if (sort === "newest") sortOption = { createdAt: -1 };

    let productsQuery = Product.find(query)
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    if (fields) {
      productsQuery = productsQuery.select(fields);
    }

    const [products, total] = await Promise.all([
      productsQuery,
      skipCount
        ? Promise.resolve(-1)
        : Product.countDocuments(query),
    ]);

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
      $or: [{ category: categoryName }, { subCategory: categoryName }],
    })
      .sort({ createdAt: -1 })
      .select("name price images category subCategory stock")
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
    return serialize(product);
  } catch (error) {
    console.error("Failed to fetch public product:", error);
    return null;
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
