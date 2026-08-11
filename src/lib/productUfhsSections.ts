/**
 * Underfloor Heating Store PDP extras:
 * Coverage, nested product options, Do the Job Right tools.
 */

export type UfhsCoverageValue = {
  name: string;
  imageUrl: string;
  priceAdjustment: number;
  sku: string;
  sortOrder: number;
};

export type UfhsCoverage = {
  label: string;
  helptext: string;
  values: UfhsCoverageValue[];
};

export type UfhsOptionChoice = {
  label: string;
  value: string;
  imageUrl: string;
  priceAdjustment: number;
  helptext: string;
  /** Nested option fields under this choice (image or text). */
  nested: UfhsOptionField[];
};

export type UfhsOptionField = {
  id: string;
  label: string;
  helptext: string;
  /** buttons | image-swatches | color-swatches | select | dropdown | radio | switch | text | group */
  type: string;
  required: boolean;
  sortOrder: number;
  choices: UfhsOptionChoice[];
};

export type UfhsDoTheJobItem = {
  name: string;
  imageUrl: string;
  priceAdjustment: number;
  description: string;
  sortOrder: number;
};

export type UfhsDoTheJobRight = {
  label: string;
  helptext: string;
  items: UfhsDoTheJobItem[];
};

export type UfhsShopifyOption = {
  name: string;
  position: number;
  values: string[];
};

/** One clause of a supplier option show/hide rule. */
export type UfhsOptionWhen = {
  /** Element id this clause reads. */
  select: string;
  where: string;
  value: string;
};

export type UfhsOptionCondition = {
  /** "all" | "any" */
  match: string;
  /** "show" | "hide" */
  display: string;
  whens: UfhsOptionWhen[];
};

export type UfhsOptionElementChoice = {
  value: string;
  label: string;
  helptext: string;
  color1: string;
  color2: string;
  /** "one-color" | "two-color" */
  colorType: string;
  imageUrl: string;
  priceAdjustment: number;
  productHandle: string;
  variantId: string;
  available: boolean;
};

/**
 * One node of the supplier option builder, flattened in render order —
 * swatches, buttons, dropdowns and the heading / description copy between them.
 */
export type UfhsOptionElement = {
  id: string;
  /** buttons | color-swatches | image-swatches | dropdown | select | radio | switch | paragraph | html | modal | spacing */
  type: string;
  label: string;
  labelHidden: boolean;
  required: boolean;
  multiple: boolean;
  deselectNotAllowed: boolean;
  helptext: string;
  /** Rich copy for paragraph / html / modal nodes. */
  text: string;
  columnWidth: number;
  style: string;
  /** "color" renders the swatch colour even when a photo is attached. */
  swatchStyle: string;
  swatchesPerRow: number;
  swatchWidth: number;
  swatchHeight: number;
  defaultValue: string[];
  conditions: UfhsOptionCondition[];
  choices: UfhsOptionElementChoice[];
};

/** elementId → selected values. */
export type UfhsOptionSelection = Record<string, string[]>;

/** "More info" copy shown behind the ⓘ next to an option axis label. */
export type UfhsOptionInfo = {
  name: string;
  html: string;
  text: string;
};

export type UfhsVariantRow = {
  name: string;
  sku: string;
  option1: string;
  option2: string;
  option3: string;
  price: number;
  available: boolean;
  imageUrl: string;
  /** Was-price / RRP shown struck through. */
  compareAtPrice: number | null;
  /** Merchandising label, e.g. "OUR PICK". */
  badge: string;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function emptyCoverage(): UfhsCoverage {
  return { label: "Coverage", helptext: "", values: [] };
}

export function emptyDoTheJobRight(): UfhsDoTheJobRight {
  return {
    label: "Do the Job Right - Tools and Testing Equipment",
    helptext: "",
    items: [],
  };
}

export function emptyOptionField(
  partial?: Partial<UfhsOptionField>,
): UfhsOptionField {
  return {
    id: "",
    label: "",
    helptext: "",
    type: "image-swatches",
    required: false,
    sortOrder: 0,
    choices: [],
    ...partial,
  };
}

export function parseCoverage(raw: unknown): UfhsCoverage | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const values: UfhsCoverageValue[] = [];
  for (const [i, v] of asArray<Record<string, unknown>>(row.values).entries()) {
    const name = String(v?.name || v?.label || "").trim();
    if (!name) continue;
    values.push({
      name,
      imageUrl: String(v?.imageUrl || v?.image || "").trim(),
      priceAdjustment: num(v?.priceAdjustment ?? v?.price),
      sku: String(v?.sku || "").trim(),
      sortOrder: num(v?.sortOrder, i),
    });
  }
  values.sort((a, b) => a.sortOrder - b.sortOrder);
  const label = String(row.label || "Coverage").trim() || "Coverage";
  if (!values.length && !String(row.helptext || "").trim()) return null;
  return {
    label,
    helptext: String(row.helptext || "").trim(),
    values,
  };
}

function parseChoice(
  raw: Record<string, unknown>,
  index: number,
): UfhsOptionChoice | null {
  const label = String(raw.label || raw.name || raw.title || "").trim();
  if (!label) return null;
  return {
    label,
    value: String(raw.value ?? raw.id ?? label).trim(),
    imageUrl: String(
      raw.imageUrl || raw.image || raw.img || raw.src || raw.swatch || "",
    ).trim(),
    priceAdjustment: num(raw.priceAdjustment ?? raw.price ?? raw.amount),
    helptext: String(raw.helptext || "").trim(),
    nested: parseOptionFields(raw.nested || raw.elements || raw.children),
  };
}

export function parseOptionFields(raw: unknown): UfhsOptionField[] {
  const out: UfhsOptionField[] = [];
  for (const [i, row] of asArray<Record<string, unknown>>(raw).entries()) {
    if (!row || typeof row !== "object") continue;
    const type = String(row.type || "image-swatches").trim() || "image-swatches";
    if (/^(spacing|paragraph|html|modal|icon)$/i.test(type)) continue;
    const label = String(row.label || row.label_en || row.name || "").trim();
    if (!label && type !== "group") continue;
    const choiceRaw =
      row.choices || row.options || row.values || row.swatches || row.items;
    const choices: UfhsOptionChoice[] = [];
    for (const [ci, c] of asArray<Record<string, unknown> | string>(
      choiceRaw,
    ).entries()) {
      if (typeof c === "string") {
        if (!c.trim()) continue;
        choices.push({
          label: c.trim(),
          value: c.trim(),
          imageUrl: "",
          priceAdjustment: 0,
          helptext: "",
          nested: [],
        });
        continue;
      }
      const parsed = parseChoice(c, ci);
      if (parsed) choices.push(parsed);
    }
    const nestedFromGroup = parseOptionFields(row.elements || row.children);
    out.push({
      id: String(row.id || `field-${i}`),
      label: label || "Options",
      helptext: String(row.helptext || row.helptext_en || "").trim(),
      type,
      required: Boolean(row.required),
      sortOrder: num(row.sortOrder, i),
      choices:
        choices.length > 0
          ? choices
          : nestedFromGroup.length
            ? nestedFromGroup.map((f) => ({
                label: f.label,
                value: f.id || f.label,
                imageUrl: "",
                priceAdjustment: 0,
                helptext: f.helptext,
                nested: [f],
              }))
            : [],
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder);
}

export function parseDoTheJobRight(raw: unknown): UfhsDoTheJobRight | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const items: UfhsDoTheJobItem[] = [];
  for (const [i, v] of asArray<Record<string, unknown>>(row.items).entries()) {
    const name = String(v?.name || v?.label || "").trim();
    if (!name) continue;
    items.push({
      name,
      imageUrl: String(v?.imageUrl || v?.image || "").trim(),
      priceAdjustment: num(v?.priceAdjustment ?? v?.price),
      description: String(v?.description || v?.helptext || "").trim(),
      sortOrder: num(v?.sortOrder, i),
    });
  }
  items.sort((a, b) => a.sortOrder - b.sortOrder);
  const label =
    String(row.label || "").trim() ||
    "Do the Job Right - Tools and Testing Equipment";
  if (!items.length && !String(row.helptext || "").trim()) return null;
  return {
    label,
    helptext: String(row.helptext || "").trim(),
    items,
  };
}

export function parseShopifyOptions(raw: unknown): UfhsShopifyOption[] {
  const out: UfhsShopifyOption[] = [];
  for (const [i, row] of asArray<Record<string, unknown> | string>(
    raw,
  ).entries()) {
    if (typeof row === "string") {
      if (!row.trim()) continue;
      out.push({ name: row.trim(), position: i + 1, values: [] });
      continue;
    }
    const name = String(row?.name || "").trim();
    if (!name || /^title$/i.test(name)) continue;
    out.push({
      name,
      position: num(row?.position, i + 1),
      values: asArray<string>(row?.values)
        .map((v) => String(v || "").trim())
        .filter(Boolean),
    });
  }
  return out.sort((a, b) => a.position - b.position);
}

function parseConditions(raw: unknown): UfhsOptionCondition[] {
  const out: UfhsOptionCondition[] = [];
  for (const row of asArray<Record<string, unknown>>(raw)) {
    const whens: UfhsOptionWhen[] = [];
    for (const w of asArray<Record<string, unknown>>(row?.whens)) {
      whens.push({
        select: String(w?.select ?? ""),
        where: String(w?.where || "EQUALS"),
        value: String(w?.value ?? ""),
      });
    }
    out.push({
      match: String(row?.match || "all"),
      display: String(row?.display || "show"),
      whens,
    });
  }
  return out;
}

export function parseOptionElements(raw: unknown): UfhsOptionElement[] {
  const out: UfhsOptionElement[] = [];
  for (const [i, row] of asArray<Record<string, unknown>>(raw).entries()) {
    if (!row || typeof row !== "object") continue;
    const type = String(row.type || "").trim();
    if (!type) continue;
    const choices: UfhsOptionElementChoice[] = [];
    for (const c of asArray<Record<string, unknown>>(row.choices)) {
      const value = String(c?.value ?? c?.label ?? "").trim();
      if (!value) continue;
      choices.push({
        value,
        label: String(c?.label || value).trim(),
        helptext: String(c?.helptext || "").trim(),
        color1: String(c?.color1 || "").trim(),
        color2: String(c?.color2 || "").trim(),
        colorType: String(c?.colorType || "").trim(),
        imageUrl: String(c?.imageUrl || "").trim(),
        priceAdjustment: num(c?.priceAdjustment),
        productHandle: String(c?.productHandle || "").trim(),
        variantId: String(c?.variantId || "").trim(),
        available: c?.available !== false,
      });
    }
    out.push({
      id: String(row.id || `el-${i}`),
      type,
      label: String(row.label || "").trim(),
      labelHidden: Boolean(row.labelHidden),
      required: Boolean(row.required),
      multiple: Boolean(row.multiple),
      deselectNotAllowed: Boolean(row.deselectNotAllowed),
      helptext: String(row.helptext || "").trim(),
      text: String(row.text || "").trim(),
      columnWidth: num(row.columnWidth, 100),
      style: String(row.style || "").trim(),
      swatchStyle: String(row.swatchStyle || "").trim(),
      swatchesPerRow: num(row.swatchesPerRow),
      swatchWidth: num(row.swatchWidth),
      swatchHeight: num(row.swatchHeight),
      defaultValue: asArray<string>(row.defaultValue).map((v) => String(v)),
      conditions: parseConditions(row.conditions),
      choices,
    });
  }
  return out;
}

export function parseOptionInfo(raw: unknown): UfhsOptionInfo[] {
  const out: UfhsOptionInfo[] = [];
  for (const row of asArray<Record<string, unknown>>(raw)) {
    const name = String(row?.name || "").trim();
    const text = String(row?.text || "").trim();
    const html = String(row?.html || "").trim();
    if (!name || (!text && !html)) continue;
    out.push({ name, html, text: text || html.replace(/<[^>]+>/g, " ").trim() });
  }
  return out;
}

export function parseUfhsVariants(raw: unknown): UfhsVariantRow[] {
  const out: UfhsVariantRow[] = [];
  for (const row of asArray<Record<string, unknown>>(raw)) {
    // Variant prices are stored in pounds. An older guess treated anything
    // over 200 as pennies, which showed a £635.35 mat as £6.35.
    const price = num(row.price);
    out.push({
      name: String(row.name || row.title || "").trim(),
      sku: String(row.sku || "").trim(),
      option1: String(row.option1 || "").trim(),
      option2: String(row.option2 || "").trim(),
      option3: String(row.option3 || "").trim(),
      price,
      available: row.available !== false,
      imageUrl: String(row.imageUrl || row.featured_image || "").trim(),
      compareAtPrice:
        Number(row.compareAtPrice) > 0 ? Number(row.compareAtPrice) : null,
      badge: String(row.badge || "").trim(),
    });
  }
  return out;
}

/** Pull “Do the Job Right” image-swatches out of nested option fields. */
export function extractDoTheJobFromFields(
  fields: UfhsOptionField[],
): UfhsDoTheJobRight | null {
  const walk = (list: UfhsOptionField[]): UfhsDoTheJobRight | null => {
    for (const field of list) {
      if (/do the job right|tools and testing/i.test(field.label)) {
        return {
          label: field.label,
          helptext: field.helptext,
          items: field.choices.map((c, i) => ({
            name: c.label,
            imageUrl: c.imageUrl,
            priceAdjustment: c.priceAdjustment,
            description: c.helptext,
            sortOrder: i,
          })),
        };
      }
      for (const choice of field.choices) {
        const nested = walk(choice.nested);
        if (nested) return nested;
      }
    }
    return null;
  };
  return walk(fields);
}

export function hasUfhsConfigurator(input: {
  coverage?: UfhsCoverage | null;
  nestedOptions?: UfhsOptionField[] | null;
  doTheJobRight?: UfhsDoTheJobRight | null;
  shopifyOptions?: UfhsShopifyOption[] | null;
  variants?: UfhsVariantRow[] | null;
}): boolean {
  if (input.coverage?.values?.length) return true;
  if (input.doTheJobRight?.items?.length) return true;
  if (input.nestedOptions?.length) return true;
  if ((input.shopifyOptions?.length || 0) > 0 && (input.variants?.length || 0) > 1)
    return true;
  return false;
}
