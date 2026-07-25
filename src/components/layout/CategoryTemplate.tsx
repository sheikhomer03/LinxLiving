"use client";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProductCard } from "@/components/products/ProductCard";
import { Folder, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
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
  initialProducts?: {
    products: any[];
    total: number;
    totalPages: number;
    page: number;
  };
  initialBrandMenus?: any[];
  initialStoreName?: string;
}

function CategoryPageContent({
  title,
  description,
  slug,
  initialProducts,
  initialBrandMenus,
  initialStoreName,
}: CategoryPageProps) {
  const searchParams = useSearchParams();
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [data, setData] = useState<{
    products: any[];
    total: number;
    totalPages: number;
    page: number;
  }>(
    initialProducts || {
      products: [],
      total: 0,
      totalPages: 0,
      page: 1,
    },
  );
  const [isLoading, setIsLoading] = useState(!initialProducts);

  useEffect(() => {
    const urlCategory = searchParams.get("category");
    const page = searchParams.get("page")
      ? Number(searchParams.get("page"))
      : 1;
    const sort = searchParams.get("sort") || "newest";
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const search = searchParams.get("search") || undefined;

    const isDefaultView =
      !urlCategory &&
      !minPrice &&
      !maxPrice &&
      !search &&
      (!searchParams.get("sort") || sort === "newest") &&
      page === 1;

    if (isDefaultView && initialProducts) {
      setData(initialProducts);
      setIsLoading(false);
      return;
    }

    const fetchProducts = async () => {
      setIsLoading(true);
      const result = await getPublicProducts({
        category: urlCategory || slug,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        sort,
        search,
        page,
        limit: 12,
      });
      setData(result);
      setIsLoading(false);
    };

    fetchProducts();
  }, [slug, searchParams, initialProducts]);

  return (
    <main className="min-h-screen">
      <Navbar
        initialBrandMenus={initialBrandMenus}
        initialStoreName={initialStoreName}
      />
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
                    stock={product.stock}
                    shopifyVariantId={product.shopifyVariantId}
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
      <Footer initialStoreName={initialStoreName} />
    </main>
  );
}

export default function CategoryPage(props: CategoryPageProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex flex-col">
          <Navbar
            initialBrandMenus={props.initialBrandMenus}
            initialStoreName={props.initialStoreName}
          />
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-pulse text-[10px] uppercase tracking-[0.3em] font-bold opacity-80">
              Curating architectural elements...
            </div>
          </div>
          <Footer initialStoreName={props.initialStoreName} />
        </div>
      }
    >
      <CategoryPageContent {...props} />
    </Suspense>
  );
}
