"use client";

import Link from "next/link";

export function Hero() {
  return (
    <section className="relative h-screen w-full flex items-center justify-center overflow-hidden">
      {/* Background Image Placeholder - In real app, use a high-res image */}
      <div
        className="absolute inset-0 bg-[url('/images/tiles1.jpg')] bg-cover bg-center"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-black/40" />
      </div>

      <div className="relative border border-white/30 mt-16 md:mt-24 lg:mt-32 rounded-3xl z-10 text-center bg-black/50 backdrop-blur-2xl text-white space-y-8 p-6 sm:p-8 md:p-12 max-w-4xl shadow-2xl ring-1 ring-white/10">
        <p className="uppercase tracking-[0.4em] text-sm font-medium animate-fade-in">
          Exquisite Craftsmanship
        </p>
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-serif md:tracking-tight leading-none animate-slide-up">
          Luxury Living <br />
          <span className="italic">without</span> Compromise
        </h2>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8 animate-fade-in-up">
          <Link
            href="/accessories"
            className="px-10 py-4 bg-primary text-primary-foreground uppercase tracking-widest text-xs font-bold hover:bg-white hover:text-black transition-colors duration-500 w-full sm:w-auto"
          >
            Shop Now
          </Link>
          <Link
            href="/custom"
            className="px-10 py-4 border border-white text-white uppercase tracking-widest text-xs font-bold hover:bg-white hover:text-black transition-colors duration-500 w-full sm:w-auto"
          >
            Custom Design
          </Link>
        </div>
      </div>
    </section>
  );
}
