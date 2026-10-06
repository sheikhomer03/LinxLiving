import { create } from "zustand";
import type { VisualiserLayout } from "@/lib/visualiser/flooring";
import type { ScannedSurface, VisualiserDesignCard } from "@/lib/visualiser/types";

/**
 * Room visualiser state (flooring only).
 *
 * Mirrors the testing-app visualiser's per-surface model: every floor area the
 * scanner finds keeps its own design, size, pattern, joint and finish, and a
 * "link" switch edits them together. Walls are listed but never changed.
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

/** One floor surface's look — the engine's surface state, minus the model. */
export type FloorSurface = {
  designId: string;
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

export type PanelTab = "surfaces" | "products" | "layout" | "grout" | "finish";

/** Zoom and pan of the room photo (engine units: zoom ≥ 1, centre 0–1). */
export type StageView = { zoom: number; x: number; y: number };
const FIT_VIEW: StageView = { zoom: 1, x: 0.5, y: 0.5 };

type State = {
  step: VisualiserStep;
  error: string | null;
  room: VisualiserRoom | null;
  /** Every design the customer has picked this visit, by id. */
  designs: Record<string, VisualiserDesignCard>;
  /** The design shown before a room exists, and the default for new floors. */
  primaryId: string;
  /** Floor surfaces by scanner name. */
  floors: Record<string, FloorSurface>;
  activeFloor: string | null;
  /** Edit every floor surface together (on by default: usually one floor). */
  linkFloors: boolean;
  tab: PanelTab;
  compare: boolean;
  split: number;
  view: StageView;
  /** Floor area the customer is ordering for, m² (starts from the scan). */
  areaM2: number | null;
};

type Actions = {
  startScan: () => void;
  scanFailed: (message: string) => void;
  roomReady: (room: VisualiserRoom) => void;
  applyDesign: (item: VisualiserDesignCard) => void;
  /** Patch the active floor (and the others, when linked). */
  updateFloor: (patch: Partial<FloorSurface>) => void;
  setFloorVisible: (name: string, visible: boolean) => void;
  setActiveFloor: (name: string) => void;
  setLinkFloors: (on: boolean) => void;
  resetFloor: () => void;
  setTab: (tab: PanelTab) => void;
  setCompare: (on: boolean) => void;
  setView: (view: Partial<StageView>) => void;
  resetView: () => void;
  setSplit: (split: number) => void;
  setArea: (m2: number | null) => void;
  /** Back to the upload step with the same design; the old photo is released. */
  newPhoto: () => void;
};

const DEFAULT_GROUT = "#c9c9c4";

/** A floor laid with this design, as the testing-app applies a product. */
function floorFor(item: VisualiserDesignCard, base?: Partial<FloorSurface>): FloorSurface {
  const { design } = item;
  return {
    visible: base?.visible ?? true,
    designId: design.id,
    tileSize: { w: design.sizeMm.w, h: design.sizeMm.h },
    layout: design.layout,
    rotation: 0,
    offset: { x: 0, y: 0 },
    grout: { size: 0, color: base?.grout?.color ?? DEFAULT_GROUT },
    bevel: 0,
    gloss: design.gloss,
    shade: 0,
    detail: 0,
    tint: "#ffffff",
    randomFace: true,
    randomRotate: false,
  };
}

/** Rough visible floor area: the scanner's floor planes, summed. */
export function scannedFloorArea(objectList: ScannedSurface[]): number | null {
  let total = 0;
  for (const o of objectList) {
    if (o.product_surface !== "floor") continue;
    const w = Number(o.realSize?.w);
    const h = Number(o.realSize?.h);
    if (w > 0 && h > 0) total += w * h;
  }
  return total > 0 ? Math.round(total * 10) / 10 : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep every value inside the range the engine and controls expect. */
function sanitise(patch: Partial<FloorSurface>): Partial<FloorSurface> {
  const out = { ...patch };
  if (out.tileSize) {
    out.tileSize = {
      w: Math.round(clamp(Number(out.tileSize.w) || 20, 20, 6000)),
      h: Math.round(clamp(Number(out.tileSize.h) || 20, 20, 6000)),
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
    /** The floors an edit touches, honouring the link switch. */
    const targets = (): string[] => {
      const { floors, activeFloor, linkFloors } = get();
      if (linkFloors) return Object.keys(floors);
      return activeFloor && floors[activeFloor] ? [activeFloor] : [];
    };

    return {
      step: "upload",
      error: null,
      room: null,
      designs: { [initial.design.id]: initial },
      primaryId: initial.design.id,
      floors: {},
      activeFloor: null,
      linkFloors: true,
      tab: "products",
      compare: false,
      split: 0.5,
      view: FIT_VIEW,
      areaM2: null,

      startScan: () => set({ step: "scanning", error: null }),
      scanFailed: (message) => set({ step: "upload", error: message }),

      roomReady: (room) => {
        const item = get().designs[get().primaryId];
        const floors: Record<string, FloorSurface> = {};
        for (const o of room.objectList) {
          if (o.product_surface === "floor") floors[o.name] = floorFor(item);
        }
        set({
          step: "visualise",
          error: null,
          room,
          floors,
          activeFloor: Object.keys(floors)[0] ?? null,
          compare: false,
          split: 0.5,
          view: FIT_VIEW,
          areaM2: scannedFloorArea(room.objectList),
        });
      },

      applyDesign: (item) => {
        const designs = { ...get().designs, [item.design.id]: item };
        const names = targets();
        if (!get().room || !names.length) {
          // No room yet: this is simply the design the scan will lay.
          set({ designs, primaryId: item.design.id });
          return;
        }
        const floors = { ...get().floors };
        for (const name of names) {
          const cur = floors[name];
          if (cur.designId === item.design.id) continue;
          // Like the testing-app's applyProduct: size, bond and finish follow
          // the new design; the joint colour and visibility are kept.
          floors[name] = floorFor(item, cur);
        }
        set({ designs, floors, primaryId: item.design.id });
      },

      updateFloor: (patch) => {
        const clean = sanitise(patch);
        const floors = { ...get().floors };
        for (const name of targets()) floors[name] = { ...floors[name], ...clean };
        set({ floors });
      },

      setFloorVisible: (name, visible) => {
        const cur = get().floors[name];
        if (!cur) return;
        set({ floors: { ...get().floors, [name]: { ...cur, visible } } });
      },

      setActiveFloor: (name) => {
        const floor = get().floors[name];
        if (!floor) return;
        set({ activeFloor: name, primaryId: floor.designId });
      },

      setLinkFloors: (on) => {
        // Linking copies the active floor's look onto the others, so "edit
        // together" starts from what the customer is looking at.
        const { floors, activeFloor } = get();
        if (on && activeFloor && floors[activeFloor]) {
          const src = floors[activeFloor];
          const next: Record<string, FloorSurface> = {};
          for (const [name, f] of Object.entries(floors)) next[name] = { ...src, visible: f.visible };
          set({ linkFloors: true, floors: next });
          return;
        }
        set({ linkFloors: on });
      },

      resetFloor: () => {
        const { designs, floors } = get();
        const next = { ...floors };
        for (const name of targets()) {
          const item = designs[floors[name].designId];
          if (item) next[name] = floorFor(item, { visible: floors[name].visible });
        }
        set({ floors: next });
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
      setArea: (m2) =>
        set({ areaM2: m2 == null || !Number.isFinite(m2) || m2 <= 0 ? null : Math.min(m2, 10_000) }),
      newPhoto: () => {
        const old = get().room?.image;
        if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
        set({
          step: "upload",
          room: null,
          error: null,
          floors: {},
          activeFloor: null,
          compare: false,
          view: FIT_VIEW,
          areaM2: null,
        });
      },
    };
  });

export type VisualiserStore = ReturnType<typeof createVisualiserStore>;
type FullState = ReturnType<VisualiserStore["getState"]>;

/** The design on the floor being edited (or the one the scan will lay). */
export const selectCurrentDesign = (s: FullState): VisualiserDesignCard =>
  s.designs[(s.activeFloor && s.floors[s.activeFloor]?.designId) || s.primaryId] ??
  s.designs[s.primaryId];

/** The floor surface being edited, or null before a scan. */
export const selectActiveFloor = (s: FullState): FloorSurface | null =>
  (s.activeFloor && s.floors[s.activeFloor]) || null;
