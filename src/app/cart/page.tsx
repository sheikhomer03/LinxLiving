"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";

/** Legacy /cart route — opens the cart drawer and returns home. */
export default function CartPage() {
  const router = useRouter();
  const open = useCartDrawerStore((s) => s.open);

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
