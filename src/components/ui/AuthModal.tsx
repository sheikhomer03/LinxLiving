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
          className="absolute top-4 right-4 p-2 hover:bg-secondary transition-colors z-10"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-8 md:p-12 text-center space-y-8">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-secondary flex items-center justify-center rounded-full">
              <Heart className="w-8 h-8 opacity-90" />
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-2xl font-serif tracking-widest uppercase text-[#333]">
              Authentication Required
            </h2>
            <p className="text-sm text-foreground/60 leading-relaxed font-sans">
              Experience the full inspiration. Please log in to your account to
              save items to your personal cart.
            </p>
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <Link
              href="/login"
              onClick={onClose}
              className="flex items-center justify-center gap-3 px-8 py-4 bg-[#333] text-white uppercase tracking-widest text-[11px] font-bold hover:bg-black transition-all group shadow-lg shadow-black/5"
            >
              <LogIn className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              Sign In to Account
            </Link>

            <button
              onClick={onClose}
              className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80 hover:opacity-800 transition-opacity pt-2"
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
