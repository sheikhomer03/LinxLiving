"use client";

import { useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  calculateAdhesive,
  calculateGrout,
  calculateSilicone,
  calculatorBlurb,
  calculatorHelp,
  quantityHintForKind,
  unitLabelForKind,
  type SpectraLarsenKind,
} from "@/lib/spectraLarsenCalculator";
import {
  getSpectraLarsenGuide,
  LARSEN_COLOURFAST_COLOURS,
  LARSEN_COLOUR_SWATCHES,
} from "@/lib/spectraLarsenGuide";

type Props = {
  kind: SpectraLarsenKind;
  productName?: string | null;
  quantity: number;
  maxQuantity?: number;
  disabled?: boolean;
  showColourPalette?: boolean;
  onQuantityChange: (qty: number) => void;
};

/**
 * Spectra-style Larsen quantity calculator + accordion guide
 * for Adhesive / Grout / Silicone PDPs.
 */
export function SpectraLarsenConfigurator({
  kind,
  productName,
  quantity,
  maxQuantity = 999,
  disabled = false,
  showColourPalette,
  onQuantityChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState("");
  const [allowance, setAllowance] = useState("10");
  const [tileLength, setTileLength] = useState("1200");
  const [tileWidth, setTileWidth] = useState("600");
  const [tileDepth, setTileDepth] = useState("8.5");
  const [jointWidth, setJointWidth] = useState(kind === "silicone" ? "5" : "3");
  const [jointLength, setJointLength] = useState("");
  const [jointDepth, setJointDepth] = useState("5");
  const [openSection, setOpenSection] = useState(0);

  const result = useMemo(() => {
    if (kind === "adhesive") {
      return calculateAdhesive(Number(area) || 0, Number(allowance) || 0);
    }
    if (kind === "grout") {
      return calculateGrout({
        areaM2: Number(area) || 0,
        tileLengthMm: Number(tileLength) || 0,
        tileWidthMm: Number(tileWidth) || 0,
        tileDepthMm: Number(tileDepth) || 0,
        jointWidthMm: Number(jointWidth) || 0,
      });
    }
    return calculateSilicone({
      jointLengthM: Number(jointLength) || 0,
      jointWidthMm: Number(jointWidth) || 0,
      jointDepthMm: Number(jointDepth) || 0,
    });
  }, [
    kind,
    area,
    allowance,
    tileLength,
    tileWidth,
    tileDepth,
    jointWidth,
    jointLength,
    jointDepth,
  ]);

  const notify = useRef(onQuantityChange);
  notify.current = onQuantityChange;

  const unit = unitLabelForKind(kind);
  const guide = getSpectraLarsenGuide(kind, productName);
  const palette =
    showColourPalette ?? (kind === "grout" || kind === "silicone");

  const applyRecommended = () => {
    if (result.recommended <= 0) return;
    const next = Math.min(maxQuantity, Math.max(1, result.recommended));
    notify.current(next);
    setOpen(false);
  };

  const fieldClass =
    "mt-1.5 w-full rounded-lg border border-foreground/15 bg-white px-3 py-2.5 text-sm text-foreground outline-none focus:border-foreground/40";

  return (
    <div className={cn("space-y-4", disabled && "opacity-50 pointer-events-none")}>
      <div className="rounded-xl border border-foreground/10 bg-[#faf8f3] overflow-hidden">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-black/[0.02] transition-colors"
        >
          <span className="min-w-0">
            <strong className="block text-sm font-semibold text-foreground">
              Calculate how much you need
            </strong>
            <span className="mt-0.5 block text-xs text-foreground/55 leading-snug">
              {calculatorBlurb(kind)}
            </span>
          </span>
          <span
            className="shrink-0 text-lg leading-none text-foreground/60 tabular-nums"
            aria-hidden
          >
            {open ? "−" : "+"}
          </span>
        </button>

        {open ? (
          <div className="border-t border-foreground/10 px-4 py-4 space-y-4">
            {kind === "adhesive" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-foreground/70">
                  Area to tile (m²)
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    inputMode="decimal"
                    placeholder="e.g. 24"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="block text-xs font-medium text-foreground/70">
                  Installation allowance
                  <select
                    value={allowance}
                    onChange={(e) => setAllowance(e.target.value)}
                    className={fieldClass}
                  >
                    <option value="5">5%</option>
                    <option value="10">10% recommended</option>
                    <option value="15">15%</option>
                  </select>
                </label>
              </div>
            ) : null}

            {kind === "grout" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-foreground/70">
                  Tiled area (m²)
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    inputMode="decimal"
                    placeholder="e.g. 20"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="block text-xs font-medium text-foreground/70">
                  Tile length (mm)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={tileLength}
                    onChange={(e) => setTileLength(e.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="block text-xs font-medium text-foreground/70">
                  Tile width (mm)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={tileWidth}
                    onChange={(e) => setTileWidth(e.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="block text-xs font-medium text-foreground/70">
                  Tile thickness (mm)
                  <input
                    type="number"
                    min={1}
                    step="0.5"
                    inputMode="decimal"
                    value={tileDepth}
                    onChange={(e) => setTileDepth(e.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="block text-xs font-medium text-foreground/70 sm:col-span-2">
                  Joint width (mm)
                  <input
                    type="number"
                    min={1}
                    max={15}
                    step="0.5"
                    inputMode="decimal"
                    value={jointWidth}
                    onChange={(e) => setJointWidth(e.target.value)}
                    className={cn(fieldClass, "max-w-xs")}
                  />
                </label>
              </div>
            ) : null}

            {kind === "silicone" ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block text-xs font-medium text-foreground/70 sm:col-span-3">
                  Total joint length (metres)
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    inputMode="decimal"
                    placeholder="e.g. 18"
                    value={jointLength}
                    onChange={(e) => setJointLength(e.target.value)}
                    className={cn(fieldClass, "max-w-xs")}
                  />
                </label>
                <label className="block text-xs font-medium text-foreground/70">
                  Joint width (mm)
                  <input
                    type="number"
                    min={5}
                    max={30}
                    step={1}
                    inputMode="numeric"
                    value={jointWidth}
                    onChange={(e) => setJointWidth(e.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="block text-xs font-medium text-foreground/70">
                  Joint depth (mm)
                  <input
                    type="number"
                    min={5}
                    step={1}
                    inputMode="numeric"
                    value={jointDepth}
                    onChange={(e) => setJointDepth(e.target.value)}
                    className={fieldClass}
                  />
                </label>
              </div>
            ) : null}

            <p className="text-xs leading-relaxed text-foreground/55">
              {calculatorHelp(kind)}
            </p>

            <div className="rounded-lg border border-foreground/10 bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
                Recommended quantity
              </p>
              <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
                {result.recommended}{" "}
                <span className="text-base font-medium text-foreground/60">
                  {unit}
                </span>
              </p>
              <p className="mt-1 text-xs text-foreground/55 leading-snug">
                {result.detail}
              </p>
            </div>

            <button
              type="button"
              disabled={result.recommended <= 0}
              onClick={applyRecommended}
              className="w-full h-11 rounded-lg bg-foreground text-background text-sm font-bold disabled:opacity-40"
            >
              Use this quantity
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-foreground/10 bg-white px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Quantity</p>
          <p className="text-xs text-foreground/50">{quantityHintForKind(kind)}</p>
        </div>
        <div className="flex items-center border border-foreground/15 rounded-lg">
          <button
            type="button"
            onClick={() =>
              notify.current(Math.max(1, Math.min(maxQuantity, quantity - 1)))
            }
            className="p-2.5 hover:bg-secondary transition-colors"
            aria-label="Decrease quantity"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="w-12 text-center text-sm font-semibold tabular-nums">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() =>
              notify.current(Math.min(maxQuantity, quantity + 1))
            }
            disabled={quantity >= maxQuantity}
            className="p-2.5 hover:bg-secondary transition-colors disabled:opacity-40"
            aria-label="Increase quantity"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-foreground/10 bg-white overflow-hidden">
        <div className="px-4 py-4 border-b border-foreground/10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/45">
            {guide.kicker}
          </p>
          <h2 className="mt-1 text-base font-semibold text-foreground">
            {guide.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground/65">
            {guide.body}
          </p>
        </div>

        {palette && guide.paletteTitle ? (
          <div className="px-4 py-4 border-b border-foreground/10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/45">
              Available colours
            </p>
            <h3 className="mt-1 text-sm font-semibold text-foreground">
              {guide.paletteTitle}
            </h3>
            {guide.paletteBody ? (
              <p className="mt-1.5 text-xs leading-relaxed text-foreground/55">
                {guide.paletteBody}
              </p>
            ) : null}
            <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-3">
              {LARSEN_COLOURFAST_COLOURS.map((name) => {
                const sw = LARSEN_COLOUR_SWATCHES[name];
                return (
                  <div key={name} className="text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={sw.swatchImage}
                      alt={`${name} colour`}
                      className="mx-auto aspect-square w-full max-w-[5.5rem] rounded-md object-cover border border-foreground/10"
                      loading="lazy"
                    />
                    <p className="mt-1.5 text-[11px] font-medium text-foreground/80">
                      {name}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-foreground/45">
              Screen colours are a guide only. Lighting, tile colour and display
              settings can affect appearance; check a physical sample where an
              exact match is important.
            </p>
          </div>
        ) : null}

        <div>
          {guide.sections.map((section, index) => {
            const isOpen = openSection === index;
            return (
              <div
                key={section.title}
                className="border-b border-foreground/10 last:border-b-0"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenSection(isOpen ? -1 : index)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-semibold text-foreground hover:bg-secondary/40 transition-colors"
                >
                  {section.title}
                  <span className="text-foreground/45" aria-hidden>
                    {isOpen ? "−" : "+"}
                  </span>
                </button>
                {isOpen ? (
                  <div className="px-4 pb-4 text-sm text-foreground/70">
                    {section.specs?.length ? (
                      <dl className="space-y-2">
                        {section.specs.map((row) => (
                          <div
                            key={row.label}
                            className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-0.5 sm:gap-3"
                          >
                            <dt className="text-xs font-semibold uppercase tracking-wide text-foreground/45">
                              {row.label}
                            </dt>
                            <dd className="text-sm text-foreground/80">
                              {row.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {section.paragraphs?.map((p) => (
                      <p key={p.slice(0, 40)} className="leading-relaxed">
                        {p}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
