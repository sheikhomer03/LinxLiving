/**
 * Registered company particulars, as filed at Companies House.
 *
 * Deliberately dependency-free so client components (the footer) and server
 * components (the contact page) can both import it — `@/lib/support` reaches
 * for the Settings model and therefore mongoose, which cannot be bundled for
 * the browser.
 *
 * One definition rather than a hardcoded copy per page: the site previously
 * had "Brampton Road" in both the footer and the contact page, which is not
 * the filed address.
 *
 * @see https://find-and-update.company-information.service.gov.uk/company/10982266
 */

export const COMPANY = {
  legalName: "LINX Construction Group Limited",
  number: "10982266",
  address: {
    line1: "189 Brompton Road",
    city: "London",
    postcode: "SW3 1NE",
    country: "England",
  },
} as const;

/** "189 Brompton Road, London, SW3 1NE" */
export const COMPANY_ADDRESS_LINE = [
  COMPANY.address.line1,
  COMPANY.address.city,
  COMPANY.address.postcode,
].join(", ");

/** Google Maps link for the registered office. */
export const COMPANY_MAP_HREF = `https://maps.google.com/?q=${encodeURIComponent(
  `${COMPANY_ADDRESS_LINE}, ${COMPANY.address.country}`,
)}`;

/**
 * Support contact fallbacks.
 *
 * Here rather than in `@/lib/support` because that module reaches for the
 * Settings model, and therefore mongoose, which cannot be bundled for the
 * browser. Client components need these values; `support.ts` re-exports them
 * so server callers keep one import.
 */
export const DEFAULT_SUPPORT_PHONE = "020 4634 2203";
export const DEFAULT_SUPPORT_EMAIL = "info@linxsquare.co.uk";
export const DEFAULT_SUPPORT_HOURS = "Mon–Fri, 9am–5pm";
