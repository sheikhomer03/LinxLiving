/** Category intro copy — mirrors Linx Glass `fakroTaxonomy` parent descriptions. */
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "pitched-roof-windows":
    "Explore the diverse range of pitched roof windows. From classic Centre Pivot and versatile Top Hung to advanced Z-Wave (Electric) & Solar and Conservation styles, every choice blends design, function, and style for pitched roof settings.",
  "flat-roof-windows":
    "Discover our assortment of flat roof windows — from non-opening and frameless styles to manual and electric opening, walk-on, dome, and roof access designs. Crafted for performance and contemporary aesthetics.",
  "blinds-accessories":
    "Complete your roof window with FAKRO blinds and essential fitting accessories — blackout, roller and venetian options plus fitters packs and installation materials.",
  "loft-ladders":
    "Unlock easy and safe loft access with FAKRO loft ladders. Choose from wooden, metal, scissor, energy-efficient, fire-resistant, and highly insulated options.",
};

/** Also match by display name (case-insensitive). */
const CATEGORY_DESCRIPTIONS_BY_NAME: Record<string, string> = {
  "pitched roof windows": CATEGORY_DESCRIPTIONS["pitched-roof-windows"],
  "flat roof windows": CATEGORY_DESCRIPTIONS["flat-roof-windows"],
  "blinds & accessories": CATEGORY_DESCRIPTIONS["blinds-accessories"],
  "blinds and accessories": CATEGORY_DESCRIPTIONS["blinds-accessories"],
  "loft ladders": CATEGORY_DESCRIPTIONS["loft-ladders"],
};

export function getCategoryDescription(
  slug?: string | null,
  name?: string | null,
): string | undefined {
  if (slug && CATEGORY_DESCRIPTIONS[slug]) return CATEGORY_DESCRIPTIONS[slug];
  if (name) {
    const key = name.trim().toLowerCase();
    if (CATEGORY_DESCRIPTIONS_BY_NAME[key]) {
      return CATEGORY_DESCRIPTIONS_BY_NAME[key];
    }
  }
  return undefined;
}

/** Department intro copy — shown under the heading on a department's own
    catalogue page (e.g. /category?department=flooring), before any
    category is chosen. */
const DEPARTMENT_DESCRIPTIONS: Record<string, string> = {
  flooring:
    "Laminate, engineered wood, LVT and solid oak flooring for every room — trade-priced, sold by the m², with free samples before you commit.",
  tiles:
    "Porcelain, ceramic and natural stone tiles in every finish, from classic gloss to on-trend encaustic patterns — priced and sold by the m².",
  "wall-panels":
    "Decorative wall panelling and cladding that transforms a room in a weekend, from sleek modern slats to classic tongue and groove.",
  bathrooms:
    "Everything for a complete bathroom fit-out — sanitaryware, showers, taps and tiling, at trade prices.",
  heating:
    "Underfloor heating systems and accessories engineered for every floor type, sized and specified to your project.",
  electrical:
    "Trade-priced electrical fittings and accessories to finish the job properly, from switches to wiring essentials.",
  "rooflights-and-glass":
    "Roof windows, rooflights and glazing solutions from trusted manufacturers, built to bring natural light into any space.",
  accessories:
    "Adhesives, trims, grouts and fixings — the finishing touches every flooring and tiling project needs.",
  "outdoor-living":
    "Porcelain paving, decking and outdoor tiles built to withstand the British weather, styled for modern outdoor spaces.",
  "windows-and-doors":
    "Bi-fold doors, front doors and window systems, made to measure and quoted to your exact specification.",
  lighting:
    "Statement lighting for every room, from designer lamps to functional fittings that finish a space.",
  roofing:
    "Roofing systems and materials built to protect and complete your project, from trusted UK manufacturers.",
};

export function getDepartmentDescription(slug?: string | null): string | undefined {
  if (!slug) return undefined;
  return DEPARTMENT_DESCRIPTIONS[slug];
}
