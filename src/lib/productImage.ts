/**
 * Product image helpers.
 *
 * Stored order matches Linx Glass / Fakro:
 *   [0] primary (card + PDP hero)
 *   [1…] gallery extras in sort order (images + videos)
 */

function filterImages(images?: string[] | null): string[] {
  return (images || []).filter(
    (src): src is string => typeof src === "string" && Boolean(src.trim()),
  );
}

/** Cloudinary video delivery URL or common video extensions. */
export function isGalleryVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (/\/video\/upload\//i.test(url)) return true;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}

/** Poster/thumbnail for a Cloudinary video URL when possible. */
export function videoPosterUrl(url: string): string | undefined {
  if (!/\/video\/upload\//i.test(url)) return undefined;
  return url
    .replace("/video/upload/", "/video/upload/so_0,f_jpg/")
    .replace(/\.(mp4|webm|mov|m4v)(\?|$)/i, ".jpg$2");
}

/** Still images only (cards / mega menu — skip videos). */
export function getProductStillImages(images?: string[] | null): string[] {
  return filterImages(images).filter((src) => !isGalleryVideoUrl(src));
}

/** Gallery order for PDP — same sequence as stored / Linx Glass (includes videos). */
export function getProductGalleryImages(images?: string[] | null): string[] {
  return filterImages(images);
}

/** Primary image for cards, cart, search, mega menu, wishlist. */
export function getProductDisplayImage(images?: string[] | null): string {
  const stills = getProductStillImages(images);
  if (stills.length) return stills[0];
  return filterImages(images)[0] || "";
}

/** Prefer lifestyle/room shot for editorial “spaces” sections. */
export function getProductLifestyleImage(images?: string[] | null): string {
  const list = getProductStillImages(images);
  if (!list.length) return getProductDisplayImage(images);
  if (list.length >= 2) return list[1];
  return list[0];
}
