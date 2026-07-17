import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const PROJECTS = [
  {
    title: "A home that embraces light",
    location: "Private residence",
    image: "/images/tiles2.jpg",
  },
  {
    title: "Material, light, and balance",
    location: "Urban apartment",
    image: "/images/tiles3.jpg",
  },
  {
    title: "Architecture in harmony",
    location: "Coastal villa",
    image: "/images/tiles5.jpg",
  },
];

export function ProjectGallery() {
  return (
    <section className="px-6 lg:px-20 py-16 md:py-24">
      <div className="max-w-[1400px] mx-auto space-y-10 md:space-y-12">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <p className="uppercase tracking-[0.35em] text-[10px] font-bold text-primary">
              Inspiration
            </p>
            <h2 className="text-3xl md:text-4xl font-serif tracking-[0.08em]">
              Spaces made with our materials
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              See how stone, ceramic, and fixture ranges come together in
              finished interiors — then start your own.
            </p>
          </div>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-bold border-b border-foreground/20 pb-1 hover:border-primary hover:text-primary transition-colors self-start shrink-0"
          >
            Discuss your project
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
          {PROJECTS.map((project) => (
            <Link
              key={project.title}
              href="/contact"
              className="group block space-y-4"
            >
              <div className="relative aspect-[4/5] overflow-hidden">
                <Image
                  src={project.image}
                  alt={project.title}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 33vw"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors duration-500" />
              </div>
              <div className="space-y-1.5 px-1">
                <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-bold">
                  {project.location}
                </p>
                <h3 className="font-serif text-lg tracking-[0.06em] leading-snug group-hover:text-primary transition-colors">
                  {project.title}
                </h3>
                <span className="inline-flex items-center gap-2 text-[9px] uppercase tracking-[0.25em] font-bold text-foreground/40 group-hover:text-primary transition-colors">
                  View project
                  <ArrowRight className="w-3 h-3 transition-transform duration-300 group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
