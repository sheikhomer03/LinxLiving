"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small building blocks for the visualiser's panels, in the site's style. */

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-black/10 pb-5 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[1px] text-black/60">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-4 text-black/50">{children}</p>;
}

export function Opt({
  active,
  onClick,
  children,
  title,
  className,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "font-menu min-h-9 border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active ? "border-black bg-black text-white" : "border-black/20 bg-white text-black hover:border-black",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <label htmlFor={id} className="text-black/80">{label}</label>
        <span className="tabular-nums text-black/60">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/15 accent-black"
        style={{ background: `linear-gradient(to right, #000 ${pct}%, rgba(0,0,0,.15) ${pct}%)` }}
      />
    </div>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-3 text-xs text-black/80", disabled && "cursor-not-allowed opacity-50")}>
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-black" : "bg-black/20",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </button>
    </label>
  );
}

/** Tiny previews of each bond pattern (ported from the testing-app panels). */
export function LayoutGlyph({ kind }: { kind: string }) {
  const r = (x: number, y: number, w: number, h: number, k: string) => (
    <rect key={k} x={x} y={y} width={w} height={h} rx="0.6" />
  );
  let shapes: ReactNode[] = [];
  if (kind === "grid") {
    shapes = [r(1, 1, 8, 5, "a"), r(10, 1, 8, 5, "b"), r(1, 7, 8, 5, "c"), r(10, 7, 8, 5, "d")];
  } else if (kind === "brick" || kind === "diagonal-brick") {
    shapes = [r(1, 1, 8, 5, "a"), r(10, 1, 8, 5, "b"), r(-3, 7, 8, 5, "c"), r(5.5, 7, 8, 5, "d"), r(14, 7, 8, 5, "e")];
  } else if (kind === "brick-third") {
    shapes = [r(1, 1, 8, 5, "a"), r(10, 1, 8, 5, "b"), r(-2, 7, 8, 5, "c"), r(7, 7, 8, 5, "d"), r(16, 7, 8, 5, "e")];
  } else if (kind === "vertical") {
    shapes = [r(1, 1, 5, 11, "a"), r(7, 1, 5, 11, "b"), r(13, 1, 5, 11, "c")];
  } else if (kind === "vertical-brick") {
    shapes = [r(1, -2, 5, 8, "a"), r(7, 1, 5, 8, "b"), r(13, -2, 5, 8, "c"), r(1, 7, 5, 8, "d"), r(13, 7, 5, 8, "e")];
  } else if (kind === "herringbone") {
    return (
      <svg viewBox="0 0 20 13" width="26" height="17" fill="currentColor" opacity=".85" aria-hidden>
        <g transform="rotate(45 10 6.5)">
          <rect x="1" y="2" width="8" height="3.4" rx=".5" />
          <rect x="9.5" y="-2.4" width="3.4" height="8" rx=".5" />
          <rect x="9.5" y="6" width="8" height="3.4" rx=".5" />
          <rect x="5.6" y="6" width="3.4" height="8" rx=".5" />
        </g>
      </svg>
    );
  } else if (kind === "basketweave") {
    shapes = [
      r(1, 1, 7.5, 2.4, "a"), r(1, 4, 7.5, 2.4, "b"),
      r(10, 1, 2.4, 5.4, "c"), r(13, 1, 2.4, 5.4, "d"),
      r(1, 7.5, 2.4, 4.5, "e"), r(4, 7.5, 2.4, 4.5, "f"),
      r(10, 7.5, 7.5, 1.9, "g"), r(10, 10, 7.5, 1.9, "h"),
    ];
  } else if (kind === "diagonal") {
    return (
      <svg viewBox="0 0 20 13" width="26" height="17" fill="currentColor" opacity=".85" aria-hidden>
        <g transform="rotate(45 10 6.5)">
          <rect x="3" y="0" width="6" height="6" rx=".6" />
          <rect x="10" y="0" width="6" height="6" rx=".6" />
          <rect x="3" y="7" width="6" height="6" rx=".6" />
          <rect x="10" y="7" width="6" height="6" rx=".6" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 13" width="26" height="17" fill="currentColor" opacity=".85" aria-hidden>
      <clipPath id={`vg-${kind}`}>
        <rect x="0" y="0" width="20" height="13" />
      </clipPath>
      <g clipPath={`url(#vg-${kind})`}>{shapes}</g>
    </svg>
  );
}
