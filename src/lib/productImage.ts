/**
 * Product image helpers.
 *
 * Stored order matches Linx Glass / Fakro:
 *   [0] primary (card + PDP hero)
 *   [1…] gallery extras in sort order (images + videos)
 */

export function isShopifyCdnUrl(src: string): boolean {
  return /cdn\.shopify\.com|cdn\.shopifycdn\.net/i.test(src);
}

/** YouTube watch / embed / youtu.be / youtube:ID forms. */
export function isYoutubeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    /^youtube:/i.test(url) ||
    /youtube\.com\/(watch|embed|shorts)/i.test(url) ||
    /youtu\.be\//i.test(url)
  );
}

export function youtubeIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const bare = url.match(/^youtube:([a-zA-Z0-9_-]{6,})/i);
  if (bare) return bare[1];
  const m =
    url.match(/[?&]v=([a-zA-Z0-9_-]{6,})/) ||
    url.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/) ||
    url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/) ||
    url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,})/);
  return m?.[1] || null;
}

export function youtubeEmbedUrl(url: string): string | null {
  const id = youtubeIdFromUrl(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

export function youtubePosterUrl(url: string): string | undefined {
  const id = youtubeIdFromUrl(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined;
}

/** Cloudinary video delivery URL, YouTube, or common video extensions. */
export function isGalleryVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (isYoutubeUrl(url)) return true;
  if (/\/video\/upload\//i.test(url)) return true;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}

/** True when gallery has a usable Cloudinary still. */
export function hasCloudinaryImage(images?: string[] | null): boolean {
  return (images || []).some(
    (src) =>
      typeof src === "string" &&
      Boolean(src.trim()) &&
      isCloudinaryUrl(src) &&
      !isGalleryVideoUrl(src),
  );
}

/** True when gallery has any durable (non-Shopify) still. */
export function hasNonShopifyImage(images?: string[] | null): boolean {
  return (images || []).some(
    (src) =>
      typeof src === "string" &&
      Boolean(src.trim()) &&
      !isShopifyCdnUrl(src) &&
      !isGalleryVideoUrl(src),
  );
}

export function isCloudinaryUrl(src: string): boolean {
  return /res\.cloudinary\.com|cloudinary\.com/i.test(src);
}

/**
 * Display priority:
 *  1) Cloudinary stills (durable) + any videos from the gallery
 *  2) Otherwise the full stored gallery (Shopify stills + YouTube/mp4)
 *
 * Important: do NOT prefer bare YouTube / non-Shopify video URLs over Shopify
 * product photos — UFHS enrich often keeps CDN stills + youtube: entries, and
 * dropping the stills leaves a video-only PDP gallery.
 */
function filterImages(images?: string[] | null): string[] {
  const list = (images || []).filter(
    (src): src is string => typeof src === "string" && Boolean(src.trim()),
  );
  if (!list.length) return [];

  const cloudinaryStills = list.filter(
    (src) => isCloudinaryUrl(src) && !isGalleryVideoUrl(src),
  );
  if (cloudinaryStills.length) {
    return list.filter(
      (src) =>
        (isCloudinaryUrl(src) && !isGalleryVideoUrl(src)) ||
        isGalleryVideoUrl(src),
    );
  }

  return list;
}

/** Trim / pass-through for brand & menu cover URLs (Shopify allowed as fallback). */
export function sanitizeDisplayImageUrl(src?: string | null): string {
  if (!src || typeof src !== "string") return "";
  return src.trim();
}

/** Poster/thumbnail for Cloudinary / YouTube video URLs when possible. */
export function videoPosterUrl(url: string): string | undefined {
  if (isYoutubeUrl(url)) return youtubePosterUrl(url);
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
