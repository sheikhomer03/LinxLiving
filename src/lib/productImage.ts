/**
 * Spectra galleries are typically:
 *   [0] branded packshot (logo + pedestal)
 *   [1] lifestyle / room shot
 *   [2] surface texture (best "real" product look)
 */

function filterImages(images?: string[] | null): string[] {
  return (images || []).filter(
    (src): src is string => typeof src === "string" && Boolean(src.trim()),
  );
}

/** Prefer surface texture for catalogue cards / hero. */
export function getProductDisplayImage(images?: string[] | null): string {
  const list = filterImages(images);
  if (!list.length) return "";
  if (list.length >= 2) return list[list.length - 1];
  return list[0];
}

/** Prefer lifestyle/room shot for editorial “spaces” sections. */
export function getProductLifestyleImage(images?: string[] | null): string {
  const list = filterImages(images);
  if (!list.length) return "";
  if (list.length >= 2) return list[1];
  return list[0];
}

/** Gallery order: surface first, then lifestyle, packshot last. */
export function getProductGalleryImages(images?: string[] | null): string[] {
  const list = filterImages(images);
  if (list.length <= 1) return list;
  return [list[list.length - 1], ...list.slice(0, -1)];
}
