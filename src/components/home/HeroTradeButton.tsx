"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { BadgePercent, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isTradeAccount } from "@/lib/trade";
import { useTradeModeStore } from "@/store/useTradeModeStore";

/**
 * The hero's trade control — it switches trade pricing on, it does not
 * navigate.
 *
 * Sending it to /trade would have been the obvious thing and the wrong one:
 * that route is a "Coming soon" holding page, so the button would have
 * promised a trade account and delivered a dead end. The working control is
 * the one in the top bar, which turns on the same self-serve discount without
 * a login — this is that control, repeated where a first-time visitor will
 * actually see it.
 *
 * An approved trade account never sees a toggle, for the reason the navbar
 * gives: their discount is always applied, and offering to "switch it on"
 * would imply they had been browsing at full price.
 */
export function HeroTradeButton({ className }: { className?: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const isTradeMode = useTradeModeStore((s) => s.isTradeMode);
  const toggleTradeMode = useTradeModeStore((s) => s.toggle);
  const realTradeAccount = isTradeAccount(session?.user);

  // The store is persisted, so its first client value differs from the one
  // rendered on the server. Reading it before mount would mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const on = mounted && isTradeMode;

  if (realTradeAccount) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 border border-white/70 bg-white/10 px-6 py-3.5 text-[11px] font-black uppercase tracking-[0.12em] text-white sm:px-8 sm:py-4 sm:text-[14px] sm:tracking-[0.14em]",
          className,
        )}
      >
        <Check className="h-4 w-4" />
        Trade account · Active
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        const turningOn = !isTradeMode;
        toggleTradeMode();
        toast[turningOn ? "success" : "info"](
          turningOn
            ? "Trade pricing activated — 5% off every product"
            : "Trade pricing switched off",
        );
        // The department tiles and best-selling rows below are rendered on
        // the server, so their prices only follow the toggle once the page
        // re-reads them.
        router.refresh();
      }}
      className={cn(
        "inline-flex items-center gap-2 border px-6 py-3.5 text-[11px] font-black uppercase tracking-[0.12em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-8 sm:py-4 sm:text-[14px] sm:tracking-[0.14em]",
        on
          ? "border-white bg-white text-[#0d0d0d]"
          : "border-white/70 text-white hover:bg-white hover:text-[#0d0d0d]",
        className,
      )}
    >
      {on ? (
        <>
          <Check className="h-4 w-4" />
          Trade pricing on
        </>
      ) : (
        <>
          <BadgePercent className="h-4 w-4 opacity-80" />
          Trade account
        </>
      )}
    </button>
  );
}
