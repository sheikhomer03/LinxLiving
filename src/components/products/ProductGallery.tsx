"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Moon, Play, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { isGalleryVideoUrl, isYoutubeUrl, videoPosterUrl, youtubeEmbedUrl } from "@/lib/productImage";
import { ImageLightbox } from "./ImageLightbox";

interface ProductGalleryProps {
  images: string[];
  name: string;
  /** Lights-off shot — shows a toggle over the stage when present. */
  darkModeImage?: string;
  /** Discount badge (e.g. "20% OFF") — pinned top-left, same on every slide. */
  cornerBadge?: string | null;
  /** Free-sample badge — pinned top-right, same on every slide. */
  showSampleBadge?: boolean;
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
}: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightsOff, setLightsOff] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<Record<string, boolean>>(
    {},
  );

  const list = (images || []).filter(
    (src): src is string => typeof src === "string" && Boolean(src.trim()),
  );
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images?.join("|")]);

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
          "relative rounded-xl border border-foreground/10 overflow-hidden aspect-square bg-white",
          !activeIsVideo && "cursor-zoom-in",
        )}
        onClick={() => {
          if (!activeIsVideo) setIsLightboxOpen(true);
        }}
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
          isYoutubeUrl(activeSrc) && youtubeEmbedUrl(activeSrc) ? (
            <iframe
              key={activeSrc}
              src={youtubeEmbedUrl(activeSrc) || ""}
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
              poster={videoPosterUrl(activeSrc)}
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
                src={activeSrc}
                alt={name}
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full object-cover object-center"
              />
            ) : (
              <Image
                key={activeSrc}
                src={activeSrc}
                alt={name}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover object-center"
                priority
                unoptimized={/cdn\.shopify\.com|cdn\.shopifycdn\.net/i.test(
                  activeSrc,
                )}
                onError={() => setFailedSrc(activeSrc)}
              />
            )}
          </div>
        )}
      </div>

      {list.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {list.map((src, index) => {
            const isVideo = isGalleryVideoUrl(src);
            const thumb = isVideo ? videoPosterUrl(src) || "" : src;
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
          images={stillImages}
          initialIndex={lightboxIndex}
          isOpen={isLightboxOpen}
          onClose={() => setIsLightboxOpen(false)}
          name={name}
        />
      ) : null}
    </div>
  );
}
