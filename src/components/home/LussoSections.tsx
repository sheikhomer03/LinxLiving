import Image from "next/image";
import Link from "next/link";

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
}: {
  content: PanelContent;
  priority?: boolean;
  sizes: string;
}) {
  if (content.video) {
    return (
      <video
        className="absolute inset-0 h-full w-full object-cover"
        style={
          content.imagePosition
            ? { objectPosition: content.imagePosition }
            : undefined
        }
        src={content.video}
        poster={content.poster}
        autoPlay
        muted
        loop
        playsInline
        // Decorative background: the copy over it carries the meaning, and a
        // silent looping clip announced to a screen reader is just noise.
        aria-hidden
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
                className="bg-white px-6 py-2.5 text-[11px] sm:text-xs font-medium uppercase tracking-[0.05em] text-black hover:bg-white/90 transition-colors"
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
 */
function Scrim() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/45 to-black/15"
    />
  );
}

/** Full-bleed banner: one image or film, copy centred over the lower third. */
export function FeatureBanner({
  content,
  tall = false,
  priority = false,
}: {
  content: PanelContent;
  /** The first banner on the page stands a little taller, as the hero does. */
  tall?: boolean;
  priority?: boolean;
}) {
  if (!content.image && !content.video) return null;
  const height = tall
    ? "min-h-[520px] sm:min-h-[640px] lg:min-h-[810px]"
    : "min-h-[460px] sm:min-h-[560px] lg:min-h-[720px]";

  return (
    <section className={`relative isolate w-full ${height}`}>
      <PanelMedia content={content} priority={priority} sizes="100vw" />
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
    <section className="grid w-full gap-1.5 lg:grid-cols-2">
      {panels.map((panel, i) => (
        <div
          key={panel.title + i}
          className="relative isolate min-h-[420px] sm:min-h-[520px] lg:min-h-[720px]"
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
