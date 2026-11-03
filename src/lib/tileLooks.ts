/**
 * "Shop by marble" — tile looks matched by rule rather than by category.
 *
 * No supplier files marble the same way. Tile Mountain says it in
 * `specs.Style` ("Marble Effect"), Ca'Pietra in `specs.Effect`, natural stone
 * suppliers in `specs.Material` ("Marble"), and most only in the name
 * ("Calacatta Gold XL Tile"). A category link can't gather those, so a look
 * is a query over every one of those signals instead. Nothing is written to
 * product data: new imports are picked up the moment they carry any signal.
 *
 * Used as `/category?department=tiles&look=<slug>`.
 */

/** Marble names that are only ever used for marble (or marble-look) stone. */
const MARBLE_NAME =
  /\b(marble|marmo|calacatta|calcutta|carrara|statuario|statuary|onyx|arabescato|emperador|marquina)\b/i;

/** "Marble Effect" as a style / effect / finish value. */
const MARBLE_EFFECT = /marble effect/i;

const MARBLE_MATERIAL = /\bmarble\b/i;
const MAN_MADE = /porcelain|ceramic/i;

/**
 * Not tiles, though filed under Tiles with marble words: fitting materials,
 * and marble-print vinyl / SPC click flooring.
 */
const NOT_A_TILE =
  /\b(grout|adhesive|trims?|spacers?|sealer|sealant|cleaner|primer|silicone|levell\w*|tools?|profiles?|edging|vinyl|lvt|spc|laminate)\b/i;

const EFFECT_FIELDS = [
  "specs.Style",
  "specs.Effect",
  "specs.Appearance: Effect",
  "specs.Design",
  "specs.Finish",
  "finish",
];

const MATERIAL_FIELDS = [
  "specs.Material",
  "specs.Material &amp; construction: Material",
  "specs.Material Type",
  "materials",
];

const anyField = (fields: string[], rx: RegExp) =>
  fields.map((f) => ({ [f]: rx }));

const isMarble = {
  $and: [
    {
      $or: [
        { name: MARBLE_NAME },
        ...anyField(EFFECT_FIELDS, MARBLE_EFFECT),
        ...anyField(MATERIAL_FIELDS, MARBLE_MATERIAL),
        { category: /marble/i },
        { subCategory: /marble/i },
      ],
    },
    { name: { $not: NOT_A_TILE } },
  ],
};

/** Quarried marble: a marble material and no porcelain or ceramic one. */
const isNaturalMarble = {
  $and: [
    { $or: anyField(MATERIAL_FIELDS, MARBLE_MATERIAL) },
    ...MATERIAL_FIELDS.map((f) => ({ [f]: { $not: MAN_MADE } })),
  ],
};

const named = (rx: RegExp) => ({ $and: [isMarble, { name: rx }] });

export type TileLook = {
  slug: string;
  /** Menu link label. */
  label: string;
  /** Listing page heading. */
  title: string;
};

const LOOKS: Array<TileLook & { filter: Record<string, unknown> }> = [
  { slug: "marble", label: "All marble tiles", title: "Marble Tiles", filter: isMarble },
  {
    slug: "marble-effect",
    label: "Marble effect",
    title: "Marble Effect Tiles",
    filter: { $and: [isMarble, { $nor: [isNaturalMarble] }] },
  },
  {
    slug: "natural-marble",
    label: "Natural marble",
    title: "Natural Marble Tiles",
    filter: { $and: [isMarble, isNaturalMarble] },
  },
  { slug: "marble-carrara", label: "Carrara", title: "Carrara Marble Tiles", filter: named(/carrara/i) },
  { slug: "marble-calacatta", label: "Calacatta", title: "Calacatta Marble Tiles", filter: named(/calacatta|calcutta/i) },
  { slug: "marble-statuario", label: "Statuario", title: "Statuario Marble Tiles", filter: named(/statuario|statuary/i) },
  { slug: "marble-onyx", label: "Onyx", title: "Onyx Tiles", filter: named(/\bonyx\b/i) },
  {
    slug: "marble-black",
    label: "Black marble",
    title: "Black Marble Tiles",
    // A black-and-white pattern or a "Marquina Bronze" is not a black marble.
    filter: {
      $and: [named(/\b(nero|marquina|black)\b/i), { name: { $not: /white|bronze/i } }],
    },
  },
];

const BY_SLUG = new Map(LOOKS.map((l) => [l.slug, l]));

/** Every look, for the menu and for nav counts. */
export const TILE_LOOKS: TileLook[] = LOOKS.map(({ slug, label, title }) => ({
  slug,
  label,
  title,
}));

export function isTileLook(slug?: string | null): boolean {
  return Boolean(slug && BY_SLUG.has(slug));
}

export function tileLookTitle(slug?: string | null): string | null {
  return (slug && BY_SLUG.get(slug)?.title) || null;
}

/** Mongo filter for a look, or null for an unknown slug. */
export function tileLookFilter(slug?: string | null): Record<string, unknown> | null {
  return (slug && BY_SLUG.get(slug)?.filter) || null;
}
