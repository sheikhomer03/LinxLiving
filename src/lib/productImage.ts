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

export function isVimeoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    /^vimeo:/i.test(url) ||
    /player\.vimeo\.com\/video\//i.test(url) ||
    /vimeo\.com\/\d/i.test(url)
  );
}

export function vimeoIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const bare = url.match(/^vimeo:(\d{6,})/i);
  if (bare) return bare[1];
  const player = url.match(/player\.vimeo\.com\/video\/(\d{6,})/i);
  if (player) return player[1];
  const watch = url.match(/vimeo\.com\/(?:channels\/[^/]+\/)?(\d{6,})/i);
  return watch ? watch[1] : null;
}

export function vimeoEmbedUrl(url: string): string | null {
  const id = vimeoIdFromUrl(url);
  return id ? `https://player.vimeo.com/video/${id}` : null;
}

/**
 * Any src the gallery should treat as a video rather than a still.
 *
 * Covers Cloudinary video delivery, YouTube, Vimeo and bare file extensions.
 * Vimeo carries no poster in the URL — unlike YouTube, whose thumbnail is
 * derivable from the id — so a Vimeo entry needs its poster supplied
 * alongside; see `videoPosters` on the gallery.
 */
export function isGalleryVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (isYoutubeUrl(url)) return true;
  if (isVimeoUrl(url)) return true;
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
 * Spectra's templated studio shots have a supplier logo band baked into the
 * top ~18% of the image (verified: logo graphics sit within y 25–150 of a
 * 1080px-tall image, tile artwork starts ~y 230). The template is always
 * exactly 1080x1080, regardless of .png/.jpg — their lifestyle/texture
 * photos use other dimensions (1400x1400, 1560x1560, etc.) and never carry
 * the logo, so filename (not extension) is the only reliable signal.
 * Filenames below were identified by checking every Spectra product image's
 * dimensions via Cloudinary's fl_getinfo. Crops via a Cloudinary transform
 * rather than touching the stored asset, so it's non-destructive.
 */
const SPECTRA_LOGO_BAND_FILENAMES = new Set([
  "fix-aquarius-onyx-grey-1.png",
  "fix-arsenic-pigeon-1.png",
  "fix-breccia-grey-1.png",
  "fix-calacatta-crema-1.png",
  "fix-doritos-green-glossy-1.jpg",
  "fix-emperador-natural-1.png",
  "fix-grey-spider-1.png",
  "fix-lakme-onyx-2-1.jpg",
  "fix-moon-crema-1.jpg",
  "fix-mordi-pista-1.jpg",
  "fix-mordi-sky-1.jpg",
  "fix-ocean-azzurro-1.jpg",
  "fix-lakme-onyx-1-1.jpg",
  "fix-perlino-cemento-1.jpg",
  "fix-plaza-white-1.jpg",
  "fix-regal-crema-1.jpg",
  "fix-regal-silver-1.jpg",
  "fix-snow-white-onyx-1.jpg",
  "fix-agate-aqua-1.png",
  "fix-amazon-azul-1.png",
  "fix-ananas-blue-onyx-1.png",
  "fix-black-fusion-1.png",
  "fix-cinder-wave-1.png",
  "fix-costa-green-1.png",
  "fix-dazzle-grey-1.png",
  "fix-natural-azul-onyx-1.jpg",
  "fix-nexside-blue-1-1.jpg",
  "fix-alaska-white-1.png",
  "fix-baltic-bianco-1.png",
  "fix-olivia-grey-1.jpg",
  "fix-alix-olive-lt-1.jpg",
  "fix-bottochino-crema-1.jpg",
  "fix-celino-gold-1.jpg",
  "fix-clivia-blue-1.jpg",
  "fix-dream-desire-beige-1.jpg",
  "fix-florian-pista-1.jpg",
  "fix-florian-sky-glossy-1.jpg",
  "fix-marfo-crema-1.jpg",
  "fix-mentos-blue-1.jpg",
  "fix-opera-grey-1.jpg",
  "fix-zion-grey-1.jpg",
  "royal-aqua-onyx-lt-1.jpg",
  "nexside-blue-dk-1.jpg",
  "bianco-lasa-1.png",
  "berlin-beige-1.png",
  "calacatta-creamo-matt-1.png",
]);

/**
 * Cloudinary delivery transform: auto format (WebP/AVIF where supported,
 * original format otherwise) + auto quality, chained with the Spectra
 * logo-band crop when that file needs it. `unoptimized: true` in
 * next.config.js means next/image never resizes/recompresses these, so
 * without this every card, thumbnail and gallery shot downloads at its full
 * original weight — this asks Cloudinary to do that work at delivery time
 * instead, non-destructively (the stored asset is untouched).
 */
function applyCloudinaryDeliveryTransform(url: string): string {
  if (!isCloudinaryUrl(url)) return url;
  if (!/\/image\/upload\//.test(url)) return url;

  const isSpectraLogoBand =
    /\/products\/spectra\//i.test(url) &&
    SPECTRA_LOGO_BAND_FILENAMES.has(url.split("/").pop()?.split("?")[0] || "");

  const segments = [
    isSpectraLogoBand ? "c_crop,x_0,y_0.18,w_1.0,h_0.82,fl_relative" : null,
    "f_auto,q_auto",
  ].filter(Boolean);

  return url.replace("/image/upload/", `/image/upload/${segments.join("/")}/`);
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
    return list
      .filter(
        (src) =>
          (isCloudinaryUrl(src) && !isGalleryVideoUrl(src)) ||
          isGalleryVideoUrl(src),
      )
      .map(applyCloudinaryDeliveryTransform);
  }

  return list.map(applyCloudinaryDeliveryTransform);
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
