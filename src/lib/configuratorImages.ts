import {
  getProductGalleryImages,
  resolveGalleryImages,
  type ShopifyImagePair,
} from "@/lib/productImage";

/**
 * Collect displayable image URLs from product + variant payloads.
 *
 * Reads the Shopify pairing first. `images` alone is empty for every brand
 * whose gallery has been mirrored, which left the tile configurator — the
 * surface Tile Mountain's per-m² products land on — with no photographs.
 */
export function resolveConfiguratorImages(product: {
  images?: string[] | null;
  shopifyImages?: ShopifyImagePair[] | null;
  variants?: Array<{ imageUrl?: string | null }> | null;
}): string[] {
  const mirrored = resolveGalleryImages(product);
  if (mirrored.length) return getProductGalleryImages(mirrored);

  const fromGallery = getProductGalleryImages(product.images);
  if (fromGallery.length) return fromGallery;

  const fromVariants = (product.variants || [])
    .map((v) => String(v?.imageUrl || "").trim())
    .filter(Boolean);
  return [...new Set(fromVariants)];
}
