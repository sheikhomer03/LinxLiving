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
  // No session from the server: SessionProvider fetches it in the browser.
  // `undefined` is what tells it to — `null` would mean "signed out, known",
  // and a signed-in shopper would stay signed out until something refetched.
  // A caller that does pass one (null included) is still taken at its word.
  return (
    <SessionProvider
      session={session}
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
