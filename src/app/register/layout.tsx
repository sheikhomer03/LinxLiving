import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Register | Linx Living",
  description: "Create your Linx Living account for personalized architectural material selection.",
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
