import { create } from "zustand";
import type { SurfaceKind, VisualiserLayout } from "@/lib/visualiser/flooring";
import type { ScannedSurface, VisualiserDesignCard } from "@/lib/visualiser/types";

/**
 * Room visualiser state: flooring and tiles, on the floor and every wall part.
 *
 * Mirrors the testing-app visualiser's per-surface model: the floor and every
 * wall part the scanner returns (split at corners and steps — back_wall,
 * back_wall_2, …) is its own surface with its own design, size, pattern,
 * joint and finish. A per-kind "link" switch edits all floor areas, or all
 * walls, together; floor and walls are never linked to each other.
 *
 * Rules enforced here, whatever the UI does:
 *  - a design only lands on a surface its `surfaces` allow (flooring is
 *    floor-only; a tile goes on the floor or a wall);
 *  - after a scan, a flooring design is laid on the floor straight away (as
 *    before); a tile is never laid by itself — every surface starts as
 *    photographed until the customer picks it and a design.
 *
 * Deliberately not persisted: the room photo is a blob URL that dies with the
 * page, and nothing about a customer's room is kept anywhere.
 */

export type VisualiserStep = "upload" | "scanning" | "visualise";

export type VisualiserRoom = {
  /** Blob URL of the prepared photo. */
  image: string;
  width: number;
  height: number;
  objectList: ScannedSurface[];
  settings: Record<string, unknown>;
};

/** Every bond pattern the engine draws (engine/layouts.js LAYOUTS). */
export type LayoutKey =
  | VisualiserLayout
  | "vertical"
  | "vertical-brick"
  | "diagonal"
  | "diagonal-brick";

/** How a surface is laid — the engine's surface state, minus the model. */
export type SurfaceLook = {
  visible: boolean;
  tileSize: { w: number; h: number };
  layout: LayoutKey;
  /** Degrees, 0–359. */
  rotation: number;
  /** Metres, as the engine reads it. */
  offset: { x: number; y: number };
  grout: { size: number; color: string };
  bevel: number;
  gloss: number;
  shade: number;
  detail: number;
  tint: string;
  randomFace: boolean;
  randomRotate: boolean;
};

/** One scanned surface: the floor, or one wall part. */
export type Surface = SurfaceLook & {
  kind: SurfaceKind;
  /** The scanner's label ("Floor", "Back Wall 2"). */
  label: string;
  /** The design laid on it, or null while it is as photographed. */
  designId: string | null;
};

export type PanelTab = "surfaces" | "products" | "layout" | "grout" | "finish";

/** Zoom and pan of the room photo (engine units: zoom ≥ 1, centre 0–1). */
export type StageView = { zoom: number; x: number; y: number };
const FIT_VIEW: StageView = { zoom: 1, x: 0.5, y: 0.5 };

export type ApplyResult = { ok: true } | { ok: false; reason: string };

type State = {
  step: VisualiserStep;
  error: string | null;
  room: VisualiserRoom | null;
  /** Every design the customer has picked this visit, by id. */
  designs: Record<string, VisualiserDesignCard>;
  /** The design chosen before a scan, and the last one applied after it. */
  primaryId: string;
  /** What the customer came from (flooring or a tile); the floor's list opens on it. Never changes. */
  entry: VisualiserDesignCard["design"]["kind"];
  /** Floor and wall parts by scanner name, in the scanner's order. */
  surfaces: Record<string, Surface>;
  activeSurface: string | null;
  /** Edit every surface of a kind together: floors yes (usually one), walls no. */
  links: Record<SurfaceKind, boolean>;
  tab: PanelTab;
  compare: boolean;
  split: number;
  view: StageView;
};

type Actions = {
  startScan: () => void;
  scanFailed: (message: string) => void;
  roomReady: (room: VisualiserRoom) => void;
  /** Lay a design on the active surface (and its linked siblings). */
  applyDesign: (item: VisualiserDesignCard) => ApplyResult;
  /** Patch the active surface (and the others of its kind, when linked). */
  updateSurface: (patch: Partial<SurfaceLook>) => void;
  setSurfaceVisible: (name: string, visible: boolean) => void;
  setActiveSurface: (name: string) => void;
  setLink: (kind: SurfaceKind, on: boolean) => void;
  resetSurface: () => void;
  setTab: (tab: PanelTab) => void;
  setCompare: (on: boolean) => void;
  setView: (view: Partial<StageView>) => void;
  resetView: () => void;
  setSplit: (split: number) => void;
  /** Back to the upload step with the same design; the old photo is released. */
  newPhoto: () => void;
};

const DEFAULT_GROUT = "#c9c9c4";

/** A surface laid with this design, as the testing-app applies a product. */
function lookFor(item: VisualiserDesignCard, base?: Partial<SurfaceLook>): SurfaceLook {
  const { design } = item;
  return {
    visible: base?.visible ?? true,
    tileSize: { w: design.sizeMm.w, h: design.sizeMm.h },
    layout: design.layout,
    rotation: 0,
    offset: { x: 0, y: 0 },
    grout: { size: design.groutMm ?? 0, color: base?.grout?.color ?? DEFAULT_GROUT },
    bevel: 0,
    gloss: design.gloss,
    shade: 0,
    detail: 0,
    tint: "#ffffff",
    randomFace: true,
    randomRotate: false,
  };
}

/** A surface as photographed (nothing laid), sized from the scanner's defaults. */
function emptySurface(o: ScannedSurface, kind: SurfaceKind): Surface {
  const d = (o.defaults ?? {}) as { tileSize?: { w?: unknown; h?: unknown } };
  const w = Number(d.tileSize?.w);
  const h = Number(d.tileSize?.h);
  return {
    kind,
    label: String(o.label || o.name).replace(/_/g, " "),
    designId: null,
    visible: true,
    tileSize: w > 0 && h > 0 ? { w, h } : kind === "floor" ? { w: 600, h: 600 } : { w: 300, h: 600 },
    layout: "grid",
    rotation: 0,
    offset: { x: 0, y: 0 },
    grout: { size: 0, color: DEFAULT_GROUT },
    bevel: 0,
    gloss: 0,
    shade: 0,
    detail: 0,
    tint: "#ffffff",
    randomFace: true,
    randomRotate: false,
  };
}

/** The kind of a scanned surface the visualiser designs, or null for anything else. */
export function surfaceKindOf(o: ScannedSurface): SurfaceKind | null {
  return o.product_surface === "floor" || o.product_surface === "wall" ? o.product_surface : null;
}

/** Rough area of one surface from the scanner's plane size, m² (a hint only). */
export function surfaceArea(o: ScannedSurface | undefined | null): number | null {
  const w = Number(o?.realSize?.w);
  const h = Number(o?.realSize?.h);
  return w > 0 && h > 0 ? Math.round(w * h * 10) / 10 : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep every value inside the range the engine and controls expect. */
function sanitise(patch: Partial<SurfaceLook>): Partial<SurfaceLook> {
  const out = { ...patch };
  if (out.tileSize) {
    out.tileSize = {
      w: Math.round(clamp(Number(out.tileSize.w) || 20, 10, 6000)),
      h: Math.round(clamp(Number(out.tileSize.h) || 20, 10, 6000)),
    };
  }
  if (out.rotation != null) out.rotation = ((Math.round(Number(out.rotation) || 0) % 360) + 360) % 360;
  if (out.offset) {
    out.offset = { x: clamp(Number(out.offset.x) || 0, -2, 2), y: clamp(Number(out.offset.y) || 0, -2, 2) };
  }
  if (out.grout) {
    out.grout = {
      size: clamp(Number(out.grout.size) || 0, 0, 15),
      color: /^#[0-9a-f]{6}$/i.test(out.grout.color) ? out.grout.color : DEFAULT_GROUT,
    };
  }
  if (out.bevel != null) out.bevel = clamp(Number(out.bevel) || 0, 0, 1);
  if (out.gloss != null) out.gloss = clamp(Number(out.gloss) || 0, 0, 1.2);
  if (out.shade != null) out.shade = clamp(Number(out.shade) || 0, 0, 1.8);
  if (out.detail != null) out.detail = clamp(Number(out.detail) || 0, 0, 1.5);
  if (out.tint != null && !/^#[0-9a-f]{6}$/i.test(out.tint)) out.tint = "#ffffff";
  return out;
}

export const createVisualiserStore = (initial: VisualiserDesignCard) =>
  create<State & Actions>()((set, get) => {
    /** The surfaces an edit touches: the active one, or all of its kind when linked. */
    const targets = (): string[] => {
      const { surfaces, activeSurface, links } = get();
      const active = activeSurface ? surfaces[activeSurface] : null;
      if (!active) return [];
      if (!links[active.kind]) return [activeSurface as string];
      return Object.keys(surfaces).filter((n) => surfaces[n].kind === active.kind);
    };

    return {
      step: "upload",
      error: null,
      room: null,
      designs: { [initial.design.id]: initial },
      primaryId: initial.design.id,
      entry: initial.design.kind,
      surfaces: {},
      activeSurface: null,
      links: { floor: true, wall: false },
      tab: "products",
      compare: false,
      split: 0.5,
      view: FIT_VIEW,

      startScan: () => set({ step: "scanning", error: null }),
      scanFailed: (message) => set({ step: "upload", error: message }),

      roomReady: (room) => {
        const primary = get().designs[get().primaryId];
        // Only flooring is laid by itself; a tile waits to be placed.
        const autoLay = primary?.design.kind === "flooring" && primary.design.surfaces.includes("floor");
        const surfaces: Record<string, Surface> = {};
        for (const o of room.objectList) {
          const kind = surfaceKindOf(o);
          if (!kind || surfaces[o.name]) continue;
          const empty = emptySurface(o, kind);
          surfaces[o.name] =
            autoLay && kind === "floor"
              ? { ...empty, ...lookFor(primary), designId: primary.design.id }
              : empty;
        }
        const names = Object.keys(surfaces);
        set({
          step: "visualise",
          error: null,
          room,
          surfaces,
          activeSurface: names.find((n) => surfaces[n].kind === "floor") ?? names[0] ?? null,
          compare: false,
          split: 0.5,
          view: FIT_VIEW,
        });
      },

      applyDesign: (item) => {
        const { room, surfaces, activeSurface } = get();
        if (!room) {
          // No room yet: this is simply the design the scan will start from.
          set({ designs: { ...get().designs, [item.design.id]: item }, primaryId: item.design.id });
          return { ok: true };
        }
        const active = activeSurface ? surfaces[activeSurface] : null;
        if (!active) return { ok: false, reason: "Tap the floor or a wall in your photo first." };
        if (!item.design.surfaces.includes(active.kind)) {
          return {
            ok: false,
            reason:
              active.kind === "wall"
                ? "Flooring can only be laid on the floor. Choose a tile for this wall."
                : "This design can't be laid on the floor.",
          };
        }
        const next = { ...surfaces };
        for (const name of targets()) {
          const cur = next[name];
          // Never cross kinds, whatever the link says.
          if (!cur || cur.kind !== active.kind || cur.designId === item.design.id) continue;
          // Size, bond and finish follow the new design; joint colour and
          // visibility are kept (testing-app applyProduct).
          next[name] = { ...cur, ...lookFor(item, cur), designId: item.design.id };
        }
        set({
          designs: { ...get().designs, [item.design.id]: item },
          surfaces: next,
          primaryId: item.design.id,
        });
        return { ok: true };
      },

      updateSurface: (patch) => {
        const clean = sanitise(patch);
        const surfaces = { ...get().surfaces };
        for (const name of targets()) surfaces[name] = { ...surfaces[name], ...clean };
        set({ surfaces });
      },

      setSurfaceVisible: (name, visible) => {
        const cur = get().surfaces[name];
        if (!cur) return;
        set({ surfaces: { ...get().surfaces, [name]: { ...cur, visible } } });
      },

      setActiveSurface: (name) => {
        const surface = get().surfaces[name];
        if (!surface) return;
        set({ activeSurface: name, ...(surface.designId ? { primaryId: surface.designId } : {}) });
      },

      setLink: (kind, on) => {
        const { surfaces, activeSurface, links } = get();
        // Linking copies the active surface's look onto the others of its
        // kind, so "edit together" starts from what the customer is looking at.
        const src = activeSurface ? surfaces[activeSurface] : null;
        if (on && src && src.kind === kind && src.designId) {
          const next: Record<string, Surface> = {};
          for (const [name, s] of Object.entries(surfaces)) {
            next[name] = s.kind === kind ? { ...src, kind: s.kind, label: s.label, visible: s.visible } : s;
          }
          set({ links: { ...links, [kind]: true }, surfaces: next });
          return;
        }
        set({ links: { ...links, [kind]: on } });
      },

      resetSurface: () => {
        const { designs, surfaces } = get();
        const next = { ...surfaces };
        for (const name of targets()) {
          const cur = surfaces[name];
          const item = cur.designId ? designs[cur.designId] : null;
          if (item) next[name] = { ...cur, ...lookFor(item, { visible: cur.visible }) };
        }
        set({ surfaces: next });
      },

      setTab: (tab) => set({ tab }),
      setCompare: (on) => set({ compare: on, split: 0.5 }),
      setView: (patch) => {
        const next = { ...get().view, ...patch };
        next.zoom = clamp(Number(next.zoom) || 1, 1, 6);
        // Back at fit-to-screen there is nothing to pan: re-centre.
        set({ view: next.zoom <= 1.001 ? FIT_VIEW : next });
      },
      resetView: () => set({ view: FIT_VIEW }),
      setSplit: (split) => set({ split: clamp(split, 0.02, 0.98) }),
      newPhoto: () => {
        const old = get().room?.image;
        if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
        set({
          step: "upload",
          room: null,
          error: null,
          surfaces: {},
          activeSurface: null,
          compare: false,
          view: FIT_VIEW,
        });
      },
    };
  });

export type VisualiserStore = ReturnType<typeof createVisualiserStore>;
type FullState = ReturnType<VisualiserStore["getState"]>;

/** The design chosen before the scan / applied last (always set). */
export const selectPrimaryDesign = (s: FullState): VisualiserDesignCard => s.designs[s.primaryId];

/** The surface being edited, or null before a scan. */
export const selectActiveSurface = (s: FullState): Surface | null =>
  (s.activeSurface && s.surfaces[s.activeSurface]) || null;

/**
 * The design on the surface being edited — or, before a scan, the one the
 * customer chose. Null when the active surface is still as photographed.
 */
export const selectCurrentDesign = (s: FullState): VisualiserDesignCard | null => {
  if (!s.room) return s.designs[s.primaryId] ?? null;
  const active = selectActiveSurface(s);
  return active?.designId ? (s.designs[active.designId] ?? null) : null;
};

/** The kind of surface the design list is for: the active one, or the floor before a scan. */
export const selectListSurface = (s: FullState): SurfaceKind => selectActiveSurface(s)?.kind ?? "floor";

/** Rough area of the active surface (m²), for the calculator hint. */
export const selectActiveArea = (s: FullState): number | null => {
  if (!s.room || !s.activeSurface) return null;
  return surfaceArea(s.room.objectList.find((o) => o.name === s.activeSurface));
};
