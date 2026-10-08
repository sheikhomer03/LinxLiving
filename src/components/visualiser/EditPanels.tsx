"use client";

import { cn } from "@/lib/utils";
import { useVisualiser } from "@/components/visualiser/VisualiserContext";
import { Hint, LayoutGlyph, Opt, Section, Slider, Switch } from "@/components/visualiser/controls";
import {
  selectActiveSurface,
  selectCurrentDesign,
  type LayoutKey,
  type PanelTab,
} from "@/store/useVisualiserStore";
// The engine's own catalogues, so the panels offer exactly what it can draw.
import {
  GROUT_COLORS,
  GROUT_SIZES,
  LAYOUTS,
  TILE_SIZES,
  materialModel,
} from "@/components/visualiser/engine/layouts.js";

/** Typical floor sizes (mm), offered next to the product's own size. */
const FLOOR_SIZES = [
  { w: 150, h: 900 },
  { w: 185, h: 1220 },
  { w: 190, h: 1900 },
  { w: 195, h: 1380 },
  { w: 220, h: 2200 },
  { w: 90, h: 600 },
  { w: 300, h: 600 },
  { w: 600, h: 600 },
];

const FINISHES: [string, number][] = [
  ["Matt", 0.06],
  ["Satin", 0.28],
  ["Gloss", 0.62],
  ["Polished", 0.9],
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const mm = (v: number) => `${Math.round(v * 1000)} mm`;

/**
 * Surfaces / Layout / Grout / Finish — the side panel's content for each
 * rail tab (Products is the design list). Same controls, presets and ranges
 * as the testing-app viewer.
 */
export function PanelBody({ tab }: { tab: Exclude<PanelTab, "products"> }) {
  const surface = useVisualiser(selectActiveSurface);
  const current = useVisualiser(selectCurrentDesign);
  if (!surface) {
    return (
      <div className="space-y-2 py-6 text-center">
        <p className="text-sm font-medium text-black">Add a photo of your room first</p>
        <Hint>Once the floor and walls are found, you can change how each is laid here.</Hint>
      </div>
    );
  }
  // Layout, joints and finish belong to a design; an untouched surface has none.
  if (tab !== "surfaces" && (!surface.designId || !current)) {
    return (
      <div className="space-y-2 py-6 text-center">
        <p className="text-sm font-medium capitalize text-black">{surface.label} is as photographed</p>
        <Hint>Choose a design for it in Products first, then adjust how it&apos;s laid here.</Hint>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {tab === "surfaces" ? (
        <SurfacesPanel />
      ) : tab === "layout" ? (
        <LayoutPanel />
      ) : tab === "grout" ? (
        <GroutPanel />
      ) : (
        <FinishPanel />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- surfaces --- */

function SurfacesPanel() {
  const room = useVisualiser((s) => s.room);
  const surfaces = useVisualiser((s) => s.surfaces);
  const designs = useVisualiser((s) => s.designs);
  const activeSurface = useVisualiser((s) => s.activeSurface);
  const links = useVisualiser((s) => s.links);
  const setActiveSurface = useVisualiser((s) => s.setActiveSurface);
  const setSurfaceVisible = useVisualiser((s) => s.setSurfaceVisible);
  const setLink = useVisualiser((s) => s.setLink);
  const setTab = useVisualiser((s) => s.setTab);
  if (!room) return null;

  // In the scanner's order: the floor, then each wall part left to right.
  const names = room.objectList.map((o) => o.name).filter((n) => surfaces[n]);
  const count = (kind: "floor" | "wall") => names.filter((n) => surfaces[n].kind === kind).length;

  return (
    <>
      <Section title="Surfaces in this room">
        <ul className="space-y-2">
          {names.map((name) => {
            const f = surfaces[name];
            const d = f.designId ? designs[f.designId]?.design : null;
            const active = name === activeSurface;
            return (
              <li key={name}>
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-sm border p-2 transition-colors",
                    active ? "border-black" : "border-black/15 hover:border-black/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSurface(name);
                      setTab(d ? "layout" : "products");
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-pressed={active}
                  >
                    {d ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.thumb} alt="" className="h-10 w-10 shrink-0 rounded-sm object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-black/5 text-lg text-black/40">
                        +
                      </span>
                    )}
                    <span className="min-w-0 text-xs">
                      <strong className="block capitalize text-black">{f.label}</strong>
                      <span className="line-clamp-1 text-black/60">
                        {d ? d.name : f.kind === "wall" ? "As photographed — choose a tile" : "As photographed — choose a floor or tile"}
                      </span>
                    </span>
                  </button>
                  <Switch
                    label={<span className="sr-only">Show the new design on {f.label}</span>}
                    checked={f.visible}
                    onChange={(v) => setSurfaceVisible(name, v)}
                    disabled={!d}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <Hint>Tap a surface here or in the photo to design it. Switch one off to see it as photographed.</Hint>
      </Section>

      {count("floor") > 1 || count("wall") > 1 ? (
        <Section title="Editing behaviour">
          {count("floor") > 1 ? (
            <Switch label="Apply changes to every floor area" checked={links.floor} onChange={(v) => setLink("floor", v)} />
          ) : null}
          {count("wall") > 1 ? (
            <Switch label="Apply changes to every wall" checked={links.wall} onChange={(v) => setLink("wall", v)} />
          ) : null}
          <Hint>
            Floors are linked by default, so the whole floor changes together. Walls are separate by default, so each
            wall can have its own tile — turn the switch on to tile them all the same. Floor and walls are never linked.
          </Hint>
        </Section>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------- layout --- */

function LayoutPanel() {
  const floor = useVisualiser(selectActiveSurface);
  const current = useVisualiser(selectCurrentDesign);
  const updateSurface = useVisualiser((s) => s.updateSurface);
  if (!floor || !current) return null;

  const isSheet = materialModel(current.design.material) !== "module";
  const own = current.design.sizeMm;
  // Tiles offer the engine's common tile sizes; flooring its plank sizes.
  const common = current.design.kind === "tile" ? (TILE_SIZES as { w: number; h: number }[]) : FLOOR_SIZES;
  const presets = [own, ...common.filter((s) => !(s.w === own.w && s.h === own.h))].map(({ w, h }) => ({ w, h }));
  const sameSize = (a: { w: number; h: number }, b: { w: number; h: number }) => a.w === b.w && a.h === b.h;

  return (
    <>
      <Section title={isSheet ? "Pattern repeat (mm)" : current.design.kind === "tile" ? "Tile size (mm)" : "Plank / tile size (mm)"}>
        <div className="grid grid-cols-3 gap-1.5">
          {presets.map((s, i) => (
            <Opt
              key={`${s.w}x${s.h}`}
              active={sameSize(floor.tileSize, s)}
              onClick={() => updateSurface({ tileSize: { w: s.w, h: s.h } })}
              className="px-1 normal-case tracking-normal"
            >
              {s.w} × {s.h}
              {i === 0 ? <span className="block text-[9px] uppercase opacity-70">This product</span> : null}
            </Opt>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <SizeInput label="Width (mm)" value={floor.tileSize.w} onChange={(w) => updateSurface({ tileSize: { ...floor.tileSize, w } })} />
          <span className="text-black/40">×</span>
          <SizeInput label="Length (mm)" value={floor.tileSize.h} onChange={(h) => updateSurface({ tileSize: { ...floor.tileSize, h } })} />
        </div>
        {current.design.sizeSource === "default" ? (
          <Hint>This product doesn&apos;t list its size, so a typical size is used — set the real one here.</Hint>
        ) : null}
      </Section>

      {!isSheet ? (
        <Section title="Laying pattern">
          <div className="grid grid-cols-3 gap-1.5">
            {(LAYOUTS as { key: LayoutKey; name: string }[]).map((l) => (
              <Opt
                key={l.key}
                active={floor.layout === l.key}
                onClick={() => updateSurface({ layout: l.key })}
                title={l.name}
                className="flex flex-col items-center gap-1 px-1 normal-case tracking-normal"
              >
                <LayoutGlyph kind={l.key} />
                <span className="text-[10px] leading-3">{l.name}</span>
              </Opt>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Orientation">
        <div className="grid grid-cols-4 gap-1.5">
          {[0, 90, 180, 270].map((deg) => (
            <Opt key={deg} active={floor.rotation === deg} onClick={() => updateSurface({ rotation: deg })}>
              {deg}°
            </Opt>
          ))}
        </div>
        <Slider label="Fine rotation" value={floor.rotation} min={0} max={359} step={1} onChange={(v) => updateSurface({ rotation: v })} format={(v) => `${v}°`} />
        <Slider label="Shift across" value={floor.offset.x} min={-2} max={2} step={0.01} onChange={(x) => updateSurface({ offset: { ...floor.offset, x } })} format={mm} />
        <Slider label="Shift along" value={floor.offset.y} min={-2} max={2} step={0.01} onChange={(y) => updateSurface({ offset: { ...floor.offset, y } })} format={mm} />
        <button
          type="button"
          onClick={() => updateSurface({ rotation: 0, offset: { x: 0, y: 0 } })}
          className="text-[11px] font-medium text-black/70 underline underline-offset-2 hover:text-black"
        >
          Reset position
        </button>
      </Section>

      {!isSheet ? (
        <Section title="Variation">
          <Switch label="Random 90° rotation" checked={floor.randomRotate} onChange={(v) => updateSurface({ randomRotate: v })} />
          <Hint>Turns each {current.design.kind === "tile" ? "tile" : "plank"} at random so a repeating photo shows less. Each product uses its main photo as the design.</Hint>
        </Section>
      ) : null}
    </>
  );
}

function SizeInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex-1">
      <span className="sr-only">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={10}
        max={6000}
        value={value}
        aria-label={label}
        onChange={(e) => {
          // Same range the store keeps (10 mm mosaic chips up to 6 m slabs).
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 10 && n <= 6000) onChange(n);
        }}
        className="h-9 w-full border border-black/20 px-2 text-sm tabular-nums outline-none focus:border-black"
      />
    </label>
  );
}

/* ---------------------------------------------------------------- grout --- */

function GroutPanel() {
  const floor = useVisualiser(selectActiveSurface);
  const current = useVisualiser(selectCurrentDesign);
  const updateSurface = useVisualiser((s) => s.updateSurface);
  if (!floor || !current) return null;

  if (materialModel(current.design.material) !== "module") {
    return <Hint>Carpet is laid as one continuous surface, so it has no joints.</Hint>;
  }

  const grout = floor.grout;
  const colors = GROUT_COLORS as { name: string; hex: string }[];
  const named = colors.find((c) => c.hex.toLowerCase() === grout.color.toLowerCase())?.name;

  return (
    <>
      <Section title="Joint width">
        <div className="grid grid-cols-4 gap-1.5">
          {(GROUT_SIZES as number[]).map((g) => (
            <Opt key={g} active={grout.size === g} onClick={() => updateSurface({ grout: { ...grout, size: g } })} className="px-1">
              {g === 0 ? "None" : `${g} mm`}
            </Opt>
          ))}
        </div>
        <Slider label="Custom width" value={grout.size} min={0} max={15} step={0.5} onChange={(size) => updateSurface({ grout: { ...grout, size } })} format={(v) => `${v} mm`} />
      </Section>

      <Section title="Grout colour">
        <div className="flex flex-wrap gap-2">
          {colors.map((c) => (
            <button
              key={c.hex}
              type="button"
              title={c.name}
              aria-label={c.name}
              aria-pressed={grout.color.toLowerCase() === c.hex.toLowerCase()}
              onClick={() => updateSurface({ grout: { ...grout, color: c.hex } })}
              className={cn(
                "h-8 w-8 rounded-full border border-black/15 transition-shadow",
                grout.color.toLowerCase() === c.hex.toLowerCase() && "ring-2 ring-black ring-offset-2",
              )}
              style={{ background: c.hex }}
            />
          ))}
          <label
            title="Custom colour"
            className={cn("relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border border-black/15", !named && "ring-2 ring-black ring-offset-2")}
            style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}
          >
            <span className="sr-only">Custom colour</span>
            <input
              type="color"
              value={grout.color}
              onChange={(e) => updateSurface({ grout: { ...grout, color: e.target.value } })}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>
        <Hint>Currently {named ?? grout.color}.{grout.size === 0 ? " Set a joint width to see it." : ""}</Hint>
      </Section>

      <Section title="Edge profile">
        <Slider label="Bevel / joint depth" value={floor.bevel} min={0} max={1} step={0.01} onChange={(v) => updateSurface({ bevel: v })} format={pct} />
        <Hint>Shades the edge next to each joint, the way a bevelled plank catches the light on a real floor.</Hint>
      </Section>
    </>
  );
}

/* --------------------------------------------------------------- finish --- */

function FinishPanel() {
  const floor = useVisualiser(selectActiveSurface);
  const updateSurface = useVisualiser((s) => s.updateSurface);
  if (!floor) return null;

  return (
    <>
      <Section title="Surface finish">
        <div className="grid grid-cols-4 gap-1.5">
          {FINISHES.map(([label, g]) => (
            <Opt key={label} active={Math.abs(floor.gloss - g) < 0.05} onClick={() => updateSurface({ gloss: g })} className="px-1">
              {label}
            </Opt>
          ))}
        </div>
        <Slider label="Reflectivity" value={floor.gloss} min={0} max={1.2} step={0.01} onChange={(v) => updateSurface({ gloss: v })} format={pct} />
      </Section>

      <Section title="Blend with the room">
        <Slider label="Keep original lighting" value={floor.shade} min={0} max={1.8} step={0.01} onChange={(v) => updateSurface({ shade: v })} format={pct} />
        <Hint>How strongly the photo&apos;s own shadows and light fall-off carry onto the new floor. Lower it if the room is very dark; raise it for punch.</Hint>
        <Slider label="Surface detail" value={floor.detail} min={0} max={1.5} step={0.01} onChange={(v) => updateSurface({ detail: v })} format={pct} />
        <Hint>Lets fine texture from the original photo — scuffs, contact shadows — show through the new floor.</Hint>
      </Section>

      <Section title="Tint">
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={floor.tint}
            aria-label="Tint colour"
            onChange={(e) => updateSurface({ tint: e.target.value })}
            className="h-9 w-12 cursor-pointer border border-black/20 bg-white p-0.5"
          />
          <button
            type="button"
            onClick={() => updateSurface({ tint: "#ffffff" })}
            disabled={floor.tint.toLowerCase() === "#ffffff"}
            className="text-[11px] font-medium text-black/70 underline underline-offset-2 hover:text-black disabled:no-underline disabled:opacity-40"
          >
            Reset
          </button>
        </div>
        <Hint>Shifts the floor&apos;s colour without replacing it.</Hint>
      </Section>
    </>
  );
}
