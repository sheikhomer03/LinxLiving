import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout | Linx Square",
  description: "Complete your acquisition of premium architectural materials.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
