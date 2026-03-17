import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forgot Password | Linx Living",
  description: "Reset your Linx Living account password.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
