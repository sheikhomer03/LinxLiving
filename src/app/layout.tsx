import type { Metadata } from "next";
import { Tenor_Sans, Lexend_Deca } from "next/font/google";
import "@/styles/globals.css";
import { Providers } from "@/components/Providers";

const tenor = Tenor_Sans({
  weight: "400",
  variable: "--font-tenor",
  subsets: ["latin"],
});

const lexend = Lexend_Deca({
  variable: "--font-lexend",
  subsets: ["latin"],
});

import { getStoreName } from "@/app/actions/settings";

export async function generateMetadata(): Promise<Metadata> {
  const storeName = await getStoreName();
  return {
    title: `${storeName.toUpperCase()} | Luxury Tile Boutique`,
    description:
      "Exquisite stone baths, al ceramics and luxury tiles for refined living.",
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${tenor.variable} ${lexend.variable} antialiased font-sans`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
