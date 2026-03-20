"use client";
import React, { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface ProductGalleryProps {
  images: string[];
  name: string;
}

import { ImageLightbox } from "./ImageLightbox";

export function ProductGallery({ images, name }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const handlePrev = () => {
    setActiveIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  return (
    <div className="space-y-6">
      <div
        onClick={() => setIsLightboxOpen(true)}
        className="relative aspect-5/5 bg-secondary overflow-hidden group cursor-zoom-in"
      >
        <Image
          src={images[activeIndex]}
          alt={name}
          fill
          className="object-cover transition-transform duration-1000 group-hover:scale-105"
          priority
        />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {Array.isArray(images) &&
          images.map((image, index) => (
            <button
              key={index}
              onClick={() => setActiveIndex(index)}
              className={cn(
                "relative aspect-square bg-secondary overflow-hidden transition-all duration-300",
                activeIndex === index
                  ? "ring-1 ring-foreground opacity-800"
                  : "opacity-80 hover:opacity-800",
              )}
            >
              <Image
                src={image || "/images/placeholder.jpg"}
                alt={`${name} gallery ${index + 1}`}
                fill
                className="object-contain"
              />
            </button>
          ))}
      </div>

      <ImageLightbox
        images={images}
        initialIndex={activeIndex}
        isOpen={isLightboxOpen}
        onClose={() => setIsLightboxOpen(false)}
        name={name}
      />
    </div>
  );
}
