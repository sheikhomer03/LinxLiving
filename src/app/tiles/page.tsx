import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProductCard } from "@/components/products/ProductCard";
import { SlidersHorizontal } from "lucide-react";

const PRODUCTS = [
  {
    id: "1",
    name: "Calacatta Gold Slab",
    price: 450,
    category: "Marble",
    image: "/images/tiles1.jpg",
  },
  {
    id: "2",
    name: "Emerald Green Mosaic",
    price: 120,
    category: "Tiles",
    image: "/images/tiles2.jpg",
  },
  {
    id: "3",
    name: "Matte Black Hexagon",
    price: 85,
    category: "Ceramic",
    image: "/images/tiles3.jpg",
  },
  {
    id: "4",
    name: "Travertine Vessel Sink",
    price: 890,
    category: "Custom",
    image: "/images/tiles4.jpg",
  },
  {
    id: "5",
    name: "Statuary White Marble",
    price: 420,
    category: "Marble",
    image: "/images/tiles5.jpg",
  },
  {
    id: "6",
    name: "Oak Wood Texture Tile",
    price: 65,
    category: "Ceramic",
    image: "/images/tiles6.jpg",
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
