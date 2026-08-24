"use client";

import Script from "next/script";

/**
 * Google Tag Manager container.
 *
 * Loaded after interactive, like the Meta Pixel: tags fire for measurement and
 * nothing on the page waits for the container.
 *
 * No route-change handling here, unlike MetaPixel, because for GTM that is a
 * container setting rather than a code change: give the container a History
 * Change trigger and it installs its own pushState listener, and every
 * client-side navigation raises gtm.historyChange for tags to fire on. Without
 * such a trigger the container never listens, so a dataLayer with only
 * gtm.js / gtm.dom / gtm.load after a navigation is GTM working as configured,
 * not the tag failing to load.
 */
const GTM_CONTAINER_ID = "GTM-W9GPSKH6";

export function GoogleTagManager() {
  return (
    <>
      <Script id="google-tag-manager" strategy="afterInteractive">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_CONTAINER_ID}');`}
      </Script>
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${GTM_CONTAINER_ID}`}
          height="0"
          width="0"
          style={{ display: "none", visibility: "hidden" }}
          title="Google Tag Manager"
        />
      </noscript>
    </>
  );
}
