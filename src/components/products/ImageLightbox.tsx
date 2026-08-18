"use client";

import React, { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSwipeNav } from "@/hooks/useSwipeNav";

interface ImageLightboxProps {
  images: string[];
  initialIndex: number;
  isOpen: boolean;
  onClose: () => void;
  name: string;
}

/**
 * Full-viewport lightbox portaled to document.body so sticky/stacking
 * contexts on the PDP cannot trap it (stars/buy-box bleeding through).
 */
export function ImageLightbox({
  images,
  initialIndex,
  isOpen,
  onClose,
  name,
}: ImageLightboxProps) {
  const [localIndex, setLocalIndex] = useState(initialIndex);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setLocalIndex(initialIndex);
    }
  }, [isOpen, initialIndex]);

  const onPrev = useCallback(() => {
    setLocalIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  }, [images.length]);

  const onNext = useCallback(() => {
    setLocalIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  }, [images.length]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    },
    [isOpen, onClose, onPrev, onNext],
  );

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const { onTouchStart, onTouchEnd } = useSwipeNav(onNext, onPrev);

  if (!isOpen || !mounted) return null;

  const src = images[localIndex];
  const coverFit = /cloudinary/i.test(src || "");

  return createPortal(
    <div
      className="fixed inset-0 z-300 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-300 p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} image gallery`}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close lightbox"
        onClick={onClose}
      />

      <div
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="relative z-1 w-full max-w-4xl h-[70vh] md:h-[85vh] bg-white shadow-2xl rounded-2xl flex items-center justify-center animate-in zoom-in-95 duration-300 overflow-hidden"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 md:top-4 md:right-4 p-2 rounded-full bg-white/90 hover:bg-secondary transition-all duration-300 z-20 shadow-sm"
          aria-label="Close lightbox"
        >
          <X className="w-6 h-6" />
        </button>

        {images.length > 1 ? (
          <>
            <button
              type="button"
              onClick={onPrev}
              className="absolute left-1 sm:left-3 top-1/2 -translate-y-1/2 z-20 group"
              aria-label="Previous image"
            >
              <div className="bg-white/90 p-2 sm:p-3 rounded-full shadow-lg group-hover:bg-black group-hover:text-white transition-all">
                <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
            </button>
            <button
              type="button"
              onClick={onNext}
              className="absolute right-1 sm:right-3 top-1/2 -translate-y-1/2 z-20 group"
              aria-label="Next image"
            >
              <div className="bg-white/90 p-2 sm:p-3 rounded-full shadow-lg group-hover:bg-black group-hover:text-white transition-all">
                <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
            </button>
          </>
        ) : null}

        <div className="relative w-full h-full bg-white">
          <Image
            src={src}
            alt={`${name} featured view`}
            fill
            sizes="(max-width: 768px) 100vw, 900px"
            className={cn(
              "transition-opacity duration-300",
              coverFit ? "object-cover object-center" : "object-contain p-4",
            )}
            priority
          />
        </div>

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 rounded-full bg-black/50 px-3 py-1 text-[10px] uppercase tracking-[0.35em] font-bold text-white">
          {localIndex + 1} / {images.length}
        </div>
      </div>
    </div>,
    document.body,
  );
}
