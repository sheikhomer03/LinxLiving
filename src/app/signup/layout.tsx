import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign Up | Linx Square",
  description: "Join Linx Square and explore luxury architectural materials.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
