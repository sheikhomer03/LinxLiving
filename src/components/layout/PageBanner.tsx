import Image from "next/image";

/**
 * The block every interior page opens with.
 *
 * Lifted verbatim out of `CatalogueIndex` once /contact, /about, /faq and
 * /track-order all needed it: one full-bleed photograph, one centred word in
 * `font-menu`, a radial scrim so white ink carries over a bright interior. The
 * header is expected to be running transparent over it — pass `overlay` to
 * whichever navbar the page renders — so there is no `page-top` spacer here and
 * the image starts at the top of the window.
 *
 * Measurements are the reference's: 654px tall on mobile, 720px from lg, and an
 * 18/24px heading at 1px tracking.
 */
export function PageBanner({
  image,
  title,
  /**
   * `tall` is the reference height, for pages whose photograph is the point —
   * the catalogue index, contact, about. `standard` is for the utility pages
   * (FAQ, order tracking) where 720px of photography puts the thing the visitor
   * actually came for below two screenfuls of scroll.
   */
  size = "tall",
  priority = true,
}: {
  image: string;
  title: string;
  size?: "tall" | "standard";
  priority?: boolean;
}) {
  const height =
    size === "tall"
      ? "h-[654px] lg:h-[720px]"
      : "h-[360px] sm:h-[420px] lg:h-[480px]";

  return (
    <section className="relative w-full">
      <div className={`relative w-full ${height}`}>
        <Image
          src={image}
          alt=""
          fill
          priority={priority}
          sizes="100vw"
          className="object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.42),transparent_62%)]"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <h1 className="font-menu px-6 text-center text-[18px] font-medium uppercase tracking-[1px] text-white lg:text-[24px]">
            {title}
          </h1>
        </div>
      </div>
    </section>
  );
}
