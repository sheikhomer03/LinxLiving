import Link from "next/link";
import Image from "next/image";

interface CollectionCardProps {
  title: string;
  image: string;
  href: string;
}

export function CollectionCard({ title, image, href }: CollectionCardProps) {
  return (
    <Link
      href={href}
      className="group block relative overflow-hidden aspect-4/5"
    >
      <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors duration-500 z-10" />
      <Image
        src={image}
        alt={title}
        fill
        className="object-cover transition-transform duration-700 group-hover:scale-110"
      />
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-end p-12 text-white text-center">
        <h3 className="text-2xl font-serif tracking-widest uppercase mb-4 transition-transform duration-500 transform translate-y-0 lg:translate-y-4 lg:group-hover:translate-y-0">
          {title}
        </h3>
        <span className="text-[10px] uppercase tracking-widest border-b border-transparent group-hover:border-white transition-all duration-500 pb-1">
          Explore Collection
        </span>
      </div>
    </Link>
  );
}
