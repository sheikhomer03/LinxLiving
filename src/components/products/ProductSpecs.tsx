"use client";
import React from "react";
import Image from "next/image";

interface SpecItem {
  label: string;
  value: string;
}

interface ProductSpecsProps {
  specs: SpecItem[];
  schematicImage: string;
}

export function ProductSpecs({ specs, schematicImage }: ProductSpecsProps) {
  return (
    <section className="py-24 border-t border-foreground/5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
        <div className="space-y-8">
          <h3 className="text-xl font-serif tracking-widest uppercase">
            Technical Specifications
          </h3>
          <div className="divide-y divide-foreground/5 border-t border-foreground/5">
            {Array.isArray(specs) &&
              specs.map((spec) => (
                <div
                  key={spec.label}
                  className="flex justify-between py-4 items-center"
                >
                  <span className="uppercase tracking-[0.2em] text-[10px] font-bold opacity-50">
                    {spec.label}
                  </span>
                  <span className="uppercase tracking-widest text-[10px] font-bold">
                    {spec.value}
                  </span>
                </div>
              ))}
          </div>
        </div>

        <div className="space-y-8">
          <h3 className="text-xl font-serif tracking-widest uppercase">
            Schematic & Dimensions
          </h3>
          <div className="relative aspect-square bg-secondary/30 flex items-center justify-center overflow-hidden border border-foreground/5">
            <Image
              src={schematicImage}
              alt="Technical Schematic"
              fill
              className="opacity-40 grayscale mix-blend-multiply object-contain"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="uppercase tracking-[0.5em] text-[8px] font-bold opacity-30 rotate-90">
                TECHNICAL SPECIFICATION
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
