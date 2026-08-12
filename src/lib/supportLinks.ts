/**
 * Turning page paths into something a customer should actually read.
 *
 * Replies used to contain bare paths — "our returns policy is at
 * /shipping-returns" — which reads like a developer note rather than a
 * support agent. Answers are now written with markdown links
 * (`[Delivery & Returns](/shipping-returns)`) and rendered as real links in
 * the chat.
 *
 * `linkifyReply` is the safety net for the AI tier: the model is told to use
 * the same markdown, but if it slips and emits a bare path anyway, this
 * rewrites it into a properly named link before the customer sees it.
 */

/** Every page the assistant is allowed to point at, with its display name. */
export const PAGE_LABELS: Record<string, string> = {
  "/track-order": "Track your order",
  "/shipping-returns": "Delivery & Returns",
  "/contact": "contact form",
  "/help": "Help Centre",
  "/faq": "FAQs",
  "/category": "our ranges",
};

/** Longest first, so "/shipping-returns" is not matched by a shorter prefix. */
const PATHS = Object.keys(PAGE_LABELS).sort((a, b) => b.length - a.length);

const BARE_PATH_RX = new RegExp(
  `(?<!\\]\\()(${PATHS.map((p) => p.replace(/\//g, "\\/")).join("|")})\\b`,
  "g",
);

/**
 * Rewrite bare paths as named markdown links, and tidy the phrasing around
 * them so the sentence still reads naturally.
 */
export function linkifyReply(text: string): string {
  let out = String(text || "");

  // "is at /shipping-returns" → "is on our Delivery & Returns page".
  // Prepositions only: a verb like "see" or "visit" already reads correctly
  // once the path becomes a named link, and rewriting it swallows the verb.
  out = out.replace(
    new RegExp(
      `\\b(?:at|on|via)\\s+(${PATHS.map((p) => p.replace(/\//g, "\\/")).join("|")})\\b`,
      "gi",
    ),
    (_m, path: string) => `on our [${PAGE_LABELS[path]}](${path}) page`,
  );

  // Anything still bare becomes a plain named link.
  out = out.replace(BARE_PATH_RX, (_m, path: string) =>
    `[${PAGE_LABELS[path]}](${path})`,
  );

  return out;
}

export type ReplyPart =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string };

const MD_LINK_RX = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

/** Split a reply into text and link parts for rendering. */
export function parseReply(text: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let last = 0;

  for (const m of String(text || "").matchAll(MD_LINK_RX)) {
    const start = m.index ?? 0;
    if (start > last) {
      parts.push({ type: "text", text: text.slice(last, start) });
    }
    parts.push({ type: "link", text: m[1], href: m[2] });
    last = start + m[0].length;
  }

  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}
