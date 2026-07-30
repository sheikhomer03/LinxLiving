import { getProductDisplayImage } from "@/lib/productImage";

export type MoreFromProduct = {
  id: string;
  name: string;
  price: number;
  image?: string;
  category?: string;
  brandName?: string;
  shopifyVariantId?: string | null;
  stock?: number;
};

/** Group products by baseTitle (fallback: name without size), pick one each. */
export function pickMoreFromProducts(
  products: Array<{
    _id: string;
    name: string;
    price: number;
    images?: unknown;
    category?: string;
    stock?: number;
    shopifyVariantId?: string | null;
    specs?: { baseTitle?: string; basetitle?: string };
    brandName?: string;
  }>,
  current: { id: string; baseTitle?: string; name: string },
  limit = 3,
): MoreFromProduct[] {
  const currentBase = (
    current.baseTitle ||
    current.name.replace(/\s+\d+(\.\d+)?\s*cm\s*x\s*\d+(\.\d+)?\s*cm$/i, "") ||
    current.name
  ).trim();

  const seen = new Set<string>();
  const picked: MoreFromProduct[] = [];

  for (const p of products) {
    if (String(p._id) === String(current.id)) continue;
    const base = String(
      p.specs?.baseTitle ||
        p.specs?.basetitle ||
        p.name.replace(/\s+\d+(\.\d+)?\s*cm\s*x\s*\d+(\.\d+)?\s*cm$/i, "") ||
        p.name,
    ).trim();
    if (base.toLowerCase() === currentBase.toLowerCase()) continue;
    const key = base.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({
      id: String(p._id),
      name: base || p.name,
      price: Number(p.price) || 0,
      image: getProductDisplayImage(p.images as any) || undefined,
      category: p.category,
      brandName: p.brandName,
      shopifyVariantId: p.shopifyVariantId,
      stock: p.stock ?? 0,
    });
    if (picked.length >= limit) break;
  }

  return picked;
}
