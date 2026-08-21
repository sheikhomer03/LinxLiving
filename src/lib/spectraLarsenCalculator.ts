/**
 * Spectra / Larsen installation-product calculators
 * (spectratileandhome.com SpectraLarsenCalculator formulas).
 */

export type SpectraLarsenKind = "adhesive" | "grout" | "silicone";

export type SpectraLarsenCalcResult = {
  recommended: number;
  detail: string;
};

const COLOUR_NAMES = new Set([
  "white",
  "silver grey",
  "anthracite",
  "grey",
  "limestone",
  "beige",
  "black",
]);

/** Infer calculator kind from product name / handle / category. */
export function inferSpectraLarsenKind(input: {
  name?: string | null;
  handle?: string | null;
  category?: string | null;
  categoryName?: string | null;
}): SpectraLarsenKind | null {
  const cat = `${input.category || ""} ${input.categoryName || ""}`.toLowerCase();
  if (
    cat &&
    !/adhesive|grout|silicone/.test(cat) &&
    cat !== "adhesive-grout-silicone"
  ) {
    return null;
  }
  const hay = `${input.handle || ""} ${input.name || ""}`.toLowerCase();
  if (/silicone/.test(hay)) return "silicone";
  if (/grout/.test(hay)) return "grout";
  if (/adhesive/.test(hay)) return "adhesive";
  if (/adhesive|grout|silicone/.test(cat) || cat.includes("adhesive-grout")) {
    // Category alone is not enough to pick a kind.
    return null;
  }
  return null;
}

export function isSpectraAdhesiveGroutCategory(input: {
  brandSlug?: string | null;
  category?: string | null;
  categoryName?: string | null;
}): boolean {
  if (String(input.brandSlug || "").toLowerCase() !== "spectra") return false;
  const cat = `${input.category || ""} ${input.categoryName || ""}`.toLowerCase();
  return (
    cat.includes("adhesive-grout-silicone") ||
    (cat.includes("adhesive") && cat.includes("grout"))
  );
}

export function unitLabelForKind(kind: SpectraLarsenKind): string {
  if (kind === "silicone") return "cartridges";
  if (kind === "grout") return "packs";
  return "bags";
}

export function quantityHintForKind(kind: SpectraLarsenKind): string {
  if (kind === "silicone") return "Number of 300ml cartridges";
  if (kind === "grout") return "Number of 3kg packs";
  return "Number of 20kg bags";
}

export function calculatorBlurb(kind: SpectraLarsenKind): string {
  if (kind === "silicone") {
    return "Enter the total joint length and bead size for a 300ml cartridge estimate.";
  }
  if (kind === "grout") {
    return "Enter the tile and joint measurements for a 3kg pack estimate.";
  }
  return "Enter the tiled area and we’ll recommend the number of 20kg bags.";
}

export function calculatorHelp(kind: SpectraLarsenKind): string {
  if (kind === "silicone") {
    return "The result includes a 10% application allowance. Larsen specifies a minimum 5mm joint width and 5mm joint depth.";
  }
  if (kind === "grout") {
    return "The estimate uses the standard grout-volume formula, Larsen’s published coverage guidance and a built-in 10% allowance. Joint depth is assumed to match the tile thickness.";
  }
  return "We calculate conservatively at 3m² per bag to allow for normal site variation and back-buttering. Larsen’s stated guide is approximately 4m² per bag at a uniform 3mm bed.";
}

/** True when a size-option name is actually a Colourfast colour (bad sync). */
export function isLarsenColourName(name: string): boolean {
  return COLOUR_NAMES.has(String(name || "").trim().toLowerCase());
}

export function calculateAdhesive(
  areaM2: number,
  allowancePercent: number,
): SpectraLarsenCalcResult {
  const area = Math.max(0, areaM2);
  const allowance = Math.max(0, allowancePercent) / 100;
  const recommended = area > 0 ? Math.ceil((area * (1 + allowance)) / 3) : 0;
  return {
    recommended,
    detail: recommended
      ? `Covers up to ${(recommended * 3).toFixed(0)}m² using our conservative 3m²-per-bag ordering allowance.`
      : "Enter your measurements to calculate.",
  };
}

export function calculateGrout(input: {
  areaM2: number;
  tileLengthMm: number;
  tileWidthMm: number;
  tileDepthMm: number;
  jointWidthMm: number;
}): SpectraLarsenCalcResult {
  const {
    areaM2,
    tileLengthMm,
    tileWidthMm,
    tileDepthMm,
    jointWidthMm,
  } = input;
  let kilograms = 0;
  if (
    areaM2 > 0 &&
    tileLengthMm > 0 &&
    tileWidthMm > 0 &&
    tileDepthMm > 0 &&
    jointWidthMm > 0
  ) {
    kilograms =
      areaM2 *
      ((tileLengthMm + tileWidthMm) / (tileLengthMm * tileWidthMm)) *
      tileDepthMm *
      jointWidthMm *
      1.6 *
      1.1;
  }
  const recommended = kilograms > 0 ? Math.ceil(kilograms / 3) : 0;
  return {
    recommended,
    detail: recommended
      ? `Estimated use: ${kilograms.toFixed(2)}kg including a 10% allowance. Supplied in full 3kg packs.`
      : "Enter your measurements to calculate.",
  };
}

export function calculateSilicone(input: {
  jointLengthM: number;
  jointWidthMm: number;
  jointDepthMm: number;
}): SpectraLarsenCalcResult {
  const { jointLengthM, jointWidthMm, jointDepthMm } = input;
  const millilitres = jointLengthM * jointWidthMm * jointDepthMm;
  const recommended =
    millilitres > 0 ? Math.ceil((millilitres * 1.1) / 300) : 0;
  let detail = "Enter your measurements to calculate.";
  if (recommended && jointWidthMm > 0 && jointDepthMm > 0) {
    const metresPerCartridge = 300 / (jointWidthMm * jointDepthMm);
    detail = `Approx. ${metresPerCartridge.toFixed(1)} linear metres per cartridge at this bead size before the application allowance.`;
  }
  return { recommended, detail };
}
