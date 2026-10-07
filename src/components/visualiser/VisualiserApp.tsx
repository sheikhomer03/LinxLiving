"use client";

import { useEffect, useState } from "react";
import { Contrast, Grid3x3, Layers, LayoutGrid, LayoutPanelTop, RotateCcw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createVisualiserStore,
  selectCurrentDesign,
  type PanelTab,
} from "@/store/useVisualiserStore";
import { VisualiserContext, useVisualiser } from "@/components/visualiser/VisualiserContext";
import { UploadStep } from "@/components/visualiser/UploadStep";
import { RoomStage } from "@/components/visualiser/RoomStage";
import { FloorPanel } from "@/components/visualiser/FloorPanel";
import { PanelBody } from "@/components/visualiser/EditPanels";
import { DesignGrid } from "@/components/visualiser/DesignGrid";
import type { VisualiserDesignCard, VisualiserDesignsResponse } from "@/lib/visualiser/types";

/**
 * The room visualiser (flooring): upload a room photo, the scanner finds the
 * floor, and any flooring design is laid on it at its real size.
 *
 * Laid out like the testing-app viewer, in the site's light theme:
 *
 *   ≥ 900 px   [rail 76][panel 360][ room photo, filling the rest ]
 *   <  900 px   room photo / panel (scrolls, ≤ 46% of the screen) / tab bar
 *
 * The whole app is one screen tall, under the site header, so the photo and
 * the panel are always both in view. Client-only (WebGL); the page loads it
 * with ssr: false.
 */
export default function VisualiserApp({
  initialDesign,
  initialDesigns,
}: {
  initialDesign: VisualiserDesignCard;
  initialDesigns: VisualiserDesignsResponse;
}) {
  // One store per visit, created once.
  const [store] = useState(() => createVisualiserStore(initialDesign));
  return (
    <VisualiserContext.Provider value={store}>
      <VisualiserLayout initialDesigns={initialDesigns} />
    </VisualiserContext.Provider>
  );
}

const TABS: { key: PanelTab; label: string; icon: LucideIcon }[] = [
  { key: "surfaces", label: "Surfaces", icon: Layers },
  { key: "products", label: "Products", icon: LayoutGrid },
  { key: "layout", label: "Layout", icon: LayoutPanelTop },
  { key: "grout", label: "Grout", icon: Grid3x3 },
  { key: "finish", label: "Finish", icon: Contrast },
];

function VisualiserLayout({ initialDesigns }: { initialDesigns: VisualiserDesignsResponse }) {
  const step = useVisualiser((s) => s.step);
  const tab = useVisualiser((s) => s.tab);
  const setTab = useVisualiser((s) => s.setTab);
  const currentId = useVisualiser((s) => selectCurrentDesign(s).design.id);
  const room = useVisualiser((s) => s.room);
  const activeFloor = useVisualiser((s) => s.activeFloor);
  const resetFloor = useVisualiser((s) => s.resetFloor);
  const activeLabel = useVisualiser((s) => {
    const o = s.room?.objectList.find((x) => x.name === s.activeFloor);
    return o ? String(o.label || o.name).replace(/_/g, " ") : null;
  });

  // Keep ?product= on the chosen design, so a refresh or a shared link opens
  // it. replaceState rather than the router: no navigation, no refetch.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("product") === currentId) return;
    url.searchParams.set("product", currentId);
    window.history.replaceState(window.history.state, "", url);
  }, [currentId]);

  // The photo is a blob URL held in memory; release it when leaving the page.
  useEffect(
    () => () => {
      if (room?.image?.startsWith("blob:")) URL.revokeObjectURL(room.image);
    },
    [room],
  );

  const tabLabel = TABS.find((t) => t.key === tab)?.label ?? "Products";

  return (
    // Light theme, always: colorScheme keeps native controls (selects, sliders,
    // colour pickers) light even when the device is set to dark mode.
    <div
      style={{ colorScheme: "light" }}
      // Phones: exactly one screen tall, so the tab bar is always on screen.
      // Desktop: never shorter than 560 px.
      className="flex h-[calc(100dvh-var(--lx-announce-h)-var(--lx-header-h))] min-h-105 flex-col border-t border-black/10 bg-white text-black min-[900px]:min-h-140 min-[900px]:flex-row"
    >
      {/* Rail: a column on the left, a tab bar along the bottom on phones. */}
      <nav
        aria-label="Visualiser tools"
        role="tablist"
        className="order-3 flex shrink-0 justify-around gap-1 overflow-x-auto border-t border-black/10 bg-white px-1.5 py-1.5 min-[900px]:order-0 min-[900px]:w-19 min-[900px]:flex-col min-[900px]:justify-start min-[900px]:border-r min-[900px]:border-t-0 min-[900px]:px-2 min-[900px]:py-2.5"
      >
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="vis-panel"
              onClick={() => setTab(key)}
              className={cn(
                "flex min-w-14 flex-1 flex-col items-center gap-1 rounded-md border px-1 py-2 text-[10px] font-medium transition-colors min-[900px]:w-15 min-[900px]:flex-none",
                active
                  ? "border-black bg-black text-white"
                  : "border-transparent text-black/60 hover:bg-black/5 hover:text-black",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.5} />
              {label}
            </button>
          );
        })}
      </nav>

      {/* Panel: header, scrolling body, and the design-on-the-floor footer. */}
      <aside
        id="vis-panel"
        role="tabpanel"
        aria-label={tabLabel}
        className="order-2 flex max-h-[46dvh] min-h-0 w-full shrink flex-col border-t border-black/10 bg-white min-[900px]:order-0 min-[900px]:max-h-none min-[900px]:w-90 min-[900px]:shrink-0 min-[900px]:border-r min-[900px]:border-t-0"
      >
        <div className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-black">{tabLabel}</h2>
            {activeLabel && tab !== "surfaces" ? (
              <p className="truncate text-xs capitalize text-black/50">on {activeLabel}</p>
            ) : null}
          </div>
          {room && activeFloor ? (
            <button
              type="button"
              onClick={resetFloor}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-black/70 transition-colors hover:bg-black/5 hover:text-black"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3.5 [scrollbar-width:thin]">
          {/* Kept mounted so the design list keeps its filters and pages. */}
          <div hidden={tab !== "products"}>
            <DesignGrid initial={initialDesigns} />
          </div>
          {tab !== "products" ? <PanelBody tab={tab} /> : null}
        </div>

        <FloorPanel />
      </aside>

      {/* Stage: the room, filling what is left. */}
      <section
        id="visualiser-stage"
        aria-label="Your room"
        className="relative order-1 min-h-[30dvh] min-w-0 flex-1 bg-[#f3f3f1] min-[900px]:order-0 min-[900px]:min-h-0"
      >
        {step === "visualise" ? <RoomStage /> : <UploadStep />}
      </section>
    </div>
  );
}
