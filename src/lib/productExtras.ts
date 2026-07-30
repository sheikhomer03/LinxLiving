/** Shared Glass-style product extras (optional). */

export type ProductOptionExtra = {
  name: string;
  imageUrl?: string;
  priceAdjustment?: number;
  sortOrder?: number;
};

export type FlashingFinderItem = {
  title: string;
  description?: string;
  imageUrl?: string;
};

export type ProductExtras = {
  installationGuide?: string | null;
  insulatingSetPrice?: number | null;
  flashingFinder?: FlashingFinderItem[];
  finishes?: ProductOptionExtra[];
  flashings?: ProductOptionExtra[];
};

export function emptyProductExtras(): ProductExtras {
  return {
    installationGuide: "",
    insulatingSetPrice: null,
    flashingFinder: [],
    finishes: [],
    flashings: [],
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function cleanOption(raw: any, index: number): ProductOptionExtra | null {
  const name = String(raw?.name || "").trim();
  if (!name) return null;
  const price = Number(raw?.priceAdjustment ?? raw?.price_adjustment ?? 0);
  return {
    name,
    imageUrl: String(raw?.imageUrl || raw?.image_url || "").trim() || undefined,
    priceAdjustment: Number.isFinite(price) ? price : 0,
    sortOrder:
      typeof raw?.sortOrder === "number"
        ? raw.sortOrder
        : typeof raw?.sort_order === "number"
          ? raw.sort_order
          : index,
  };
}

function cleanFinder(raw: any): FlashingFinderItem | null {
  const title = String(raw?.title || "").trim();
  if (!title) return null;
  return {
    title,
    description: String(raw?.description || "").trim() || undefined,
    imageUrl: String(raw?.imageUrl || raw?.image_url || "").trim() || undefined,
  };
}

/** Normalize FormData / Shopify / Mongo payloads into clean extras. */
export function parseProductExtras(input: {
  installationGuide?: unknown;
  insulatingSetPrice?: unknown;
  flashingFinder?: unknown;
  finishes?: unknown;
  flashings?: unknown;
}): ProductExtras {
  const guide = String(input.installationGuide ?? "").trim();

  let insulating: number | null = null;
  const rawIns = input.insulatingSetPrice;
  if (rawIns !== null && rawIns !== undefined && String(rawIns).trim() !== "") {
    const n = Number(rawIns);
    if (Number.isFinite(n)) insulating = n;
  }

  const flashingFinder = asArray<any>(input.flashingFinder)
    .map(cleanFinder)
    .filter(Boolean) as FlashingFinderItem[];

  const finishes = asArray<any>(input.finishes)
    .map(cleanOption)
    .filter(Boolean) as ProductOptionExtra[];

  const flashings = asArray<any>(input.flashings)
    .map(cleanOption)
    .filter(Boolean) as ProductOptionExtra[];

  return {
    installationGuide: guide || null,
    insulatingSetPrice: insulating,
    flashingFinder,
    finishes,
    flashings,
  };
}

export function parseProductExtrasFromFormData(formData: FormData): ProductExtras {
  const parseJson = (key: string) => {
    try {
      return JSON.parse(String(formData.get(key) || "[]"));
    } catch {
      return [];
    }
  };

  return parseProductExtras({
    installationGuide: formData.get("installationGuide"),
    insulatingSetPrice: formData.get("insulatingSetPrice"),
    flashingFinder: parseJson("flashingFinder"),
    finishes: parseJson("finishes"),
    flashings: parseJson("flashings"),
  });
}
