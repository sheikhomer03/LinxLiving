"use client";

import { useContext } from "react";
import { SessionContext } from "next-auth/react";
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
