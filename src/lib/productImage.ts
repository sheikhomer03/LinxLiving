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
 * Spectra's templated studio shots have a supplier logo band — the teal
 * diamond plus "Spectra / PORCELAIN TILES" — baked into the top 18% of the
 * image. Every one of them is exactly 1080x1080; the brand's lifestyle and
 * texture photography uses other sizes (1400x1400, 2835x2835, …) and never
 * carries the logo.
 *
 * The list was derived by fetching all 177 Spectra images and measuring the
 * fraction of saturated-teal pixels in the top 18%. The split is absolute —
 * every logo shot scores ≥ 0.0039, every clean shot ≤ 0.00001 — and each hit
 * was then confirmed by eye on a contact sheet of the bands. Size alone is
 * *not* sufficient: 68 of the 1080x1080 images are logo-free gallery shots.
 *
 * Keyed on the stored Cloudinary basename rather than the delivered Shopify
 * one: the mirror renames 19 of these on upload (`fix-plaza-white-1.jpg` →
 * `plaza-white-gloss-600x1200-1.jpg`, several gaining UUID suffixes), and a
 * re-sync can rename them again. The stored URL is the stable identity.
 *
 * Three files the previous revision of this list named are deliberately
 * absent — `nexside-blue-dk-1.jpg` is already stored pre-cropped (1080x885),
 * and `fix-mordi-pista-1.jpg` / `fix-mordi-sky-1.jpg` are lifestyle room
 * shots. Cropping any of them would cut into the tile instead of a logo.
 */
/**
 * Spectra's studio template bakes a supplier logo into the top ~18% of the
 * image. Verified by measuring all 177 Spectra images: the template is always
 * exactly 1080x1080 (115 of them), while their lifestyle and texture photos
 * are 1400x1400 or larger and never carry the logo — so size, not the product,
 * is the signal, and the crop must be per-image rather than per-brand.
 *
 * Matched on the base name because Shopify renames on mirroring: the same file
 * arrives as `alaska-white-600x1200-1_<uuid>.png`. The previous list held the
 * pre-mirror Cloudinary names, so 90 logo images stopped matching and the band
 * came back. The uuid and extension are stripped before lookup.
 *
 * Regenerate by measuring the delivered images; do not hand-edit.
 */
const SPECTRA_LOGO_BAND_FILENAMES = new Set([
  "alaska-white-600x1200-1",
  "alaska-white-600x1200-2",
  "alaska-white-600x1200-3",
  "ananas-blue-onyx-600x1200-1",
  "ananas-blue-onyx-600x1200-2",
  "ananas-blue-onyx-600x1200-3",
  "baltic-bianco-matt-600x1200-1",
  "baltic-bianco-matt-600x1200-2",
  "baltic-bianco-matt-600x1200-3",
  "berlin-beige-1",
  "bianco-lasa-1",
  "black-fusion-600x1200-1",
  "black-fusion-600x1200-2",
  "black-fusion-600x1200-3",
  "calacatta-creamo-matt-1",
  "calacatta-creamo-matt-2",
  "calacatta-creamo-matt-3",
  "cinder-wave-600x1200-1",
  "cinder-wave-600x1200-2",
  "cinder-wave-600x1200-3",
  "costa-green-600x1200-1",
  "costa-green-600x1200-2",
  "costa-green-600x1200-3",
  "dazzle-grey-600x1200-1",
  "dazzle-grey-600x1200-2",
  "dazzle-grey-600x1200-3",
  "fix-agate-aqua-1",
  "fix-agate-aqua-2",
  "fix-agate-aqua-3",
  "fix-alix-olive-lt-1",
  "fix-alix-olive-lt-2",
  "fix-alix-olive-lt-3",
  "fix-amazon-azul-1",
  "fix-amazon-azul-2",
  "fix-amazon-azul-3",
  "fix-aquarius-onyx-grey-1",
  "fix-arsenic-pigeon-1",
  "fix-arsenic-pigeon-2",
  "fix-arsenic-pigeon-3",
  "fix-bottochino-crema-1",
  "fix-bottochino-crema-2",
  "fix-bottochino-crema-3",
  "fix-breccia-grey-1",
  "fix-calacatta-crema-1",
  "fix-calacatta-crema-2",
  "fix-calacatta-crema-3",
  "fix-celino-gold-1",
  "fix-celino-gold-2",
  "fix-celino-gold-3",
  "fix-clivia-blue-1",
  "fix-clivia-blue-2",
  "fix-clivia-blue-3",
  "fix-doritos-green-glossy-1",
  "fix-doritos-green-glossy-2",
  "fix-doritos-green-glossy-3",
  "fix-dream-desire-beige-1",
  "fix-dream-desire-beige-2",
  "fix-dream-desire-beige-3",
  "fix-emperador-natural-1",
  "fix-emperador-natural-2",
  "fix-emperador-natural-3",
  "fix-florian-pista-1",
  "fix-florian-pista-2",
  "fix-florian-pista-3",
  "fix-florian-sky-glossy-1",
  "fix-florian-sky-glossy-2",
  "fix-florian-sky-glossy-3",
  "fix-grey-spider-1",
  "fix-lakme-onyx-1-1",
  "fix-lakme-onyx-2-1",
  "fix-marfo-crema-1",
  "fix-marfo-crema-2",
  "fix-marfo-crema-3",
  "fix-mentos-blue-1",
  "fix-mentos-blue-2",
  "fix-mentos-blue-3",
  "fix-mordi-pista-1",
  "fix-olivia-grey-1",
  "fix-olivia-grey-2",
  "fix-olivia-grey-3",
  "fix-opera-grey-1",
  "fix-opera-grey-2",
  "fix-opera-grey-3",
  "fix-zion-grey-1",
  "fix-zion-grey-2",
  "fix-zion-grey-3",
  "moon-creama-600x1200-1",
  "moon-creama-600x1200-2",
  "moon-creama-600x1200-3",
  "mordi-sky-600x1200-1",
  "natural-azul-onyx-600x1200-1",
  "natural-azul-onyx-600x1200-2",
  "natural-azul-onyx-600x1200-3",
  "nexside-blue-lt-600x1200-1",
  "nexside-blue-lt-600x1200-2",
  "nexside-blue-lt-600x1200-3",
  "ocean-azzurro-600x1200-1",
  "perlino-cemento-gloss-600x1200-1",
  "plaza-white-gloss-600x1200-1",
  "plaza-white-gloss-600x1200-2",
  "plaza-white-gloss-600x1200-3",
  "regal-crema-gloss-600x1200-1",
  "regal-crema-gloss-600x1200-2",
  "regal-silver-gloss-600x1200-1",
  "regal-silver-gloss-600x1200-2",
  "regal-silver-gloss-600x1200-3",
  "royal-aqua-onyx-lt-1",
  "royal-aqua-onyx-lt-2",
  "royal-aqua-onyx-lt-3",
  "snow-white-onyx-600x1200-1",
  "snow-white-onyx-600x1200-2",
  "snow-white-onyx-600x1200-3",
]);

/** Delivered filename -> the stable base the set above is keyed on. */
function spectraImageBase(url: string): string {
  const file = url.split("/").pop()?.split("?")[0] || "";
  return file
    .replace(/\.(png|jpe?g|webp)$/i, "")
    .replace(
      /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "",
    );
}

/** Fraction of the image height the logo band occupies. */
const SPECTRA_LOGO_BAND = 0.18;

/** Every logo-band file measured exactly this square. */
const SPECTRA_TEMPLATE_PX = 1080;

/*
 * The three helpers below were referenced from four places in this file but
 * never defined — the branch this file came from does not compile on its own.
 * They are restored here from the revision that did define them, rewritten to
 * use the two constants above so there is one name per idea rather than the
 * two parallel sets the branches had drifted into.
 */

/** True for a *stored* (Cloudinary) URL whose file carries the logo band. */
function isSpectraLogoBandSource(src: string): boolean {
  if (!/\/products\/spectra\//i.test(src)) return false;
  return SPECTRA_LOGO_BAND_FILENAMES.has(spectraImageBase(src));
}

/**
 * Width/height pair that trims the logo band off a square Spectra shot.
 *
 * Capped at the source's own size: Shopify will not crop above it — ask for
 * 1081px wide and it quietly returns the uncropped square, logo and all.
 */
function spectraCropSize(width: number): { w: number; h: number } {
  const w = Math.min(Math.max(1, Math.round(width)), SPECTRA_TEMPLATE_PX);
  return { w, h: Math.round(w * (1 - SPECTRA_LOGO_BAND)) };
}

/**
 * Trim the Spectra logo band off a Shopify-hosted still.
 *
 * Shopify crops on delivery from `width` + `height` + `crop`: asking for a
 * shorter box than the source's aspect and anchoring it to the bottom keeps
 * the lower 82% — the tile — and drops the logo. The stored file is untouched,
 * so this is reversible by deleting the call.
 *
 * Emitted at full source width; `cdnImageUrl` scales the pair down together
 * for the size each surface actually paints.
 */
function applyShopifyLogoCrop(shopifyUrl: string): string {
  if (!shopifyUrl || /[?&]crop=/.test(shopifyUrl)) return shopifyUrl;
  const { w, h } = spectraCropSize(SPECTRA_TEMPLATE_PX);
  const sep = shopifyUrl.includes("?") ? "&" : "?";
  return `${shopifyUrl}${sep}width=${w}&height=${h}&crop=bottom`;
}

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

  const segments = [
    isSpectraLogoBandSource(url)
      ? `c_crop,x_0,y_${SPECTRA_LOGO_BAND},w_1.0,h_${
          1 - SPECTRA_LOGO_BAND
        },fl_relative`
      : null,
    "f_auto,q_auto",
  ].filter(Boolean);

  return url.replace("/image/upload/", `/image/upload/${segments.join("/")}/`);
}

/**
 * Ask the CDN for an image at roughly the size it will be shown.
 *
 * `next.config.ts` sets `unoptimized: true` (Vercel's optimizer returns 402 on
 * this plan), so without this every card downloads its original: the homepage
 * pulled 7.9MB of images, including a 5000x3750 photo painted at 1512px and
 * 1080x1080 tiles painted at 429px. Both hosts resize on delivery — Shopify
 * from a `width` query parameter, Cloudinary from a `w_` transform — and both
 * leave the stored asset untouched.
 *
 * `width` is the CSS width the image occupies; the request is made at 2x for
 * retina, capped at the source's own dimensions by the CDN.
 */
export function cdnImageUrl(src: string, width: number): string {
  if (!src) return src;
  // 2x for retina, but capped: a full-bleed hero at 1512 CSS px would
  // otherwise request 3024px and download several megabytes for one image.
  const target = Math.min(Math.round(width * 2), 1600);

  if (isShopifyCdnUrl(src)) {
    // A Spectra logo-band crop arrives here already carrying width/height/crop
    // at full source size. Resize the pair together rather than returning it
    // untouched, so a 430px card does not download the whole 1080px file —
    // and never above the source, which would drop the crop (see
    // SPECTRA_TEMPLATE_PX) and put the logo back on screen.
    if (/[?&]crop=/.test(src)) {
      const { w, h } = spectraCropSize(target);
      return src
        .replace(/([?&]width=)\d+/, `$1${w}`)
        .replace(/([?&]height=)\d+/, `$1${h}`);
    }
    // Shopify keeps its own `?v=` cache-buster, so append rather than replace.
    if (/[?&]width=/.test(src)) return src;
    const sep = src.includes("?") ? "&" : "?";

    // Spectra's logo band is cropped off at delivery. The source is square, so
    // keeping the bottom 82% removes the band and leaves the tile artwork.
    if (SPECTRA_LOGO_BAND_FILENAMES.has(spectraImageBase(src))) {
      // Shopify ignores a crop it cannot satisfy: ask for more than the source
      // holds and it returns the original, band and all. The template is always
      // 1080 square, so the request is capped there.
      const width = Math.min(target, SPECTRA_TEMPLATE_PX);
      const height = Math.round(width * (1 - SPECTRA_LOGO_BAND));
      return `${src}${sep}width=${width}&height=${height}&crop=bottom`;
    }

    return `${src}${sep}width=${target}`;
  }

  if (isCloudinaryUrl(src) && /\/image\/upload\//.test(src)) {
    if (/\/image\/upload\/[^/]*\bw_\d/.test(src)) return src;
    return src.replace(
      "/image/upload/",
      `/image/upload/f_auto,q_auto,w_${target},c_limit/`,
    );
  }

  return src;
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
    // An already-mirrored product stores the Shopify URL as its own source, so
    // the two match. Skipping those dropped the pair from the map entirely and
    // the card resolved to "" — a fully synced product rendered blank. Such a
    // pair maps to itself, which is what the self-map below always intended.
    if (!source || !shopify) continue;
    // Spectra's studio shots carry the supplier's logo in a band across the
    // top; the crop is decided from `source` because the mirror renames many
    // of these files on upload, so the Shopify name is not a stable key.
    const delivered = isSpectraLogoBandSource(source)
      ? applyShopifyLogoCrop(shopify)
      : shopify;
    map[source] = delivered;
    // A Shopify URL maps to itself. `images` is rewritten to Shopify before it
    // reaches the page, so later lookups arrive already mirrored and would
    // otherwise miss and resolve to nothing.
    map[shopify] = delivered;
    // …and a cropped URL fed back in resolves to itself rather than missing.
    if (delivered !== shopify) map[delivered] = delivered;
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
    const restored = applyCloudinaryDeliveryTransform(source);
    map[shopify] = restored;
    // The gallery reports the URL it actually put in `src` as the failed one,
    // so a cropped Spectra still has to be keyed under its cropped form too —
    // keying only on the bare mirror URL would never match.
    if (isSpectraLogoBandSource(source)) {
      map[applyShopifyLogoCrop(shopify)] = restored;
    }
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
  const list = getProductStillImages(images).filter(
    (src) => !isSpecGraphicImage(src),
  );
  if (!list.length) return getProductDisplayImage(images);
  if (list.length >= 2) return list[1];
  return list[0];
}

/**
 * Supplier "features" plates: a room shot with callout icons and spec copy
 * baked into the pixels — "1.2mm stainless steel", "PVD coated". Fine on a
 * product page, wrong anywhere the site prints its own caption over the
 * photograph, because the two sets of text land on top of each other. RAK ship
 * these as the first image, so the homepage's inspiration cards picked them.
 */
const SPEC_GRAPHIC_FILENAME =
  /(^|[-_])(features?|spec|specs|specification|dimensions?|drawing|diagram|technical|infographic)([-_.]|$)/i;

export function isSpecGraphicImage(src?: string | null): boolean {
  const file = String(src || "").split("/").pop()?.split("?")[0] || "";
  return SPEC_GRAPHIC_FILENAME.test(file);
}
