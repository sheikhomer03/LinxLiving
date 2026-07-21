import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Profile | Linx Square",
  description: "Manage your architectural projects and personal information.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
