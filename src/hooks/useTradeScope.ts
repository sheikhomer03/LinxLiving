"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTradeModeStore } from "@/store/useTradeModeStore";
import { NO_TRADE, tradeScopeFor, type TradeScope } from "@/lib/trade";

/**
 * Who the shopper is for pricing purposes, in one call.
 *
 * Every surface that shows a price needs the same two inputs — the approved
 * account on the session and the no-login Trade Mode toggle — and before this
 * existed each one combined them differently: the cart and checkout honoured
 * both, while the product cards read only the toggle, so an approved trade
 * account browsing the catalogue saw retail prices it could not fix (the navbar
 * hides the toggle from a real account). This is the single answer.
 *
 * Returns NO_TRADE until mounted. The toggle is persisted in localStorage and
 * the session arrives over the wire, so neither is known while the server
 * renders — reading them during hydration would make the HTML and the first
 * client render disagree about a price, which React repairs by throwing the
 * tree away.
 */
export function useTradeScope(): TradeScope {
  const { data: session } = useSession();
  const isTradeMode = useTradeModeStore((s) => s.isTradeMode);
  const [mounted, setMounted] = useState(false);

  // The flag IS the "we are past hydration" signal, so there is nowhere else
  // to raise it than in an effect that runs once the first commit is done.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return NO_TRADE;
  return tradeScopeFor(session?.user, isTradeMode);
}
