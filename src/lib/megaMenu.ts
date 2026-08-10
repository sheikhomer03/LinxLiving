/**
 * Curated mega-menu columns.
 *
 * The menu previously built its columns from whatever facets a department
 * happened to carry — Category, Type, Size, Colors, Style, Range, Brands —
 * capped at nine arbitrary entries. That produces up to seven ragged columns
 * of whatever the data contains, which is why the panels read as a data dump
 * rather than a shop.
 *
 * This file is the merchandising layer: 3–5 named columns per department,
 * each a short list of links. A department listed here uses these columns; a
 * department that is not falls back to the old facet behaviour, so nothing
 * breaks while the list is filled in.
 *
 * Every entry points at categories that exist in the catalogue. Nothing here
 * touches product data — these are just links into /category with filters.
 */

export type MegaLink = {
  label: string;
  /** Category slug(s) — comma-separated for a group. */
  category?: string;
  /** Brand slug, when the column is a brand list. */
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
        { label: "Luxury vinyl tile", category: "luxury-vinyl-tile,lvt-flooring" },
        { label: "Laminate", category: "laminate,laminate-flooring" },
        { label: "Vinyl", category: "vinyl" },
        { label: "Wood", category: "wood,wood-flooring" },
        { label: "Parquet", category: "parquet-flooring" },
        { label: "Carpet", category: "carpet" },
      ],
    },
    {
      title: "Wood ranges",
      links: [
        { label: "Engineered wood", category: "engineered-wood-flooring" },
        { label: "Solid wood", category: "solid-wood-flooring" },
        { label: "Herringbone", category: "herringbone-wood-flooring" },
        { label: "Family floor", category: "the-family-floor-engineered-hardwood-flooring" },
        { label: "Trade flooring", category: "trade-flooring" },
      ],
    },
    {
      title: "Mats & rugs",
      links: [
        { label: "Mats & runners", category: "mats-runners" },
        { label: "Rugs", category: "rugs" },
        { label: "Artificial grass", category: "grass" },
      ],
    },
    {
      title: "Tile-effect",
      links: [
        { label: "Floor & wall", category: "floor-and-wall" },
        { label: "MB flooring", category: "mb-flooring" },
      ],
    },
    {
      title: "Shop by brand",
      links: [
        { label: "Likewise Floors", brand: "likewisefloors" },
        { label: "Direct Flooring Online", brand: "direct-flooring-online" },
        { label: "Natura Flooring", brand: "natura-flooring" },
        { label: "Porcelanosa", brand: "porcelanosagrupo" },
        { label: "MB Decor", brand: "mb-decor" },
      ],
    },
  ],

  tiles: [
    {
      title: "Shop by type",
      links: [
        { label: "Floor & wall tiles", category: "floor-and-wall" },
        { label: "Ceramic", category: "ceramic" },
        { label: "Outdoor tiles", category: "outdoor-tiles" },
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
      title: "Speciality",
      links: [
        { label: "Terrazzo", category: "terrazzo" },
        { label: "Encaustic cement", category: "encaustic-cement" },
        { label: "Zellige & Bejmat", category: "zellige-and-bejmat" },
        { label: "Signature collection", category: "signature-collection" },
      ],
    },
    {
      title: "Shop by size",
      links: [{ label: "600 x 600", category: "600x600-tiles" }],
    },
    {
      title: "Shop by brand",
      links: [
        { label: "Porcelanosa", brand: "porcelanosagrupo" },
        { label: "Otto Tiles", brand: "otto-tiles" },
        { label: "Spectra", brand: "spectra" },
      ],
    },
  ],

  bathrooms: [
    {
      title: "Sanitaryware",
      links: [
        { label: "Sanitaryware", category: "sanitaryware" },
        { label: "Basins", category: "basins" },
        { label: "Baths", category: "bathtub" },
        { label: "Shower trays", category: "shower-trays" },
      ],
    },
    {
      title: "Brassware",
      links: [
        { label: "Bathroom taps", category: "bathroom-taps" },
        { label: "Showers", category: "shower" },
        { label: "Kitchen taps", category: "kitchen-taps" },
      ],
    },
    {
      title: "Furniture & storage",
      links: [{ label: "Bathroom furniture", category: "bathroom-furniture" }],
    },
    {
      title: "Bathroom heating",
      links: [{ label: "Underfloor heating", category: "bathrooms" }],
    },
    {
      title: "Shop by brand",
      links: [
        { label: "Noken", brand: "noken" },
        { label: "Porcelanosa", brand: "porcelanosagrupo" },
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
      title: "Bathroom panels",
      links: [
        { label: "Bathroom wall panels", category: "bathrooms" },
        { label: "Shower panels", subcategory: "maxi-shower-panel" },
      ],
    },
    {
      title: "Stone & texture",
      links: [
        { label: "Panel-Stone", category: "panel-stone" },
        { label: "Slat panels", subcategory: "vari-slat" },
      ],
    },
    {
      title: "Ceiling",
      links: [{ label: "Ceiling panels", category: "ceiling-panel" }],
    },
    {
      title: "Shop by brand",
      links: [
        { label: "MB Decor", brand: "mb-decor" },
        { label: "Porcelanosa", brand: "porcelanosagrupo" },
      ],
    },
  ],

  electrical: [
    {
      title: "Lampshades",
      links: [{ label: "All lampshades", category: "lampshades" }],
    },
    {
      title: "Wall & ceiling",
      links: [
        { label: "Wall lights", category: "wall-lights" },
        { label: "Ceiling lights", category: "ceiling-lights" },
      ],
    },
    {
      title: "Table lamps",
      links: [{ label: "All table lamps", category: "table-lamps" }],
    },
    {
      title: "Wiring accessories",
      links: [{ label: "Sockets & switches", category: "sockets-and-switches" }],
    },
    {
      title: "Bathroom",
      links: [{ label: "Bathroom lighting", category: "bathroom" }],
    },
  ],

  "rooflights-and-glass": [
    {
      title: "Roof windows",
      links: [
        { label: "Pitched roof windows", category: "pitched-roof-windows" },
        { label: "Flat roof windows", category: "flat-roof-windows,flat-roof-windows-and-skylights" },
      ],
    },
    {
      title: "Lanterns & tunnels",
      links: [
        { label: "Roof lanterns", category: "roof-lanterns" },
        { label: "Sun tunnels", category: "sun-tunnels" },
      ],
    },
    {
      title: "Access",
      links: [{ label: "Loft ladders", category: "loft-ladders" }],
    },
    {
      title: "Blinds & shutters",
      links: [{ label: "Blinds & shutters", category: "blinds-and-shutters" }],
    },
    {
      title: "Shop by brand",
      links: [{ label: "FAKRO", brand: "fakro" }],
    },
  ],

  accessories: [
    {
      title: "Adhesives & grouts",
      links: [
        { label: "Adhesives & levellers", category: "adhesives-levellers" },
        { label: "Adhesive, grout & silicone", category: "adhesive-grout-silicone" },
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
      ],
    },
    {
      title: "Roof, window & plumbing",
      links: [
        { label: "Flashings", category: "flashings" },
        { label: "Flashing kits", subcategory: "flashing-kits" },
        { label: "Blinds accessories", category: "blinds-accessories" },
        { label: "Plumbing supplies", category: "plumbing" },
      ],
    },
    {
      title: "Bathroom",
      links: [
        { label: "Towel warmers", category: "towel-warmers" },
        { label: "Mirrors", category: "mirror" },
        { label: "Bathroom accessories", category: "accessories" },
      ],
    },
  ],

  heating: [
    {
      title: "Electric underfloor heating",
      links: [
        { label: "Heating mats", subcategory: "underfloor-heating-mats" },
        { label: "Heating cables", subcategory: "underfloor-heating-cables" },
        { label: "In-screed heating", subcategory: "inscreed-heating" },
        { label: "All electric UFH", category: "electric-underfloor-heating" },
      ],
    },
    {
      title: "Water underfloor heating",
      links: [
        { label: "Low profile kits", subcategory: "low-profile-water-underfloor-heating" },
        { label: "Standard output kits", subcategory: "standard-output-water-underfloor-heating" },
        { label: "High output kits", subcategory: "high-output-water-underfloor-heating" },
        { label: "Multi-room kits", subcategory: "multi-room-water-underfloor-heating" },
      ],
    },
    {
      title: "Controls",
      links: [
        { label: "All thermostats", category: "thermostats" },
        { label: "WiFi thermostats", subcategory: "wifi-thermostats" },
        { label: "Programmable", subcategory: "programmable-thermostats" },
        { label: "Smart heating", subcategory: "smart-heating" },
      ],
    },
    {
      title: "Energy efficiency",
      links: [
        { label: "Air source heat pumps", subcategory: "air-source-heat-pumps" },
        { label: "Skirting board heating", subcategory: "skirting-board-heating" },
        { label: "Boilers & cylinders", subcategory: "water-boilers" },
        { label: "Solar & EV", subcategory: "solar-panels" },
      ],
    },
    {
      title: "Trade",
      links: [{ label: "Pallet deals", category: "pallet-deals" }],
    },
  ],

  "windows-and-doors": [
    {
      title: "Windows",
      links: [
        { label: "Windows", category: "windows" },
        { label: "Hinged systems", category: "hinged-window-and-door-systems" },
      ],
    },
    {
      title: "Doors",
      links: [
        { label: "Doors", category: "doors" },
        { label: "Sliding doors", category: "sliding-doors,sliding-window-and-door-systems" },
      ],
    },
    {
      title: "Systems",
      links: [
        { label: "Facade systems", category: "facade-systems" },
        { label: "Curtain wall", category: "curtain-wall" },
      ],
    },
    {
      title: "PVC",
      links: [{ label: "Cortizo PVC", category: "cortizo-pvc" }],
    },
    {
      title: "Other",
      links: [
        { label: "Solar protection", category: "solar-protection" },
        { label: "Balustrading", category: "balustrading-system" },
      ],
    },
  ],

  "outdoor-living": [
    {
      title: "Decking",
      links: [
        { label: "Extruda Deck", category: "mb-outdoor", subcategory: "mb-outdoor" },
        { label: "All decking", category: "mb-outdoor" },
      ],
    },
    {
      title: "Cladding",
      links: [
        { label: "Extruda Clad", category: "mb-outdoor" },
        { label: "Kerrafront External", category: "vox" },
        { label: "Fronto External", category: "vox" },
      ],
    },
    {
      title: "Fencing",
      links: [{ label: "Extruda Fence", category: "mb-outdoor" }],
    },
    {
      title: "Shop by brand",
      links: [{ label: "MB Decor", brand: "mb-decor" }],
    },
  ],

  lighting: [
    {
      title: "Shades",
      links: [{ label: "Lampshades", category: "lampshades" }],
    },
    {
      title: "Wall & ceiling",
      links: [
        { label: "Wall lights", category: "wall-lights" },
        { label: "Ceiling lights", category: "ceiling-lights" },
      ],
    },
    {
      title: "Lamps",
      links: [
        { label: "Table lamps", category: "table-lamps" },
        { label: "Rechargeable", category: "rechargeable-lighting" },
      ],
    },
    {
      title: "Bathroom",
      links: [{ label: "Bathroom lighting", category: "bathroom" }],
    },
    {
      title: "Wiring",
      links: [{ label: "Sockets & switches", category: "sockets-and-switches" }],
    },
  ],

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
