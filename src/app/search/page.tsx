import CategoryTemplate from "@/components/layout/CategoryTemplate";
import { Suspense } from "react";

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
          <div className="animate-pulse text-[10px] uppercase tracking-[0.3em] font-bold opacity-40">
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
