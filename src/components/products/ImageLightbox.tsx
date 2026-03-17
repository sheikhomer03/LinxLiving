"use client";

import React, { useEffect, useCallback, useState } from "react";
import Image from "next/image";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageLightboxProps {
  images: string[];
  initialIndex: number;
  isOpen: boolean;
  onClose: () => void;
  name: string;
}

export function ImageLightbox({
  images,
  initialIndex,
  isOpen,
  onClose,
  name,
}: ImageLightboxProps) {
  const [localIndex, setLocalIndex] = useState(initialIndex);

  // Sync with initialIndex when opening
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-500 p-4 md:p-8">
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl h-[50vh] md:h-[75vh] bg-white shadow-xl rounded-2xl flex items-center justify-center animate-in zoom-in-95 duration-700 overflow-hidden"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-1 top-1 md:top-4 md:right-4 p-2 hover:bg-secondary transition-all duration-300 z-110"
          aria-label="Close lightbox"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Navigation Buttons */}
        {images.length > 1 && (
          <>
            <button
              onClick={onPrev}
              className="absolute left-0 px-1 sm:px-4 group transition-all duration-300 z-110"
              aria-label="Previous image"
            >
              <div className="bg-white/80 p-2 sm:p-3 rounded-full shadow-lg group-hover:bg-black group-hover:text-white transition-all">
                <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
            </button>
            <button
              onClick={onNext}
              className="absolute right-0 px-1 sm:px-4 group transition-all duration-300 z-110"
              aria-label="Next image"
            >
              <div className="bg-white/80 p-2 sm:p-3 rounded-full shadow-lg group-hover:bg-black group-hover:text-white transition-all">
                <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
            </button>
          </>
        )}

        {/* Main Image Container */}
        <div className="relative w-full h-full">
          <Image
            src={images[localIndex]}
            alt={`${name} featured view`}
            fill
            className="object-cover transition-opacity duration-500"
            priority
          />
        </div>

        {/* Image Counter */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.5em] font-bold opacity-30">
          {localIndex + 1} / {images.length}
        </div>
      </div>

      {/* Backdrop Click to Close */}
      <div className="absolute inset-0 -z-10" onClick={onClose} />
    </div>
  );
}
