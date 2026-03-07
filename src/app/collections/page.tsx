import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { CollectionCard } from "@/components/home/CollectionCard";
import { FolderOpen } from "lucide-react";

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
        {collections.length > 0 ? (
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
        ) : (
          <div className="flex flex-col items-center justify-center py-40 space-y-8 max-w-7xl mx-auto border border-foreground/5 bg-secondary/20 rounded-3xl">
            <FolderOpen className="w-20 h-20 stroke-[0.5] opacity-90" />
            <div className="text-center space-y-3">
              <h3 className="text-2xl font-serif tracking-[0.2em] uppercase opacity-80">
                Archive Empty
              </h3>
              <p className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-90">
                Check back shortly for our latest curations
              </p>
            </div>
            <div className="w-px h-12 bg-foreground/10" />
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}
