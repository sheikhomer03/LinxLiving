import CategoryTemplate from "@/components/layout/CategoryTemplate";
import { Suspense } from "react";
import type { Metadata } from "next";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: q ? `Search results for "${q}"` : "Search Our Catalog",
    description: q
      ? `Explore our collection of luxury architectural materials matching "${q}".`
      : "Discover exquisite stone baths, fine ceramics, and luxury architectural tiles.",
    robots: {
      index: false,
      follow: true,
    },
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q || "";

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="animate-pulse text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
            Scouring catalog...
          </div>
        </div>
      }
    >
      <CategoryTemplate
        title={query ? `Results for "${query}"` : "Search Results"}
        description={
          query
            ? `Discover our exquisite collection matching your inquiry for "${query}".`
            : "Explore our full catalog of luxury architectural elements."
        }
        slug="all"
      />
    </Suspense>
  );
}
