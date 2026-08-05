import { Loader2 } from "lucide-react";

export default function RootLoading() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="h-16 border-b border-foreground/10" />
      <div className="flex-1 flex items-center justify-center gap-3 text-foreground/60">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-[11px] uppercase tracking-[0.22em] font-bold">
          Loading…
        </span>
      </div>
    </div>
  );
}
