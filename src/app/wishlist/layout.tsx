import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Wishlist | Linx Living",
  description: "A curated list of your desired architectural pieces.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function WishlistLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
