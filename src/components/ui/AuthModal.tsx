"use client";

import { useModalStore } from "@/store/useModalStore";
import { X, Heart, LogIn } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function AuthModal() {
  const { isOpen, onClose } = useModalStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !isOpen) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 animate-in fade-in duration-300">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative bg-white w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-2 hover:bg-secondary transition-colors z-10 sm:top-4 sm:right-4"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-6 text-center space-y-6 sm:p-8 sm:space-y-8 md:p-12">
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-secondary flex items-center justify-center rounded-full sm:w-20 sm:h-20">
              <Heart className="w-7 h-7 opacity-90 sm:w-8 sm:h-8" />
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-serif tracking-wide uppercase text-[#333] wrap-break-word sm:text-2xl sm:tracking-widest">
              Authentication Required
            </h2>
            <p className="text-xs text-foreground/60 leading-relaxed font-sans sm:text-sm">
              Experience the full inspiration. Please log in to your account to
              save items to your personal cart.
            </p>
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <Link
              href="/login"
              onClick={onClose}
              className="flex items-center justify-center gap-2 px-4 py-3.5 bg-[#333] text-white uppercase tracking-wide text-[10px] font-bold hover:bg-black transition-all group shadow-lg shadow-black/5 sm:gap-3 sm:px-8 sm:py-4 sm:tracking-widest sm:text-[11px]"
            >
              <LogIn className="w-4 h-4 shrink-0 group-hover:-translate-x-0.5 transition-transform" />
              Sign In to Account
            </Link>

            <button
              onClick={onClose}
              className="text-[9px] uppercase tracking-[0.15em] font-bold opacity-80 hover:opacity-800 transition-opacity pt-2 sm:text-[10px] sm:tracking-[0.2em]"
            >
              Continue Browsing
            </button>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="h-1.5 w-full bg-linear-to-r from-secondary via-foreground/5 to-secondary" />
      </div>
    </div>
  );
}
