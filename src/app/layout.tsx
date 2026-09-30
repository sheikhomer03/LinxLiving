import type { Metadata } from "next";
import { Tenor_Sans, Lexend_Deca, Archivo } from "next/font/google";
import "@/styles/globals.css";
import { Providers } from "@/components/Providers";
import {
  GoogleAnalyticsScript,
  GoogleTagManagerNoscript,
  GoogleTagManagerScript,
} from "@/components/analytics/GoogleTagManager";
import { MetaPixel } from "@/components/analytics/MetaPixel";

const tenor = Tenor_Sans({
  weight: "400",
  variable: "--font-tenor",
  subsets: ["latin"],
});

const lexend = Lexend_Deca({
  variable: "--font-lexend",
  subsets: ["latin"],
});

/**
 * The menu face.
 *
 * Lusso Stone sets its navigation in ABC Diatype Extended — a wide neo-
 * grotesque, medium weight, in black — and next to it our menu read as small,
 * bold and grey. Diatype is licensed, so the menu takes Archivo: the closest
 * free grotesque with a real width axis, opened up to a slightly extended
 * width in `.font-menu` (globals.css) to match. Body copy stays Lexend Deca.
 */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

import { getStoreName } from "@/app/actions/settings";

export async function generateMetadata(): Promise<Metadata> {
  const storeName = await getStoreName();
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL || "https://linxliving.co.uk";

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: `${storeName} | Luxury Architectural Materials & Boutique Surfaces`,
      template: `%s | ${storeName}`,
    },
    description:
      "Exquisite stone baths, al ceramics, and luxury architectural tiles for refined living. Curated materials for the discerning designer.",
    keywords: [
      "luxury tiles",
      "stone baths",
      "architectural surfaces",
      "boutique tiles",
      "designer bathrooms",
      "marble surfaces",
      "premium ceramics",
    ],
    authors: [{ name: storeName }],
    creator: storeName,
    publisher: storeName,
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    alternates: {
      canonical: "/",
    },
    openGraph: {
      title: `${storeName} | Luxury Architectural Materials`,
      description:
        "Discover the finest stone baths and architectural surfaces.",
      url: baseUrl,
      siteName: storeName,
      locale: "en_GB",
      type: "website",
      images: [
        {
          url: "/images/og-image.jpg",
          width: 1200,
          height: 630,
          alt: `${storeName} Luxury Surfaces`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${storeName} | Luxury Architectural Materials`,
      description:
        "Discover the finest stone baths and architectural surfaces.",
      images: ["/images/og-image.jpg"],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    icons: {
      icon: "/favicon.ico",
      apple: "/favicon.ico",
    },
    // Google Search Console's proof that the property is ours; Next renders it
    // as <meta name="google-site-verification">. Google re-checks the tag from
    // time to time, so it stays after the property is verified.
    verification: {
      google: "OTgUXijfrshEG-lyBFuGj43Jbzshu7XbXLYCaIfhnps",
    },
  };
}

import NextTopLoader from "nextjs-toploader";
import { DisableNumberScroll } from "@/components/DisableNumberScroll";
import { DisableNegativeNumberInput } from "@/components/DisableNegativeNumberInput";
import { StorefrontLiveRefresh } from "@/components/common/StorefrontLiveRefresh";
import { SupportLauncher } from "@/components/support/SupportLauncher";
import { getSupportContact } from "@/lib/support";

/*
 * Pages that can be cached (home, product and information pages) are
 * refreshed at least every 30 seconds. The data caches they read were each
 * shortened by the same 30 seconds, so a change shows no later than it did
 * when every page was rendered per request. Admin and Shopify edits clear
 * the affected pages at once, as before.
 */
export const revalidate = 30;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const support = await getSupportContact();

  /*
   * The session is not read here. Reading it — cookies — made every page on
   * the site render per request, so none could be served from the CDN and a
   * hard refresh always waited on the server. SessionProvider now fetches it
   * in the browser; nothing on the storefront needs it before hydration
   * (prices, the account link and trade state are all read after mount), and
   * clicks that do, wait for it — see sessionForAction.
   */

  return (
    <html lang="en">
      <head />
      <body
        className={`${tenor.variable} ${lexend.variable} ${archivo.variable} antialiased font-sans`}
      >
        {/* Analytics — all afterInteractive so they never block first paint */}
        <GoogleTagManagerScript />
        <GoogleAnalyticsScript />
        <GoogleTagManagerNoscript />
        {/* A navigation still costs a server round trip, so the click needs an
            answer of its own — without one the page sits looking untouched
            until the next route paints, and the customer clicks again. */}
        <NextTopLoader
          color="#D3102F"
          height={3}
          showSpinner={false}
          shadow={false}
        />
        <MetaPixel />
        <DisableNumberScroll />
        <DisableNegativeNumberInput />
        <StorefrontLiveRefresh />
        <Providers>
          {children}
          {/* Fixed-position help launcher — additive, so no page or flow
              needs to know about it. */}
          <SupportLauncher
            phone={support.phone}
            phoneHref={support.phoneHref}
            email={support.email}
            hours={support.hours}
          />
        </Providers>
      </body>
    </html>
  );
}
