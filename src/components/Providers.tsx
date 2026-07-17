"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { Toaster } from "sonner";
import { AuthModal } from "./ui/AuthModal";

export function Providers({
  children,
  session,
}: {
  children: React.ReactNode;
  session?: Session | null;
}) {
  return (
    <SessionProvider session={session ?? undefined} refetchOnWindowFocus={false}>
      {children}
      <Toaster position="bottom-right" richColors expand={true} />
      <AuthModal />
    </SessionProvider>
  );
}
