import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://linxliving.co.uk";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/api/",
        "/profile/",
        "/checkout/",
        "/cart/",
        "/login",
        "/register",
        "/forgot-password/",
        "/search",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
