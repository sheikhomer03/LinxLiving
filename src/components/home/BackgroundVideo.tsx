"use client";

import { useEffect, useRef, useState } from "react";

/** Matches Tailwind's `lg` — the breakpoint where the hero reaches 810px. */
const DESKTOP_QUERY = "(min-width: 1024px)";

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
  srcMobile,
  poster,
  className,
  style,
}: {
  src: string;
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
    const pick = () =>
      setActiveSrc(
        window.matchMedia(DESKTOP_QUERY).matches ? src : srcMobile || src,
      );
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
  }, [src, srcMobile]);

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
