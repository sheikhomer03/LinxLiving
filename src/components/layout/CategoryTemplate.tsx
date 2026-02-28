import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProductCard } from "@/components/products/ProductCard";
import { SlidersHorizontal } from "lucide-react";

const SIGNATURE_IMAGE = "/images/tiles5.jpg";

export default function CategoryPage({
  title,
  description,
  slug,
}: {
  title: string;
  description: string;
  slug: string;
}) {
  const products = [
    {
      id: "1",
      name: `Luxury ${title} I`,
      price: 1250,
      category: title,
      image: SIGNATURE_IMAGE,
    },
    {
      id: "2",
      name: `Minimalist ${title} II`,
      price: 890,
      category: title,
      image: SIGNATURE_IMAGE,
    },
    {
      id: "3",
      name: ` ${title} III`,
      price: 2100,
      category: title,
      image: SIGNATURE_IMAGE,
    },
    {
      id: "4",
      name: `Custom ${title} IV`,
      price: 3400,
      category: title,
      image: SIGNATURE_IMAGE,
    },
    {
      id: "5",
      name: `Classic ${title} V`,
      price: 1550,
      category: title,
      image: SIGNATURE_IMAGE,
    },
    {
      id: "6",
      name: `Modern ${title} VI`,
      price: 980,
      category: title,
      image: SIGNATURE_IMAGE,
    },
  ];

  return (
    <main className="min-h-screen">
      <Navbar />
      <PageHeader
        title={title}
        description={description}
        breadcrumb={[{ label: title, href: `/${slug}` }]}
      />

      <section className="py-24 px-6 lg:px-20">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-16 py-6 border-y border-foreground/5">
            <button className="flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] font-bold hover:opacity-60 transition-opacity">
              <SlidersHorizontal className="w-4 h-4" />
              Filter Models
            </button>
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-40">
              {products.length} Designs Available
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 lg:gap-16">
            {products.map((product) => (
              <ProductCard key={product.id} {...product} />
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
