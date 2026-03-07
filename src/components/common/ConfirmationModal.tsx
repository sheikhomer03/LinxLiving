"use client";

import React, { useEffect, useState } from "react";
import SpinnerLoader from "./SpinnerLoader";
import { cn } from "@/lib/utils";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  isDangerous?: boolean;
  cancelLabel?: string;
  isLoading?: boolean;
}

export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isLoading = false,
  isDangerous = false,
}: ConfirmationModalProps) {
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      document.body.style.overflow = "hidden";
    } else {
      const timer = setTimeout(() => {
        setShouldRender(false);
        document.body.style.overflow = "unset";
      }, 300);
      return () => {
        clearTimeout(timer);
        document.body.style.overflow = "unset";
      };
    }
  }, [isOpen]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-100 flex items-center justify-center p-6 transition-all duration-300 ${
        isOpen ? "opacity-800" : "opacity-0"
      }`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div
        className={`relative w-full max-w-md bg-white p-10 space-y-8 shadow-2xl transition-all duration-300 transform ${
          isOpen ? "translate-y-0 scale-100" : "translate-y-4 scale-95"
        }`}
      >
        <div className="space-y-4">
          <h3 className="text-xl font-serif tracking-[0.2em] uppercase text-center">
            {title}
          </h3>
          <p className="text-sm font-sans text-center text-muted-foreground leading-relaxed">
            {message}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 pt-4">
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={cn(
              "flex-1 h-14 py-3 sm:py-0  uppercase bg-foreground text-background tracking-widest text-[11px] font-bold transition-all flex items-center justify-center",
              isDangerous ? "hover:bg-red-600" : "hover:bg-black",
            )}
          >
            {isLoading ? <SpinnerLoader className="w-5! h-5!" /> : confirmLabel}
          </button>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 h-14 py-3 sm:py-0 border border-foreground/10 uppercase tracking-widest text-[11px] font-bold hover:bg-secondary/50 transition-all"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
