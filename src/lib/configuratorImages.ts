import { getProductGalleryImages, getProductDisplayImage } from "@/lib/productImage";

/** Collect displayable image URLs from product + variant payloads. */
export function resolveConfiguratorImages(product: {
  images?: string[] | null;
  variants?: Array<{ imageUrl?: string | null }> | null;
}): string[] {
  const fromGallery = getProductGalleryImages(product.images);
  if (fromGallery.length) return fromGallery;

  const primary = getProductDisplayImage(product.images);
  if (primary) return [primary];

  const fromVariants = (product.variants || [])
    .map((v) => String(v?.imageUrl || "").trim())
    .filter(Boolean);
  return [...new Set(fromVariants)];
}
