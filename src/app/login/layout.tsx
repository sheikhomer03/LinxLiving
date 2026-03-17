import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login | Linx Living",
  description: "Access your Linx Living collection and manage your architectural projects.",
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
