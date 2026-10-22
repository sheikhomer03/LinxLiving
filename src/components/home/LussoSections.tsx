import Image from "next/image";
import Link from "next/link";
import { preload } from "react-dom";
import { cdnVideoUrl, sanitizeDisplayImageUrl } from "@/lib/productImage";
import { ProductCard } from "@/components/products/ProductCard";
import BackgroundVideo from "./BackgroundVideo";

/*
 * The homepage block system.
 *
 * The layout is modelled on the Lusso Stone homepage, which is built from just
 * two shapes repeated in alternation: a full-bleed banner, and a pair of
 * half-width panels. Both put the same copy block — eyebrow, headline, one line
 * of body, one or two buttons — centred over the lower third of the image, and
 * the sections butt together with no gap or background between them, so the
 * page reads as one continuous run of photography.
 *
 * Measurements taken from that page at 1440px: banner 720px tall (hero 810px),
 * headline 24px/500 uppercase, eyebrow 11px letter-spaced, body 12px uppercase,
 * button white on black text, square corners, 10px/25px padding, 12px label.
 */

export type PanelCta = { label: string; href: string };

export type PanelContent = {
  eyebrow?: string;
  title: string;
  body?: string;
  ctas?: PanelCta[];
  /** Image URL. Ignored when `video` is set. */
  image?: string;
  /** Video URL — plays muted and looped as the panel's background. */
  video?: string;
  /** Sharper cut of `video` for dense or very wide screens. Falls back to it. */
  videoLarge?: string;
  /** Lighter cut of `video` for screens below `lg`. Falls back to `video`. */
  videoMobile?: string;
  /** Still frame shown while the video loads. */
  poster?: string;
  alt?: string;
  /**
   * CSS `object-position` for the media — which part of the photograph survives
   * the crop.
   *
   * Every still here is 3:2 and no panel is, so `object-cover` always discards
   * something: the full-width banner trims top and bottom, the half-width
   * panels trim left and right. Centring is right for a room shot, whose
   * subject is in the middle, and wrong for a composed image that carries its
   * subject at one edge. Defaults to centre, so existing panels are unaffected.
   */
  imagePosition?: string;
};

function PanelMedia({
  content,
  priority,
  sizes,
  contain = false,
}: {
  content: PanelContent;
  priority?: boolean;
  sizes: string;
  /**
   * Show the whole frame rather than filling the box with it. `object-cover`
   * is right for photography, where the subject sits in the middle and the
   * trimmed edges carry nothing; it is wrong for a film the client wants seen
   * end to end, because the crop is severe once the viewport stops being
   * roughly 16:9 — on a phone it discards most of the width.
   */
  contain?: boolean;
}) {
  if (content.video) {
    // The poster is what paints first, so it is fetched like a priority image.
    if (priority && content.poster) {
      preload(content.poster, { as: "image", fetchPriority: "high" });
    }
    return (
      <BackgroundVideo
        className={`absolute inset-0 h-full w-full ${
          contain ? "object-contain" : "object-cover"
        }`}
        style={
          content.imagePosition
            ? { objectPosition: content.imagePosition }
            : undefined
        }
        src={cdnVideoUrl(content.video)}
        srcLarge={
          content.videoLarge ? cdnVideoUrl(content.videoLarge) : undefined
        }
        srcMobile={
          content.videoMobile ? cdnVideoUrl(content.videoMobile) : undefined
        }
        poster={content.poster}
      />
    );
  }
  if (!content.image) return null;
  return (
    <Image
      src={content.image}
      alt={content.alt || content.title}
      fill
      sizes={sizes}
      className="object-cover"
      // Inline rather than a Tailwind utility: the value comes from data, and
      // Tailwind cannot see a class name it never reads in the source.
      style={
        content.imagePosition
          ? { objectPosition: content.imagePosition }
          : undefined
      }
      priority={priority}
    />
  );
}

/**
 * Positioned absolutely rather than as a flex child: the sections size
 * themselves with `min-h`, and a percentage/`h-full` child of a min-height box
 * has no definite height to resolve against, so `justify-end` had nothing to
 * push against and every caption rendered at the top of its image instead of
 * over the lower third.
 */
function PanelCopy({ content }: { content: PanelContent }) {
  return (
    <div className="absolute inset-0 z-10 flex w-full flex-col justify-end items-center px-5 pb-10 sm:pb-12 lg:pb-16 text-center text-white">
      <div className="max-w-2xl">
        {content.eyebrow ? (
          <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.16em]">
            {content.eyebrow}
          </p>
        ) : null}
        <h2 className="mt-2 text-xl sm:text-2xl font-medium uppercase leading-tight">
          {content.title}
        </h2>
        {content.body ? (
          <p className="mt-3 text-[11px] sm:text-xs font-medium uppercase leading-relaxed tracking-[0.03em] text-white/90">
            {content.body}
          </p>
        ) : null}
        {content.ctas?.length ? (
          <div className="mt-5 sm:mt-6 flex flex-wrap justify-center gap-3">
            {content.ctas.map((cta) => (
              <Link
                key={cta.href + cta.label}
                href={cta.href}
                className="bg-white px-6 py-2.5 text-[11px] sm:text-xs font-medium uppercase tracking-wider text-black hover:bg-white/90 transition-colors"
              >
                {cta.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The scrim.
 *
 * Lusso's banner photography is shot dark enough to carry white text unaided.
 * Ours is supplier-supplied and ranges from near-black to blown-out white, so
 * white copy over it is otherwise a coin toss — this guarantees the contrast
 * instead of hoping for it. It is weighted to the bottom because that is where
 * the copy sits.
 *
 * Held to the lower half deliberately. It used to cover the whole frame and
 * never fall below 15% black, which greyed the showroom film top to bottom and
 * read as a dull photograph rather than a lit room. The copy still sits on
 * 70% black; above it the imagery is now its own colour.
 */
function Scrim() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 bg-linear-to-t from-black/70 via-black/25 to-transparent"
    />
  );
}

/** Full-bleed banner: one image or film, copy centred over the lower third. */
export function FeatureBanner({
  content,
  tall = false,
  priority = false,
  uncropped = false,
}: {
  content: PanelContent;
  /** The first banner on the page stands a little taller, as the hero does. */
  tall?: boolean;
  priority?: boolean;
  /**
   * Size the banner to the film rather than the film to the banner.
   *
   * The fixed heights below are close enough to 16:9 on a laptop that a
   * cover-fit crops almost nothing, but they are nowhere near it on a phone,
   * where a 520px-tall box over a ~390px-wide viewport throws away most of
   * the frame. This mode makes the box itself 16:9, so the film plays whole
   * at every width, and keeps a floor under it so the copy still has room on
   * the narrowest screens — the letterboxing that floor introduces reads as
   * deliberate against the dark backdrop. The ceiling stops an ultra-wide
   * monitor turning the hero into a full screen of video.
   */
  uncropped?: boolean;
}) {
  if (!content.image && !content.video) return null;
  const height = uncropped
    ? "aspect-video min-h-[430px] sm:min-h-[560px] max-h-[88svh]"
    : tall
      ? "min-h-[520px] sm:min-h-[640px] lg:min-h-[810px]"
      : "min-h-[460px] sm:min-h-[560px] lg:min-h-[720px]";

  return (
    <section
      className={`relative isolate w-full ${height} ${
        uncropped ? "bg-[#0b0b0c]" : ""
      }`}
    >
      <PanelMedia
        content={content}
        priority={priority}
        sizes="100vw"
        contain={uncropped}
      />
      <Scrim />
      <PanelCopy content={content} />
    </section>
  );
}

/**
 * Two half-width panels side by side, each with its own image and copy.
 * Stacks to one column below lg, where two half-width panels would leave the
 * copy unreadable.
 */
export function FeatureDuo({
  left,
  right,
  priority = false,
}: {
  left: PanelContent;
  right: PanelContent;
  priority?: boolean;
}) {
  const panels = [left, right].filter(
    (p): p is PanelContent => Boolean(p && (p.image || p.video)),
  );
  if (!panels.length) return null;

  return (
    // No gap: a grid gap here is page background, and the page is white, so
    // the pair showed a white seam down the middle of the imagery — and a
    // second one between them once stacked. The run of panels is meant to
    // read as one unbroken band (see this file's opening note).
    <section className="grid w-full gap-0 lg:grid-cols-2">
      {panels.map((panel, i) => (
        <div
          key={panel.title + i}
          className="relative isolate min-h-105 sm:min-h-130 lg:min-h-180"
        >
          <PanelMedia
            content={panel}
            priority={priority && i === 0}
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
          <Scrim />
          <PanelCopy content={panel} />
        </div>
      ))}
    </section>
  );
}

/**
 * Centred prose on white — the "Luxury Bathrooms, Kitchens & Home Collections"
 * block that closes the run of imagery.
 */
export function EditorialText({
  title,
  paragraphs,
}: {
  title: string;
  paragraphs: React.ReactNode[];
}) {
  return (
    <section className="bg-white py-12 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-3xl px-5 text-center">
        <h2 className="text-xl sm:text-2xl font-medium uppercase leading-tight text-foreground">
          {title}
        </h2>
        <div className="mt-6 space-y-4 text-[13px] sm:text-sm leading-relaxed text-foreground/75">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Centred contact line, matching the editorial block above it. */
export function ContactLine({
  phone,
  email,
}: {
  phone: string;
  email: string;
}) {
  return (
    <section className="bg-white pb-14 sm:pb-20">
      <div className="mx-auto max-w-3xl px-5 text-center">
        <h2 className="text-xl sm:text-2xl font-medium uppercase leading-tight text-foreground">
          Contact us
        </h2>
        <p className="mt-5 text-[13px] sm:text-sm leading-relaxed text-foreground/75">
          If you would like to discuss a project, you can contact our sales team
          on{" "}
          <Link
            href={`tel:${phone.replace(/\s+/g, "")}`}
            className="font-medium text-foreground hover:underline"
          >
            {phone}
          </Link>{" "}
          or email us at{" "}
          <Link
            href={`mailto:${email}`}
            className="font-medium text-foreground hover:underline"
          >
            {email}
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

/** One product in an offers row, as the homepage's range bands supply it. */
export type OfferProduct = {
  _id: string;
  slug?: string;
  name: string;
  images?: string[];
  shopifyImages?: { sourceUrl?: string | null; shopifyUrl?: string | null }[];
  brandName?: string;
  brandSlug?: string;
  category?: string;
  subCategory?: string;
  department?: string;
  stock?: number;
  price: number;
  perSqm?: boolean;
  size?: string;
  wasPrice?: number;
  discountPercent?: number;
  hasPaidSample?: boolean;
};

/**
 * A row of products that are genuinely reduced.
 *
 * The page it sits in is otherwise a run of full-bleed photography with no
 * price on it anywhere, which is why this block exists: a visitor could read
 * the whole homepage without learning that more than half the catalogue is
 * discounted. It breaks the run of imagery deliberately — that is the point of
 * it — so it takes the warm off-white the range bands use rather than white,
 * and the copy follows the editorial blocks below it rather than the banners.
 *
 * Every figure here is the product's own recorded one. The caller passes only
 * products whose `wasPrice` is above what they sell for, and the card prints
 * `discountPercent` and strikes `wasPrice` from those fields — nothing in this
 * component invents a saving, and a product with no discount recorded against
 * it cannot appear in the row at all.
 */
export function OffersBand({
  eyebrow,
  title,
  body,
  cta,
  products,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  cta?: PanelCta;
  products: OfferProduct[];
}) {
  if (!products.length) return null;

  return (
    <section className="bg-[#f7f5f1] py-12 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-350 px-5 lg:px-10">
        <div className="mx-auto max-w-3xl text-center">
          {eyebrow ? (
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-2 text-xl sm:text-2xl font-medium uppercase leading-tight text-foreground">
            {title}
          </h2>
          {body ? (
            <p className="mt-3 text-[13px] sm:text-sm leading-relaxed text-foreground/75">
              {body}
            </p>
          ) : null}
        </div>

        <div className="mt-8 sm:mt-10 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 md:gap-6 xl:grid-cols-4 items-stretch">
          {products.map((p) => (
            <ProductCard
              key={p._id}
              id={p._id}
              slug={p.slug}
              name={p.name}
              price={p.price}
              image={sanitizeDisplayImageUrl(p.images?.[0] || "")}
              images={p.images}
              shopifyImages={p.shopifyImages}
              category={p.category || ""}
              subCategory={p.subCategory}
              department={p.department}
              brandName={p.brandName}
              brandSlug={p.brandSlug}
              size={p.size}
              stock={p.stock}
              perSqm={p.perSqm}
              compareAtPrice={p.wasPrice ?? null}
              salePercent={p.discountPercent ?? null}
              hasPaidSample={Boolean(p.hasPaidSample)}
              homeLayout
            />
          ))}
        </div>

        {cta ? (
          <div className="mt-10 text-center">
            <Link
              href={cta.href}
              className="inline-block bg-black px-7 py-3 text-[11px] sm:text-xs font-medium uppercase tracking-wider text-white transition-colors hover:bg-black/85"
            >
              {cta.label}
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
