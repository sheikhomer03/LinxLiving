/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useContext } from "react";
import { SessionContext, getSession } from "next-auth/react";
import type { Session } from "next-auth";

type SafeSession = {
  data: Session | null;
  status: "authenticated" | "unauthenticated" | "loading";
  update: (data?: any) => Promise<Session | null | undefined>;
};

const FALLBACK: SafeSession = {
  data: null,
  status: "loading",
  update: async () => null,
};

/**
 * Like useSession(), but does not throw when SessionProvider is missing
 * during SSR / recoverable error retries (Next 16 + next-auth v4).
 */
export function useSafeSession(): SafeSession {
  const value = useContext(SessionContext) as SafeSession | null | undefined;
  if (!value) return FALLBACK;
  return value;
}

/**
 * The session a click should act on.
 *
 * The session is read in the browser rather than rendered in by the server,
 * so for a moment after a hard load it is still "loading". A click in that
 * moment — a wishlist heart, say — must not treat a signed-in shopper as
 * signed out and open the sign-in modal, so it waits for the answer instead.
 * Once loaded this is simply the session already held.
 */
export async function sessionForAction(state: {
  data?: Session | null;
  status: string;
}): Promise<Session | null> {
  if (state.status !== "loading") return state.data ?? null;
  return (await getSession()) ?? null;
}
