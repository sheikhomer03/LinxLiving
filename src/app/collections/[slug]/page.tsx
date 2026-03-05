"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProductCard } from "@/components/products/ProductCard";
import { getCollectionBySlug } from "@/app/actions/collections";
import { getPublicProducts } from "@/app/actions/products";
import { Folder, SlidersHorizontal } from "lucide-react";
import { useEffect, useState, use } from "react";
import { FilterSidebar } from "@/components/products/FilterSidebar";
import { Pagination } from "@/components/products/Pagination";

function DynamicCollectionContent({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const searchParams = useSearchParams();
  const [collection, setCollection] = useState<any>(null);
  const [data, setData] = useState<any>({
    products: [],
    total: 0,
    totalPages: 0,
    page: 1,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      const coll = await getCollectionBySlug(slug);
      if (!coll) {
        setCollection(null);
        setIsLoading(false);
        return;
      }
      setCollection(coll);

      const filters = {
        category: slug,
        minPrice: searchParams.get("minPrice")
          ? Number(searchParams.get("minPrice"))
          : undefined,
        maxPrice: searchParams.get("maxPrice")
          ? Number(searchParams.get("maxPrice"))
          : undefined,
        sort: searchParams.get("sort") || "newest",
        page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
        limit: 12,
      };

      const result = await getPublicProducts(filters);
      setData(result);
      setIsLoading(false);
    };

    fetchData();
  }, [slug, searchParams]);

  if (!isLoading && !collection) {
    notFound();
  }

  return (
    <main className="min-h-screen">
      <Navbar />
      {collection && (
        <PageHeader
          title={collection.name}
          description={collection.description}
          breadcrumb={[
            { label: "Collections", href: "/collections" },
            { label: collection.name, href: `/collections/${collection.slug}` },
          ]}
        />
      )}

      <section className="py-24 px-6 lg:px-20 min-h-[50vh]">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-16 py-6 border-y border-foreground/5">
            <button
              onClick={() => setIsFilterOpen(true)}
              className="flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] font-bold hover:opacity-60 transition-opacity"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filter Models
            </button>
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-40">
              {data.total} Designs Available
            </p>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-6 opacity-30 animate-pulse">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="aspect-square bg-secondary" />
              ))}
            </div>
          ) : data.products.length === 0 ? (
            <div className="flex flex-col items-center justify-center space-y-6 opacity-60 mt-20">
              <Folder className="w-16 h-16 stroke-1" />
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-serif tracking-widest uppercase">
                  Empty Collection
                </h3>
                <p className="text-xs uppercase tracking-[0.2em] font-medium max-w-sm mx-auto">
                  There are currently no featured products available in the{" "}
                  {collection?.name} collection.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-12 mb-20">
                {data.products.map((product: any) => (
                  <ProductCard
                    key={product._id}
                    id={product._id}
                    name={product.name}
                    price={product.price}
                    category={product.category}
                    image={product.images?.[0] || "/images/placeholder.jpg"}
                  />
                ))}
              </div>

              <Pagination
                currentPage={data.page}
                totalPages={data.totalPages}
              />
            </>
          )}
        </div>
      </section>

      <FilterSidebar
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
      />
      <Footer />
    </main>
  );
}

export default function DynamicCollectionPage(props: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex flex-col">
          <Navbar />
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-pulse text-[10px] uppercase tracking-[0.3em] font-bold opacity-40">
              Opening collection archives...
            </div>
          </div>
          <Footer />
        </div>
      }
    >
      <DynamicCollectionContent {...props} />
    </Suspense>
  );
}
