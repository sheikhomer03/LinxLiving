/**
 * Categories treated as accessories — shown under the navbar Accessories
 * tab (by brand), not as main product columns inside a department mega panel.
 */

/** Explicit bathroom accessories (slug + common name forms). */
const BATHROOM_ACCESSORY_SLUGS = new Set([
  "towel-warmers",
  "towel-warmer",
  "mirror",
  "mirrors",
]);

const BATHROOM_ACCESSORY_NAMES = new Set([
  "towel warmers",
  "towel warmer",
  "mirrors",
  "mirror",
]);

/**
 * Tile / flooring install ranges that match ACCESSORY_RX words (adhesive,
 * grout, …) but are real Spectra (etc.) shop categories under Tiles — keep
 * them in the department mega, not the Accessories tab.
 */
const NOT_ACCESSORY_SLUGS = new Set(["adhesive-grout-silicone"]);

/** Generic accessory ranges (fixings, flashings, …). */
export const ACCESSORY_RX =
  /accessor|fixing|flashing|adhesive|grout|underlay|sealant|fastener|spare|trim/i;

export function isAccessoryCategory(
  name?: string | null,
  slug?: string | null,
): boolean {
  const s = String(slug || "")
    .trim()
    .toLowerCase();
  const n = String(name || "")
    .trim()
    .toLowerCase();
  if (s && NOT_ACCESSORY_SLUGS.has(s)) return false;
  if (s && BATHROOM_ACCESSORY_SLUGS.has(s)) return true;
  if (n && BATHROOM_ACCESSORY_NAMES.has(n)) return true;
  return ACCESSORY_RX.test(`${s} ${n}`);
}
