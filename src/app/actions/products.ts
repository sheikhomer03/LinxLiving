"use server";

import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";

export interface ProductFilters {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  search?: string;
  page?: number;
  limit?: number;
  fields?: string; // e.g. "name price images category"
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
    } = filters;

    let query: any = {};

    if (category && category !== "all") {
      const categoryFilter = {
        $or: [{ category: category }, { subCategory: category }],
      };

      if (query.$or) {
        // If search already added an $or, we need to combine them with $and
        const searchFilter = { $or: query.$or };
        delete query.$or;
        query.$and = [categoryFilter, searchFilter];
      } else {
        query.$or = categoryFilter.$or;
      }
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice !== undefined) query.price.$gte = minPrice;
      if (maxPrice !== undefined) query.price.$lte = maxPrice;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    let sortOption: any = { createdAt: -1 };
    if (sort === "price-asc") sortOption = { price: 1 };
    if (sort === "price-desc") sortOption = { price: -1 };
    if (sort === "newest") sortOption = { createdAt: -1 };

    const total = await Product.countDocuments(query);
    let productsQuery = Product.find(query)
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(limit);

    if (fields) {
      productsQuery = productsQuery.select(fields);
    }

    const products = await productsQuery;

    return {
      products: JSON.parse(JSON.stringify(products)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
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
    }).sort({ createdAt: -1 });
    return JSON.parse(JSON.stringify(products));
  } catch (error) {
    console.error("Failed to fetch products by category:", error);
    return [];
  }
}

export async function getPublicProduct(id: string) {
  try {
    await connectDB();
    const product = await Product.findById(id);
    if (!product) return null;
    return JSON.parse(JSON.stringify(product));
  } catch (error) {
    console.error("Failed to fetch public product:", error);
    return null;
  }
}
