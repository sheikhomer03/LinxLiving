"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { subscribeCatalogChange } from "@/lib/live-sync";

/**
 * Refreshes storefront RSC data only when admin notifies a catalog change.
 */
export function StorefrontLiveRefresh() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;

    return subscribeCatalogChange(() => {
      if (document.visibilityState === "hidden") return;
      router.refresh();
    });
  }, [router, pathname]);

  return null;
}
