"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";
import { AuthModal } from "./ui/AuthModal";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <Toaster position="bottom-right" richColors expand={true} />
      <AuthModal />
    </SessionProvider>
  );
}
