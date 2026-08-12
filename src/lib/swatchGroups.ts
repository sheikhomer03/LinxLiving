import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";

export type ResolvedSwatch = {
  label: string;
  /** Our product id, when the sibling finish is in the catalogue. */
  productId: string;
  colorValue: string;
  secondaryColor: string;
  swatchImage: string;
  /** Sibling's own lead image — shown in the gallery on hover. */
  previewImage: string;
  price: number | null;
  available: boolean;
  isCurrent: boolean;
};

export type ResolvedSwatchGroup = {
  optionName: string;
  swatches: ResolvedSwatch[];
};

type RawSwatch = {
  label?: string;
  handle?: string;
  colorValue?: string;
  secondaryColor?: string;
  swatchImage?: string;
  price?: number | null;
  available?: boolean;
  isCurrent?: boolean;
};

/**
 * Suppliers that sell one product per finish link the siblings by handle. Turn
 * those handles into ids and lead images so the PDP can preview and link them,
 * dropping any finish we do not stock.
 */
export async function resolveSwatchGroups(
  raw: unknown,
  currentProductId: string,
): Promise<ResolvedSwatchGroup[]> {
  const groups = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  if (!groups.length) return [];

  const handles = new Set<string>();
  for (const g of groups) {
    for (const s of (g?.swatches || []) as RawSwatch[]) {
      const h = String(s?.handle || "").trim();
      if (h) handles.add(h);
    }
  }
  if (!handles.size) return [];

  await connectDB();
  const rows = await Product.find({
    "specs.plankHandle": { $in: [...handles] },
  })
    .select("_id name images specs.plankHandle")
    .lean<
      { _id: unknown; images?: string[]; specs?: { plankHandle?: string } }[]
    >();

  const byHandle = new Map<string, { id: string; image: string }>();
  for (const r of rows) {
    const h = String(r?.specs?.plankHandle || "");
    if (!h || byHandle.has(h)) continue;
    byHandle.set(h, {
      id: String(r._id),
      image: String((r.images || [])[0] || ""),
    });
  }

  const out: ResolvedSwatchGroup[] = [];
  for (const g of groups) {
    const swatches: ResolvedSwatch[] = [];
    for (const s of (g?.swatches || []) as RawSwatch[]) {
      const hit = byHandle.get(String(s?.handle || "").trim());
      if (!hit) continue;
      swatches.push({
        label: String(s?.label || "").trim(),
        productId: hit.id,
        colorValue: String(s?.colorValue || ""),
        secondaryColor: String(s?.secondaryColor || ""),
        swatchImage: String(s?.swatchImage || ""),
        previewImage: hit.image,
        price: typeof s?.price === "number" ? s.price : null,
        available: s?.available !== false,
        isCurrent: hit.id === String(currentProductId),
      });
    }
    // Live shows the chip even when a finish has no siblings.
    if (swatches.length) {
      out.push({
        optionName: String(g?.optionName || "Finish").trim() || "Finish",
        swatches,
      });
    }
  }
  return out;
}
