/**
 * Google Tag Manager container, installed where Google asks for it: the
 * loader as high in <head> as the document allows, the noscript frame
 * immediately after <body>.
 *
 * Previously these used plain inline <script> tags which blocked the head
 * and delayed first paint. Switched to next/script with afterInteractive so
 * they load after the page is interactive — all tracking still fires, and
 * the page renders faster.
 *
 * No route-change handling here, unlike MetaPixel, because for GTM that is a
 * container setting rather than a code change: give the container a History
 * Change trigger and it installs its own pushState listener, and every
 * client-side navigation raises gtm.historyChange for tags to fire on.
 */
import Script from "next/script";

const GTM_CONTAINER_ID = "GTM-W9GPSKH6";

/** Goes in <head>, first. */
export function GoogleTagManagerScript() {
  return (
    <Script
      id="gtm-loader"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_CONTAINER_ID}');`,
      }}
    />
  );
}

/** Goes immediately after the opening <body> tag. */
export function GoogleTagManagerNoscript() {
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${GTM_CONTAINER_ID}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="Google Tag Manager"
      />
    </noscript>
  );
}

/**
 * GA4, installed with Google's own gtag.js snippet.
 *
 * This is a second, separate product from the container above: `GTM-…` is a
 * tag manager, `G-…` is a Google Analytics 4 property. The snippet below is
 * the one Google issues under Admin → Data streams → View tag instructions →
 * Install manually, reproduced verbatim but for the id.
 *
 * Worth knowing before this is relied on: if the GTM container also holds a
 * GA4 Configuration tag pointing at this same measurement id, the property
 * will now be loaded twice and every page view counted twice. The two ways
 * to install GA4 are alternatives, not layers. Check the container for a
 * "Google Tag" / "GA4 Configuration" tag; if one is there, it should be
 * paused, or this snippet removed again.
 */
const GA4_MEASUREMENT_ID = "G-8BLPEE0D2Z";

/** Goes in <head>, alongside the container loader. */
export function GoogleAnalyticsScript() {
  return (
    <>
      <Script
        id="ga4-loader"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`}
      />
      <Script
        id="ga4-config"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());

gtag('config', '${GA4_MEASUREMENT_ID}');`,
        }}
      />
    </>
  );
}
