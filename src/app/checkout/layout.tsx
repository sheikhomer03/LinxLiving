import type { Metadata } from "next";
import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";

/*
 * Rendered per request, as before. The root layout no longer reads the
 * session (so storefront pages can be cached), which would otherwise let Next
 * cache this route too — and there is nothing to gain from caching a page
 * that is personal or part of an order.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout | Linx Square",
  description: "Complete your acquisition of premium architectural materials.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function CheckoutRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <StorefrontNavbar />
      {children}
    </>
  );
}
