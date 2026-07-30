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
