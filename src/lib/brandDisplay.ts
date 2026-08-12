/**
 * Storefront brand labelling.
 *
 * Every brand is presented to customers as LINX Square — suppliers are not
 * named on the shop front. This is display only: the real brand is still on
 * the product, still drives pricing rules (per-m² divisors, from-price
 * brands, trade discounts), still filters the catalogue, and is still shown
 * in admin. Nothing here changes data.
 *
 * Use `storefrontBrandLabel()` anywhere a brand name would be rendered to a
 * customer. Never use it where the value feeds logic — `isFromPriceBrand`,
 * `getEnquiryCtaLabel` and the supplier price rules all need the real name.
 */

export const STOREFRONT_BRAND_NAME = "Linx Square";

/**
 * The name to show a customer for any brand.
 *
 * Takes the real name only so call sites read honestly; the argument is
 * deliberately ignored.
 */
export function storefrontBrandLabel(_realName?: string | null): string {
  return STOREFRONT_BRAND_NAME;
}
