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

/** Heuristic mapping from existing brand/category signals → department slug */
export function inferDepartmentSlug(input: {
  brandSlug?: string | null;
  categorySlug?: string | null;
  categoryName?: string | null;
}): string {
  const brand = (input.brandSlug || "").toLowerCase();
  const cat = `${input.categorySlug || ""} ${input.categoryName || ""}`.toLowerCase();

  if (
    /fakro|velux|keylite|sterling|rooflight|skylight|sun.?tunnel|flashing|blind/.test(
      brand + " " + cat,
    )
  ) {
    return "rooflights-and-glass";
  }
  if (/noken|bathroom|sanitary|shower|basin|toilet|tap/.test(brand + " " + cat)) {
    return "bathrooms";
  }
  if (
    /porcelanosa|tile|ceramic|floor|likewise|laminate|vinyl|carpet|lvt|wood/.test(
      brand + " " + cat,
    )
  ) {
    if (/kitchen/.test(cat)) return "kitchens";
    if (/bath/.test(cat)) return "bathrooms";
    if (/floor|carpet|vinyl|laminate|lvt|wood|grass|rug|mat/.test(cat) || /likewise/.test(brand)) {
      return "flooring";
    }
    return "building-materials";
  }
  if (/window|door|upvc|aluminium|bifold|sliding/.test(cat)) {
    return "windows-and-doors";
  }
  if (/solar|ev.?charg|heat.?pump|battery|inverter|renewable/.test(cat)) {
    return "renewable-energy";
  }
  if (/kitchen/.test(cat)) return "kitchens";
  if (/garden|deck|pergola|outdoor/.test(cat)) return "outdoor-living";
  if (/light|lamp|led/.test(cat)) return "lighting";
  if (/plumb|pipe|valve/.test(cat)) return "plumbing";
  if (/electric|cable|socket/.test(cat)) return "electrical";
  if (/heat|radiator|boiler|cool|air.?con/.test(cat)) return "heating-and-cooling";
  if (/paint|decor/.test(cat)) return "paint-and-decorating";
  if (/drain/.test(cat)) return "drainage";
  if (/ventil|mvhr/.test(cat)) return "ventilation";
  if (/tool|workwear/.test(cat)) return "tools-and-workwear";
  if (/ironmong|hardware|hinge|handle/.test(cat)) return "ironmongery-and-hardware";
  if (/smart|security|cctv|alarm/.test(cat)) return "smart-home-and-security";
  if (/furniture|sofa|table|chair/.test(cat)) return "furniture";

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
