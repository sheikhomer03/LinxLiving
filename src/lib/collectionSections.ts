/**
 * The department-specific furniture a Lusso Stone collection page carries
 * around its product grid.
 *
 * Three kinds of block, all optional, all keyed on the department slug:
 *
 *   features  promo cards laid *inside* the grid, spanning whole columns
 *   copy      the centred editorial paragraph under the guide cards
 *   faqs      the accordion that closes the page
 *
 * They are configured per department rather than rendered everywhere because
 * that is how the reference behaves: /collections/tiles carries all three,
 * /collections/accessories carries the copy and the FAQ, and
 * /collections/bathroom, /heating and /electrical carry none of them — their
 * theme sections exist but are left empty, and an empty section renders
 * nothing at all. A department with no entry here simply gets the hero, the
 * grid, the guide cards and the sales line.
 *
 * Measured off /collections/tiles at 1440 (see CollectionFeatureCard and
 * CollectionCopy for the type scale each block uses).
 */

export type CollectionFeature = {
  /**
   * How many products sit ahead of the card in the grid.
   *
   * The reference places its cards with explicit `grid-row` / `grid-column`
   * rules — row 2 columns 1–2, then row 5 columns 1–4 — which on a four-up
   * grid puts the first after 4 products and the second after 14. Written as
   * a product count instead so the cards stay in sensible places when the
   * grid drops to three or two columns.
   */
  afterProducts: number;
  /** Columns taken on the four-up desktop grid — half the row, or all of it. */
  span: 2 | 4;
  title: string;
  description: string;
  ctaLabel: string;
  href: string;
  image: string;
};

export type CollectionCopy = {
  heading: string;
  /** One entry per paragraph. */
  body: string[];
};

export type CollectionFaq = {
  question: string;
  answer: string;
};

export type CollectionSections = {
  features?: CollectionFeature[];
  copy?: CollectionCopy;
  faqs?: CollectionFaq[];
};

/**
 * Everything here points at a category this catalogue actually holds and a
 * photograph that actually ships in /public — the same rule `collectionGuides`
 * works to. A promo card for a collection we cannot fill would be worse than
 * no card.
 */
const TILES: CollectionSections = {
  features: [
    {
      afterProducts: 4,
      span: 2,
      title: "Floor & Wall Tiles",
      description:
        "One tile, floor to wall — matched finishes that carry a room through in a single material.",
      ctaLabel: "Shop floor & wall tiles",
      href: "/category?department=tiles&category=floor-and-wall",
      image: "/home/hero/bathroom-tiles.png",
    },
    {
      afterProducts: 14,
      span: 4,
      title: "Large Format Tiles",
      description:
        "600×1200 porcelain — fewer grout lines, and a surface that reads as one continuous plane.",
      ctaLabel: "Shop large format tiles",
      href: "/category?department=tiles&category=600x1200-tiles",
      image: "/home/hero/kitchen-tiles.png",
    },
  ],
  copy: {
    heading: "Tiles",
    body: [
      "Mixing textures, finishes and formats is what gives a tiled room its depth. Lighter shades open a small bathroom up, while darker tones and bold patterning give a larger space something to settle on. Whichever you choose, weigh slip resistance and durability alongside the look — particularly on wet room floors and anywhere that takes heavy traffic.",
      "Every tile in this collection is priced and sold by the square metre, so the calculator on each product page will size your order once you know the area. Free samples are available across the range, and our sales team can help you specify a floor and wall combination before you commit.",
    ],
  },
  faqs: [
    {
      question: "What is the difference between a matt and a polished tile?",
      answer:
        "A matt (or honed) tile has a flat, light-absorbing surface, while a polished tile is buffed to a gloss that reflects it. Polished finishes make a room feel brighter and larger; matt finishes are less slippery underfoot and hide water marks and dust better, which is why they are usually the safer choice for a floor.",
    },
    {
      question: "Can every tile be used on both walls and floors?",
      answer:
        "No. Texture, thickness and material vary across the range, and some tiles are rated for walls only. The suitability is listed in each product's specification — check it before ordering, and speak to our sales team if you want one tile to run from floor to wall.",
    },
    {
      question: "How do I work out how many tiles I need?",
      answer:
        "Measure the area in square metres and add roughly 10% for cuts and breakages — more if you are laying a herringbone or diagonal pattern, which wastes more at the edges. Tiles here are sold by the square metre, and each product page carries a calculator that turns your measurements into an order quantity.",
    },
    {
      question: "Do porcelain and natural stone tiles need sealing?",
      answer:
        "Porcelain is fired dense enough that it does not need sealing, though the grout around it usually benefits from it. Natural stone is porous and does need sealing, both before grouting and periodically afterwards, to keep it from staining. The product specification says which material you are buying.",
    },
    {
      question: "How should I clean and maintain tiles?",
      answer:
        "A soft cloth or mop and a neutral, non-abrasive soap solution is all that is needed for weekly cleaning. Avoid bleach, vinegar, baking soda and any acidic or abrasive cleaner — they dull a polished glaze and will etch natural stone. Wipe spills on stone promptly rather than letting them sit.",
    },
    {
      question: "Can I order a sample before I buy?",
      answer:
        "Yes. Tiles can be sampled free of charge, and we would encourage it — glaze and veining read very differently under your own lighting than they do on screen. Request one from the product page, or call the sales team and we will put a selection together.",
    },
  ],
};

/**
 * Accessories carries the copy block and the FAQ, but no promo cards.
 *
 * The reference's accessories are bathroom accessories — towel bars, soap
 * dispensers, shower baskets — and its copy and questions are written about
 * those. Ours is the trade half of the catalogue: adhesives, levellers,
 * grouts, trims, fixings and underlays. Same three blocks in the same order,
 * about what this department actually sells.
 */
const ACCESSORIES: CollectionSections = {
  copy: {
    heading: "Accessories",
    body: [
      "These are the products that turn a delivery of tiles or flooring into a finished floor — adhesives, levellers, grouts, trims, fixings and underlays, bought at the same trade prices as everything else here.",
      "Below are the questions we are asked most often. If yours is not among them, call the sales team and we will work through the specification with you before you order.",
    ],
  },
  faqs: [
    {
      question: "How much adhesive and grout will I need?",
      answer:
        "It depends on the tile format, the trowel notch and how flat the substrate is — a large-format tile on an uneven wall swallows far more adhesive than a small one on a flat board. Every bag and tub lists its coverage per square metre; work from the area you measured for the tiles themselves, and round up rather than down.",
    },
    {
      question: "Do I need a levelling compound before tiling or laying a floor?",
      answer:
        "If the substrate is out by more than a few millimetres across a two-metre span, yes. Large-format tiles and click-fit flooring are both unforgiving of a floor that is not flat — tiles lipping at the edges and planks that creak or unclip are usually a subfloor problem, not a product one.",
    },
    {
      question: "What is the difference between a cement-based and a ready-mixed adhesive?",
      answer:
        "Cement-based adhesive is mixed on site, sets chemically and is the stronger of the two — it is what heavy tiles, floors and wet areas need. Ready-mixed is convenient for light wall tiles in a dry room, but it dries by evaporation, so it should not be used on floors, in showers, or under anything large.",
    },
    {
      question: "Which trim do I use where flooring meets another surface?",
      answer:
        "A threshold or T-bar where two floors of the same height meet, a ramp or reducer where the heights differ, and a scotia or beading around the perimeter to cover the expansion gap. Pick the trim after the floor, since the profile has to suit the board thickness.",
    },
    {
      question: "Does grout colour really change how a tiled wall looks?",
      answer:
        "More than most people expect. A grout close to the tile colour lets the surface read as one plane; a contrasting grout draws every joint and turns the format itself into the pattern — which is the whole point of a metro or a herringbone. Decide it with a sample in the room's own light.",
    },
    {
      question: "Can you help me work out what my project needs?",
      answer:
        "Yes. Send the room dimensions and the tile or floor you are considering, and the sales team will put together the adhesive, grout, trims and fixings to go with it so nothing is missing on the day.",
    },
  ],
};

const BY_DEPARTMENT: Record<string, CollectionSections> = {
  tiles: TILES,
  accessories: ACCESSORIES,
};

const NONE: CollectionSections = {};

export function sectionsForDepartment(
  slug?: string | null,
): CollectionSections {
  const key = String(slug || "").trim().toLowerCase();
  return BY_DEPARTMENT[key] || NONE;
}
