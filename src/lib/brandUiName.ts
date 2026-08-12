/**
 * Storefront label for a brand.
 * `uiName` ("Name Show in UI") can be shared by multiple brands;
 * admin / backend continue to use the real `name`.
 */
export function brandUiName(brand: {
  name?: string | null;
  uiName?: string | null;
} | null | undefined): string {
  if (!brand) return "";
  const ui = String(brand.uiName || "").trim();
  if (ui) return ui;
  return String(brand.name || "").trim();
}
