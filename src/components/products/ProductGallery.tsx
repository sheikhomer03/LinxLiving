/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/immutability */
/* eslint-disable react-hooks/preserve-manual-memoization */
"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Moon, Play, Sun } from "lucide-react";
import { SliderChevron } from "@/components/products/ProductDisclosure";
import { cn } from "@/lib/utils";
import { useSwipeNav } from "@/hooks/useSwipeNav";
import { useImageFit } from "@/hooks/useImageFit";
import {
  cdnImageUrl,
  cdnVideoUrl,
  isGalleryVideoUrl,
  isVimeoUrl,
  isYoutubeUrl,
  videoPosterUrl,
  vimeoEmbedUrl,
  youtubeEmbedUrl,
} from "@/lib/productImage";
// Zoom-on-click only — deferring its chunk keeps it off the critical path
// for every product page, which renders this gallery unconditionally.
const ImageLightbox = dynamic(
  () => import("./ImageLightbox").then((m) => m.ImageLightbox),
  { ssr: false },
);

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
  /**
   * The reference's product page treatment: the photograph fills the whole
   * section behind the buy box instead of sitting in a bordered stage, and
   * the thumbnails become a narrow column tucked into the bottom-left
   * corner. Measured on lussostone.com at 1440 — media 1440x900 on cover,
   * thumbnail strip 64px wide at x=32, and the buy card floating over it.
   */
  fullBleed?: boolean;
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
  /**
   * Shopify CDN copy of each gallery image, keyed by the URL used in `images`.
   */
  fallbackImages?: Record<string, string>;
  /** Callback fired whenever the actual rendered width of the main image is measured/updated (in pixels). */
  onImageWidthChange?: (widthInPx: number) => void;
  /**
   * Shopify URL → stored original.
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
  fullBleed = false,
  darkModeImage = "",
  cornerBadge = null,
  showSampleBadge = false,
  videoPosters = {},
  fallbackImages = {},
  originalImages = {},
  onImageWidthChange,
}: ProductGalleryProps) {
  /** Supplied poster wins; otherwise fall back to one derived from the URL. */
  const posterFor = (src: string) => videoPosters[src] || videoPosterUrl(src);

  const [activeIndex, setActiveIndex] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const [lightsOff, setLightsOff] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<Record<string, boolean>>(
    {},
  );
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 990px)");
    const handleMq = () => setIsDesktop(mq.matches);
    handleMq();
    mq.addEventListener("change", handleMq);
    return () => mq.removeEventListener("change", handleMq);
  }, []);
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
  // Delivered at the size the stage actually paints at — reads the live element
  // width so mobile (390px) requests a ~780px image rather than 1520px.
  // Falls back to 760 before the first paint measurement is available.
  const resolve = (src: string, width?: number) =>
    cdnImageUrl(
      fallbackImages[src] || src,
      width ?? stage.current?.offsetWidth ?? 760,
    );

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

  /**
   * The shape of the box the stage is actually drawn in.
   *
   * `useImageFit` decides cover vs contain by comparing the image to its box,
   * so it has to be told the real one. It was being handed `stageAspect` —
   * the ratio the *inline* stage adopts from its first image — which the
   * full-bleed stage never applies, because there the height comes from the
   * section. Every image on this page was therefore judged against a square
   * while being shown in a 1.44:1 band, so the square majority of the
   * catalogue scored a crop loss of zero and was cropped by a third.
   */
  const [boxAspect, setBoxAspect] = useState(1);

  const {
    fitClass: stageFitClass,
    onLoad: onImageFitLoad,
  } = useImageFit(
    /*
      The opening guess, which is what paints before the image has loaded and
      reported its size.
      
      "cover" is right for a card, where three quarters of the catalogue is
      square and a square fills a square tile. In this band the box is 1.44:1,
      so that same square majority ends up contained — and guessing cover
      meant they all appeared filled and centred, then moved to whole and
      left. Guessing contain leaves those still; only a wide scene changes,
      and it changes by growing to fill rather than sliding sideways.
      
      Nothing is hidden while this settles: the picture is painted straight
      away either way.
    */
    fullBleed ? "contain" : "cover",
    undefined,
    fullBleed ? boxAspect : stageAspect ?? 1,
  );

  /**
   * Where a picture that is shown whole sits in the band.
   *
   * `object-contain` centres by default, which puts a margin down both
   * sides. Pinning it left instead moves the whole margin to the right —
   * where the buy card floats — so most of it lands behind the card rather
   * than reading as two bars around the photograph. At 1440 a square image
   * leaves 440px spare: centred that is 220px either side of the picture,
   * left-aligned it is 110px past the edge of the card.
   *
   * Only in full-bleed. The inline stage takes its aspect from the image and
   * has no margin to place.
   */
  const stageClass =
    fullBleed && stageFitClass.includes("contain")
      ? cn(stageFitClass, "object-left")
      : stageFitClass;

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

      // Measured, not assumed — see `boxAspect` above.
      const box = stage.current?.getBoundingClientRect();
      if (box?.width && box.height) {
        setBoxAspect(box.width / box.height);
        const actualWidth = Math.min(box.width, box.height * aspect);
        onImageWidthChange?.(actualWidth);
      }
    },
    [onImageFitLoad, onImageWidthChange],
  );

  useEffect(() => {
    const handleMeasure = () => {
      if (!stage.current || !stageAspect) return;
      const box = stage.current.getBoundingClientRect();
      if (box?.width && box.height) {
        setBoxAspect(box.width / box.height);
        const actualWidth = Math.min(box.width, box.height * stageAspect);
        onImageWidthChange?.(actualWidth);
      }
    };
    handleMeasure();
    window.addEventListener("resize", handleMeasure);
    return () => window.removeEventListener("resize", handleMeasure);
  }, [stageAspect, activeIndex, onImageWidthChange]);

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
    /*
      `relative` so the thumbnail rail and the arrows, which are absolute,
      anchor here. They used to fall through to whatever ancestor happened to
      be positioned — the media wrapper, which only gets its `absolute` from
      990 up — so on a phone the rail landed thousands of pixels down the
      page instead of on the photograph.
    */
    <div className={cn(fullBleed ? "relative h-full" : "space-y-3")}>
      <div
        ref={stage}
        className={cn(
          "group relative overflow-hidden bg-white",
          fullBleed
            ? "h-full w-full"
            : "rounded-xl border border-foreground/10",
        )}
        // Square until the first picture reports its shape, so the page does
        // not reflow for the square majority of the catalogue. Full-bleed
        // takes its height from the section instead.
        style={fullBleed ? undefined : { aspectRatio: String(stageAspect ?? 1) }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Clickable Image Box — Width is strictly constrained to the actual rendered picture width on desktop */}
        <div
          className={cn(
            "absolute left-0 top-0 h-full",
            fullBleed && isDesktop && "shadow-[2px_0_12px_rgba(0,0,0,0.08)] border-r border-black/10",
            !activeIsVideo && "cursor-zoom-in",
          )}
          style={
            fullBleed && isDesktop && stageAspect && boxAspect
              ? { width: `${Math.min(100, (stageAspect / boxAspect) * 100)}%` }
              : { width: "100%" }
          }
          onClick={() => {
            if (consumeSwipeClick()) return;
            if (!activeIsVideo) setIsLightboxOpen(true);
          }}
        >
          {cornerBadge ? (
            <div
              className={cn(
                "absolute left-0 z-20 pointer-events-none",
                fullBleed
                  ? "top-0 sm:top-6 md:top-12 min-[990px]:top-[calc(var(--lx-header-h)+0rem)] lg:top-[calc(var(--lx-header-h)+0rem)]"
                  : "top-0",
              )}
            >
              <span className="bg-[#D3102F] text-white font-bold tracking-wide
                text-[9px] px-2 py-1
                min-[375px]:text-[10px] min-[375px]:px-2.5 min-[375px]:py-1
                sm:text-[11px] sm:px-3 sm:py-1.5
                md:text-[12px] md:px-3 md:py-1.5">
                {cornerBadge}
              </span>
            </div>
          ) : null}

          {showSampleBadge ? (
            <div
              className={cn(
                "absolute right-0 z-20 pointer-events-none",
                fullBleed
                  ? "top-0 sm:top-6 md:top-12 min-[990px]:top-[calc(var(--lx-header-h)+0rem)] lg:top-[calc(var(--lx-header-h)+0rem)]"
                  : "top-0",
              )}
            >
              <span className="bg-[#D3102F] text-white font-bold tracking-wide shadow-sm
                text-[9px] px-2 py-1
                min-[375px]:text-[10px] min-[375px]:px-2.5 min-[375px]:py-1
                sm:text-[10px] sm:px-3 sm:py-1.5
                md:text-[11px] md:px-3 md:py-1.5">
                FREE SAMPLE
              </span>
            </div>
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
                src={cdnVideoUrl(activeSrc)}
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
                  className={cn("absolute inset-0 h-full w-full", stageClass)}
                />
              ) : (
                <Image
                  key={resolve(activeSrc)}
                  src={resolve(activeSrc)}
                  alt={name}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  onLoad={onStageLoad}
                  className={stageClass}
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
      </div>

      {list.length > 1 ? (
        <div
          className={cn(
            fullBleed
              // Lifted clear of the arrow pair below it (32px + an 8px gap),
              // which is the order the reference stacks them in: the
              // thumbnail column, then the two round buttons under it.
              ? "absolute bottom-18 left-3 min-[990px]:left-8 z-20 flex max-h-70 w-10 min-[990px]:w-16 flex-col gap-1.5 min-[990px]:gap-2 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden"
              : "flex gap-2 overflow-x-auto pb-1 scrollbar-thin",
          )}
        >
          {list.map((src, index) => {
            const isVideo = isGalleryVideoUrl(src);
            const thumb = isVideo ? posterFor(src) || "" : resolve(src, 96);
            return (
              <button
                key={`${src}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={cn(
                  "relative shrink-0 overflow-hidden border-2 bg-white transition-all",
                  // Their corner strip is a flat 64px square; the inline
                  // strip keeps the larger rounded thumb it always had.
                  fullBleed
                    ? "h-10 w-10 min-[990px]:h-16 min-[990px]:w-16"
                    : "h-16 w-16 rounded-lg sm:h-20 sm:w-20",
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

      {fullBleed && list.length > 1 ? (
        /*
          The two round prev/next buttons under the thumbnail column — the
          `bottom-18` on that column above already reserved this exact strip
          for them (32px tall + an 8px gap), they just hadn't been drawn yet.
        */
        <div className="absolute bottom-2 left-2 z-20 flex items-center gap-1.5 min-[375px]:bottom-3 min-[375px]:left-3 min-[375px]:gap-2 min-[990px]:left-8">
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous image"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-black/10 bg-black/85 text-white backdrop-blur-xs transition-colors hover:bg-black min-[375px]:h-8 min-[375px]:w-8"
          >
            <SliderChevron direction="left" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-label="Next image"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-black/10 bg-black/85 text-white backdrop-blur-xs transition-colors hover:bg-black min-[375px]:h-8 min-[375px]:w-8"
          >
            <SliderChevron direction="right" strokeWidth={2} />
          </button>
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
          images={stillImages.map((src) => resolve(src, 1200))}
          initialIndex={lightboxIndex}
          isOpen={isLightboxOpen}
          onClose={() => setIsLightboxOpen(false)}
          name={name}
        />
      ) : null}
    </div>
  );
}
