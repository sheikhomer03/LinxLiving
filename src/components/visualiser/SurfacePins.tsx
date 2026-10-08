"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useVisualiser } from "@/components/visualiser/VisualiserContext";
// The engine's own geometry, so a pin sits where the renderer draws the surface.
import { maskAnchor } from "@/components/visualiser/engine/masks.js";

/**
 * A marker on the floor and on every wall part (ported from the testing-app's
 * SurfacePins). The room opens looking exactly like the photograph, so without
 * these nothing says the floor and each wall can be picked separately.
 *
 * A pin sits at the mask's pole of inaccessibility (maskAnchor), never on an
 * edge or a neighbour's pin; it follows zoom and pan with the same aspect-fit
 * the renderer applies.
 */
export function SurfacePins({ hover, onHover }: { hover: string | null; onHover: (name: string | null) => void }) {
  const room = useVisualiser((s) => s.room);
  const surfaces = useVisualiser((s) => s.surfaces);
  const designs = useVisualiser((s) => s.designs);
  const active = useVisualiser((s) => s.activeSurface);
  const view = useVisualiser((s) => s.view);
  const setActiveSurface = useVisualiser((s) => s.setActiveSurface);
  const setTab = useVisualiser((s) => s.setTab);

  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Pure geometry: only changes with the room.
  const anchors = useMemo(() => {
    const out: Record<string, { x: number; y: number } | null> = {};
    if (!room) return out;
    for (const o of room.objectList) {
      if (!surfaces[o.name]) continue;
      try {
        out[o.name] = maskAnchor(o.mask, room.width, room.height) as { x: number; y: number } | null;
      } catch {
        out[o.name] = null;
      }
    }
    return out;
    // surfaces' keys are fixed for a room; the room is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  if (!room || !box) return <div ref={ref} className="pointer-events-none absolute inset-0" />;

  const photoAspect = room.width / room.height;
  const canvasAspect = box.w / box.h;
  const scale =
    photoAspect > canvasAspect ? { x: 1, y: canvasAspect / photoAspect } : { x: photoAspect / canvasAspect, y: 1 };
  const place = (px: number, py: number) => {
    const ux = px / room.width;
    const uy = 1 - py / room.height;
    const vx = (ux - view.x) * scale.x * view.zoom + 0.5;
    const vy = (uy - view.y) * scale.y * view.zoom + 0.5;
    return { left: vx * 100, top: (1 - vy) * 100, on: vx > 0.03 && vx < 0.97 && vy > 0.03 && vy < 0.97 };
  };

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-10">
      {room.objectList.map((o) => {
        const surface = surfaces[o.name];
        const a = anchors[o.name];
        if (!surface || !a) return null;
        const pos = place(a.x, a.y);
        if (!pos.on) return null;
        const design = surface.designId ? designs[surface.designId]?.design : null;
        const isActive = active === o.name;
        return (
          <button
            key={o.name}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActiveSurface(o.name);
              setTab("products");
            }}
            onPointerEnter={() => onHover(o.name)}
            onPointerLeave={() => onHover(null)}
            className={cn(
              "pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border bg-white/90 py-1 pl-1 pr-2.5 text-left shadow-md backdrop-blur transition-colors",
              isActive || hover === o.name ? "border-black" : "border-black/10",
            )}
            style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
            title={`${surface.label} — ${design ? design.name : "tap to choose a design"}`}
          >
            {design ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={design.thumb} alt="" className="h-6 w-6 rounded-full object-cover" />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-sm font-semibold text-white">
                +
              </span>
            )}
            <span className="max-w-[9rem] text-[10px] leading-3">
              <strong className="block capitalize text-black">{surface.label}</strong>
              <span className="block truncate text-black/60">{design ? design.name : "Tap to design"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
