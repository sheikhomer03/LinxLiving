"use client";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProductCard } from "@/components/products/ProductCard";
import { SlidersHorizontal, Folder } from "lucide-react";
import { useState, useEffect } from "react";
import { FilterSidebar } from "@/components/products/FilterSidebar";
import { Pagination } from "@/components/products/Pagination";
import { getPublicProducts } from "@/app/actions/products";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getProductDisplayImage } from "@/lib/productImage";

interface CategoryPageProps {
  title: string;
  description: string;
  slug: string;
}

function CategoryPageContent({ title, description, slug }: CategoryPageProps) {
  const searchParams = useSearchParams();
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [data, setData] = useState<{
    products: any[];
    total: number;
    totalPages: number;
    page: number;
  }>({
    products: [],
    total: 0,
    totalPages: 0,
    page: 1,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchProducts = async () => {
      setIsLoading(true);
      const urlCategory = searchParams.get("category");
      const filters = {
        category: urlCategory || slug,
        minPrice: searchParams.get("minPrice")
          ? Number(searchParams.get("minPrice"))
          : undefined,
        maxPrice: searchParams.get("maxPrice")
          ? Number(searchParams.get("maxPrice"))
          : undefined,
        sort: searchParams.get("sort") || "newest",
        search: searchParams.get("search") || undefined,
        page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
        limit: 12,
      };

      const result = await getPublicProducts(filters);
      setData(result);
      setIsLoading(false);
    };

    fetchProducts();
  }, [slug, searchParams]);

  return (
    <main className="min-h-screen">
      <Navbar />
      <PageHeader
        title={title}
        description={description}
        breadcrumb={[{ label: title, href: `/category/${slug}` }]}
      />

      <section className="md:py-10 px-6 lg:px-20">
        <div className="max-w-8xl mx-auto">
          <div className="flex justify-between items-center mb-16 py-6 border-y border-foreground/5">
            <button
              onClick={() => setIsFilterOpen(true)}
              className="flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] font-bold hover:opacity-90 transition-opacity"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filter Models
            </button>
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
              {data.total} Designs Available
            </p>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 xl:grid-cols-4 lg:gap-16 opacity-90 animate-pulse">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="aspect-square bg-secondary" />
              ))}
            </div>
          ) : data.products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-6 opacity-90">
              <Folder className="w-16 h-16 stroke-1" />
              <div className="text-center space-y-2">
                <h3 className="text-xl font-serif tracking-widest uppercase">
                  No products found
                </h3>
                <p className="text-[10px] uppercase tracking-widest">
                  Try adjusting your filters
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-6 mb-20">
                {data.products.map((product) => (
                  <ProductCard
                    key={product._id}
                    id={product._id}
                    name={product.name}
                    price={product.price}
                    category={product.category}
                    image={getProductDisplayImage(product.images)}
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

export default function CategoryPage(props: CategoryPageProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex flex-col">
          <Navbar />
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-pulse text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
              Curating architectural elements...
            </div>
          </div>
          <Footer />
        </div>
      }
    >
      <CategoryPageContent {...props} />
    </Suspense>
  );
}
