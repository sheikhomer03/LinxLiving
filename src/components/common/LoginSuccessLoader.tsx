"use client";

import React from "react";
import { BrandLogo } from "@/components/layout/BrandLogo";

export default function LoginSuccessLoader({
  storeName = "Linx Square",
}: {
  storeName?: string;
}) {
  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center bg-white animate-in fade-in duration-700">
      <div className="relative w-full max-w-lg px-6 flex flex-col items-center text-center space-y-12">
        <div className="relative group">
          <div className="absolute inset-0 bg-[#333]/5 rounded-full scale-[2] blur-3xl group-hover:bg-[#333]/10 transition-all duration-1000 animate-pulse" />
          <div className="relative w-24 h-24 flex items-center justify-center">
            <div className="absolute inset-0 border border-[#333]/10 rounded-full animate-[spin_10s_linear_infinite]" />
            <div className="absolute inset-2 border border-[#333]/5 rounded-full animate-[spin_15s_linear_infinite_reverse]" />
            <div className="animate-in zoom-in duration-1000 delay-300">
              <BrandLogo name={storeName} size="sm" />
            </div>
          </div>
        </div>

        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-1000 delay-500">
          <h2 className="text-4xl font-serif tracking-[0.2em] uppercase text-[#333]">
            Authenticating
          </h2>
          <div className="flex flex-col items-center gap-4">
            <p className="text-[10px] uppercase tracking-[0.5em] font-black opacity-90">
              Securing Private Session
            </p>
            <div className="w-48 h-px bg-[#333]/10 relative overflow-hidden">
              <div className="absolute inset-0 bg-[#333] w-1/3 animate-[loading-bar_2s_ease-in-out_infinite]" />
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center -z-10 opacity-[0.04] select-none pointer-events-none">
          <BrandLogo name={storeName} size="lg" className="scale-[3] sm:scale-[4]" />
        </div>
      </div>

      <style jsx>{`
        @keyframes loading-bar {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(300%);
          }
        }
      `}</style>
    </div>
  );
}
