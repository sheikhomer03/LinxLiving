import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login | Linx Square",
  description: "Access your Linx Square collection and manage your architectural projects.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
