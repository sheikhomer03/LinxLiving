"use client";

import { cn } from "@/lib/utils";
import { useVisualiser } from "@/components/visualiser/VisualiserContext";
import { Hint, LayoutGlyph, Opt, Section, Slider, Switch } from "@/components/visualiser/controls";
import {
  selectActiveFloor,
  selectCurrentDesign,
  type LayoutKey,
  type PanelTab,
} from "@/store/useVisualiserStore";
// The engine's own catalogues, so the panels offer exactly what it can draw.
import { GROUT_COLORS, GROUT_SIZES, LAYOUTS, materialModel } from "@/components/visualiser/engine/layouts.js";

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
  const floor = useVisualiser(selectActiveFloor);
  if (!floor) {
    return (
      <div className="space-y-2 py-6 text-center">
        <p className="text-sm font-medium text-black">Add a photo of your room first</p>
        <Hint>Once the floor is found, you can change how it&apos;s laid here.</Hint>
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
  const floors = useVisualiser((s) => s.floors);
  const designs = useVisualiser((s) => s.designs);
  const activeFloor = useVisualiser((s) => s.activeFloor);
  const linkFloors = useVisualiser((s) => s.linkFloors);
  const setActiveFloor = useVisualiser((s) => s.setActiveFloor);
  const setFloorVisible = useVisualiser((s) => s.setFloorVisible);
  const setLinkFloors = useVisualiser((s) => s.setLinkFloors);
  const setTab = useVisualiser((s) => s.setTab);
  if (!room) return null;

  const floorCount = Object.keys(floors).length;

  return (
    <>
      <Section title="Surfaces in this room">
        <ul className="space-y-2">
          {room.objectList.map((o) => {
            const f = floors[o.name];
            const d = f ? designs[f.designId]?.design : null;
            const label = String(o.label || o.name).replace(/_/g, " ");
            if (!f) {
              return (
                <li key={o.name} className="flex items-center gap-3 rounded-sm border border-dashed border-black/15 p-2 opacity-60">
                  <span className="h-10 w-10 shrink-0 rounded-sm bg-black/5" />
                  <span className="min-w-0 text-xs">
                    <strong className="block capitalize text-black">{label}</strong>
                    <span className="text-black/60">Stays as photographed — flooring only</span>
                  </span>
                </li>
              );
            }
            const active = o.name === activeFloor;
            return (
              <li key={o.name}>
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-sm border p-2 transition-colors",
                    active ? "border-black" : "border-black/15 hover:border-black/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFloor(o.name);
                      setTab("layout");
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-pressed={active}
                  >
                    {d ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.thumb} alt="" className="h-10 w-10 shrink-0 rounded-sm object-cover" />
                    ) : (
                      <span className="h-10 w-10 shrink-0 rounded-sm bg-black/5" />
                    )}
                    <span className="min-w-0 text-xs">
                      <strong className="block capitalize text-black">{label}</strong>
                      <span className="line-clamp-1 text-black/60">{d ? d.name : "Not applied"}</span>
                    </span>
                  </button>
                  <Switch
                    label={<span className="sr-only">Show new floor on {label}</span>}
                    checked={f.visible}
                    onChange={(v) => setFloorVisible(o.name, v)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <Hint>Switch a floor area off to see it as photographed.</Hint>
      </Section>

      {floorCount > 1 ? (
        <Section title="Editing behaviour">
          <Switch label="Apply changes to every floor area" checked={linkFloors} onChange={setLinkFloors} />
          <Hint>
            On by default, so the whole floor changes together. Turn it off to give each floor area its own
            design — choose an area above (or tap it in the photo), then pick a floor.
          </Hint>
        </Section>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------- layout --- */

function LayoutPanel() {
  const floor = useVisualiser(selectActiveFloor);
  const current = useVisualiser(selectCurrentDesign);
  const updateFloor = useVisualiser((s) => s.updateFloor);
  if (!floor) return null;

  const isSheet = materialModel(current.design.material) !== "module";
  const own = current.design.sizeMm;
  const presets = [own, ...FLOOR_SIZES.filter((s) => !(s.w === own.w && s.h === own.h))];
  const sameSize = (a: { w: number; h: number }, b: { w: number; h: number }) => a.w === b.w && a.h === b.h;

  return (
    <>
      <Section title={isSheet ? "Pattern repeat (mm)" : "Plank / tile size (mm)"}>
        <div className="grid grid-cols-3 gap-1.5">
          {presets.map((s, i) => (
            <Opt
              key={`${s.w}x${s.h}`}
              active={sameSize(floor.tileSize, s)}
              onClick={() => updateFloor({ tileSize: { w: s.w, h: s.h } })}
              className="px-1 normal-case tracking-normal"
            >
              {s.w} × {s.h}
              {i === 0 ? <span className="block text-[9px] uppercase opacity-70">This product</span> : null}
            </Opt>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <SizeInput label="Width (mm)" value={floor.tileSize.w} onChange={(w) => updateFloor({ tileSize: { ...floor.tileSize, w } })} />
          <span className="text-black/40">×</span>
          <SizeInput label="Length (mm)" value={floor.tileSize.h} onChange={(h) => updateFloor({ tileSize: { ...floor.tileSize, h } })} />
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
                onClick={() => updateFloor({ layout: l.key })}
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
            <Opt key={deg} active={floor.rotation === deg} onClick={() => updateFloor({ rotation: deg })}>
              {deg}°
            </Opt>
          ))}
        </div>
        <Slider label="Fine rotation" value={floor.rotation} min={0} max={359} step={1} onChange={(v) => updateFloor({ rotation: v })} format={(v) => `${v}°`} />
        <Slider label="Shift across" value={floor.offset.x} min={-2} max={2} step={0.01} onChange={(x) => updateFloor({ offset: { ...floor.offset, x } })} format={mm} />
        <Slider label="Shift along" value={floor.offset.y} min={-2} max={2} step={0.01} onChange={(y) => updateFloor({ offset: { ...floor.offset, y } })} format={mm} />
        <button
          type="button"
          onClick={() => updateFloor({ rotation: 0, offset: { x: 0, y: 0 } })}
          className="text-[11px] font-medium text-black/70 underline underline-offset-2 hover:text-black"
        >
          Reset position
        </button>
      </Section>

      {!isSheet ? (
        <Section title="Variation">
          <Switch label="Random 90° rotation" checked={floor.randomRotate} onChange={(v) => updateFloor({ randomRotate: v })} />
          <Hint>Turns planks at random so a repeating photo shows less. Each product uses its main photo as the design.</Hint>
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
        min={20}
        max={6000}
        value={value}
        aria-label={label}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 20 && n <= 6000) onChange(n);
        }}
        className="h-9 w-full border border-black/20 px-2 text-sm tabular-nums outline-none focus:border-black"
      />
    </label>
  );
}

/* ---------------------------------------------------------------- grout --- */

function GroutPanel() {
  const floor = useVisualiser(selectActiveFloor);
  const current = useVisualiser(selectCurrentDesign);
  const updateFloor = useVisualiser((s) => s.updateFloor);
  if (!floor) return null;

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
            <Opt key={g} active={grout.size === g} onClick={() => updateFloor({ grout: { ...grout, size: g } })} className="px-1">
              {g === 0 ? "None" : `${g} mm`}
            </Opt>
          ))}
        </div>
        <Slider label="Custom width" value={grout.size} min={0} max={15} step={0.5} onChange={(size) => updateFloor({ grout: { ...grout, size } })} format={(v) => `${v} mm`} />
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
              onClick={() => updateFloor({ grout: { ...grout, color: c.hex } })}
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
              onChange={(e) => updateFloor({ grout: { ...grout, color: e.target.value } })}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>
        <Hint>Currently {named ?? grout.color}.{grout.size === 0 ? " Set a joint width to see it." : ""}</Hint>
      </Section>

      <Section title="Edge profile">
        <Slider label="Bevel / joint depth" value={floor.bevel} min={0} max={1} step={0.01} onChange={(v) => updateFloor({ bevel: v })} format={pct} />
        <Hint>Shades the edge next to each joint, the way a bevelled plank catches the light on a real floor.</Hint>
      </Section>
    </>
  );
}

/* --------------------------------------------------------------- finish --- */

function FinishPanel() {
  const floor = useVisualiser(selectActiveFloor);
  const updateFloor = useVisualiser((s) => s.updateFloor);
  if (!floor) return null;

  return (
    <>
      <Section title="Surface finish">
        <div className="grid grid-cols-4 gap-1.5">
          {FINISHES.map(([label, g]) => (
            <Opt key={label} active={Math.abs(floor.gloss - g) < 0.05} onClick={() => updateFloor({ gloss: g })} className="px-1">
              {label}
            </Opt>
          ))}
        </div>
        <Slider label="Reflectivity" value={floor.gloss} min={0} max={1.2} step={0.01} onChange={(v) => updateFloor({ gloss: v })} format={pct} />
      </Section>

      <Section title="Blend with the room">
        <Slider label="Keep original lighting" value={floor.shade} min={0} max={1.8} step={0.01} onChange={(v) => updateFloor({ shade: v })} format={pct} />
        <Hint>How strongly the photo&apos;s own shadows and light fall-off carry onto the new floor. Lower it if the room is very dark; raise it for punch.</Hint>
        <Slider label="Surface detail" value={floor.detail} min={0} max={1.5} step={0.01} onChange={(v) => updateFloor({ detail: v })} format={pct} />
        <Hint>Lets fine texture from the original photo — scuffs, contact shadows — show through the new floor.</Hint>
      </Section>

      <Section title="Tint">
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={floor.tint}
            aria-label="Tint colour"
            onChange={(e) => updateFloor({ tint: e.target.value })}
            className="h-9 w-12 cursor-pointer border border-black/20 bg-white p-0.5"
          />
          <button
            type="button"
            onClick={() => updateFloor({ tint: "#ffffff" })}
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
