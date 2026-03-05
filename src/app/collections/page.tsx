import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { CollectionCard } from "@/components/home/CollectionCard";

import { getPublicCollections } from "@/app/actions/collections";

export default async function CollectionsPage() {
  const collections = await getPublicCollections();

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
          {collections.map((collection: any) => (
            <CollectionCard
              key={collection._id}
              title={collection.name}
              image={collection.image || "/images/tiles1.jpg"}
              href={`/collections/${collection.slug}`}
            />
          ))}
        </div>
      </section>

      <Footer />
    </main>
  );
}
