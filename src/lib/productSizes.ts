/** Optional product size variants (name + image), admin-editable. */

export type ProductSizeEntry = {
  name: string;
  /** Optional photo / swatch for this size. */
  imageUrl: string;
  sortOrder: number;
};

export function emptySizeEntry(
  partial?: Partial<ProductSizeEntry>,
): ProductSizeEntry {
  return {
    name: "",
    imageUrl: "",
    sortOrder: 0,
    ...partial,
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function parseSizeOptions(raw: unknown): ProductSizeEntry[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  const out: ProductSizeEntry[] = [];
  for (const [index, row] of asArray<any>(parsed).entries()) {
    if (!row || typeof row !== "object") continue;
    const name = String(row.name || row.size || row.label || "").trim();
    if (!name) continue;
    out.push({
      name,
      imageUrl: String(
        row.imageUrl || row.image_url || row.image || "",
      ).trim(),
      sortOrder:
        typeof row.sortOrder === "number"
          ? row.sortOrder
          : typeof row.sort_order === "number"
            ? row.sort_order
            : index,
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder);
}

export function hasSizeOptions(
  items: ProductSizeEntry[] | null | undefined,
): boolean {
  return Array.isArray(items) && items.some((i) => i.name);
}
