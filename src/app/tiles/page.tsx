import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProductCard } from "@/components/products/ProductCard";
import { SlidersHorizontal } from "lucide-react";

const PRODUCTS = [
  {
    id: "65e49c7a2f5a2b1a3c4d5e64",
    name: "Calacatta Gold Slab",
    price: 450,
    category: "Marble",
    image: "/images/tiles1.jpg",
  },
  {
    id: "65e49c7a2f5a2b1a3c4d5e65",
    name: "Emerald Green Mosaic",
    price: 120,
    category: "Tiles",
    image: "/images/tiles2.jpg",
  },
  {
    id: "65e49c7a2f5a2b1a3c4d5e66",
    name: "Matte Black Hexagon",
    price: 85,
    category: "Ceramic",
    image: "/images/tiles3.jpg",
  },
];

export default function TilesPage() {
  return (
    <main className="min-h-screen">
      <Navbar />
      <PageHeader
        title=" Tiles"
        description="Discover our extensive range of premium tiles and slabs, curated for the most discerning architectural projects."
        breadcrumb={[{ label: "Tiles", href: "/tiles" }]}
      />

      <section className="py-12 px-6 lg:px-20">
        <div className="max-w-7xl mx-auto">
          {/* Controls */}
          <div className="flex justify-between items-center mb-12 py-4 border-b border-t border-transparent group">
            <button className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-bold hover:opacity-60 transition-opacity">
              <SlidersHorizontal className="w-4 h-4" />
              Filter & Sort
            </button>
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40">
              {PRODUCTS.length} Results
            </p>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 lg:gap-12">
            {PRODUCTS.map((product) => (
              <ProductCard key={product.id} {...product} />
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
