"use client";

import { useState } from "react";
import Image from "next/image";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { isGalleryVideoUrl, videoPosterUrl } from "@/lib/productImage";
import { ImageLightbox } from "./ImageLightbox";

interface ProductGalleryProps {
  images: string[];
  name: string;
}

/**
 * Linx Glass fills Cloudinary URLs with object-cover (edge-to-edge).
 * Non-Cloudinary packshots stay centered with object-contain.
 */
function usesCoverFit(src: string) {
  return /cloudinary/i.test(src);
}

/**
 * Linx Glass–style gallery: square main stage + horizontal thumbnails.
 */
export function ProductGallery({ images, name }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const list = images.length ? images : [];
  const stillImages = list.filter((src) => !isGalleryVideoUrl(src));
  const activeSrc = list[activeIndex] || "";
  const activeIsVideo = isGalleryVideoUrl(activeSrc);
  const coverFit = usesCoverFit(activeSrc);
  const lightboxIndex = Math.max(0, stillImages.indexOf(activeSrc));

  if (!list.length) {
    return (
      <div className="relative aspect-square rounded-xl border border-foreground/10 bg-[#fafafa]" />
    );
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "relative rounded-xl border border-foreground/10 overflow-hidden aspect-square",
          coverFit ? "bg-white" : "bg-[#fafafa]",
          !activeIsVideo && "cursor-zoom-in",
        )}
        onClick={() => {
          if (!activeIsVideo) setIsLightboxOpen(true);
        }}
      >
        {activeIsVideo ? (
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
        ) : coverFit ? (
          <Image
            src={activeSrc}
            alt={name}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover object-center"
            priority
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeSrc}
              alt={name}
              className="max-h-full max-w-full w-auto h-auto object-contain p-3 md:p-6"
            />
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
                {thumb ? (
                  <Image
                    src={thumb}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
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
