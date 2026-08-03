/**
 * LINX catalogue taxonomy helpers.
 * Hierarchy: Department → Category → Subcategory → Products
 * Brands are independent and cross-cut the tree.
 */

export const LINX_DEPARTMENTS = [
  { name: "Windows & Doors", slug: "windows-and-doors" },
  { name: "Rooflights & Glass", slug: "rooflights-and-glass" },
  { name: "Outdoor Living", slug: "outdoor-living" },
  { name: "Kitchens", slug: "kitchens" },
  { name: "Bathrooms", slug: "bathrooms" },
  { name: "Flooring", slug: "flooring" },
  { name: "Furniture", slug: "furniture" },
  { name: "Lighting", slug: "lighting" },
  { name: "Renewable Energy", slug: "renewable-energy" },
  { name: "Building Materials", slug: "building-materials" },
  { name: "Plumbing", slug: "plumbing" },
  { name: "Electrical", slug: "electrical" },
  { name: "Ventilation", slug: "ventilation" },
  { name: "Tools & Workwear", slug: "tools-and-workwear" },
  { name: "Ironmongery & Hardware", slug: "ironmongery-and-hardware" },
  { name: "Smart Home & Security", slug: "smart-home-and-security" },
  { name: "Garden & Landscaping", slug: "garden-and-landscaping" },
  { name: "Drainage", slug: "drainage" },
  { name: "Heating & Cooling", slug: "heating-and-cooling" },
  { name: "Paint & Decorating", slug: "paint-and-decorating" },
] as const;

/**
 * Match a keyword only as a whole word.
 *
 * Bare substring tests silently misclassify: /door/ matches "outdoor", so
 * outdoor paving landed in Windows & Doors. Same trap for light/skylight,
 * heat/sheathing, tool/stool, table/portable. Slugs are hyphenated, so the
 * boundary set has to treat "-" as a separator too.
 */
function hasWord(haystack: string, pattern: string) {
  return new RegExp(`(^|[^a-z0-9])(${pattern})([^a-z0-9]|$)`, "i").test(
    haystack,
  );
}

/** Heuristic mapping from existing brand/category signals → department slug */
export function inferDepartmentSlug(input: {
  brandSlug?: string | null;
  categorySlug?: string | null;
  categoryName?: string | null;
}): string {
  const brand = (input.brandSlug || "").toLowerCase();
  const cat = `${input.categorySlug || ""} ${input.categoryName || ""}`.toLowerCase();

  if (
    hasWord(brand + " " + cat, "fakro|velux|keylite|sterling|rooflights?|skylights?|sun.?tunnels?|flashings?|blinds?")
  ) {
    return "rooflights-and-glass";
  }
  if (hasWord(brand + " " + cat, "noken|bathrooms?|sanitary|showers?|basins?|toilets?|taps?")) {
    return "bathrooms";
  }
  if (
    hasWord(brand + " " + cat, "porcelanosa|tiles?|ceramics?|floors?|flooring|likewise|laminate|vinyl|carpets?|lvt|wood")
  ) {
    if (hasWord(cat, "kitchens?")) return "kitchens";
    if (hasWord(cat, "bath|bathrooms?")) return "bathrooms";
    if (
      hasWord(cat, "floors?|flooring|carpets?|vinyl|laminate|lvt|wood|grass|rugs?|mats?") ||
      hasWord(brand, "likewise")
    ) {
      return "flooring";
    }
    return "building-materials";
  }
  if (hasWord(cat, "windows?|doors?|upvc|aluminium|bifolds?|bifolding|sliding")) {
    return "windows-and-doors";
  }
  if (hasWord(cat, "solar|ev.?charg\\w*|heat.?pumps?|batter(y|ies)|inverters?|renewable")) {
    return "renewable-energy";
  }
  if (hasWord(cat, "kitchens?")) return "kitchens";
  if (hasWord(cat, "gardens?|decks?|decking|pergolas?|outdoor|patio|paving")) return "outdoor-living";
  if (hasWord(cat, "lights?|lighting|lamps?|led")) return "lighting";
  if (hasWord(cat, "plumb\\w*|pipes?|valves?")) return "plumbing";
  if (hasWord(cat, "electric\\w*|cables?|sockets?")) return "electrical";
  if (hasWord(cat, "heat|heating|radiators?|boilers?|cool|cooling|air.?con\\w*")) return "heating-and-cooling";
  if (hasWord(cat, "paints?|decor|decorating")) return "paint-and-decorating";
  if (hasWord(cat, "drains?|drainage")) return "drainage";
  if (hasWord(cat, "ventil\\w*|mvhr")) return "ventilation";
  if (hasWord(cat, "tools?|workwear")) return "tools-and-workwear";
  if (hasWord(cat, "ironmong\\w*|hardware|hinges?|handles?")) return "ironmongery-and-hardware";
  if (hasWord(cat, "smart|security|cctv|alarms?")) return "smart-home-and-security";
  if (hasWord(cat, "furniture|sofas?|tables?|chairs?")) return "furniture";

  return "building-materials";
}

export function slugifyTaxonomy(text: string): string {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
