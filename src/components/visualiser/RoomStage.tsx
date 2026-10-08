"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import {
  AlertCircle,
  Columns2,
  Download,
  ImageUp,
  Loader2,
  MapPin,
  Maximize,
  Minimize,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useVisualiser } from "@/components/visualiser/VisualiserContext";
import { selectPrimaryDesign } from "@/store/useVisualiserStore";
import { SurfacePins } from "@/components/visualiser/SurfacePins";
import { trimmedTexture } from "@/components/visualiser/trimTexture";
// The engine is plain JS, copied unchanged from the testing-app visualiser.
import useRenderer from "@/components/visualiser/engine/useRenderer.js";
import { defaultSurfaceState, materialModel } from "@/components/visualiser/engine/layouts.js";
import { loadImage } from "@/components/visualiser/engine/textures.js";
import { pointInMask } from "@/components/visualiser/engine/masks.js";

/** Engine surface state (plain JS object; see engine/layouts.js defaultSurfaceState). */
type SurfaceState = Record<string, unknown>;

/** The parts of the (untyped JS) renderer this component reaches into. */
type EngineRenderer = {
  exportFrame: (frame: "left" | "right", opts?: { watermark?: string }) => HTMLCanvasElement;
  presentMat?: { uniforms: { uScale: { value: { x: number; y: number } } } };
  setBackground?: (hex: string) => void;
};

/** Around the photo: the stage's light grey, not the engine's dark default. */
const STAGE_BG = "#f3f3f1";

/** Keep the pan inside the photo so it cannot be dragged off into the void (testing-app). */
function clampPan(v: number, zoom: number) {
  const half = 0.5 / zoom;
  return Math.min(1 - half, Math.max(half, v));
}

/** Square icon button, as on the testing-app stage toolbar (light theme). */
function ToolButton({
  label,
  onClick,
  active,
  disabled,
  children,
  wide,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border text-xs font-semibold shadow-sm backdrop-blur transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        wide ? "px-3" : "w-9",
        active
          ? "border-black bg-black text-white"
          : "border-black/10 bg-white/90 text-black hover:bg-white",
      )}
    >
      {children}
    </button>
  );
}

export function RoomStage() {
  const room = useVisualiser((s) => s.room);
  const surfaces = useVisualiser((s) => s.surfaces);
  const designs = useVisualiser((s) => s.designs);
  const activeSurface = useVisualiser((s) => s.activeSurface);
  const setActiveSurface = useVisualiser((s) => s.setActiveSurface);
  const setTab = useVisualiser((s) => s.setTab);
  const compare = useVisualiser((s) => s.compare);
  const split = useVisualiser((s) => s.split);
  const view = useVisualiser((s) => s.view);
  const setCompare = useVisualiser((s) => s.setCompare);
  const setSplit = useVisualiser((s) => s.setSplit);
  const setView = useVisualiser((s) => s.setView);
  const resetView = useVisualiser((s) => s.resetView);
  const newPhoto = useVisualiser((s) => s.newPhoto);
  // Names the download and the canvas after the design last chosen.
  const design = useVisualiser(selectPrimaryDesign).design;

  const surfaceNames = useMemo(() => Object.keys(surfaces), [surfaces]);
  const [hover, setHover] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // Designs actually laid somewhere: the renderer loads each one once.
  const usedIds = useMemo(
    () =>
      [...new Set(Object.values(surfaces).map((f) => f.designId).filter((id): id is string => Boolean(id)))]
        .sort()
        .join(","),
    [surfaces],
  );

  // Tile photos lose their plain white/transparent margin before they become
  // a texture (a blob URL, in memory). The renderer caches a design by id, so
  // a tile is only handed over once its trimmed texture is ready.
  const [textures, setTextures] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    for (const id of usedIds.split(",").filter(Boolean)) {
      const d = designs[id]?.design;
      if (!d || d.kind !== "tile" || textures[d.image]) continue;
      trimmedTexture(d.image).then((url) => {
        if (live) setTextures((t) => (t[d.image] ? t : { ...t, [d.image]: url }));
      });
    }
    return () => {
      live = false;
    };
  }, [usedIds, designs, textures]);

  const products = useMemo(
    () =>
      usedIds
        .split(",")
        .filter(Boolean)
        .map((id) => designs[id]?.design)
        .filter((d): d is NonNullable<typeof d> => Boolean(d))
        .map((d) => {
          const image = d.kind === "tile" ? textures[d.image] : d.image;
          return image ? { id: d.id, name: d.name, material: d.material, image, faces: [image] } : null;
        })
        .filter((p): p is NonNullable<typeof p> => Boolean(p)),
    [usedIds, designs, textures],
  );
  const texturesPending = usedIds.split(",").filter(Boolean).length > products.length;

  // Whether each used design's photograph loads as a texture at all, keyed by
  // URL (the same cached loader the renderer uses, so each is fetched once).
  const [imageChecks, setImageChecks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    for (const p of products) {
      loadImage(p.image).then(
        () => live && setImageChecks((c) => (c[p.image] === true ? c : { ...c, [p.image]: true })),
        () => live && setImageChecks((c) => (c[p.image] === false ? c : { ...c, [p.image]: false })),
      );
    }
    return () => {
      live = false;
    };
  }, [products]);
  const designLoading = texturesPending || products.some((p) => imageChecks[p.image] === undefined);
  const designFailed = products.some((p) => imageChecks[p.image] === false);

  const frames = useMemo(() => {
    if (!room) return { left: {}, right: {} };
    const blank: Record<string, SurfaceState> = {};
    const laid: Record<string, SurfaceState> = {};
    for (const o of room.objectList) {
      const base: SurfaceState = {
        ...defaultSurfaceState(o.product_surface),
        ...((o.defaults as Record<string, unknown> | undefined) ?? {}),
      };
      blank[o.name] = base;
      // A surface with no design keeps productId null: the renderer skips it,
      // so it shows exactly as photographed.
      const f = surfaces[o.name];
      const d = f?.designId ? designs[f.designId]?.design : null;
      if (!f || !d) {
        laid[o.name] = base;
        continue;
      }
      const model = materialModel(d.material);
      const modular = model === "module";
      laid[o.name] = {
        ...base,
        productId: d.id,
        model,
        visible: f.visible,
        tileSize: f.tileSize,
        // A sheet (carpet) has no bond pattern or joints.
        layout: modular ? f.layout : "grid",
        rotation: f.rotation,
        offset: f.offset,
        grout: { size: modular ? f.grout.size : 0, color: f.grout.color },
        bevel: modular ? f.bevel : 0,
        gloss: f.gloss,
        shade: f.shade,
        detail: f.detail,
        tint: f.tint,
        randomFace: f.randomFace,
        randomRotate: f.randomRotate,
      };
    }
    // Compare: left of the split is the room as photographed, right the new
    // floor. Otherwise the whole frame is the new floor.
    return compare ? { left: blank, right: laid } : { left: laid, right: blank };
  }, [room, surfaces, designs, compare]);

  const { attach, renderer, ready, loading, error, screenToPhoto } = useRenderer(room, {
    products,
    frames,
    compare,
    split,
    view,
    highlight: compare ? null : hover,
  });
  const engine = () => renderer.current as unknown as EngineRenderer | null;

  // Light theme: paint the area around the photo the stage's own colour.
  useEffect(() => {
    if (ready) (renderer.current as unknown as EngineRenderer | null)?.setBackground?.(STAGE_BG);
  }, [ready, renderer]);

  /** The floor or wall part under a screen point, if any. */
  const surfaceAt = useCallback(
    (clientX: number, clientY: number): string | null => {
      if (!room) return null;
      const pt = screenToPhoto(clientX, clientY) as { x: number; y: number } | null;
      if (!pt) return null;
      // Later surfaces sit on top of earlier ones, so search back to front.
      for (let i = room.objectList.length - 1; i >= 0; i--) {
        const o = room.objectList[i];
        if (pointInMask(o.mask, pt.x, pt.y)) return surfaces[o.name] ? o.name : null;
      }
      return null;
    },
    [room, surfaces, screenToPhoto],
  );

  // --- pointer: tap a surface to design it, drag to pan when zoomed ----------
  const pickable = surfaceNames.length > 0 && !compare;
  // Pins explain the room once, after the scan; the toolbar brings them back.
  const [pinsOn, setPinsOn] = useState(true);
  useEffect(() => {
    if (!ready) return undefined;
    const t = setTimeout(() => setPinsOn(false), 4500);
    return () => clearTimeout(t);
  }, [ready]);
  const drag = useRef<{ x: number; y: number; moved: boolean; start: typeof view } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false, start: { ...view } };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) {
      if (pickable && e.pointerType === "mouse") {
        const name = surfaceAt(e.clientX, e.clientY);
        if (name !== hover) setHover(name);
      }
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (view.zoom <= 1.001) return; // nothing to pan at fit-to-screen
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = engine()?.presentMat?.uniforms.uScale.value;
    if (!scale) return;
    setView({
      x: clampPan(d.start.x - dx / rect.width / scale.x / view.zoom, view.zoom),
      y: clampPan(d.start.y + dy / rect.height / scale.y / view.zoom, view.zoom),
    });
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !pickable) return;
    const name = surfaceAt(e.clientX, e.clientY);
    if (name && name !== activeSurface) {
      setActiveSurface(name);
      setTab("products");
    }
  };
  const zoomTo = (zoom: number) => {
    const z = Math.min(6, Math.max(1, zoom));
    setView({ zoom: z, x: clampPan(view.x, z), y: clampPan(view.y, z) });
  };
  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    if (compare) return;
    zoomTo(view.zoom * (e.deltaY < 0 ? 1.14 : 1 / 1.14));
  };

  // --- before/after handle ---------------------------------------------------
  const dragging = useRef(false);
  const moveSplit = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0) setSplit((clientX - rect.left) / rect.width);
  };

  // A wheel over the photo zooms it; React's wheel listener is passive, so the
  // page would scroll as well without this one.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const stop = (e: globalThis.WheelEvent) => {
      if (!compare && e.target instanceof HTMLCanvasElement) e.preventDefault();
    };
    el.addEventListener("wheel", stop, { passive: false });
    return () => el.removeEventListener("wheel", stop);
  }, [compare]);

  // --- fullscreen -----------------------------------------------------------
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const canFullscreen = typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen?.().catch(() => toast.error("Full screen isn't available here."));
  };

  const download = () => {
    const r = engine();
    if (!r || !ready) return;
    try {
      const canvas = r.exportFrame(compare ? "right" : "left", { watermark: `LINX Living · ${design.name}` });
      canvas.toBlob(
        (blob) => {
          if (!blob) return toast.error("Couldn't create the image. Please try again.");
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `linx-living-room-${design.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.jpg`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        },
        "image/jpeg",
        0.9,
      );
    } catch {
      toast.error("Couldn't create the image. Please try again.");
    }
  };

  if (!room) return null;

  return (
    <div ref={stageRef} className="absolute inset-0 overflow-hidden"
      style={{ background: STAGE_BG }}>
      <canvas
        ref={attach}
        className="block h-full w-full touch-none"
        style={{ cursor: view.zoom > 1.001 ? "grab" : pickable && hover ? "pointer" : "default" }}
        aria-label={`Your room with ${design.name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => setHover(null)}
        onWheel={onWheel}
      />

      {(loading || designLoading) && !error ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40">
          <Loader2 className="h-7 w-7 animate-spin text-black/60" />
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/90 px-6 text-center text-sm text-black">
          <AlertCircle className="h-6 w-6" />
          <p>
            {String(error).includes("WebGL")
              ? "Your browser can't show the 3D preview. Please try a recent version of Chrome, Safari or Edge."
              : String(error)}
          </p>
        </div>
      ) : designFailed ? (
        <div role="alert" className="absolute inset-x-3 bottom-16 rounded-md bg-black/80 px-4 py-2 text-center text-xs text-white">
          A design&apos;s image couldn&apos;t be loaded. Please choose another design.
        </div>
      ) : null}

      {/* Toolbar: new photo on the left; compare, download, full screen on the right. */}
      <div className="absolute left-3 top-3 z-20 flex gap-1.5">
        <ToolButton label="Use another photo" onClick={newPhoto} wide>
          <ImageUp className="h-4 w-4" />
          <span className="hidden min-[480px]:inline">New photo</span>
        </ToolButton>
      </div>
      <div className="absolute right-3 top-3 z-20 flex gap-1.5">
        <ToolButton label={pinsOn ? "Hide surface markers" : "Show surface markers"} onClick={() => setPinsOn(!pinsOn)} active={pinsOn} disabled={!ready || compare}>
          <MapPin className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Before / after" onClick={() => setCompare(!compare)} active={compare} disabled={!ready} wide>
          <Columns2 className="h-4 w-4" />
          <span className="hidden min-[480px]:inline">Compare</span>
        </ToolButton>
        <ToolButton label="Download image" onClick={download} disabled={!ready || designFailed}>
          <Download className="h-4 w-4" />
        </ToolButton>
        {canFullscreen ? (
          <ToolButton label={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </ToolButton>
        ) : null}
      </div>

      {pickable && ready && !error && !compare ? (
        <p className="pointer-events-none absolute left-3 top-14 z-10 rounded-sm bg-black/60 px-2 py-1 text-[10px] text-white">
          Tap the floor or a wall to design it
        </p>
      ) : null}

      {pinsOn && pickable && ready && !error ? <SurfacePins hover={hover} onHover={setHover} /> : null}

      {/* Zoom pill, bottom centre. */}
      {!compare ? (
        <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-black/10 bg-white/90 px-1.5 py-1 shadow-sm backdrop-blur">
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomTo(view.zoom / 1.25)} disabled={view.zoom <= 1.001} className="flex h-8 w-8 items-center justify-center rounded-full text-black hover:bg-black/5 disabled:opacity-35">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs font-medium tabular-nums text-black/70" aria-live="polite">
            {Math.round(view.zoom * 100)}%
          </span>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomTo(view.zoom * 1.25)} disabled={view.zoom >= 6} className="flex h-8 w-8 items-center justify-center rounded-full text-black hover:bg-black/5 disabled:opacity-35">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Fit to screen" title="Fit to screen" onClick={resetView} disabled={view.zoom <= 1.001} className="flex h-8 w-8 items-center justify-center rounded-full text-black hover:bg-black/5 disabled:opacity-35">
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {compare && ready ? (
        <>
          <div
            className="absolute inset-y-0 z-10 w-10 -translate-x-1/2 cursor-ew-resize touch-none"
            style={{ left: `${split * 100}%` }}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => dragging.current && moveSplit(e.clientX)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
            role="slider"
            aria-label="Before and after"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(split * 100)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setSplit(split - 0.05);
              if (e.key === "ArrowRight") setSplit(split + 0.05);
            }}
          >
            <div className="mx-auto h-full w-0.5 bg-white shadow" />
            <div className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-xs font-bold text-black shadow">
              ⇄
            </div>
          </div>
          <span className="pointer-events-none absolute bottom-3 left-3 rounded-sm bg-black/60 px-2 py-1 text-[10px] font-medium uppercase tracking-[1px] text-white">Before</span>
          <span className="pointer-events-none absolute bottom-3 right-3 rounded-sm bg-black/60 px-2 py-1 text-[10px] font-medium uppercase tracking-[1px] text-white">After</span>
        </>
      ) : null}
    </div>
  );
}
