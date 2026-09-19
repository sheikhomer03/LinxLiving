"use client";

import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";

export type FinishSwatch = {
  label: string;
  productId: string;
  colorValue?: string;
  secondaryColor?: string;
  swatchImage?: string;
  previewImage?: string;
  price?: number | null;
  available?: boolean;
  isCurrent?: boolean;
};

export type FinishSwatchGroup = {
  optionName: string;
  swatches: FinishSwatch[];
};

type Props = {
  groups: FinishSwatchGroup[];
  /** Hovering a swatch previews that finish in the gallery. */
  onPreview?: (image: string) => void;
  className?: string;
};

/**
 * Finish picker for suppliers that publish one product per finish: an arched
 * chip per finish, hover previews it in the gallery, clicking opens it.
 *
 * Not every axis is a picture, though. A size has nothing to show, and drawn
 * as a chip it comes out as an empty grey arch with the measurement squeezed
 * underneath — so a group whose options carry neither art nor a colour is
 * laid out as labelled buttons instead, which is how the suppliers who sell
 * one product per size present them.
 */
export function ProductFinishSwatches({ groups, onPreview, className }: Props) {
  const usable = (groups || []).filter((g) => (g.swatches || []).length);
  if (!usable.length) return null;

  return (
    <div className={cn("space-y-4", className)}>
      {usable.map((group) => {
        const pictorial = group.swatches.some(
          (s) =>
            String(s.swatchImage || "").trim() || String(s.colorValue || "").trim(),
        );
        if (!pictorial) {
          return (
            <div key={group.optionName}>
              <p className="mb-2 text-sm font-semibold text-foreground">
                {group.optionName}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.swatches.map((s) => (
                  <Link
                    key={s.productId}
                    href={`/products/${s.productId}`}
                    scroll={false}
                    aria-current={s.isCurrent ? "true" : undefined}
                    onMouseEnter={() =>
                      onPreview?.(String(s.previewImage || "").trim())
                    }
                    onMouseLeave={() => onPreview?.("")}
                    className={cn(
                      "inline-flex h-10 items-center border px-4 text-sm transition-colors",
                      s.isCurrent
                        ? "border-2 border-[#7a3b3b] font-semibold text-foreground"
                        : "border-foreground/20 text-foreground/80 hover:border-foreground/50",
                      !s.available && "opacity-45",
                    )}
                  >
                    {s.label}
                  </Link>
                ))}
              </div>
            </div>
          );
        }
        return (
        <div key={group.optionName}>
          <p className="mb-2 text-sm font-semibold text-foreground">
            {group.optionName}
          </p>
          <div className="flex flex-wrap gap-3">
            {group.swatches.map((s) => {
              const chip = String(s.swatchImage || "").trim();
              return (
                <Link
                  key={s.productId}
                  href={`/products/${s.productId}`}
                  scroll={false}
                  title={s.label}
                  aria-current={s.isCurrent ? "true" : undefined}
                  onMouseEnter={() =>
                    onPreview?.(String(s.previewImage || "").trim())
                  }
                  onMouseLeave={() => onPreview?.("")}
                  onFocus={() => onPreview?.(String(s.previewImage || "").trim())}
                  onBlur={() => onPreview?.("")}
                  className="group flex w-[52px] flex-col items-center gap-1 text-center"
                >
                  <span
                    className={cn(
                      // Arched chip, exactly as the supplier shows it.
                      "relative block h-[62px] w-12 overflow-hidden rounded-t-full border bg-white transition-colors",
                      s.isCurrent
                        ? "border-2 border-[#7a3b3b]"
                        : "border-foreground/20 group-hover:border-foreground/50",
                      !s.available && "opacity-45",
                    )}
                    style={
                      chip
                        ? undefined
                        : { backgroundColor: s.colorValue || "#e5e5e5" }
                    }
                  >
                    {chip ? (
                      <Image
                        src={chip}
                        alt={s.label}
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    ) : null}
                  </span>
                  <span className="text-[10px] font-semibold leading-tight text-foreground/80">
                    {s.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
        );
      })}
    </div>
  );
}
