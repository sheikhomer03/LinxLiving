import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Register | Linx Square",
  description: "Create your Linx Square account for personalized architectural material selection.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
