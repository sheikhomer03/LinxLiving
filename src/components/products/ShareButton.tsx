"use client";

import React from "react";
import { Share2 } from "lucide-react";
import { toast } from "sonner";

export function ShareButton() {
  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard", {
      description: "You can now share this luxury piece.",
    });
  };

  return (
    <button
      onClick={handleShare}
      className="p-3 border border-foreground/10 hover:bg-secondary transition-colors"
      title="Share Product"
    >
      <Share2 className="w-4 h-4" />
    </button>
  );
}
