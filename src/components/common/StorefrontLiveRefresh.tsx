"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { subscribeCatalogChange } from "@/lib/live-sync";

const MIN_REFRESH_GAP_MS = 12_000;

/**
 * Refreshes storefront RSC data when admin notifies a catalog change.
 * Heavily debounced — admin Shopify auto-sync used to spam router.refresh().
 */
export function StorefrontLiveRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const lastRefreshAt = useRef(0);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;

    return subscribeCatalogChange(() => {
      if (document.visibilityState === "hidden") return;

      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => {
        const now = Date.now();
        if (now - lastRefreshAt.current < MIN_REFRESH_GAP_MS) return;
        lastRefreshAt.current = now;
        router.refresh();
      }, 800);
    });
  }, [router, pathname]);

  useEffect(() => {
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, []);

  return null;
}
