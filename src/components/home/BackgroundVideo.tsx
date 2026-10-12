"use client";

import { useEffect, useRef, useState } from "react";

/** Matches Tailwind's `lg` — the breakpoint where the hero reaches 810px. */
const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Screens where the 1080p cut is visibly stretched.
 *
 * The hero is full-bleed, so on a 1500px-wide Retina laptop it is painted
 * across ~3000 device pixels — a 1.6x upscale the browser does with a cheap
 * filter, and the softness that leaves is what reads as "low quality". A
 * 1440p cut, scaled offline with lanczos and a light unsharp pass, hands the
 * browser enough pixels that it barely has to interpolate.
 *
 * Either a dense display from `lg` up, or any very wide screen — a 1x
 * 2560px monitor stretches the 1080p cut just as far as a Retina laptop does.
 */
const LARGE_QUERY =
  "(min-width: 1024px) and (min-resolution: 1.5dppx), (min-width: 1800px)";

/**
 * Decorative background film that never slows the page down.
 *
 * The server HTML carries only the poster, so the first paint is a still.
 * The film is chosen and attached after the window `load` event and an idle
 * slot, so it never competes with the page's own CSS, JS and images. Phones get
 * the lighter `srcMobile`; visitors on Save-Data, 2G or reduced motion keep the
 * still and download nothing.
 */
export default function BackgroundVideo({
  src,
  srcLarge,
  srcMobile,
  poster,
  className,
  style,
}: {
  src: string;
  /** Sharper cut for dense or very wide screens. Falls back to `src`. */
  srcLarge?: string;
  srcMobile?: string;
  poster?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [activeSrc, setActiveSrc] = useState<string | null>(null);

  useEffect(() => {
    // Network Information API — Chromium only, so typed loosely here.
    const conn = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      conn?.saveData ||
      /(^|-)2g$/.test(conn?.effectiveType || "")
    ) {
      return;
    }

    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const pick = () => {
      if (!window.matchMedia(DESKTOP_QUERY).matches) {
        setActiveSrc(srcMobile || src);
        return;
      }
      setActiveSrc(
        srcLarge && window.matchMedia(LARGE_QUERY).matches ? srcLarge : src,
      );
    };
    const attach = () => {
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(pick, { timeout: 2000 });
      } else {
        timeoutId = setTimeout(pick, 200);
      }
    };

    if (document.readyState === "complete") attach();
    else window.addEventListener("load", attach, { once: true });

    return () => {
      window.removeEventListener("load", attach);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [src, srcLarge, srcMobile]);

  useEffect(() => {
    // Some browsers ignore `autoPlay` on a src set after hydration.
    if (activeSrc) ref.current?.play().catch(() => {});
  }, [activeSrc]);

  return (
    <video
      ref={ref}
      className={className}
      style={style}
      src={activeSrc ?? undefined}
      poster={poster}
      preload={activeSrc ? "auto" : "none"}
      autoPlay
      muted
      loop
      playsInline
      // Decorative background: the copy over it carries the meaning, and a
      // silent looping clip announced to a screen reader is just noise.
      aria-hidden
    />
  );
}
