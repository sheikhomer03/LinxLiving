/**
 * Google Tag Manager container, installed where Google asks for it: the
 * loader as high in <head> as the document allows, the noscript frame
 * immediately after <body>.
 *
 * Both halves are plain server-rendered markup rather than next/script. A
 * `beforeInteractive` script is still injected by the framework and lands
 * below Next's own preloads; written inline it goes out in the first bytes of
 * the head, ahead of everything, which is the placement the container's
 * consent and page-view tags are written against.
 *
 * No route-change handling here, unlike MetaPixel, because for GTM that is a
 * container setting rather than a code change: give the container a History
 * Change trigger and it installs its own pushState listener, and every
 * client-side navigation raises gtm.historyChange for tags to fire on. Without
 * such a trigger the container never listens, so a dataLayer holding only
 * gtm.js / gtm.dom / gtm.load after a navigation is GTM working as configured,
 * not the tag failing to load.
 */
const GTM_CONTAINER_ID = "GTM-W9GPSKH6";

/** Goes in <head>, first. */
export function GoogleTagManagerScript() {
  return (
    <script
      // The container snippet as Google issues it, verbatim but for the id.
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
