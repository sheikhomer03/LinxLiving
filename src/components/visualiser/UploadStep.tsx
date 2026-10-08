"use client";

import { useEffect, useRef, useState } from "react";
import { ImageUp, Loader2, AlertCircle } from "lucide-react";
import { useVisualiser } from "@/components/visualiser/VisualiserContext";
import { selectPrimaryDesign } from "@/store/useVisualiserStore";
import { preparePhoto, PhotoError } from "@/components/visualiser/preparePhoto";
import type { ScanResponse, ScannedSurface } from "@/lib/visualiser/types";

/** Scale the scanner's coordinates onto the photo we display, if they differ. */
function fitSurfaces(list: ScannedSurface[], sx: number, sy: number): ScannedSurface[] {
  if (Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3) return list;
  const pts = (arr: unknown) =>
    Array.isArray(arr)
      ? arr.map((p: unknown) =>
          Array.isArray(p) ? [Number(p[0]) * sx, Number(p[1]) * sy] : p,
        )
      : arr;
  type Mask = { polygons?: { points?: unknown }[] } & Record<string, unknown>;
  return list.map((o) => {
    const mask = o.mask as Mask | undefined;
    return {
      ...o,
      quad: pts(o.quad),
      mask: mask
        ? { ...mask, polygons: (mask.polygons || []).map((p) => ({ ...p, points: pts(p.points) })) }
        : mask,
    };
  });
}

const TIPS = {
  flooring: [
    "Stand in the doorway or a corner, so the photo shows most of the floor.",
    "Hold your phone level at chest height, in landscape if you can.",
    "Turn the lights on and move rugs or clutter off the floor if possible.",
  ],
  tile: [
    "Stand back in a corner or doorway, so the photo shows the walls and floor you want to tile.",
    "Hold your phone level at chest height, in landscape if you can.",
    "Turn the lights on and clear what you can from the walls and floor.",
  ],
};

const NO_FLOOR =
  "We couldn't find the floor in this photo. Stand at the doorway, hold your phone level and show plenty of floor.";

export function UploadStep() {
  const step = useVisualiser((s) => s.step);
  const error = useVisualiser((s) => s.error);
  const startScan = useVisualiser((s) => s.startScan);
  const scanFailed = useVisualiser((s) => s.scanFailed);
  const roomReady = useVisualiser((s) => s.roomReady);
  const design = useVisualiser((s) => selectPrimaryDesign(s).design);
  const isTile = design.kind === "tile";

  const [preview, setPreview] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const uploadRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // A scan in flight is cancelled if the customer leaves the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (step !== "scanning") return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [step]);

  const onFile = async (file: File | undefined) => {
    if (!file || step === "scanning") return;
    setElapsed(0);
    setPreview(null);
    startScan();

    let prepared;
    try {
      prepared = await preparePhoto(file);
    } catch (e) {
      scanFailed(e instanceof PhotoError ? e.message : "We couldn't open that photo. Please try another.");
      return;
    }
    setPreview(prepared.url);

    const body = new FormData();
    body.append("photo", prepared.blob, "room.jpg");
    if (prepared.focal35) body.append("focal35", String(prepared.focal35));

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/visualiser/scan", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as (ScanResponse & { error?: string }) | null;
      if (!res.ok || !json || !Array.isArray(json.objectList)) {
        throw new Error(json?.error || "We couldn't scan this photo. Please try again.");
      }
      // Flooring needs a floor; a tile can go on a wall alone.
      if (!isTile && !json.objectList.some((o) => o.product_surface === "floor")) {
        throw new Error(NO_FLOOR);
      }
      const sx = prepared.width / json.width;
      const sy = prepared.height / json.height;
      roomReady({
        image: prepared.url,
        width: prepared.width,
        height: prepared.height,
        objectList: fitSurfaces(json.objectList, sx, sy),
        settings: { camera: json.camera ?? null },
      });
    } catch (e) {
      // The photo is not used after a failed or abandoned scan: release it.
      URL.revokeObjectURL(prepared.url);
      if (controller.signal.aborted) return;
      setPreview(null);
      scanFailed(
        e instanceof TypeError
          ? "Connection problem. Please check your internet and try again."
          : e instanceof Error
            ? e.message
            : "We couldn't scan this photo. Please try again.",
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const pick = (input: HTMLInputElement | null) => {
    if (!input) return;
    input.value = ""; // choosing the same file twice still fires change
    input.click();
  };

  if (step === "scanning") {
    // ~12–15 s normally; the bar eases towards 95% and waits there.
    const progress = Math.min(95, Math.round(100 * (1 - Math.exp(-elapsed / 7))));
    return (
      <div className="absolute inset-0 overflow-hidden bg-[#1a1a1a]">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Your room" className="absolute inset-0 h-full w-full object-contain opacity-50" />
        ) : null}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="font-menu text-[12px] font-medium uppercase tracking-[1.2px]">
            {preview ? (isTile ? "Finding your floor and walls…" : "Finding your floor…") : "Preparing your photo…"}
          </p>
          <div className="h-1 w-64 max-w-full bg-white/25" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-white transition-[width] duration-700" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-white/70">
            {elapsed < 25 ? "This usually takes about 15 seconds." : "Still working — the scanner is busy, thanks for waiting."}
          </p>
        </div>
      </div>
    );
  }

  return (
    // Fills the stage; scrolls inside it when a short phone screen leaves too little room.
    <div className="absolute inset-0 overflow-y-auto overscroll-contain p-3 min-[480px]:p-6">
    <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center rounded-lg border border-dashed border-black/20 bg-white/80 px-4 py-6 text-center min-[480px]:px-8 min-[480px]:py-10">
      <h2 className="font-menu text-[12px] font-medium uppercase tracking-[1.2px] text-black min-[480px]:text-[13px] min-[480px]:tracking-[1.4px]">
        See {design.name} in your room
      </h2>
      <p className="mt-2 max-w-md text-xs text-black/70 min-[480px]:mt-3 min-[480px]:text-sm">
        {isTile
          ? "Upload a photo of your room. We\u2019ll find the floor and each wall — then tap any of them to lay this tile, at its real size."
          : "Upload a photo of your room. We\u2019ll find the floor and lay this design on it, at its real size."}
      </p>

      {error ? (
        <div role="alert" className="mt-6 flex max-w-md items-start gap-2 rounded-md bg-[#D3102F]/10 px-4 py-3 text-left text-sm text-[#D3102F]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-5 flex w-full max-w-sm flex-col gap-2.5 min-[480px]:mt-8 min-[480px]:gap-3">
        <button
          type="button"
          onClick={() => pick(uploadRef.current)}
          className="font-menu inline-flex h-11 w-full items-center justify-center gap-2 bg-black text-[12px] font-medium uppercase tracking-[0.6px] text-white transition-opacity hover:opacity-90"
        >
          <ImageUp className="h-5 w-5" /> Upload a photo
        </button>
      </div>

      <input
        ref={uploadRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      <ul className="mt-5 max-w-md space-y-1.5 text-left text-[11px] text-black/60 min-[480px]:mt-8 min-[480px]:text-xs">
        {TIPS[isTile ? "tile" : "flooring"].map((tip) => (
          <li key={tip} className="flex gap-2">
            <span aria-hidden>•</span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 max-w-md text-[11px] text-black/45 min-[480px]:mt-6">
        Your photo is only used to scan the room and is not stored.
      </p>
    </div>
    </div>
  );
}
