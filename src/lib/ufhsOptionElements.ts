/**
 * Evaluates the supplier option builder's show/hide rules so our configurator
 * follows the same flow as the live PDP: each element carries the conditions
 * of its own group plus every ancestor group, and all must pass.
 */
import type {
  UfhsOptionElement,
  UfhsOptionCondition,
  UfhsOptionSelection,
  UfhsOptionWhen,
} from "@/lib/productUfhsSections";

/** Pseudo-element holding the selected Shopify variant title. */
export const SHOPIFY_VARIANT_KEY = "shopify_variant";

/**
 * A clause is only meaningful when the element it reads is part of this set.
 * Sets routinely keep clauses pointing at fields that were removed; the option
 * app ignores those rather than hiding the field, so e.g. "Prepare for the
 * Future" still shows.
 */
function isResolvable(when: UfhsOptionWhen, knownIds: Set<string>) {
  if (!when.select || when.select === "null") return false;
  if (when.select === SHOPIFY_VARIANT_KEY) return true;
  return knownIds.has(when.select);
}

/** Rule values and option values differ in case in the supplier's own data. */
function norm(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function matchesWhen(when: UfhsOptionWhen, selection: UfhsOptionSelection) {
  const values = (selection[when.select] || []).map(norm);
  const want = norm(when.value);
  const has = values.includes(want);
  const isOff = (v: string) => /^(no|off|false)\b/i.test(v);

  switch (when.where.toUpperCase()) {
    case "EQUALS":
      return has;
    case "NOT_EQUALS":
      return !has;
    case "CONTAINS":
      return values.some((v) => v.includes(want));
    case "ENABLED":
      return values.length > 0 && !isOff(values[0]);
    case "DISABLED":
      return values.length === 0 || isOff(values[0]);
    case "SELECTIONS_COUNT_GREATER_THAN":
      return values.length > Number(want || 0);
    case "SELECTIONS_COUNT_EQUALS":
      return values.length === Number(want || 0);
    default:
      return true;
  }
}

function passesCondition(
  condition: UfhsOptionCondition,
  selection: UfhsOptionSelection,
  knownIds: Set<string>,
) {
  const whens = (condition.whens || []).filter((w) =>
    isResolvable(w, knownIds),
  );
  if (!whens.length) return true;
  const results = whens.map((w) => matchesWhen(w, selection));
  const passed =
    String(condition.match || "all").toLowerCase() === "any"
      ? results.some(Boolean)
      : results.every(Boolean);
  return String(condition.display || "show").toLowerCase() === "hide"
    ? !passed
    : passed;
}

export function isElementVisible(
  element: UfhsOptionElement,
  selection: UfhsOptionSelection,
  knownIds: Set<string>,
): boolean {
  for (const condition of element.conditions || []) {
    if (!passesCondition(condition, selection, knownIds)) return false;
  }
  return true;
}

export function elementIdSet(elements: UfhsOptionElement[]): Set<string> {
  return new Set((elements || []).map((el) => el.id));
}

/**
 * Pre-selection matching the live PDP: stored defaults win, otherwise a field
 * that cannot be deselected starts on its first choice.
 */
export function initialElementSelection(
  elements: UfhsOptionElement[],
): UfhsOptionSelection {
  const selection: UfhsOptionSelection = {};
  for (const element of elements || []) {
    if (!element.choices?.length) continue;
    const valid = element.choices.map((c) => c.value);
    const defaults = (element.defaultValue || []).filter((v) =>
      valid.includes(v),
    );
    if (defaults.length) {
      selection[element.id] = element.multiple ? defaults : [defaults[0]];
      continue;
    }
    if (element.deselectNotAllowed && !element.multiple) {
      selection[element.id] = [valid[0]];
    }
  }
  return selection;
}

/** Total add-on price of everything currently selected AND visible. */
export function selectionPriceExtra(
  elements: UfhsOptionElement[],
  selection: UfhsOptionSelection,
): number {
  const knownIds = elementIdSet(elements);
  let extra = 0;
  for (const element of elements || []) {
    if (!isElementVisible(element, selection, knownIds)) continue;
    for (const value of selection[element.id] || []) {
      const choice = element.choices?.find((c) => c.value === value);
      if (choice?.priceAdjustment) extra += choice.priceAdjustment;
    }
  }
  return Math.round(extra * 100) / 100;
}

/** Human-readable configuration summary for the cart line. */
export function selectionSummary(
  elements: UfhsOptionElement[],
  selection: UfhsOptionSelection,
): string {
  const knownIds = elementIdSet(elements);
  const parts: string[] = [];
  for (const element of elements || []) {
    if (!isElementVisible(element, selection, knownIds)) continue;
    const values = selection[element.id] || [];
    if (!values.length) continue;
    const label = element.label || element.type;
    parts.push(`${label}: ${values.join(", ")}`);
  }
  return parts.join(" | ");
}
