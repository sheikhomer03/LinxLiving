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
      title: "Wood & engineered",
      links: [
        { label: "Engineered wood", category: "engineered-wood-flooring" },
        { label: "Brushed & oiled", subcategory: "brushed-engineered-wood-flooring" },
        { label: "Solid oak", subcategory: "solid-oak-flooring" },
      ],
    },
    {
      title: "Patterns",
      links: [
        { label: "Herringbone", subcategory: "herringbone-parquet-flooring,herringbone-engineered-wood-flooring" },
        { label: "Chevron", subcategory: "chevron-parquet-flooring" },
        { label: "Basket weave", subcategory: "basket-weave-flooring" },
        { label: "Bedroom parquet", subcategory: "bedroom-parquet-flooring" },
      ],
    },
    {
      title: "Shop by thickness",
      links: [
        { label: "8mm laminate", subcategory: "8mm-laminate-flooring" },
        { label: "10mm laminate", subcategory: "10mm-laminate-flooring" },
        { label: "12mm laminate", subcategory: "12mm-laminate-flooring" },
        { label: "14mm wood", subcategory: "14mm-wood-flooring" },
        { label: "18mm wood", subcategory: "18mm-wood-flooring" },
        { label: "20mm wood", subcategory: "20mm-wood-flooring" },
      ],
    },
    {
      title: "Collections",
      links: [
        { label: "Conservatory LVT", subcategory: "conservatory-lvt-flooring" },
        { label: "Inspired Living", subcategory: "inspired-living-collection" },
        { label: "Simply Stunning", subcategory: "simply-stunning-collection" },
        { label: "Floorward", subcategory: "floorward-collection" },
        { label: "Coretec", subcategory: "coretec-collection" },
        { label: "Hydro-Lock", subcategory: "hydro-lock-collection" },
      ],
    },
  ],

  tiles: [
    {
      title: "Shop by type",
      links: [
        { label: "Signature collection", category: "signature-collection" },
        { label: "Terrazzo", category: "terrazzo" },
        { label: "Encaustic cement", category: "encaustic-cement" },
        { label: "Zellige & bejmat", category: "zellige-and-bejmat" },
        { label: "Floor & wall tiles", category: "floor-and-wall" },
        { label: "Ceramic", category: "ceramic" },
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
      title: "Shop by size",
      links: [
        { label: "30 x 60 cm", category: "300x600-tiles" },
        { label: "60 x 60 cm", category: "600x600-tiles" },
        { label: "60 x 120 cm", category: "600x1200-tiles" },
      ],
    },
    {
      title: "Patterns & looks",
      links: [
        { label: "Plain", subcategory: "plain" },
        { label: "Patterned", subcategory: "patterned" },
        { label: "Marble", subcategory: "marble" },
        { label: "Cement", subcategory: "cement" },
        { label: "Terrena", subcategory: "terrena" },
        { label: "Mosaics & decorations", subcategory: "mosaics-and-decorations" },
      ],
    },
    {
      title: "Shop by room",
      links: [
        { label: "Bathroom tiles", category: "bathrooms" },
        { label: "Ceramic tiles", subcategory: "ceramic-tiles" },
      ],
    },
  ],

  "wall-panels": [
    {
      title: "Bathroom & shower",
      links: [
        { label: "Maxi shower panels", subcategory: "maxi-shower-panel" },
        { label: "Bathroom wall panels", subcategory: "bathroom-wall-panels" },
      ],
    },
    {
      title: "Decorative finishes",
      links: [
        { label: "Mineral", subcategory: "elegance-mineral" },
        { label: "Abstract", subcategory: "elegance-abstract" },
        { label: "Hardex", subcategory: "hardex-panels" },
        { label: "Tradeline", subcategory: "tradeline" },
        { label: "Elite", subcategory: "elite" },
      ],
    },
    {
      title: "Tile & stone effect",
      links: [
        { label: "Ultimo tile", subcategory: "elegance-ultimo-tile" },
        { label: "Contempo tile", subcategory: "elegance-contempo-tile" },
        { label: "Mineral tile", subcategory: "elegance-mineral-tile" },
        { label: "Stone effect", category: "panel-stone" },
      ],
    },
    {
      title: "Slat & texture",
      links: [
        { label: "Vari-Slat", subcategory: "vari-slat" },
        { label: "Vari-Wave", subcategory: "vari-wave" },
        { label: "Thermo-Slat", subcategory: "thermo-slat" },
        { label: "Create-a-Slat", subcategory: "create-a-slat" },
      ],
    },
    {
      title: "Ceiling & cladding",
      links: [
        { label: "Ceiling panels", category: "ceiling-panel" },
        { label: "Classic", subcategory: "classic" },
        { label: "Woodgrain", subcategory: "elegance-woodgrain" },
        { label: "Damask", subcategory: "elegance-damask" },
      ],
    },
  ],

  bathrooms: [
    {
      title: "Baths",
      links: [
        { label: "Baths", category: "bathtub" },
        { label: "Bathtubs", subcategory: "bathtubs" },
        { label: "Freestanding baths", subcategory: "free-standing" },
      ],
    },
    {
      title: "Showering",
      links: [
        { label: "Showers", category: "shower" },
        { label: "Shower trays", subcategory: "shower-trays" },
        { label: "Shower enclosures", subcategory: "shower-enclosures" },
        { label: "Shower packs", subcategory: "shower-packs" },
        { label: "Shower heads", subcategory: "shower-heads" },
      ],
    },
    {
      title: "Toilets",
      links: [
        { label: "Toilets", subcategory: "toilets" },
        { label: "Wall hung", subcategory: "wall-hung" },
        { label: "Bidets", subcategory: "bidet" },
        { label: "Recessed", subcategory: "recessed" },
      ],
    },
    {
      title: "Basins",
      links: [
        { label: "Basins", category: "basins" },
        { label: "Washbasins & worktops", subcategory: "washbasins-and-worktops" },
        { label: "Semi-pedestal", subcategory: "semi-pedestal" },
        { label: "Sanitaryware", category: "sanitaryware" },
      ],
    },
    {
      title: "Furniture & mirrors",
      links: [
        { label: "Bathroom furniture", category: "bathroom-furniture" },
        { label: "Mirrors", subcategory: "mirrors" },
        { label: "Floor standing", subcategory: "floor-standing" },
      ],
    },
    {
      title: "Taps",
      links: [
        { label: "Bathroom taps", category: "bathroom-taps" },
        { label: "Kitchen taps", category: "kitchen-taps" },
      ],
    },
  ],

  heating: [
    {
      title: "Electric underfloor heating",
      links: [
        { label: "All electric UFH", category: "electric-underfloor-heating" },
        { label: "Heating cables", subcategory: "underfloor-heating-cables" },
      ],
    },
    {
      title: "Water underfloor heating",
      links: [
        { label: "All water UFH", category: "water-underfloor-heating" },
        { label: "Low profile kits", subcategory: "low-profile-water-underfloor-heating" },
        { label: "Standard output kits", subcategory: "standard-output-water-underfloor-heating" },
        { label: "High output kits", subcategory: "high-output-water-underfloor-heating" },
        { label: "Multi-room kits", subcategory: "multi-room-water-underfloor-heating" },
      ],
    },
    {
      title: "Thermostats & controls",
      links: [
        { label: "All thermostats", category: "thermostats" },
        { label: "WiFi thermostats", subcategory: "wifi-thermostats" },
        { label: "Programmable", subcategory: "programmable-thermostats" },
        { label: "Touchscreen", subcategory: "touchscreen-thermostats" },
        { label: "Manual", subcategory: "manual-thermostats" },
      ],
    },
    {
      title: "Energy efficiency",
      links: [
        { label: "All energy efficiency", category: "energy-efficiency" },
        { label: "Air source heat pumps", subcategory: "air-source-heat-pumps" },
        { label: "Skirting board heating", subcategory: "skirting-board-heating" },
        { label: "Water boilers", subcategory: "water-boilers" },
        { label: "Hot water cylinders", subcategory: "hot-water-cylinders" },
        { label: "EV chargers", subcategory: "ev-chargers" },
      ],
    },
  ],

  lighting: [
    {
      title: "Lampshades",
      links: [
        { label: "All lampshades", category: "lampshades" },
        { label: "Empire", subcategory: "empire" },
        { label: "Drum", subcategory: "drum" },
        { label: "Gathered", subcategory: "gathered" },
      ],
    },
    {
      title: "Wall & ceiling",
      links: [
        { label: "Wall lights", category: "wall-lights" },
        { label: "Ceiling lights", category: "ceiling-lights" },
        { label: "Pendants", subcategory: "pendants" },
      ],
    },
    {
      title: "Table lamps",
      links: [
        { label: "All table lamps", category: "table-lamps" },
        { label: "Bedside", subcategory: "bedside" },
        { label: "Colourful", subcategory: "colourful" },
        { label: "Wooden", subcategory: "wooden" },
      ],
    },
    {
      title: "Switches & sockets",
      links: [
        { label: "Switches & sockets", category: "sockets-and-switches" },
      ],
    },
    {
      title: "Bathroom",
      links: [{ label: "Bathroom lighting", category: "bathroom" }],
    },
  ],

  electrical: [
    {
      title: "Lampshades",
      links: [
        { label: "All lampshades", category: "lampshades" },
        { label: "Empire", subcategory: "empire" },
        { label: "Drum", subcategory: "drum" },
        { label: "Gathered", subcategory: "gathered" },
      ],
    },
    {
      title: "Wall & ceiling",
      links: [
        { label: "Wall lights", category: "wall-lights" },
        { label: "Ceiling lights", category: "ceiling-lights" },
        { label: "Pendants", subcategory: "pendants" },
        { label: "Designer lighting", category: "home-lighting" },
      ],
    },
    {
      title: "Table lamps",
      links: [
        { label: "All table lamps", category: "table-lamps" },
        { label: "Bedside", subcategory: "bedside" },
        { label: "Wooden", subcategory: "wooden" },
        { label: "Colourful", subcategory: "colourful" },
      ],
    },
    {
      title: "Switches & sockets",
      links: [
        {
          label: "Switches & sockets",
          category: "sockets-and-switches,light-switches-sockets",
        },
        { label: "Brass", subcategory: "brass-switches-sockets" },
        { label: "Antique brass", subcategory: "antique-brass-switches-sockets" },
        { label: "Other switches", subcategory: "other-switches-uk" },
      ],
    },
  ],

  "rooflights-and-glass": [
    {
      title: "Pitched roof windows",
      links: [
        { label: "All pitched", category: "pitched-roof-windows" },
        { label: "Centre pivot", subcategory: "centre-pivot" },
        { label: "Top hung", subcategory: "top-hung" },
        { label: "High pivot", subcategory: "high-pivot" },
        { label: "Conservation", subcategory: "conservation" },
        { label: "Balcony", subcategory: "balcony" },
      ],
    },
    {
      title: "Flat roof windows",
      links: [
        { label: "All flat roof", category: "flat-roof-windows" },
        { label: "Dome", subcategory: "dome" },
        { label: "Fixed frameless", subcategory: "fixed-frameless" },
        { label: "Manual opening", subcategory: "manual-opening" },
        { label: "Electric opening", subcategory: "electric-opening" },
        { label: "Walk-on", subcategory: "walk-on" },
      ],
    },
    {
      title: "Lanterns & tunnels",
      links: [
        { label: "Roof lanterns", category: "roof-lanterns" },
        { label: "Sun tunnels", category: "sun-tunnels" },
        { label: "Light tunnels", subcategory: "light-tunnels" },
        { label: "Style A", subcategory: "style-a" },
        { label: "Style B", subcategory: "style-b" },
      ],
    },
    {
      title: "Loft & roof access",
      links: [
        { label: "Loft ladders", category: "loft-ladders" },
        { label: "Wooden loft ladders", subcategory: "wooden" },
        { label: "Roof access", subcategory: "roof-access" },
      ],
    },
    {
      title: "Blinds & powered",
      links: [
        { label: "Blinds & shutters", category: "blinds-and-shutters" },
        { label: "Electric & solar", subcategory: "electric-solar" },
        { label: "L-shape combination", subcategory: "l-shape-combination" },
        { label: "Windows & doors", category: "windows-and-doors" },
      ],
    },
  ],

  accessories: [
    {
      title: "Adhesives & grouts",
      links: [
        {
          label: "Adhesives, grout & silicone",
          category: "adhesives-levellers,adhesive-grout-silicone",
        },
        { label: "Tile adhesive", subcategory: "tile-adhesive" },
        { label: "Floor primer", subcategory: "floor-primer" },
        { label: "Self-levelling compound", subcategory: "self-levelling-compound" },
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
        { label: "Door trims", subcategory: "door-trims" },
      ],
    },
    {
      title: "Fitting & fixings",
      links: [
        { label: "Insulation & fixings", category: "insulation-fixings" },
        { label: "Fitting accessories", subcategory: "fitting-accessories" },
        { label: "Couplings", subcategory: "couplings" },
        { label: "UFH fixing systems", subcategory: "water-underfloor-heating-fixing-systems" },
        { label: "Insulation boards", subcategory: "insulation-boards" },
      ],
    },
    {
      title: "Cabinet hardware",
      links: [
        { label: "All cabinet hardware", category: "all-cabinet-hardware" },
        { label: "Knobs", subcategory: "knobs" },
        { label: "Handles", subcategory: "handles" },
        { label: "Living room hardware", subcategory: "living-room-hardware" },
        { label: "Bathroom hardware", subcategory: "bathroom-hardware" },
      ],
    },
    {
      title: "Plumbing",
      links: [
        { label: "All plumbing", category: "plumbing" },
        { label: "Plastic pipe fittings", subcategory: "plastic-connectors-fittings" },
        { label: "Copper & brass fittings", subcategory: "copper-brass-pipe-fittings" },
        { label: "UFH pipes", subcategory: "underfloor-heating-pipes" },
      ],
    },
    {
      title: "Roof & window",
      links: [
        { label: "Blinds & accessories", category: "blinds-accessories" },
        { label: "Flashings", category: "flashings" },
        { label: "Flashing kits", subcategory: "flashing-kits" },
        { label: "Window electricals", subcategory: "electricals" },
      ],
    },
  ],

  // Britmet is the only roofing brand. Flat-to-pitch, door canopies and
  // structural trays are dropped: the products exist but none carry a price,
  // so the storefront filters them out and the links led nowhere.
  // 23 sellable products, so the columns are shallow by nature — but they are
  // product types, not the supplier names the facet fallback was showing
  // ("Linx Square" three times over).
  "outdoor-living": [
    {
      title: "Pergolas",
      links: [
        { label: "All pergolas", category: "pergola" },
        { label: "Motorised", subcategory: "motorized-palora-p6,motorized-palora-p4" },
        { label: "Manual", subcategory: "manual-palora-p6,manual-palora-p4" },
      ],
    },
    {
      title: "Awnings & blinds",
      links: [{ label: "All awnings", category: "awning" }],
    },
    {
      title: "Decking",
      links: [{ label: "Composite decking", subcategory: "decking" }],
    },
    {
      title: "Fencing",
      links: [{ label: "Fencing", subcategory: "fencing" }],
    },
    {
      title: "Cladding",
      links: [{ label: "Outdoor cladding", subcategory: "cladding" }],
    },
  ],

  roofing: [
    {
      title: "Roofing systems",
      links: [
        { label: "Lightweight roofing", category: "lightweight-roofing" },
      ],
    },
    {
      title: "Finishes",
      links: [{ label: "Paint", category: "paint" }],
    },
  ],
};

/** Curated columns for a department, or null to use the facet fallback. */
export function megaColumnsFor(slug?: string | null): MegaColumn[] | null {
  if (!slug) return null;
  return MEGA_MENU[slug] || null;
}
