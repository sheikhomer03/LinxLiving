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
 * Gallery order, as stored.
 *
 * Shopify is now the image host: every still is displayed from its Shopify CDN
 * copy via `buildShopifyFallbackMap`, and the stored URL is only the key that
 * finds it. Selection here therefore no longer prefers one host over another —
 * it just drops blanks and keeps the supplier's order.
 *
 * The Cloudinary preference this used to apply is kept below, commented, along
 * with the delivery transform it depended on. Both become relevant again only
 * if Cloudinary is ever restored as a display host.
 *
 * // const cloudinaryStills = list.filter(
 * //   (src) => isCloudinaryUrl(src) && !isGalleryVideoUrl(src),
 * // );
 * // if (cloudinaryStills.length) {
 * //   return list
 * //     .filter(
 * //       (src) =>
 * //         (isCloudinaryUrl(src) && !isGalleryVideoUrl(src)) ||
 * //         isGalleryVideoUrl(src),
 * //     )
 * //     .map(applyCloudinaryDeliveryTransform);
 * // }
 * // return list.map(applyCloudinaryDeliveryTransform);
 */
function filterImages(images?: string[] | null): string[] {
  const list = (images || []).filter(
    (src): src is string => typeof src === "string" && Boolean(src.trim()),
  );
  if (!list.length) return [];
  return list;
}

/** One entry of `Product.shopifyImages`: a stored URL and its Shopify copy. */
export type ShopifyImagePair = {
  sourceUrl?: string | null;
  shopifyUrl?: string | null;
};

/**
 * Stored URL → the Shopify CDN copy of the same file.
 *
 * Every image pushed to Shopify is mirrored onto its CDN, and `shopifyImages`
 * records which copy came from which source. The two URLs share no structure —
 * different host, different filename — so neither can be derived from the other
 * at render time and the pairing has to be carried.
 *
 * Shopify is served first and the stored Cloudinary URL is the fallback. Keys
 * are the *delivered* URLs, transform and all, because that is the string the
 * gallery puts in `src` and therefore the one it reports as failed; keying on
 * the stored original would never match.
 */
export function buildShopifyFallbackMap(
  pairs?: ShopifyImagePair[] | null,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of pairs || []) {
    const source = String(pair?.sourceUrl || "").trim();
    const shopify = String(pair?.shopifyUrl || "").trim();
    if (!source || !shopify || source === shopify) continue;
    map[source] = shopify;
    // A Shopify URL maps to itself. `images` is rewritten to Shopify before it
    // reaches the page, so later lookups arrive already mirrored and would
    // otherwise miss and resolve to nothing.
    map[shopify] = shopify;
    // Gallery entries are no longer rewritten by the Cloudinary transform, so
    // the stored URL is the only key needed. Kept for the restore path:
    // const delivered = applyCloudinaryDeliveryTransform(source);
    // if (delivered !== source) map[delivered] = shopify;
  }
  return map;
}

/**
 * The reverse pairing: Shopify CDN URL → the stored Cloudinary original.
 *
 * With Shopify served first, this is what the gallery falls back to when a
 * Shopify file 404s — the mirror is younger than the originals and a handful of
 * its media was deleted by an earlier duplicate-product bug.
 */
export function buildCloudinaryFallbackMap(
  pairs?: ShopifyImagePair[] | null,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of pairs || []) {
    const source = String(pair?.sourceUrl || "").trim();
    const shopify = String(pair?.shopifyUrl || "").trim();
    if (!source || !shopify || source === shopify) continue;
    map[shopify] = applyCloudinaryDeliveryTransform(source);
  }
  return map;
}

/**
 * What to actually load for a stored gallery entry.
 *
 * Shopify holds a mirror of every gallery image, and serving from the same
 * host as the checkout keeps the product page on one CDN. The stored URL is
 * returned unchanged when no mirror exists — a video marker, a supplier URL
 * never pushed, an image added since the last sync.
 */
export function preferredImageUrl(
  src: string,
  shopifyByStored?: Record<string, string> | null,
): string {
  if (!src) return src;
  return shopifyByStored?.[src] || src;
}

/**
 * Every option and variant image on a product, rewritten to its Shopify copy.
 *
 * The pickers, spec tabs and swatches all read `imageUrl` straight off the
 * option arrays, so pointing the gallery at Shopify left those thumbnails on
 * Cloudinary. Rewriting the data once, here, means every component that reads
 * `imageUrl` gets the Shopify URL without each render site having to know
 * about the pairing.
 *
 * A variant already carries `shopifyImageUrl` from the sync, so it is used
 * directly; option arrays are resolved through the gallery pairing. Anything
 * with no Shopify copy becomes empty, which is what the rest of the site does
 * now that Cloudinary is not displayed.
 */
const OPTION_IMAGE_FIELDS = [
  "colorOptions",
  "sizeOptions",
  "typeOptions",
  "finishes",
  "flashings",
  "flashingFinder",
  "suitability",
  "usage",
] as const;

export function withShopifyOptionImages<T extends Record<string, unknown>>(
  product: T,
): T {
  const pairs = (product as { shopifyImages?: ShopifyImagePair[] }).shopifyImages;
  const map = buildShopifyFallbackMap(pairs);
  const next: Record<string, unknown> = { ...product };

  // The gallery itself, so anything reading `images` — the cart line snapshot
  // above all — carries a Shopify URL rather than a Cloudinary one.
  const images = (product as { images?: string[] }).images;
  if (Array.isArray(images)) {
    next.images = images
      .map((src) => {
        const value = String(src || "");
        if (!value) return "";
        // Video markers and external references have no Shopify still to map.
        if (isGalleryVideoUrl(value)) return value;
        return map[value] || "";
      })
      .filter(Boolean);
  }

  const variants = (product as { variants?: Record<string, unknown>[] }).variants;
  if (Array.isArray(variants)) {
    next.variants = variants.map((v) => ({
      ...v,
      imageUrl:
        String(v.shopifyImageUrl || "") ||
        map[String(v.imageUrl || "")] ||
        "",
    }));
  }

  for (const field of OPTION_IMAGE_FIELDS) {
    const list = (product as Record<string, unknown>)[field];
    if (!Array.isArray(list)) continue;
    next[field] = list.map((o) => {
      const row = o as Record<string, unknown>;
      const src = String(row.imageUrl || row.image || "");
      if (!src) return row;
      const mirrored = map[src] || "";
      return {
        ...row,
        ...(row.imageUrl !== undefined ? { imageUrl: mirrored } : {}),
        ...(row.image !== undefined ? { image: mirrored } : {}),
      };
    });
  }

  return next as T;
}

/**
 * The gallery, restricted to entries Shopify actually hosts.
 *
 * Cloudinary is no longer displayed or used as a fallback, so a still with no
 * Shopify copy has nothing to render and is dropped rather than left as a
 * broken frame. Videos pass through untouched: Shopify holds them as its own
 * media types, and YouTube/Vimeo markers were never Cloudinary's to mirror.
 *
 * A product whose images are all still awaiting mirror therefore shows the
 * gallery's own "no image" state until the sync reaches it.
 */
export function shopifyOnlyImages(
  images?: string[] | null,
  shopifyByStored?: Record<string, string> | null,
): string[] {
  return filterImages(images)
    .map((src) => (isGalleryVideoUrl(src) ? src : shopifyByStored?.[src] || ""))
    .filter(Boolean);
}

/**
 * True when a product has no still that would survive Cloudinary being down.
 */
export function hasShopifyFallbackOnly(
  images?: string[] | null,
  pairs?: ShopifyImagePair[] | null,
): boolean {
  return !hasCloudinaryImage(images) && (pairs || []).some((p) => p?.shopifyUrl);
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
