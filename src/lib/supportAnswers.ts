/**
 * Pre-defined support answers.
 *
 * The great majority of support questions are the same dozen questions asked
 * a hundred different ways — delivery time, returns, samples, tracking, trade
 * accounts. Answering those from a canned list costs nothing, replies
 * instantly and, more importantly, is word-for-word correct every time.
 *
 * The AI is the fallback, not the first stop: only questions that no canned
 * answer covers reach the model. That is where the token saving comes from.
 *
 * Matching is deliberately simple and deterministic — required keywords must
 * all be present, then optional keywords raise the score. No fuzzy matching:
 * a near-miss should fall through to the AI rather than confidently return
 * the wrong policy.
 */

import {
  TILE_FLOORING_DELIVERY,
  STANDARD_ITEM_DELIVERY,
  FREE_DELIVERY_THRESHOLD,
  STANDARD_DELIVERY,
} from "@/lib/shipping";

/** Shared with POLICY_CONTEXT in the chat API route, so both say the same thing. */
export const DELIVERY_POLICY_LINE =
  `UK delivery is £${TILE_FLOORING_DELIVERY} for tiles and flooring, or £${STANDARD_ITEM_DELIVERY} for everything else, and free on orders over £${FREE_DELIVERY_THRESHOLD}. Most ranges arrive within ${STANDARD_DELIVERY.leadTimeDays} business days.`;

export type CannedAnswer = {
  id: string;
  /** Every one of these (or one alternative from each group) must appear. */
  all: string[][];
  /** Any of these raise confidence but are not required. */
  any?: string[];
  /** Question is NOT this canned answer if any of these appear. */
  not?: string[];
  answer: string;
};

/**
 * Wording here is the policy — keep it in step with /shipping-returns and the
 * POLICY_CONTEXT the AI is given, so both routes say the same thing.
 */
export const CANNED_ANSWERS: CannedAnswer[] = [
  {
    id: "delivery-time",
    all: [
      ["deliver", "delivery", "dispatch", "shipping", "arrive", "receive"],
      ["long", "when", "time", "days", "quick", "fast", "soon", "take", "eta"],
    ],
    not: ["free sample", "sample"],
    answer: `${DELIVERY_POLICY_LINE} Once your order is on its way you can follow it on our [Track your order](/track-order) page using your order number and email address.`,
  },
  {
    id: "delivery-cost",
    all: [
      ["deliver", "delivery", "shipping", "postage"],
      ["cost", "charge", "price", "much", "fee", "free"],
    ],
    answer: DELIVERY_POLICY_LINE,
  },
  {
    id: "track-order",
    all: [
      ["track", "tracking", "where", "status"],
      ["order", "delivery", "parcel", "package", "item"],
    ],
    answer:
      "You can follow it on our [Track your order](/track-order) page — you will need your order number and the email address you ordered with. If it is not showing yet, the order has not been dispatched.",
  },
  {
    id: "samples",
    all: [["sample", "samples"]],
    answer:
      "Free samples can be ordered from any product page using the \"Order a free sample\" button. It is a request rather than a purchase — no payment is taken and nothing is added to your basket. The team will confirm by email.",
  },
  {
    id: "returns",
    all: [
      ["return", "returns", "refund", "send back", "cancel", "exchange"],
    ],
    answer:
      "You will find the full policy on our [Delivery & Returns](/shipping-returns) page. If it is about an order you have already placed, call us or send your order number through the [contact form](/contact) and the team will sort it out.",
  },
  {
    id: "measuring",
    all: [
      ["how many", "how much", "calculate", "work out", "quantity", "coverage", "area"],
      ["box", "boxes", "pack", "packs", "tile", "tiles", "floor", "flooring", "m2", "sqm", "square", "metre", "meter"],
    ],
    answer:
      "Tiles and flooring are sold by the square metre. Every product page has a calculator: enter the area you need, tick the 10% wastage allowance, and it rounds up to whole packs or boxes and shows the total. If you would rather we checked your measurements, send them over and the team will confirm.",
  },
  {
    id: "wastage",
    all: [["wastage", "waste", "10%", "spare", "extra", "offcut"]],
    answer:
      "We recommend adding 10% to your measured area to cover cuts, breakages and any future repairs. The calculator on each tile and flooring page has this as a tick-box option.",
  },
  {
    id: "trade-account",
    all: [
      ["trade", "wholesale", "bulk", "contractor", "builder"],
      ["account", "price", "pricing", "discount", "rate", "apply", "open"],
    ],
    answer:
      "Trade pricing is available across every range. Send your company details through our [contact form](/contact) and the team will set your account up.",
  },
  {
    id: "price-on-request",
    all: [
      ["price", "quote", "cost", "how much"],
      ["request", "quote", "no price", "not shown", "missing", "poa", "enquire", "enquiry"],
    ],
    answer:
      "Some products show \"Request a quote\" instead of a price — those are made to measure or priced per project, so the team quotes them individually. Submit the enquiry on the product page and they will come back to you with a price.",
  },
  {
    id: "made-to-measure",
    all: [
      ["made to measure", "bespoke", "custom", "window", "windows", "door", "doors", "pergola", "awning"],
      ["buy", "order", "price", "cost", "how", "quote", "measure"],
    ],
    answer:
      "Made-to-measure lines — windows, doors, pergolas, awnings and front doors — are not bought directly from the site. Fill in the enquiry form on the product page and the team will call you to take the sizes and price it up.",
  },
  {
    id: "stock",
    all: [
      ["in stock", "stock", "available", "availability"],
    ],
    answer:
      "Stock is shown on each product page — anything marked \"In Stock\" is ready to ship. If you need a specific quantity confirmed before ordering, call or message the team and they will check it for you.",
  },
  {
    id: "opening-hours",
    all: [
      ["open", "opening", "hours", "closed", "available"],
      ["when", "what time", "hours", "today", "weekend", "saturday", "sunday"],
    ],
    answer:
      "You can call or email the team during opening hours — the number and hours are shown at the top of this chat. Messages sent outside those hours are answered the next working day.",
  },
  {
    id: "contact",
    all: [
      ["speak", "talk", "call", "human", "person", "someone", "agent", "advisor", "contact"],
    ],
    answer:
      "Of course. Send your question through our [contact form](/contact) and a member of the team will get back to you — that way they have your details and can reply properly.",
  },
  {
    id: "installation",
    all: [
      ["install", "installation", "fit", "fitting", "lay", "laying", "adhesive", "grout", "underlay"],
      ["where", "what", "do you", "sell", "need", "buy", "guide", "instructions", "how"],
    ],
    answer:
      "Fitting guidance and the adhesives, grouts and underlays for each range are under Accessories. Tell me which product you are fitting and the team can confirm exactly what you need.",
  },
  {
    id: "warranty",
    all: [["warranty", "guarantee", "guaranteed"]],
    answer:
      "Manufacturer warranties vary by brand and are listed on the product page under specifications. If you cannot see one for a product you are looking at, the team will confirm it for you.",
  },
  {
    id: "payment",
    all: [
      ["pay", "payment", "card", "klarna", "finance", "invoice", "bank transfer"],
      ["how", "can", "do you", "accept", "method", "option"],
    ],
    answer:
      "Orders are paid for by card at checkout. For invoiced or trade payment terms, get in touch and the team will set that up on your account.",
  },
  {
    id: "greeting",
    all: [["hi", "hello", "hey", "good morning", "good afternoon", "thanks", "thank you"]],
    not: ["?"],
    answer:
      "Hello — happy to help. Ask me about delivery, samples, measuring up, stock or an existing order, or use the call and email buttons above to speak to the team.",
  },
];

/**
 * Phrases that mean the customer wants a judgement about a specific product —
 * suitability, compatibility, a recommendation, a comparison.
 *
 * No canned answer can be right about those, and getting one wrong is worse
 * than spending the tokens. Anything containing one of these skips the canned
 * list entirely and goes to the model, which has the real catalogue data.
 */
const ESCALATE_TO_AI = [
  "suitable",
  "suitability",
  "compatible",
  "compatibility",
  "recommend",
  "difference between",
  "compare",
  "comparison",
  "better than",
  "which one",
  "which is best",
  "underfloor heating",
  "wet room",
  "waterproof",
  "slip",
  "r11",
  "r10",
  "pei",
  "ac rating",
  "thickness",
  "load bearing",
  "outdoor",
  "conservatory",
];

/** Normalise so punctuation and casing never affect matching. */
function normalise(text: string) {
  return ` ${text.toLowerCase().replace(/[^a-z0-9%?\s]/g, " ").replace(/\s+/g, " ")} `;
}

/**
 * Find a pre-defined answer for a question, or null to hand it to the AI.
 *
 * A short question with a clear single topic matches; anything long,
 * multi-part or off-list falls through, which is exactly what we want the
 * model spending tokens on.
 */
export function matchCannedAnswer(question: string): CannedAnswer | null {
  const q = normalise(question);

  // Long questions are usually specific or multi-part — let the AI read them
  // properly rather than pattern-matching one keyword out of forty.
  if (q.split(" ").length > 32) return null;

  // A product-judgement question is never a canned answer.
  if (ESCALATE_TO_AI.some((p) => q.includes(p))) return null;

  let best: { entry: CannedAnswer; score: number } | null = null;

  for (const entry of CANNED_ANSWERS) {
    if (entry.not?.some((n) => q.includes(normalise(n).trim()))) continue;

    // Every group must contribute at least one keyword.
    const groupHits = entry.all.map((group) =>
      group.filter((k) => q.includes(` ${k}`) || q.includes(`${k} `)).length,
    );
    if (groupHits.some((h) => h === 0)) continue;

    const optional = (entry.any || []).filter((k) => q.includes(k)).length;
    const score = groupHits.reduce((a, b) => a + b, 0) + optional;

    if (!best || score > best.score) best = { entry, score };
  }

  return best?.entry || null;
}
