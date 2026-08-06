import type { Metadata } from "next";
import { StorefrontNavbar } from "@/components/layout/StorefrontNavbar";

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
