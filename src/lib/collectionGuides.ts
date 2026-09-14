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
  /**
   * Omit when /public holds nothing that belongs on the card.
   *
   * There are five showroom photographs in the repo and they run out before
   * the departments do — the bathroom set is two deep, so a third bathroom
   * card was reaching for the kitchen shot. A card with no image here takes
   * a lifestyle photograph off a product in the department being browsed
   * instead (see CollectionGuides' `fallbackImages`), which is always on
   * subject and needs no new asset.
   */
  image?: string;
};

const DEFAULT_GUIDES: CollectionGuide[] = [
  {
    title: "Order a free sample",
    href: "/faq",
    image: "/home/hero/bathroom-tiles.webp",
  },
  {
    title: "Opening a trade account",
    href: "/linx-distribution",
    image: "/home/hero/wood-flooring.webp",
  },
  {
    title: "Delivery & returns explained",
    href: "/shipping-returns",
    image: "/home/hero/heated-bathroom.webp",
  },
];

/**
 * Heating and electrical carry no cards.
 *
 * /collections/heating and /collections/electrical both have the row in
 * their markup and leave it unfilled, so those reference pages run grid →
 * sales line with nothing between them. An empty list here renders no
 * section at all, which is the same page.
 */
const NO_GUIDES: CollectionGuide[] = [];

const BY_DEPARTMENT: Record<string, CollectionGuide[]> = {
  bathrooms: [
    {
      title: "Order a free bathroom sample",
      href: "/faq",
      image: "/home/hero/bathroom-tiles.webp",
    },
    {
      title: "Planning a full bathroom fit-out",
      href: "/custom",
      image: "/home/hero/heated-bathroom.webp",
    },
    {
      // No third bathroom photograph in /public — the kitchen shot that used
      // to sit here read as the wrong room. Takes one off a bathroom product.
      title: "Delivery & returns explained",
      href: "/shipping-returns",
    },
  ],
  /*
   * Heating answers to two slugs.
   *
   * The static taxonomy calls this department `heating-and-cooling` while the
   * live tree serves it as `heating` — /category?department=heating is the
   * URL the navigation builds — so both keys are listed rather than one of
   * them quietly falling through to the default set.
   */
  heating: NO_GUIDES,
  "heating-and-cooling": NO_GUIDES,
  electrical: NO_GUIDES,
  /*
   * Accessories takes two cards, not three.
   *
   * /collections/accessories fills two of the row's three slots and leaves
   * the last empty, so the pair sits across the left two thirds — which is
   * what a two-item list in a three-column grid already does here.
   *
   * Both keep a local photograph rather than falling through to a product
   * image: this department is adhesives, trims and machines, and the product
   * shots are cut-outs on white — one of them a supplier's logo plate, which
   * has no business on an editorial card (see `storefrontBrandLabel`). These
   * accessories exist to finish a floor or a tiled wall, so the flooring and
   * tiling photographs are on subject.
   */
  accessories: [
    {
      title: "Specifying what your project needs",
      href: "/help",
      image: "/home/hero/wood-flooring.webp",
    },
    {
      title: "Delivery & returns explained",
      href: "/shipping-returns",
      image: "/home/hero/kitchen-tiles.webp",
    },
  ],
  /*
   * Tiles mirrors the reference's three tile buying-guide cards (MARBLE
   * TILES / MOSAIC TILES / PORCELAIN TILES) in shape, not in subject: those
   * point at guides Lusso has written, and ours point at the three things a
   * tile shopper here actually needs before ordering by the square metre.
   */
  tiles: [
    {
      title: "Order a free tile sample",
      href: "/faq",
      image: "/home/hero/kitchen-tiles.webp",
    },
    {
      title: "Measuring & calculating m²",
      href: "/help",
      image: "/home/hero/bathroom-tiles.webp",
    },
    {
      title: "Delivery & returns explained",
      href: "/shipping-returns",
      image: "/home/hero/wood-flooring.webp",
    },
  ],
  flooring: [
    {
      title: "Order a free flooring sample",
      href: "/faq",
      image: "/home/hero/wood-flooring.webp",
    },
    {
      title: "Measuring & calculating m²",
      href: "/help",
      image: "/home/hero/kitchen-tiles.webp",
    },
    {
      title: "Delivery & returns explained",
      href: "/shipping-returns",
      image: "/home/hero/bathroom-tiles.webp",
    },
  ],
};

export function guidesForDepartment(slug?: string | null): CollectionGuide[] {
  const key = String(slug || "").trim().toLowerCase();
  return BY_DEPARTMENT[key] || DEFAULT_GUIDES;
}
