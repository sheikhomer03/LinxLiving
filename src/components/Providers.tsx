"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { Toaster } from "sonner";
import { AuthModal } from "./ui/AuthModal";
import { CartDrawer } from "./cart/CartDrawer";
import { WishlistDrawer } from "./wishlist/WishlistDrawer";

export function Providers({
  children,
  session,
}: {
  children: React.ReactNode;
  session?: Session | null;
}) {
  // Pass `null` (not `undefined`) when logged out so SessionProvider treats
  // the server session as resolved and always provides context during SSR.
  return (
    <SessionProvider
      session={session === undefined ? null : session}
      refetchOnWindowFocus={false}
      refetchInterval={0}
    >
      {children}
      <Toaster position="bottom-right" richColors expand={true} />
      <AuthModal />
      <CartDrawer />
      <WishlistDrawer />
    </SessionProvider>
  );
}
