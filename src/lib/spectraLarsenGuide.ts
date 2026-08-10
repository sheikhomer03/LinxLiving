/**
 * Spectra Adhesive / Grout / Silicone guide panels
 * (mirrors SpectraLarsenGuide + accordion tabs on spectratileandhome.com).
 */

import type { SpectraLarsenKind } from "@/lib/spectraLarsenCalculator";

export type SpectraLarsenSpecRow = { label: string; value: string };

export type SpectraLarsenGuideSection = {
  title: string;
  /** Plain paragraphs for non-spec sections. */
  paragraphs?: string[];
  /** Spec table when title is Technical specifications. */
  specs?: SpectraLarsenSpecRow[];
};

export type SpectraLarsenGuide = {
  kicker: string;
  title: string;
  body: string;
  paletteTitle?: string;
  paletteBody?: string;
  sections: SpectraLarsenGuideSection[];
};

const COLOURFAST_COLOURS = [
  "White",
  "Silver Grey",
  "Anthracite",
  "Grey",
  "Limestone",
  "Beige",
  "Black",
] as const;

const SWATCH_BASE =
  "https://spectratileandhome.com/cdn/shop/t/9/assets";

/** Public CDN swatches used on Spectra for Colourfast 360. */
export const LARSEN_COLOUR_SWATCHES: Record<
  (typeof COLOURFAST_COLOURS)[number],
  { swatchImage: string; colorValue: string }
> = {
  White: {
    swatchImage: `${SWATCH_BASE}/larsen-grout-white.png?v=88835890003184620621785026914`,
    colorValue: "#f4f4f2",
  },
  "Silver Grey": {
    swatchImage: `${SWATCH_BASE}/larsen-grout-silver-grey.png?v=102083703330948050851785026914`,
    colorValue: "#a7a7a7",
  },
  Anthracite: {
    swatchImage: `${SWATCH_BASE}/larsen-grout-anthracite.png?v=66478849338952892781785026914`,
    colorValue: "#3a3a3a",
  },
  Grey: {
    swatchImage: `${SWATCH_BASE}/larsen-grout-grey.png?v=138758975870253432561785026914`,
    colorValue: "#7b7b7b",
  },
  Limestone: {
    swatchImage: `${SWATCH_BASE}/larsen-grout-limestone.png?v=104127842257014441861785026914`,
    colorValue: "#cfc6b8",
  },
  Beige: {
    swatchImage: `${SWATCH_BASE}/larsen-grout-beige.png?v=174942164673656263931785026914`,
    colorValue: "#d4c4a8",
  },
  Black: {
    swatchImage: `${SWATCH_BASE}/larsen-grout-black.png?v=163861959402005032281785026914`,
    colorValue: "#1a1a1a",
  },
};

export const LARSEN_COLOURFAST_COLOURS = [...COLOURFAST_COLOURS];

const DELIVERY_SECTION: SpectraLarsenGuideSection = {
  title: "Delivery, advice and returns",
  paragraphs: [
    "Accessories can be ordered alongside your tiles. UK pallet delivery costs £59, or is free when your order total exceeds £449. Need help choosing a product or quantity? Send us your measurements before ordering.",
  ],
};

const GUIDES_BY_KIND: Record<SpectraLarsenKind, SpectraLarsenGuide> = {
  silicone: {
    kicker: "Why buy our silicone?",
    title: "A premium sanitary seal that matches your grout",
    body: "Choose a coordinated finish instead of settling for basic white. This premium-grade, highly flexible Larsen silicone forms a durable waterproof seal with low dirt pick-up and mould resistance, in colours designed to complement Colourfast 360 grout.",
    paletteTitle: "Choose a matching silicone shade",
    paletteBody:
      "Compare the seven Colourfast 360 silicone colours. Match the sealant to your grout for a clean, coordinated finish, then select the colour above before adding it to your basket.",
    sections: [
      {
        title: "Technical specifications",
        specs: [
          { label: "Product type", value: "Premium sanitary silicone sealant" },
          {
            label: "Classification",
            value: "F-EXT-INT-CC 25LM · G-CC 25LM · S XS1",
          },
          { label: "Movement", value: "Low modulus, highly flexible" },
          { label: "Elastic recovery", value: "Greater than 90%" },
          { label: "Elongation at break", value: "800%" },
          { label: "Skin time", value: "Approximately 7 minutes" },
          { label: "Cure rate", value: "Approximately 2mm per 24 hours" },
          { label: "Joint width", value: "5–30mm" },
          { label: "Minimum joint depth", value: "5mm" },
          { label: "Application temperature", value: "+5°C to +30°C" },
          {
            label: "Temperature resistance",
            value: "−60°C to +180°C after curing",
          },
          { label: "Pack size", value: "300ml cartridge" },
        ],
      },
      {
        title: "Where can I use it?",
        paragraphs: [
          "Designed for sanitary and construction joints around baths, basins, showers, toilets, glass and glazed tile surrounds. Surfaces must be clean, dry, sound and free from grease or dust.",
        ],
      },
      {
        title: "Important application notes",
        paragraphs: [
          "Tool within approximately five minutes and do not over-paint. Larsen does not recommend this product for aquaria, concrete, PE, PP, Teflon, polycarbonate, bituminous or wax-containing surfaces. Some metals and natural stones can be affected, so test suitability first.",
        ],
      },
      DELIVERY_SECTION,
    ],
  },
  grout: {
    kicker: "Why choose Colourfast 360?",
    title: "Smoother joints with consistent colour",
    body: "A professional flexible grout for walls and floors. Its fine texture and Colourfast formulation are designed for uniform, efflorescence-free colour with stain, mould and water resistance.",
    paletteTitle: "Choose the right grout shade",
    paletteBody:
      "Compare the seven Colourfast 360 grout colours. Select your chosen colour using the option above before adding it to your basket.",
    sections: [
      {
        title: "Technical specifications",
        specs: [
          { label: "Product", value: "Larsen Professional Colourfast 360" },
          { label: "Use", value: "Flexible wall and floor grout" },
          { label: "Joint width", value: "1–15mm" },
          { label: "Finish", value: "Fine, smooth and colour consistent" },
          {
            label: "Performance",
            value: "Rapid setting; stain, mould and water resistant",
          },
          { label: "Colour technology", value: "Efflorescence-free formulation" },
          {
            label: "Suitable tiles",
            value: "Ceramic, porcelain, natural stone and glass",
          },
          { label: "Pack size", value: "3kg" },
          {
            label: "Manufacturer example",
            value:
              "Approx. 7.5m² per 3kg using 400 × 400 × 10mm tiles with 5mm joints",
          },
        ],
      },
      {
        title: "Where can I use it?",
        paragraphs: [
          "Suitable for wall and floor joints from 1–15mm with glazed or unglazed ceramic, porcelain, natural stone and glass tiles. Trial a small area first where scratching, staining or exact colour matching may be a concern.",
        ],
      },
      {
        title: "Important application notes",
        paragraphs: [
          "Coverage varies substantially with tile dimensions, thickness and joint width. Use material from the same batch where possible. Always follow Larsen’s mixing, cleaning and curing instructions and do not use below 5°C.",
        ],
      },
      DELIVERY_SECTION,
    ],
  },
  adhesive: {
    kicker: "Simple buying guidance",
    title: "Standard set = more working time",
    body: "Designed for careful installation rather than speed. You get up to five hours of pot life, making it a practical choice for large-format porcelain, detailed layouts and anyone who wants more time to position each tile. Grout after approximately 18 hours.",
    sections: [
      {
        title: "Technical specifications",
        specs: [
          {
            label: "Classification",
            value: "BS EN 12004 C2TE",
          },
          { label: "What C2 means", value: "Improved cementitious adhesive" },
          { label: "What T means", value: "Reduced slip for better grab on walls" },
          { label: "What E means", value: "Extended open time" },
          { label: "Setting type", value: "Standard / slow setting" },
          { label: "Pot life", value: "Up to 5 hours" },
          { label: "Grout after", value: "Approximately 18 hours" },
          { label: "Bed depth", value: "3–12mm" },
          {
            label: "Applications",
            value: "Interior and exterior walls and floors",
          },
          {
            label: "Suitable tiles",
            value: "Porcelain, natural stone and large format",
          },
          { label: "Pack size", value: "20kg" },
          {
            label: "Published coverage",
            value: "Approx. 4m² at a uniform 3mm bed",
          },
          {
            label: "Ordering estimate",
            value: "3m² per bag, plus your selected allowance",
          },
        ],
      },
      {
        title: "Where can I use it?",
        paragraphs: [
          "Suitable for 3–12mm beds on interior or exterior walls and floors, including demanding installations involving large-format tiles. Larsen also lists timber substrates and swimming-pool applications; the substrate must be correctly prepared and the full technical data sheet followed.",
        ],
      },
      {
        title: "Important application notes",
        paragraphs: [
          "Coverage changes with the substrate, trowel, bed depth, tile profile and back-buttering. Our calculator intentionally recommends more than the ideal 3mm-bed figure so customers are less likely to run short. Setting times vary with temperature and site conditions.",
        ],
      },
      DELIVERY_SECTION,
    ],
  },
};

export function getSpectraLarsenGuide(
  kind: SpectraLarsenKind,
  productName?: string | null,
): SpectraLarsenGuide {
  const base = GUIDES_BY_KIND[kind];
  if (kind !== "adhesive" || !productName) return base;
  const specs = [...(base.sections[0]?.specs || [])];
  const withProduct: SpectraLarsenSpecRow[] = [
    { label: "Product", value: String(productName).trim() },
    ...specs.filter((s) => s.label !== "Product"),
  ];
  return {
    ...base,
    sections: [
      { title: "Technical specifications", specs: withProduct },
      ...base.sections.slice(1),
    ],
  };
}
