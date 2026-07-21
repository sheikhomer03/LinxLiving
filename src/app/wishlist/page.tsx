"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWishlistDrawerStore } from "@/store/useWishlistDrawerStore";

/** Legacy /wishlist route — opens the wishlist drawer and returns home. */
export default function WishlistPage() {
  const router = useRouter();
  const open = useWishlistDrawerStore((s) => s.open);

  useEffect(() => {
    open();
    router.replace("/");
  }, [open, router]);

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-foreground/20 border-t-foreground animate-spin rounded-full" />
    </main>
  );
}
