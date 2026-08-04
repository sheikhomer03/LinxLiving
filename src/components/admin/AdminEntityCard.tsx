import Image from "next/image";
import { cn } from "@/lib/utils";

type BadgeTone = "success" | "muted" | "warning" | "primary";

const badgeClass: Record<BadgeTone, string> = {
  success:
    "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  muted: "bg-stone-100 text-stone-500 border-stone-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200/80",
  primary: "bg-primary/10 text-primary border-primary/20",
};

export function AdminEntityCard({
  image,
  imageAlt = "",
  title,
  subtitle,
  badge,
  badgeTone = "muted",
  meta,
  actions,
  className,
}: {
  image?: string | null;
  imageAlt?: string;
  title: string;
  subtitle?: React.ReactNode;
  badge?: string | null;
  badgeTone?: BadgeTone;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "bg-white admin-panel-elevated overflow-hidden flex flex-col min-w-0",
        className,
      )}
    >
      <div className="relative w-full aspect-[16/9] bg-stone-100 border-b border-stone-200/80">
        {image ? (
          <Image
            src={image}
            alt={imageAlt || title}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, 50vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center m-3 rounded-sm border border-dashed border-stone-200 bg-secondary/30">
            <span className="text-[9px] uppercase tracking-widest font-bold text-stone-400">
              No cover
            </span>
          </div>
        )}
        {badge ? (
          <span
            className={cn(
              "absolute top-2 right-2 rounded-full border px-2.5 py-1 text-[9px] uppercase font-bold tracking-wider",
              badgeClass[badgeTone],
            )}
          >
            {badge}
          </span>
        ) : null}
      </div>

      <div className="p-3.5 flex flex-col gap-3 flex-1 min-w-0">
        <div className="min-w-0">
          <h2 className="text-[12px] uppercase tracking-[0.12em] font-black text-stone-800 truncate">
            {title}
          </h2>
          {subtitle ? (
            <div className="text-[10px] text-stone-500 mt-1 break-words">
              {subtitle}
            </div>
          ) : null}
          {meta ? <div className="mt-2">{meta}</div> : null}
        </div>

        {actions ? (
          <div className="mt-auto flex items-center gap-2 pt-1 border-t border-stone-100">
            {actions}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function AdminEntityCardGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 sm:grid-cols-2 gap-3 lg:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
