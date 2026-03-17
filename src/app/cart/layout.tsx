import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Cart | Linx Living",
  description: "Review your selected materials and architectural pieces.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function CartLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
