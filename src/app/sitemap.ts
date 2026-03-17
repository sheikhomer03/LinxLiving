import { MetadataRoute } from "next";
import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { Menu } from "@/models/Menu";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://linxliving.co.uk";

  // Connect to DB
  await connectDB();

  // Fetch all products
  const products = await Product.find({}, "_id updatedAt").lean();
  const productUrls = products.map((product: any) => ({
    url: `${baseUrl}/products/${product._id}`,
    lastModified: product.updatedAt || new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  // Fetch all categories (menus)
  const categories = await Menu.find({}, "slug updatedAt").lean();
  const categoryUrls = categories.map((cat: any) => ({
    url: `${baseUrl}/category/${cat.slug}`,
    lastModified: cat.updatedAt || new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  // Static pages
  const staticPages = [
    "",
    "/contact",
    "/faq",
    "/custom",
    "/shipping-returns",
    "/new-arrivals",
  ].map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: route === "" ? 1.0 : 0.6,
  }));

  return [...staticPages, ...productUrls, ...categoryUrls];
}
