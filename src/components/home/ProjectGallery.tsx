import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export type ProjectGalleryItem = {
  title: string;
  location: string;
  image: string;
  href: string;
};

interface ProjectGalleryProps {
  items?: ProjectGalleryItem[];
}

export function ProjectGallery({ items = [] }: ProjectGalleryProps) {
  if (!items.length) return null;

  const [lead, ...rest] = items;

  return (
    <section className="py-14 md:py-20 bg-[hsl(var(--dark-section))] text-white">
      <div className="site-container space-y-12">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="max-w-xl space-y-3">
            <p className="uppercase tracking-[0.22em] text-[10px] font-bold text-primary">
              Inspiration
            </p>
            <h2 className="font-serif text-2xl md:text-3xl tracking-[0.04em]">
              In real spaces
            </h2>
            <p className="text-white/55 text-sm leading-relaxed">
              See how our materials translate from sample to finished interior.
            </p>
          </div>
          <Link
            href="/category"
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-bold text-white/60 hover:text-primary transition-colors shrink-0"
          >
            Browse catalogue
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-5">
          {lead && (
            <Link
              href={lead.href}
              className="lg:col-span-7 group relative aspect-4/3 lg:aspect-auto lg:min-h-90 overflow-hidden bg-white/5"
            >
              {lead.image ? (
                <Image
                  src={lead.image}
                  alt={lead.title}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                  sizes="(max-width: 1024px) 100vw, 58vw"
                />
              ) : null}
              <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-0 inset-x-0 p-4 sm:p-6 md:p-8 space-y-0.5 sm:space-y-1">
                <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] sm:tracking-[0.25em] text-primary font-bold">
                  {lead.location}
                </p>
                <h3 className="font-serif font-bold text-base sm:text-xl md:text-2xl tracking-[0.04em] sm:tracking-[0.08em]">
                  {lead.title}
                </h3>
              </div>
            </Link>
          )}

          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4 md:gap-5">
            {rest.map((project) => (
              <Link
                key={`${project.href}-${project.title}`}
                href={project.href}
                className="group relative aspect-16/10 lg:aspect-auto lg:flex-1 lg:min-h-57.5 overflow-hidden bg-white/5"
              >
                {project.image ? (
                  <Image
                    src={project.image}
                    alt={project.title}
                    fill
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                    sizes="(max-width: 1024px) 50vw, 30vw"
                  />
                ) : null}
                <div className="absolute inset-0 bg-black/20 group-hover:bg-black/35 transition-colors" />
                <div className="absolute bottom-0 inset-x-0 p-3 sm:p-5 space-y-0.5">
                  <p className="text-[8px] sm:text-[9px] uppercase tracking-[0.12em] sm:tracking-[0.2em] text-white/85 font-bold">
                    {project.location}
                  </p>
                  <h3 className="font-serif font-bold text-sm sm:text-base tracking-[0.03em] sm:tracking-[0.06em] text-white">
                    {project.title}
                  </h3>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
