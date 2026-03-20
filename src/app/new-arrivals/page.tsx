import CategoryPage from "@/components/layout/CategoryTemplate";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New Arrivals | Latest Luxury Architectural Surfaces",
  description: "Stay ahead of design trends. Explore our newest architectural surface materials and luxury bathroom collections freshly added to our boutique.",
  alternates: {
    canonical: "/new-arrivals",
  },
};

export default function NewArrivalsPage() {
  return (
    <CategoryPage
      title="New Arrivals"
      description="Explore our latest architectural surface materials and luxury bathroom collections."
      slug="all"
    />
  );
}
