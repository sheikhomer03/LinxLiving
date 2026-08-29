"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Moon, Play, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSwipeNav } from "@/hooks/useSwipeNav";
import { useImageFit } from "@/hooks/useImageFit";
import {
  cdnImageUrl,
  isGalleryVideoUrl,
  isVimeoUrl,
  isYoutubeUrl,
  videoPosterUrl,
  vimeoEmbedUrl,
  youtubeEmbedUrl,
} from "@/lib/productImage";
import { ImageLightbox } from "./ImageLightbox";

/**
 * How far the stage may depart from a square to match its pictures.
 *
 * Wide enough for the 3:2 and 16:9 photography suppliers ship, and for a
 * portrait shot, but not so wide that a 2575x171 dimension drawing turns the
 * stage into a letterbox slot with the rest of the page shoved off screen.
 */
const MIN_STAGE_ASPECT = 0.75; // 3:4, portrait
const MAX_STAGE_ASPECT = 1.9; // just past 16:9, landscape

interface ProductGalleryProps {
  images: string[];
  name: string;
  /** Lights-off shot — shows a toggle over the stage when present. */
  darkModeImage?: string;
  /** Discount badge (e.g. "20% OFF") — pinned top-left, same on every slide. */
  cornerBadge?: string | null;
  /** Free-sample badge — pinned top-right, same on every slide. */
  showSampleBadge?: boolean;
  /**
   * Poster image per video src, for hosts whose thumbnail cannot be derived
   * from the URL. YouTube and Cloudinary posters are computed; Vimeo's are
   * not, so the supplier's preview image is passed in here instead.
   */
  videoPosters?: Record<string, string>;
  /**
   * Shopify CDN copy of each gallery image, keyed by the URL used in `images`.
   *
   * Shopify is served first: it mirrors every gallery image, and drawing the
   * product page from the same CDN as the checkout keeps one host responsible
   * for the media. The stored Cloudinary URL stays as the fallback for anything
   * Shopify has no copy of, and for the handful of mirror files an earlier
   * duplicate-product bug deleted.
   */
  fallbackImages?: Record<string, string>;
  /**
   * Shopify URL → stored original.
   *
   * Retained on the props so the fallback can be switched back on, but no
   * longer consulted: Cloudinary is not displayed at all.
   */
  originalImages?: Record<string, string>;
}

/**
 * Square main stage + thumbnails.
 * Stills use next/image like product cards (Shopify CDN unoptimized).
 * Falls back to a plain img if the optimizer fails.
 */
export function ProductGallery({
  images,
  name,
  darkModeImage = "",
  cornerBadge = null,
  showSampleBadge = false,
  videoPosters = {},
  fallbackImages = {},
  originalImages = {},
}: ProductGalleryProps) {
  /** Supplied poster wins; otherwise fall back to one derived from the URL. */
  const posterFor = (src: string) => videoPosters[src] || videoPosterUrl(src);

  const [activeIndex, setActiveIndex] = useState(0);
  const [lightsOff, setLightsOff] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<Record<string, boolean>>(
    {},
  );
  // Cloudinary fallback state, kept for the restore path:
  // const [fellBack, setFellBack] = useState<Record<string, boolean>>({});

  const list = (images || []).filter(
    (src): src is string => typeof src === "string" && Boolean(src.trim()),
  );

  /**
   * What to load for a stored entry: the Shopify copy.
   *
   * Videos pass through as they are — Shopify holds those as its own media
   * types and YouTube/Vimeo markers were never Cloudinary's. A still with no
   * Shopify copy is already filtered out of `images` before it reaches here.
   *
   * Cloudinary is no longer a fallback, so a failed load goes straight to the
   * placeholder. The previous two-step version:
   * // const preferred = fallbackImages[src] || src;
   * // if (!fellBack[src]) return preferred;
   * // return originalImages[preferred] || src;
   */
  // Delivered at roughly the size it paints, which is also where the Spectra
  // logo band is cropped off — the gallery showed it after the cards stopped.
  const resolve = (src: string, width = 760) =>
    cdnImageUrl(fallbackImages[src] || src, width);

  const onImageError = (src: string) => {
    setFailedSrc(src);
  };

  const stillImages = list.filter((src) => !isGalleryVideoUrl(src));
  const safeIndex = Math.min(activeIndex, Math.max(0, list.length - 1));
  const activeSrc = list[safeIndex] || "";
  const activeIsVideo = isGalleryVideoUrl(activeSrc);
  const lightboxIndex = Math.max(0, stillImages.indexOf(activeSrc));
  const useFallbackImg = Boolean(activeSrc && failedSrc === activeSrc);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(0);
    setFailedSrc(null);
    setFailedThumbs({});
    // A new gallery gets to set its own shape; keeping the last product's
    // aspect would letterbox the first image all over again.
    setStageAspect(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images?.join("|")]);

  const goPrev = () => {
    setActiveIndex((prev) => (prev === 0 ? list.length - 1 : prev - 1));
  };

  const goNext = () => {
    setActiveIndex((prev) => (prev === list.length - 1 ? 0 : prev + 1));
  };

  const { onTouchStart, onTouchEnd, consumeSwipeClick } = useSwipeNav(
    goNext,
    goPrev,
  );

  /*
   * The stage takes its shape from the pictures it holds.
   *
   * It used to be a fixed square, which suits the three quarters of the
   * catalogue that is square and letterboxes everything else: Luxury
   * Flooring's room shots are 3024x1966, so a third of the stage was white
   * band above and below the photograph. Cropping them to fit instead is no
   * better — that is what `useImageFit` already declined to do.
   *
   * So the box follows the content. The first image to load sets the aspect
   * and keeps it for the whole gallery, which matters because the stage must
   * not resize as someone steps through the slides; supplier galleries are
   * near enough uniform for that to hold. The clamp keeps a panorama or a tall
   * diagram from turning the stage into a letterbox slot or a tower — those
   * still get shown whole inside a sane box, exactly as before.
   */
  const [stageAspect, setStageAspect] = useState<number | null>(null);
  const {
    fitClass: stageFitClass,
    onLoad: onImageFitLoad,
  } = useImageFit("cover", undefined, stageAspect ?? 1);

  const onStageLoad = useCallback(
    (event: { currentTarget?: HTMLImageElement | null; target?: EventTarget | null }) => {
      onImageFitLoad(event);
      // Read the element now, not inside the updater: React may run that later,
      // by which point `currentTarget` on a synthetic event is null.
      const img = (event.currentTarget ?? event.target) as HTMLImageElement | null;
      const width = img?.naturalWidth ?? 0;
      const height = img?.naturalHeight ?? 0;
      if (!width || !height) return;
      const aspect = Math.min(
        MAX_STAGE_ASPECT,
        Math.max(MIN_STAGE_ASPECT, width / height),
      );
      setStageAspect((current) => (current === null ? aspect : current));
    },
    [onImageFitLoad],
  );

  if (!list.length) {
    return (
      <div className="relative aspect-square rounded-xl border border-foreground/10 bg-[#fafafa] flex flex-col items-center justify-center gap-2 text-foreground/35">
        <span className="text-[11px] uppercase tracking-[0.16em] font-bold">
          No image
        </span>
        <span className="text-xs text-center px-6 text-muted-foreground normal-case tracking-normal font-normal">
          This product has no gallery image in the catalogue yet.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "group relative rounded-xl border border-foreground/10 overflow-hidden bg-white",
          !activeIsVideo && "cursor-zoom-in",
        )}
        // Square until the first picture reports its shape, so the page does
        // not reflow for the square majority of the catalogue.
        style={{ aspectRatio: String(stageAspect ?? 1) }}
        onClick={() => {
          if (consumeSwipeClick()) return;
          if (!activeIsVideo) setIsLightboxOpen(true);
        }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Pinned to the stage, not the slide, so they stay put as the
            image changes underneath. */}
        {cornerBadge ? (
          <span className="absolute top-0 left-0 z-20 pointer-events-none bg-[#D3102F] text-white text-[12px] font-bold tracking-wide px-3 py-1.5">
            {cornerBadge}
          </span>
        ) : null}
        {showSampleBadge ? (
          <span className="absolute top-0 right-0 z-20 pointer-events-none bg-[#D3102F] text-white text-[11px] font-bold tracking-wide px-3 py-1.5 shadow-sm">
            FREE SAMPLE
          </span>
        ) : null}

        {list.length > 1 ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 z-20 rounded-full bg-white/90 p-1.5 sm:p-2 shadow-sm opacity-90 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-black hover:text-white transition-all"
              aria-label="Previous image"
            >
              <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goNext();
              }}
              className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 z-20 rounded-full bg-white/90 p-1.5 sm:p-2 shadow-sm opacity-90 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-black hover:text-white transition-all"
              aria-label="Next image"
            >
              <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </>
        ) : null}

        {/* Lights on / off, as the supplier shows it over the main shot. */}
        {darkModeImage && !activeIsVideo ? (
          <button
            type="button"
            aria-pressed={lightsOff}
            className="absolute z-20 bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-foreground/15 bg-white/90 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-foreground backdrop-blur hover:bg-white transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setLightsOff((v) => !v);
            }}
          >
            {lightsOff ? (
              <Sun className="w-3.5 h-3.5" />
            ) : (
              <Moon className="w-3.5 h-3.5" />
            )}
            {lightsOff ? "Lights on" : "Lights off"}
          </button>
        ) : null}

        {lightsOff && darkModeImage && !activeIsVideo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={darkModeImage}
            alt={`${name} with the lights off`}
            className="absolute inset-0 w-full h-full object-contain bg-black"
          />
        ) : activeIsVideo ? (
          (isYoutubeUrl(activeSrc) && youtubeEmbedUrl(activeSrc)) ||
          (isVimeoUrl(activeSrc) && vimeoEmbedUrl(activeSrc)) ? (
            <iframe
              key={activeSrc}
              src={
                (isVimeoUrl(activeSrc)
                  ? vimeoEmbedUrl(activeSrc)
                  : youtubeEmbedUrl(activeSrc)) || ""
              }
              title={`${name} video`}
              className="absolute inset-0 w-full h-full bg-black"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <video
              key={activeSrc}
              src={activeSrc}
              controls
              playsInline
              poster={posterFor(activeSrc)}
              className="absolute inset-0 w-full h-full object-contain bg-black"
              onClick={(e) => e.stopPropagation()}
            >
              <track kind="captions" />
            </video>
          )
        ) : (
          <div className="absolute inset-0 bg-white">
            {useFallbackImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolve(activeSrc)}
                alt={name}
                referrerPolicy="no-referrer"
                onLoad={onStageLoad}
                className={cn("absolute inset-0 h-full w-full", stageFitClass)}
              />
            ) : (
              <Image
                key={resolve(activeSrc)}
                src={resolve(activeSrc)}
                alt={name}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                onLoad={onStageLoad}
                className={stageFitClass}
                priority
                unoptimized={/cdn\.shopify\.com|cdn\.shopifycdn\.net/i.test(
                  resolve(activeSrc),
                )}
                onError={() => onImageError(activeSrc)}
              />
            )}
          </div>
        )}
      </div>

      {list.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {list.map((src, index) => {
            const isVideo = isGalleryVideoUrl(src);
            const thumb = isVideo ? posterFor(src) || "" : resolve(src, 96);
            return (
              <button
                key={`${src}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={cn(
                  "relative shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-lg border-2 overflow-hidden bg-white transition-all",
                  activeIndex === index
                    ? "border-foreground shadow-sm"
                    : "border-foreground/10 opacity-80 hover:opacity-100 hover:border-foreground/40",
                )}
                aria-label={
                  isVideo ? `View video ${index + 1}` : `View image ${index + 1}`
                }
                aria-current={activeIndex === index}
              >
                {thumb && !failedThumbs[thumb] ? (
                  <Image
                    src={thumb}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
                    unoptimized
                    onError={() =>
                      setFailedThumbs((prev) => ({ ...prev, [thumb]: true }))
                    }
                  />
                ) : thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-secondary" />
                )}
                {isVideo ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                    <Play
                      className="w-5 h-5 text-white fill-white"
                      aria-hidden
                    />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {!activeIsVideo && stillImages.length > 0 ? (
        <ImageLightbox
          /*
           * `.map(resolve)` handed Array.map's index straight into resolve's
           * `width` parameter: the first slide asked the CDN for `width=0` and
           * came back broken, the second for a 4px file, and so on. The
           * lightbox stage paints up to ~900px, so it names that itself.
           */
          images={stillImages.map((src) => resolve(src, 900))}
          initialIndex={lightboxIndex}
          isOpen={isLightboxOpen}
          onClose={() => setIsLightboxOpen(false)}
          name={name}
        />
      ) : null}
    </div>
  );
}
