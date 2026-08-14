/**
 * Curated mega-menu columns.
 *
 * The menu used to build its columns from whatever facets a department
 * happened to carry — Category, Type, Size, Colors, Style, Range, Brands —
 * capped at nine arbitrary entries. That produced up to seven ragged columns
 * of whatever the data contained, which is why the panels read as a data dump
 * rather than a shop, and why accessories kept reappearing under product
 * departments after being moved.
 *
 * This file is the merchandising layer: 4–5 named columns per department,
 * covering every category that has stock behind it. A department listed here
 * uses these columns; one that is not falls back to the old facet behaviour.
 *
 * Two rules worth keeping to when editing:
 *
 *  - Every link must point at a category or subcategory that has priced
 *    products. A link to an empty filter opens a "no products found" page,
 *    which is worse than not offering the link at all.
 *  - Columns group by what the thing IS, not who made it. Brand columns were
 *    removed deliberately — someone looking for herringbone flooring does not
 *    know, or care, that it is a Natura line.
 *
 * Nothing here touches product data — these are links into /category.
 */

export type MegaLink = {
  label: string;
  /** Category slug(s) — comma-separated for a group. */
  category?: string;
  /** Brand slug, when a column genuinely needs one. */
  brand?: string;
  /** Sub-category slug. */
  subcategory?: string;
};

export type MegaColumn = {
  title: string;
  links: MegaLink[];
};

/** Department slug → its columns. Order is the display order. */
export const MEGA_MENU: Record<string, MegaColumn[]> = {
  flooring: [
    {
      title: "Shop by type",
      links: [
        { label: "LVT", category: "luxury-vinyl-tile,lvt-flooring" },
        { label: "Vinyl", category: "vinyl" },
        { label: "Laminate", category: "laminate,laminate-flooring" },
        { label: "Wood", category: "wood,wood-flooring" },
        { label: "Parquet", category: "parquet-flooring" },
      ],
    },
    {
      title: "Wood ranges",
      links: [
        { label: "Engineered wood", category: "engineered-wood-flooring" },
        { label: "Solid oak", category: "solid-wood-flooring" },
        { label: "Herringbone", category: "herringbone-wood-flooring" },
        { label: "Chevron parquet", subcategory: "chevron-parquet-flooring" },
        {
          label: "The Family Floor",
          category: "the-family-floor-engineered-hardwood-flooring",
        },
      ],
    },
    {
      title: "Shop by thickness",
      links: [
        { label: "8mm laminate", subcategory: "8mm-laminate-flooring" },
        { label: "10mm laminate", subcategory: "10mm-laminate-flooring" },
        { label: "12mm laminate", subcategory: "12mm-laminate-flooring" },
        { label: "14mm wood", subcategory: "14mm-wood-flooring" },
        { label: "20mm wood", subcategory: "20mm-wood-flooring" },
      ],
    },
    {
      title: "Popular collections",
      links: [
        { label: "Conservatory LVT", subcategory: "conservatory-lvt-flooring" },
        { label: "Inspired Living", subcategory: "inspired-living-collection" },
        { label: "Simply Stunning", subcategory: "simply-stunning-collection" },
        { label: "Coretec", subcategory: "coretec-collection" },
        { label: "Palio Karndean", subcategory: "palio-karndean-collection" },
      ],
    },
    {
      title: "Tile-effect",
      links: [
        // { label: "Floor & wall", category: "floor-and-wall" },
        { label: "MB flooring", category: "mb-flooring" },
        { label: "Cotswold", subcategory: "cotswold" },
      ],
    },
  ],

  tiles: [
    {
      title: "Shop by type",
      links: [
        { label: "Porcelain Tiles", category: "ceramic" },
        { label: "Floor & wall tiles", category: "floor-and-wall" },
        { label: "Terrazzo", category: "terrazzo" },
        { label: "Encaustic cement", category: "encaustic-cement" },
        // { label: "Zellige & Bejmat", category: "zellige-and-bejmat" },
      ],
    },
    {
      title: "Shop by finish",
      links: [
        { label: "Gloss", category: "gloss" },
        { label: "High gloss", category: "high-gloss" },
        { label: "Matt", category: "matt" },
        { label: "Matt carving", category: "matt-carving" },
      ],
    },
    {
      title: "Signature collection",
      links: [
        { label: "Zellige", subcategory: "zellige" },
        { label: "Marble", subcategory: "marble" },
        { label: "Cement", subcategory: "cement" },
        { label: "Porcelain Tiles", subcategory: "ceramic" },
        { label: "All signature", category: "signature-collection" },
      ],
    },
    {
      title: "Patterns & mosaics",
      links: [
        { label: "Patterned", subcategory: "patterned" },
        { label: "Plain", subcategory: "plain" },
        { label: "Mosaics & decorations", subcategory: "mosaics-and-decorations" },
        { label: "Terrena", subcategory: "terrena" },
      ],
    },
    {
      title: "Size & use",
      links: [
        { label: "600 x 600", category: "600x600-tiles" },
        { label: "Outdoor tiles", category: "outdoor-tiles" },
        { label: "Ceramic tiles", subcategory: "ceramic-tiles" },
        { label: "Bathroom & mosaic tiles", subcategory: "tiles" },
      ],
    },
  ],

  "wall-panels": [
    {
      title: "Shop by range",
      links: [
        { label: "Decorwall", category: "decorwall" },
        { label: "Vox", category: "vox" },
        { label: "Dumaplast", category: "dumaplast" },
        { label: "Vilo", category: "vilo" },
      ],
    },
    {
      title: "Decorwall finishes",
      links: [
        { label: "Elegance Mineral", subcategory: "elegance-mineral" },
        { label: "Elegance Ultimo Tile", subcategory: "elegance-ultimo-tile" },
        { label: "Hardex panels", subcategory: "hardex-panels" },
        { label: "Tradeline", subcategory: "tradeline" },
        { label: "Elite", subcategory: "elite" },
      ],
    },
    {
      title: "Bathroom & shower",
      links: [
        { label: "Bathroom wall panels", subcategory: "bathroom-wall-panels" },
        { label: "Maxi shower panels", subcategory: "maxi-shower-panel" },
      ],
    },
    {
      title: "Texture & slat",
      links: [
        { label: "Panel-Stone", category: "panel-stone" },
        { label: "Vari-Slat", subcategory: "vari-slat" },
        { label: "Thermo-Slat", subcategory: "thermo-slat" },
        { label: "Create-a-Slat", subcategory: "create-a-slat" },
      ],
    },
    {
      title: "Ceiling & cladding",
      links: [
        { label: "Ceiling panels", category: "ceiling-panel" },
        { label: "Claddings", category: "claddings" },
      ],
    },
  ],

  bathrooms: [
    {
      title: "Showering",
      links: [
        { label: "Shower trays", subcategory: "shower-trays" },
        { label: "Wetroom shower screens", subcategory: "wetroom-shower-screens" },
        { label: "Shower columns", subcategory: "shower-columns" },
      ],
    },
    {
      title: "Brassware",
      links: [{ label: "Bathroom taps", subcategory: "bathroom-taps" }],
    },
    {
      title: "Furniture",
      links: [{ label: "Compact furniture", subcategory: "compact-furniture" }],
    },
    {
      title: "All bathrooms",
      links: [{ label: "Shop everything", category: "bathrooms" }],
    },
  ],

  heating: [
    {
      title: "Electric underfloor heating",
      links: [
        { label: "Heating cables", subcategory: "underfloor-heating-cables" },
        { label: "Heating mats", subcategory: "underfloor-heating-mats" },
        { label: "In-screed heating", subcategory: "inscreed-heating" },
        { label: "All electric UFH", category: "electric-underfloor-heating" },
      ],
    },
    {
      title: "Water underfloor heating",
      links: [
        {
          label: "Low profile kits",
          subcategory: "low-profile-water-underfloor-heating",
        },
        {
          label: "Standard output kits",
          subcategory: "standard-output-water-underfloor-heating",
        },
        {
          label: "High output kits",
          subcategory: "high-output-water-underfloor-heating",
        },
        {
          label: "Multi-room kits",
          subcategory: "multi-room-water-underfloor-heating",
        },
      ],
    },
    {
      title: "Thermostats & controls",
      links: [
        { label: "WiFi thermostats", subcategory: "wifi-thermostats" },
        { label: "Programmable", subcategory: "programmable-thermostats" },
        { label: "Touchscreen", subcategory: "touchscreen-thermostats" },
        { label: "Smart heating", subcategory: "smart-heating" },
        { label: "All thermostats", category: "thermostats" },
      ],
    },
    {
      title: "Energy efficiency",
      links: [
        { label: "Air source heat pumps", subcategory: "air-source-heat-pumps" },
        { label: "Skirting board heating", subcategory: "skirting-board-heating" },
        { label: "Water boilers", subcategory: "water-boilers" },
        { label: "Hot water cylinders", subcategory: "hot-water-cylinders" },
        { label: "EV chargers", subcategory: "ev-chargers" },
      ],
    },
    {
      title: "Trade",
      links: [{ label: "Pallet deals", category: "pallet-deals" }],
    },
  ],

  "rooflights-and-glass": [
    {
      title: "Pitched roof windows",
      links: [
        { label: "Centre pivot", subcategory: "centre-pivot" },
        { label: "Top hung", subcategory: "top-hung" },
        { label: "High pivot", subcategory: "high-pivot" },
        { label: "Conservation", subcategory: "conservation" },
        { label: "All pitched", category: "pitched-roof-windows" },
      ],
    },
    {
      title: "Flat roof windows",
      links: [
        { label: "Dome", subcategory: "dome" },
        { label: "Fixed frameless", subcategory: "fixed-frameless" },
        { label: "Manual opening", subcategory: "manual-opening" },
        { label: "Electric opening", subcategory: "electric-opening" },
        { label: "Walk-on", subcategory: "walk-on" },
        { label: "Skylights", brand: "cambridge-skylights" },
      ],
    },
    {
      title: "Lanterns & tunnels",
      links: [
        { label: "Roof lanterns", category: "roof-lanterns" },
        { label: "Style A", subcategory: "style-a" },
        { label: "Style B", subcategory: "style-b" },
        // { label: "Sun tunnels", category: "sun-tunnels" },
      ],
    },
    {
      title: "Loft access",
      links: [
        { label: "Wooden loft ladders", subcategory: "wooden" },
        { label: "Metal loft ladders", subcategory: "metal" },
        { label: "Scissor loft ladders", subcategory: "scissor" },
        { label: "Roof access", subcategory: "roof-access" },
      ],
    },
    {
      title: "Powered",
      links: [
        { label: "Electric & solar", subcategory: "electric-solar" },
        { label: "L-shape combination", subcategory: "l-shape-combination" },
      ],
    },
  ],

  "windows-and-doors": [
    {
      title: "Windows",
      links: [
        { label: "All windows", category: "windows" },
        { label: "Hinged systems", category: "hinged-window-and-door-systems" },
        { label: "Sliding systems", category: "sliding-window-and-door-systems" },
      ],
    },
    {
      title: "Doors",
      links: [
        { label: "All doors", category: "doors" },
        { label: "Sliding doors", category: "sliding-doors" },
        { label: "Bi-fold doors", category: "bi-fold-doors" },
        { label: "Front doors", category: "front-doors" },
        { label: "Internal doors & screens", category: "internal-doors-screens" },
      ],
    },
    {
      title: "Facade systems",
      links: [
        { label: "Facade systems", category: "facade-systems" },
        { label: "Curtain wall", category: "curtain-wall" },
        { label: "Interior divisions", category: "interior-divisions" },
        { label: "Balustrading", category: "balustrading-system" },
      ],
    },
    {
      title: "PVC & finishes",
      links: [
        { label: "Cortizo PVC", category: "cortizo-pvc" },
        { label: "Finishes", category: "finishes" },
      ],
    },
    {
      title: "Protection",
      links: [
        { label: "Solar protection", category: "solar-protection" },
        { label: "Smoke & fire protection", category: "smoke-and-fire-protection" },
      ],
    },
  ],

  lighting: [
    {
      title: "Lampshades",
      links: [
        { label: "Empire", subcategory: "empire" },
        { label: "Drum", subcategory: "drum" },
        { label: "Gathered", subcategory: "gathered" },
        { label: "All lampshades", category: "lampshades" },
      ],
    },
    {
      title: "Table lamps",
      links: [
        { label: "Bedside", subcategory: "bedside" },
        { label: "Colourful", subcategory: "colourful" },
        { label: "Wooden", subcategory: "wooden" },
        { label: "All table lamps", category: "table-lamps" },
      ],
    },
    {
      title: "Wall & ceiling",
      links: [
        { label: "Wall lights", category: "wall-lights" },
        { label: "Pendants", subcategory: "pendants" },
        { label: "All ceiling lights", category: "ceiling-lights" },
      ],
    },
    {
      title: "Bathroom & rechargeable",
      links: [
        { label: "Bathroom lighting", category: "bathroom" },
        { label: "Rechargeable", category: "rechargeable-lighting" },
      ],
    },
    {
      title: "Wiring",
      links: [{ label: "Sockets & switches", category: "sockets-and-switches" }],
    },
  ],

  electrical: [
    {
      title: "Lampshades",
      links: [
        { label: "Empire", subcategory: "empire" },
        { label: "Drum", subcategory: "drum" },
        { label: "Gathered", subcategory: "gathered" },
        { label: "All lampshades", category: "lampshades" },
      ],
    },
    {
      title: "Table lamps",
      links: [
        { label: "Bedside", subcategory: "bedside" },
        { label: "Colourful", subcategory: "colourful" },
        { label: "All table lamps", category: "table-lamps" },
      ],
    },
    {
      title: "Wall & ceiling",
      links: [
        { label: "Wall lights", category: "wall-lights" },
        { label: "Pendants", subcategory: "pendants" },
        { label: "All ceiling lights", category: "ceiling-lights" },
        { label: "Designer lighting", category: "home-lighting" },
      ],
    },
    {
      title: "Wiring accessories",
      links: [
        { label: "Sockets & switches", category: "sockets-and-switches" },
        { label: "Light switches & sockets", category: "light-switches-sockets" },
      ],
    },
    {
      title: "Bathroom",
      links: [{ label: "Bathroom lighting", category: "bathroom" }],
    },
  ],

  accessories: [
    {
      title: "Adhesives & grouts",
      links: [
        { label: "Adhesives & levellers", category: "adhesives-levellers" },
        { label: "Adhesive, grout & silicone", category: "adhesive-grout-silicone" },
        { label: "Shop by finish", category: "shop-by-finish" },
      ],
    },
    {
      title: "Trims & profiles",
      links: [
        { label: "External trims", subcategory: "external-trims" },
        { label: "Metal trims", subcategory: "metal-trims" },
        { label: "Skirting board", subcategory: "skirting-board" },
        { label: "PVC window sills", subcategory: "pvc-window-sill" },
        { label: "Pipe covers", subcategory: "pipe-covers" },
      ],
    },
    {
      title: "Fitting & fixings",
      links: [
        { label: "Fitting accessories", subcategory: "fitting-accessories" },
        { label: "Insulation & fixings", category: "insulation-fixings" },
        { label: "UFH pipes", subcategory: "underfloor-heating-pipes" },
        { label: "Manifolds", subcategory: "underfloor-heating-manifolds" },
        { label: "Couplings & actuators", subcategory: "couplings" },
        { label: "Knobs & handles", category: "all-cabinet-hardware" },
        { label: "Hooks & accessories", category: "hooks-accessories" },
        
      ],
    },
    {
      title: "Roof & window",
      links: [
        // { label: "Flashings", category: "flashings" },
        { label: "Flashing kits", subcategory: "flashing-kits" },
        { label: "Blinds", subcategory: "blinds" },
        { label: "Blinds accessories", category: "blinds-accessories" },
      ],
    },
    {
      title: "Plumbing & bathroom",
      links: [
        {
          label: "Plastic pipe fittings",
          subcategory: "plastic-connectors-fittings",
        },
        {
          label: "Copper & brass fittings",
          subcategory: "copper-brass-pipe-fittings",
        },
        // { label: "Towel warmers", category: "towel-warmers" },
        // { label: "Mirrors", category: "mirror" },
        { label: "Kitchen taps", category: "kitchen-mixer-taps" },
      ],
    },
  ],

  "outdoor-living": [
    {
      title: "Decking",
      links: [
        { label: "Extruda Deck", category: "mb-outdoor", subcategory: "decking" },
      ],
    },
    {
      title: "Cladding",
      links: [
        { label: "Extruda Clad", category: "mb-outdoor", subcategory: "cladding" },
        // { label: "Kerrafront External", category: "vox" },
      ],
    },
    {
      title: "Fencing",
      links: [
        { label: "Extruda Fence", category: "mb-outdoor", subcategory: "fencing" },
      ],
    },
    {
      title: "Composite range",
      links: [{ label: "Shop all outdoor", category: "mb-outdoor" }],
    },
  ],

  // Britmet is the only roofing brand and is currently hidden from the
  // storefront, so this tab does not render. Kept so it works if Britmet is
  // unhidden — every link below is Britmet stock.
  roofing: [
    {
      title: "Roofing systems",
      links: [
        { label: "Lightweight roofing", category: "lightweight-roofing" },
        { label: "Flat to pitch", category: "flat-to-pitch-solutions" },
      ],
    },
    {
      title: "Canopies",
      links: [{ label: "Door canopies", category: "door-canopies" }],
    },
    {
      title: "Finishes",
      links: [{ label: "Paint", category: "paint" }],
    },
    {
      title: "Structural",
      links: [{ label: "Structural trays", category: "structural-trays" }],
    },
  ],
};

/** Curated columns for a department, or null to use the facet fallback. */
export function megaColumnsFor(slug?: string | null): MegaColumn[] | null {
  if (!slug) return null;
  return MEGA_MENU[slug] || null;
}
