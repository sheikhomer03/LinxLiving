import { Loader2 } from "lucide-react";

/** Instant route-level UI while catalogue / PDP RSC work finishes. */
export function CatalogueLoadingShell({
  label = "Loading catalogue…",
}: {
  label?: string;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="h-16 border-b border-foreground/10 bg-white/80" />
      <div className="border-b border-foreground/10 px-4 sm:px-6 lg:px-12 xl:px-20 py-8 md:py-12">
        <div className="max-w-8xl mx-auto space-y-3 animate-pulse">
          <div className="h-3 w-40 bg-secondary rounded" />
          <div className="h-8 w-64 md:w-96 bg-secondary rounded" />
          <div className="h-4 w-full max-w-xl bg-secondary/80 rounded" />
        </div>
      </div>
      <div className="flex-1 px-4 sm:px-6 lg:px-12 xl:px-20 py-8">
        <div className="max-w-8xl mx-auto">
          <div className="flex items-center gap-3 mb-8 text-foreground/60">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[11px] uppercase tracking-[0.22em] font-bold">
              {label}
            </span>
          </div>
          <div className="grid lg:grid-cols-12 gap-10">
            <div className="hidden lg:block lg:col-span-3 space-y-4 animate-pulse">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-4 bg-secondary rounded w-3/4" />
              ))}
            </div>
            <div className="lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="aspect-square bg-secondary animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProductDetailLoadingShell() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-16 border-b border-foreground/10 bg-white/80" />
      <div className="px-4 sm:px-6 lg:px-12 xl:px-20 py-8 md:py-12">
        <div className="max-w-8xl mx-auto grid lg:grid-cols-2 gap-10">
          <div className="aspect-square bg-secondary animate-pulse" />
          <div className="space-y-4 animate-pulse pt-4">
            <div className="h-3 w-28 bg-secondary rounded" />
            <div className="h-8 w-3/4 bg-secondary rounded" />
            <div className="h-4 w-1/3 bg-secondary rounded" />
            <div className="h-24 w-full bg-secondary/80 rounded" />
            <div className="flex items-center gap-2 pt-6 text-foreground/60">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[11px] uppercase tracking-[0.22em] font-bold">
                Loading product…
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
