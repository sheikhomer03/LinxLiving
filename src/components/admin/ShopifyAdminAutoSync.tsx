"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { notifyCatalogChange } from "@/lib/live-sync";

const DEFAULT_INTERVAL_MS = 45_000;
const EVENT = "linx:shopify-auto-sync";

/**
 * While an admin session is open, periodically sync Shopify ↔ Mongo
 * (pull + push unsynced Brands / Collections / Coupons) without clicking Pull.
 */
export function ShopifyAdminAutoSync() {
  const pathname = usePathname();
  const router = useRouter();
  const running = useRef(false);
  const lastAt = useRef(0);

  useEffect(() => {
    const enabled = process.env.NEXT_PUBLIC_SHOPIFY_AUTO_SYNC !== "false";
    if (!enabled) return;

    const intervalMs = Math.max(
      15_000,
      Number(process.env.NEXT_PUBLIC_SHOPIFY_AUTO_SYNC_MS) || DEFAULT_INTERVAL_MS,
    );

    const run = async (reason: string) => {
      if (running.current) return;
      if (typeof document !== "undefined" && document.hidden) return;

      const now = Date.now();
      // Avoid stacking when navigating quickly
      if (now - lastAt.current < 12_000 && reason !== "mount") return;

      running.current = true;
      lastAt.current = now;
      try {
        const res = await fetch("/api/admin/shopify/auto-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 25 }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.ok) return;

        window.dispatchEvent(
          new CustomEvent(EVENT, { detail: { at: data.at, summary: data.summary } }),
        );
        notifyCatalogChange("all");
        router.refresh();
      } catch {
        // Silent — auto sync should not interrupt admin UX
      } finally {
        running.current = false;
      }
    };

    // First sync shortly after admin loads
    const boot = window.setTimeout(() => run("mount"), 2500);
    const id = window.setInterval(() => run("interval"), intervalMs);

    const onFocus = () => run("focus");
    const onVisible = () => {
      if (!document.hidden) run("visible");
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(boot);
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  // Re-run sooner when opening key list pages
  useEffect(() => {
    if (!pathname) return;
    const hot =
      pathname.includes("/admin/coupons") ||
      pathname.includes("/admin/products") ||
      pathname.includes("/admin/orders") ||
      pathname.includes("/admin/customers") ||
      pathname.includes("/admin/collections") ||
      pathname.includes("/admin/brands") ||
      pathname.includes("/admin/menus") ||
      pathname.includes("/admin/queries") ||
      pathname.includes("/admin/subscribers");
    if (!hot) return;

    const t = window.setTimeout(async () => {
      try {
        await fetch("/api/admin/shopify/auto-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 25 }),
        });
        window.dispatchEvent(new CustomEvent(EVENT, { detail: { at: Date.now() } }));
        notifyCatalogChange("all");
        router.refresh();
      } catch {
        // ignore
      }
    }, 800);

    return () => window.clearTimeout(t);
  }, [pathname, router]);

  return null;
}

export function useShopifyAutoSyncListener(onSync: () => void) {
  useEffect(() => {
    const handler = () => onSync();
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [onSync]);
}
