/**
 * UK postcode-area → delivery zone lookup (Porcious tile range only).
 *
 * Source: the merchant's own "Post Code Zones.xlsx" — only zones 1-4 are
 * used on the storefront; zones 5-12 (Scotland/islands/Ireland/Channel
 * Islands) are out of scope. Zone 1 covers SS (Basildon, the supplier's own
 * warehouse), confirming it's the nearest/cheapest tier.
 */

export type DeliveryZone = 1 | 2 | 3 | 4;

const ZONE_1_AREAS = [
  "AL", "B", "BB", "BD", "BL", "BS", "CB", "CH", "CV", "CW", "DE", "DN",
  "DY", "GL", "HD", "HP", "HX", "L", "LE", "LN", "LS", "LU", "MK", "NG",
  "NN", "OL", "OX", "PE", "PR", "S", "SG", "SK", "SN", "SS", "ST", "TF",
  "WA", "WF", "WN", "WR", "WS", "WV",
];

const ZONE_2_AREAS = [
  "BA", "BH", "CF", "CM", "CO", "CT", "DH", "DL", "DT", "FY", "GU", "HG",
  "HR", "HU", "IP", "M", "ME", "NE", "NP", "NR", "PO", "RG", "RH", "SL",
  "SO", "SP", "SR", "TA", "TN", "TS", "WD", "YO",
];

const ZONE_3_AREAS = [
  "BR", "CR", "DA", "EN", "EX", "HA", "KT", "LA", "LD", "RM", "SM", "SY", "TW",
];

const ZONE_4_AREAS = ["EC", "E", "IG", "N", "NW", "SE", "SW", "UB", "W", "WC"];

/** Postcode area → zone, e.g. "SS" → 1. Longest-prefix-first for lookup. */
export const POSTCODE_AREA_ZONE: Record<string, DeliveryZone> = Object.fromEntries([
  ...ZONE_1_AREAS.map((a) => [a, 1 as DeliveryZone]),
  ...ZONE_2_AREAS.map((a) => [a, 2 as DeliveryZone]),
  ...ZONE_3_AREAS.map((a) => [a, 3 as DeliveryZone]),
  ...ZONE_4_AREAS.map((a) => [a, 4 as DeliveryZone]),
]);

/** All postcode areas, longest first, so "SW" matches before "S". */
export const POSTCODE_AREAS = Object.keys(POSTCODE_AREA_ZONE).sort(
  (a, b) => b.length - a.length,
);

/** Extracts the outward-code letters from a postcode/partial postcode. */
function outwardLetters(input: string): string {
  return String(input || "")
    .trim()
    .toUpperCase()
    .match(/^[A-Z]+/)?.[0] || "";
}

/** "SS14 3DR" | "ss14" | "SS" → 1. Null when it isn't one of zones 1-4. */
export function lookupZoneByPostcode(input: string): DeliveryZone | null {
  const letters = outwardLetters(input);
  if (!letters) return null;
  // Longest matching prefix wins (e.g. "SW" before "S", "CT" is its own area).
  for (const area of POSTCODE_AREAS) {
    if (letters.startsWith(area)) return POSTCODE_AREA_ZONE[area];
  }
  return null;
}

/** Search-as-you-type: postcode areas whose letters start with the query. */
export function searchPostcodeAreas(query: string, limit = 8) {
  const q = String(query || "").trim().toUpperCase();
  if (!q) return [];
  return POSTCODE_AREAS.filter((area) => area.startsWith(q) || q.startsWith(area))
    .slice(0, limit)
    .map((area) => ({ area, zone: POSTCODE_AREA_ZONE[area] }));
}

