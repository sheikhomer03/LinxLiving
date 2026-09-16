"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { Toaster } from "sonner";
import dynamic from "next/dynamic";

// All three are off-screen until their own trigger opens them, so their
// chunks are split out of the app-wide bundle that every page has to load.
const AuthModal = dynamic(() => import("./ui/AuthModal").then((m) => m.AuthModal), {
  ssr: false,
});
const CartDrawer = dynamic(() => import("./cart/CartDrawer").then((m) => m.CartDrawer), {
  ssr: false,
});
const WishlistDrawer = dynamic(
  () => import("./wishlist/WishlistDrawer").then((m) => m.WishlistDrawer),
  { ssr: false },
);

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
