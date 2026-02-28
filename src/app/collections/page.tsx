import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { CollectionCard } from "@/components/home/CollectionCard";

const COLLECTIONS = [
  {
    title: "Carrara Marble",
    subtitle: "Timeless Italian Elegance",
    image: "/images/tiles1.jpg",
    href: "/collections/carrara",
  },
  {
    title: "Ceramic Textures",
    subtitle: "Modern al Finish",
    image: "/images/tiles2.jpg",
    href: "/collections/ceramic",
  },
  {
    title: "Stone Basins",
    subtitle: "Minimalist Sculptures",
    image: "/images/tiles3.jpg",
    href: "/collections/stone-basins",
  },
  {
    title: "Veneer Slabs",
    subtitle: "Thin & Versatile",
    image: "/images/tiles4.jpg",
    href: "/collections/veneer",
  },
  {
    title: "Mosaic Art",
    subtitle: "Intricate Details",
    image: "/images/tiles5.jpg",
    href: "/collections/mosaic",
  },
  {
    title: "Outdoor Stone",
    subtitle: "Raw & Rugged",
    image: "/images/tiles6.jpg",
    href: "/collections/outdoor",
  },
];

export default function CollectionsPage() {
  return (
    <main className="min-h-screen">
      <Navbar />
      <PageHeader
        title="Our Collections"
        description="Explore our curated selection of fine surface materials, from the classic elegance of Carrara marble to the modern textures of handcrafted ceramic."
        breadcrumb={[{ label: "Collections", href: "/collections" }]}
      />

      <section className="py-24 px-6 lg:px-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {COLLECTIONS.map((collection) => (
            <CollectionCard key={collection.title} {...collection} />
          ))}
        </div>
      </section>

      <Footer />
    </main>
  );
}
