/**
 * The guide cards under a collection's product grid.
 *
 * Lusso Stone closes every collection page with three editorial cards —
 * "HOW TO CREATE A TRADITIONAL BATHROOM", "CHOOSING YOUR CORTESE® STONE
 * FINISH", "TYPES OF VANITY UNITS" — each a photograph over an uppercase
 * title and a READ MORE, written per department.
 *
 * These are the merchandising equivalent. Every card here points at a page
 * that actually exists in this app, and the photographs are the showroom
 * shots already in /public — nothing is invented, because a card promising
 * a buying guide we have not written would be worse than no card.
 *
 * To make them department-specific, add an entry to `BY_DEPARTMENT` keyed on
 * the department slug; anything not listed falls back to `DEFAULT_GUIDES`.
 */

export type CollectionGuide = {
  title: string;
  href: string;
  image: string;
};

const DEFAULT_GUIDES: CollectionGuide[] = [
  {
    title: "Order a free sample",
    href: "/faq",
    image: "/home/hero/bathroom-tiles.png",
  },
  {
    title: "Opening a trade account",
    href: "/linx-distribution",
    image: "/home/hero/wood-flooring.png",
  },
  {
    title: "Delivery & returns explained",
    href: "/shipping-returns",
    image: "/home/hero/heated-bathroom.png",
  },
];

const HEATING_GUIDES: CollectionGuide[] = [
  {
    title: "Planning underfloor heating",
    href: "/custom",
    image: "/home/hero/heated-bathroom.png",
  },
  {
    title: "Sizing & specification help",
    href: "/help",
    image: "/home/hero/bathroom-tiles.png",
  },
  {
    title: "Delivery & returns explained",
    href: "/shipping-returns",
    image: "/home/hero/kitchen-tiles.png",
  },
];

const BY_DEPARTMENT: Record<string, CollectionGuide[]> = {
  bathrooms: [
    {
      title: "Order a free bathroom sample",
      href: "/faq",
      image: "/home/hero/bathroom-tiles.png",
    },
    {
      title: "Planning a full bathroom fit-out",
      href: "/custom",
      image: "/home/hero/heated-bathroom.png",
    },
    {
      title: "Delivery & returns explained",
      href: "/shipping-returns",
      image: "/home/hero/kitchen-tiles.png",
    },
  ],
  /*
   * Heating answers to two slugs.
   *
   * The static taxonomy calls this department `heating-and-cooling` while the
   * live tree serves it as `heating` — /category?department=heating is the
   * URL the navigation builds — so both keys point at the same three cards
   * rather than one of them quietly falling through to the default set.
   */
  heating: HEATING_GUIDES,
  "heating-and-cooling": HEATING_GUIDES,
  flooring: [
    {
      title: "Order a free flooring sample",
      href: "/faq",
      image: "/home/hero/wood-flooring.png",
    },
    {
      title: "Measuring & calculating m²",
      href: "/help",
      image: "/home/hero/kitchen-tiles.png",
    },
    {
      title: "Delivery & returns explained",
      href: "/shipping-returns",
      image: "/home/hero/bathroom-tiles.png",
    },
  ],
};

export function guidesForDepartment(slug?: string | null): CollectionGuide[] {
  const key = String(slug || "").trim().toLowerCase();
  return BY_DEPARTMENT[key] || DEFAULT_GUIDES;
}
