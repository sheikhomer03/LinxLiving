/** Pooky-style Base / Shade / Pendant / Wall Fitting options + efficiency. */

export type PookyOptionItem = {
  name: string;
  images: string[];
  price: number;
  stock: number;
  /** Optional source handle / sku for linking. */
  handle?: string;
  sku?: string;
  sortOrder: number;
};

export type PookyEfficiency = {
  /** Short label / rating summary. */
  summary: string;
  /** Longer efficiency details copy. */
  details: string;
};

export function emptyPookyOption(
  partial?: Partial<PookyOptionItem>,
): PookyOptionItem {
  return {
    name: "",
    images: [],
    price: 0,
    stock: 0,
    handle: "",
    sku: "",
    sortOrder: 0,
    ...partial,
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parseOptionList(raw: unknown): PookyOptionItem[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  const out: PookyOptionItem[] = [];
  for (const [index, row] of asArray<any>(parsed).entries()) {
    if (!row || typeof row !== "object") continue;
    const name = String(row.name || row.title || "").trim();
    if (!name) continue;
    const images = asArray<any>(row.images || row.imageUrls)
      .map((u) => String(u || "").trim())
      .filter(Boolean);
    const single = String(row.imageUrl || row.image || "").trim();
    if (single && !images.includes(single)) images.unshift(single);
    const price = Number(row.price);
    const stock = Number(row.stock);
    out.push({
      name,
      images,
      price: Number.isFinite(price) && price > 0 ? price : 0,
      stock: Number.isFinite(stock) && stock >= 0 ? stock : 0,
      handle: String(row.handle || "").trim(),
      sku: String(row.sku || "").trim(),
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

export function parsePookyBases(raw: unknown): PookyOptionItem[] {
  return parseOptionList(raw);
}

export function parsePookyShades(raw: unknown): PookyOptionItem[] {
  return parseOptionList(raw);
}

export function parsePookyPendants(raw: unknown): PookyOptionItem[] {
  return parseOptionList(raw);
}

export function parsePookyWallFittings(raw: unknown): PookyOptionItem[] {
  return parseOptionList(raw);
}

export function parsePookyEfficiency(raw: unknown): PookyEfficiency {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { summary: "", details: "" };
    if (trimmed.startsWith("{")) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return { summary: "", details: trimmed };
      }
    } else {
      return { summary: "", details: trimmed };
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return { summary: "", details: "" };
  }
  const o = parsed as any;
  return {
    summary: String(o.summary || o.title || o.rating || "").trim(),
    details: String(o.details || o.content || o.text || "").trim(),
  };
}

export function hasPookyOptions(
  items: PookyOptionItem[] | null | undefined,
): boolean {
  return Array.isArray(items) && items.some((i) => i.name);
}

export function hasPookyEfficiency(
  value: PookyEfficiency | null | undefined,
): boolean {
  return Boolean(value?.summary?.trim() || value?.details?.trim());
}
