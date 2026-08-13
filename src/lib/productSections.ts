/**
 * Supplier PDP accordions (Materials & Care, Delivery & Returns …).
 *
 * Older scrapes read every <details> on the page, which also caught the mobile
 * navigation menus, so those headings are filtered out here as well.
 */
export type ProductSectionRow = { label: string; value: string };

export type ProductSectionItem = {
  heading: string;
  text: string;
  rows: ProductSectionRow[];
};

/** Navigation accordions that share the PDP's markup but aren't product copy. */
const NAV_HEADINGS = [
  /^knobs? & handles$/i,
  /^all knobs? & handles$/i,
  /^all lights$/i,
  /^light switches & sockets$/i,
  /^lighting$/i,
  /^taps$/i,
  /^hooks? & accessories$/i,
  /^by (finish|collection|room|project)$/i,
  /^(warm|cool|dark|colourful) finishes$/i,
  /^(finish|project|trade|shop|menu|account)$/i,
];

/**
 * Panels the PDP already renders in their own right — the description block and
 * the specification table — so they never become a second dropdown.
 */
const OWN_PANEL_HEADINGS = [/^description$/i, /^specifications?$/i];

export function parseProductSections(raw: unknown): ProductSectionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductSectionItem[] = [];
  const seen = new Set<string>();
  for (const row of raw as Record<string, unknown>[]) {
    const heading = String(row?.heading || "").trim();
    const text = String(row?.text || "").trim();
    const rows = (Array.isArray(row?.rows) ? row.rows : [])
      .map((r: Record<string, unknown>) => ({
        label: String(r?.label || "").trim(),
        value: String(r?.value || "").trim(),
      }))
      .filter((r) => r.label && r.value);
    if (!heading || (!text && !rows.length)) continue;
    if (NAV_HEADINGS.some((re) => re.test(heading))) continue;
    if (OWN_PANEL_HEADINGS.some((re) => re.test(heading))) continue;
    const key = heading.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ heading, text, rows });
  }
  return out;
}
