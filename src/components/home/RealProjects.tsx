"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { GENERATED_FILMS } from "@/components/home/realProjectsFilms";
import { FAKRO_FILMS } from "@/components/home/fakroFilms";
import { BRITMET_FILMS } from "@/components/home/britmetFilms";

/**
 * Project films for the homepage, across every brand we stock.
 *
 * Nothing on screen names a supplier — labels and titles describe the work
 * itself, so films from any brand sit in the same rail without one of them
 * appearing to own the section. Add new entries to `FILMS` below; brand-neutral
 * wording is the rule, not a detail of the current list.
 *
 * Self-hosted clips live in public/home/real-projects/ and are mirrored from
 * source by the scripts/download-*-videos.cjs helpers so they come off our own
 * origin. YouTube entries stay embedded, and their iframe is only mounted once
 * someone presses play.
 *
 * Cards are 16:9, which suits the landscape camera work most of these are.
 * Portrait sources set `portrait: true` and are letterboxed instead, so a 9:16
 * screen recording is not cropped down to a slice of its middle.
 */
export type ProjectFilm = {
  /** Short, brand-free label above the title — the kind of work shown. */
  label: string;
  /** Brand-free description of what happens in the film. */
  title: string;
  /** Local mp4 under /home/real-projects, or a YouTube / Vimeo id. */
  src?: string;
  youtubeId?: string;
  vimeoId?: string;
  /**
   * Still shown before playback. Empty for the handful of Vimeo films whose
   * oEmbed record carries no thumbnail — those fall back to a plain panel
   * rather than a black rectangle.
   */
  poster: string;
  /**
   * Portrait footage — phone screen recordings and the like — is letterboxed
   * rather than cropped, since filling a 16:9 card with a 9:16 source throws
   * away most of the frame.
   */
  portrait?: boolean;
};

const FILMS: ProjectFilm[] = [
  {
    label: "Heating controls",
    title: "Smart thermostats up close",
    src: "/home/real-projects/protouch-iq.mp4",
    poster: "/home/real-projects/posters/protouch-iq.jpg",
  },
  {
    label: "Electric heating",
    title: "Installing an electric sticky mat",
    youtubeId: "9C_Vrn1ZNWo",
    poster: "https://i.ytimg.com/vi/9C_Vrn1ZNWo/maxresdefault.jpg",
  },
  {
    label: "Electric heating",
    title: "Foil and wood mat installation guide",
    youtubeId: "_mJLcaOLzGw",
    poster: "https://i.ytimg.com/vi/_mJLcaOLzGw/maxresdefault.jpg",
  },
  {
    label: "Electric heating",
    title: "Installing a grid heating system",
    youtubeId: "2CJuikoPK6U",
    poster: "https://i.ytimg.com/vi/2CJuikoPK6U/maxresdefault.jpg",
  },
  {
    label: "Water heating",
    title: "A full multi-zone water system install",
    youtubeId: "Be8q7_j_pIw",
    poster: "https://i.ytimg.com/vi/Be8q7_j_pIw/maxresdefault.jpg",
  },
  {
    label: "Water heating",
    title: "Fitting an egg crate panel system",
    youtubeId: "RNr93MGU-tw",
    poster: "https://i.ytimg.com/vi/RNr93MGU-tw/maxresdefault.jpg",
  },
  {
    label: "Skirting heating",
    title: "Heated skirting — an installation overview",
    youtubeId: "buJ4WgUcVlc",
    poster: "https://i.ytimg.com/vi/buJ4WgUcVlc/hqdefault.jpg",
  },
  {
    label: "Choosing a system",
    title: "Electric or water — which system suits the room?",
    youtubeId: "iVB9c4fsxUg",
    poster: "https://i.ytimg.com/vi/iVB9c4fsxUg/maxresdefault.jpg",
  },
  {
    label: "Sustainability",
    title: "Taking a stand for sustainable living",
    youtubeId: "lmq0eTLSr2g",
    poster: "https://i.ytimg.com/vi/lmq0eTLSr2g/hqdefault.jpg",
  },
  {
    label: "Floor finishing",
    title: "Step 1 — Brushing the boards",
    youtubeId: "86EySgFynDg",
    poster: "https://i.ytimg.com/vi/86EySgFynDg/maxresdefault.jpg",
  },
  {
    label: "Floor finishing",
    title: "Step 2 — Staining the floor",
    youtubeId: "KVzj9vlUbqU",
    poster: "https://i.ytimg.com/vi/KVzj9vlUbqU/maxresdefault.jpg",
  },
  {
    label: "Floor finishing",
    title: "Step 3 — Colouring the finish",
    youtubeId: "zs4TOJgJJzM",
    poster: "https://i.ytimg.com/vi/zs4TOJgJJzM/maxresdefault.jpg",
  },
  {
    // The only film on the wood-flooring supplier's site — 68 pages, one
    // video, self-hosted rather than embedded, so it is mirrored by
    // scripts/download-natura-videos.cjs and served from our own origin.
    label: "Wood flooring",
    title: "From timber to finished floor",
    src: "/home/real-projects/wood-floor-story.mp4",
    poster: "/home/real-projects/posters/wood-floor-story.jpg",
  },
  {
    // The two films the bifold-door supplier hosts itself; it embeds none.
    // Both are the systems manufacturer's own footage and carry a small corner
    // watermark, in the same way as the four entries at the end of this list.
    // Mirrored by scripts/download-ukbifold-videos.cjs.
    label: "Sliding doors",
    title: "A panoramic sliding door, close up",
    src: "/home/real-projects/panoramic-sliding-door.mp4",
    poster: "/home/real-projects/posters/panoramic-sliding-door.jpg",
  },
  {
    label: "Windows",
    title: "A tilt-and-turn window with hidden hinges",
    src: "/home/real-projects/hidden-sash-window.mp4",
    poster: "/home/real-projects/posters/hidden-sash-window.jpg",
  },
  {
    label: "Outdoor living",
    title: "Assembling a louvered pergola",
    // Space in the filename is deliberate — two import scripts already point
    // products at this asset via encodeURI, so the file is left alone and the
    // path encoded the same way here.
    src: encodeURI("/oscar/Type175 145 Installation.mp4"),
    poster: "/home/real-projects/posters/louvered-pergola-assembly.jpg",
  },
  // Skylight and roof-window films surveyed from the Cambridge Skylights site
  // (scripts/scan-site-videos.cjs, 418/418 pages). That site carries 20 films
  // and 18 of them are here: the 8 that appear in page copy, plus the 10 held
  // as Shopify `external_video` gallery media, which are carried at the
  // owner's instruction even though they double as product media. The two
  // installation films left out are omitted because their own publisher titles
  // them "OBSOLETE".
  //
  // Titles here are written brand-free per the rule at the top of this file.
  // The footage itself is the supplier's own and does show their branding on
  // screen, in the same way as the four entries below.
  {
    label: "Skylights",
    title: "Fitting a skylight, step by step",
    youtubeId: "qcWqwFIAZ0U",
    poster: "https://i.ytimg.com/vi/qcWqwFIAZ0U/maxresdefault.jpg",
  },
  {
    label: "Skylights",
    title: "Installing a skylight on a pitched roof",
    youtubeId: "FAqtOPbyBu8",
    poster: "https://i.ytimg.com/vi/FAqtOPbyBu8/maxresdefault.jpg",
  },
  {
    label: "Skylights",
    title: "A look across the rooflight range",
    youtubeId: "ZX55LyXloKc",
    poster: "https://i.ytimg.com/vi/ZX55LyXloKc/maxresdefault.jpg",
  },
  {
    label: "Roof windows",
    // No maxresdefault still exists for this id; hqdefault always does.
    title: "Fitting a top-hung roof window",
    youtubeId: "DT2h7uhv4u0",
    poster: "https://i.ytimg.com/vi/DT2h7uhv4u0/hqdefault.jpg",
  },
  {
    label: "Roof windows",
    title: "Installing a solar-powered roof window",
    youtubeId: "52YRgwTPgpY",
    poster: "https://i.ytimg.com/vi/52YRgwTPgpY/maxresdefault.jpg",
  },
  {
    label: "Roof windows",
    title: "How a pivoting roof window works",
    youtubeId: "EhJyc-4reEw",
    poster: "https://i.ytimg.com/vi/EhJyc-4reEw/hqdefault.jpg",
  },
  {
    label: "Roof windows",
    title: "Centre-pivot windows for a loft conversion",
    youtubeId: "vbF3ayphKF8",
    poster: "https://i.ytimg.com/vi/vbF3ayphKF8/maxresdefault.jpg",
  },
  {
    label: "Blinds",
    title: "Fitting an electric skylight blind",
    youtubeId: "Q_qH0BXOKsY",
    poster: "https://i.ytimg.com/vi/Q_qH0BXOKsY/maxresdefault.jpg",
  },
  // The ten below double as product gallery media on the source site.
  {
    label: "Roof windows",
    title: "What goes into a modern roof window",
    youtubeId: "le3anIGsDuU",
    poster: "https://i.ytimg.com/vi/le3anIGsDuU/maxresdefault.jpg",
  },
  {
    label: "Roof windows",
    title: "A centre-pivot roof window in use",
    youtubeId: "mg_h11tg5aQ",
    poster: "https://i.ytimg.com/vi/mg_h11tg5aQ/maxresdefault.jpg",
  },
  {
    label: "Roof windows",
    title: "Top-hung and pivot windows compared",
    youtubeId: "sSzBC5OXj1w",
    poster: "https://i.ytimg.com/vi/sSzBC5OXj1w/maxresdefault.jpg",
  },
  {
    label: "Roof windows",
    title: "A mansard roof fitted for more headroom",
    youtubeId: "VGN5Qo89OeE",
    poster: "https://i.ytimg.com/vi/VGN5Qo89OeE/maxresdefault.jpg",
  },
  {
    label: "Flat roofs",
    title: "Bringing daylight through a flat roof",
    youtubeId: "eGFvVlXeIcw",
    poster: "https://i.ytimg.com/vi/eGFvVlXeIcw/maxresdefault.jpg",
  },
  {
    label: "Flat roofs",
    title: "A walk-on rooflight in a finished space",
    youtubeId: "RHIq7xVRrA8",
    poster: "https://i.ytimg.com/vi/RHIq7xVRrA8/maxresdefault.jpg",
  },
  {
    label: "Flat roofs",
    title: "Curved glass rooflights, inside and out",
    youtubeId: "Z-WbbEJBQtw",
    poster: "https://i.ytimg.com/vi/Z-WbbEJBQtw/maxresdefault.jpg",
  },
  {
    label: "Smart home",
    title: "Opening a roof window from a smart home system",
    youtubeId: "DTVQ_Z69XkM",
    poster: "https://i.ytimg.com/vi/DTVQ_Z69XkM/maxresdefault.jpg",
  },
  {
    label: "Blinds",
    title: "A blackout blind in action",
    youtubeId: "w9AbeYyHLt4",
    poster: "https://i.ytimg.com/vi/w9AbeYyHLt4/maxresdefault.jpg",
  },
  {
    label: "Loft ladders",
    title: "An extra-tall loft ladder in a high ceiling",
    youtubeId: "uPl4FqRJjxA",
    poster: "https://i.ytimg.com/vi/uPl4FqRJjxA/maxresdefault.jpg",
  },
  // The four below are carried at the owner's instruction. Each one shows the
  // source supplier's branding on screen — a logo card, or their domain in a
  // phone browser's address bar — which the rest of this list deliberately
  // avoids. Delete these four entries to drop them.
  {
    label: "Bespoke flooring",
    title: "Placeholder clip",
    youtubeId: "XHOmBV4js_E",
    poster: "https://i.ytimg.com/vi/XHOmBV4js_E/maxresdefault.jpg",
  },
  {
    label: "Returns & rewards",
    title: "How the return reward scheme works",
    src: "/home/real-projects/return-reward-scheme.mp4",
    poster: "/home/real-projects/posters/return-reward-scheme.jpg",
  },
  {
    label: "Shop on mobile",
    title: "Adding the shop to an Android home screen",
    src: "/home/real-projects/save-to-phone-1.mp4",
    poster: "/home/real-projects/posters/save-to-phone-1.jpg",
    portrait: true,
  },
  {
    label: "Shop on mobile",
    title: "Adding the shop to an iPhone home screen",
    src: "/home/real-projects/save-to-phone-2.mp4",
    poster: "/home/real-projects/posters/save-to-phone-2.jpg",
    portrait: true,
  },
];

function FilmCard({
  film,
  isActive,
  onActivate,
}: {
  film: ProjectFilm;
  isActive: boolean;
  onActivate: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Stays false until the card is scrolled into view or touched, so no mp4 and
  // no YouTube/Vimeo player is fetched for the 230-odd cards further down the
  // rail — only the poster, lazily.
  const [engaged, setEngaged] = useState(false);
  const [muted, setMuted] = useState(true);

  // YouTube and Vimeo play inside an iframe that is only mounted on click;
  // autoplay is for local mp4s, where it costs one file and no third-party
  // player. Mounting 200 iframes to autoplay them would sink the page.
  const isEmbed = Boolean(film.youtubeId || film.vimeoId);

  /**
   * Autoplay muted while the card is on screen, the way the rail reads on
   * linxdesignbuild.co.uk. Applies to embeds too: a YouTube or Vimeo iframe is
   * only mounted while its card is actually visible, so the rail holds a
   * handful of players rather than one per film.
   *
   * The mount is held back until a card has been visible for a moment —
   * dragging the rail across fifty cards would otherwise create and destroy
   * fifty players on the way past.
   */
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let settle: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      ([entry]) => {
        const v = videoRef.current;
        if (entry.isIntersecting) {
          if (isEmbed) {
            settle = setTimeout(() => setEngaged(true), 350);
          } else {
            setEngaged(true);
            if (v?.paused) void v.play().catch(() => {});
          }
        } else {
          if (settle) clearTimeout(settle);
          if (isEmbed) setEngaged(false);
          else if (v && !v.paused) v.pause();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      if (settle) clearTimeout(settle);
      io.disconnect();
    };
  }, [isEmbed]);

  // Losing "active" to another card drops this one back to silent playback
  // rather than stopping it — only one card is ever audible.
  useEffect(() => {
    if (isActive) return;
    setMuted(true);
    const v = videoRef.current;
    if (v) v.muted = true;
  }, [isActive]);

  const handleClick = useCallback(() => {
    setEngaged(true);
    onActivate();
    if (isEmbed) return;
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    setMuted(false);
    void v.play().catch(() => {});
  }, [isEmbed, onActivate]);

  const showEmbed = isEmbed && (engaged || isActive);
  /**
   * Both hosts autoplay only when muted — that is a browser rule, not a
   * provider one. Clicking swaps the src to an unmuted, full-controls player;
   * changing the URL remounts the iframe, which restarts the film with sound
   * and avoids pulling in the YouTube and Vimeo player SDKs just to toggle
   * volume on an existing frame.
   */
  const embedSrc = film.youtubeId
    ? `https://www.youtube.com/embed/${film.youtubeId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${film.youtubeId}` +
      (isActive ? "&mute=0&controls=1" : "&mute=1&controls=0")
    : `https://player.vimeo.com/video/${film.vimeoId}?autoplay=1&loop=1&title=0&byline=0&portrait=0` +
      (isActive ? "&muted=0" : "&muted=1&background=1");

  return (
    <div data-film-card className="w-[82vw] max-w-90 shrink-0 snap-start sm:w-90">
      <div
        ref={cardRef}
        className="group relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-white/10"
      >
        {showEmbed ? (
          <>
            {/* The poster stays underneath: a YouTube or Vimeo player takes a
                moment to paint, and without this the card is a black hole for
                that second. The iframe covers it once it is up. */}
            {film.poster && (
              /* eslint-disable-next-line @next/next/no-img-element -- next/image
                 is unoptimized here and the poster must stay lazily fetched. */
              <img
                src={film.poster}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <iframe
              className="absolute inset-0 h-full w-full"
              src={embedSrc}
              title={film.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
            {/* While muted the iframe swallows clicks, so the "tap for sound"
                affordance has to sit above it. Once the card is live the layer
                is removed and the player's own controls take over. */}
            {!isActive && (
              <button
                type="button"
                onClick={handleClick}
                aria-label={`Play ${film.title} with sound`}
                className="absolute inset-0 h-full w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/85 via-black/25 to-black/5"
                />
                <span
                  aria-hidden
                  className="absolute top-1/2 left-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 ring-1 ring-white/25 backdrop-blur-xs transition-transform duration-300 group-hover:scale-110"
                >
                  <VolumeX className="h-4.5 w-4.5 text-white" />
                </span>
                <span className="absolute inset-x-0 bottom-0 z-10 block p-3 sm:p-4">
                  <span className="mb-1 line-clamp-1 block text-[9px] font-bold tracking-[0.18em] text-primary uppercase sm:text-[10px] sm:tracking-[0.2em]">
                    {film.label}
                  </span>
                  <span className="line-clamp-2 block text-xs leading-snug font-semibold text-white sm:text-sm">
                    {film.title}
                  </span>
                </span>
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={handleClick}
            aria-label={
              isEmbed ? `Play ${film.title}` : `Play ${film.title} with sound`
            }
            className="absolute inset-0 h-full w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {film.poster ? (
              /* eslint-disable-next-line @next/next/no-img-element -- next/image
                 is unoptimized here and the poster must stay lazily fetched. */
              <img
                src={film.poster}
                alt=""
                loading="lazy"
                decoding="async"
                className={cn(
                  "absolute inset-0 h-full w-full",
                  film.portrait ? "object-contain" : "object-cover",
                )}
              />
            ) : (
              <div
                aria-hidden
                className="absolute inset-0 bg-linear-to-br from-white/12 via-white/5 to-transparent"
              />
            )}
            {engaged && !isEmbed && (
              <video
                ref={videoRef}
                src={film.src}
                poster={film.poster}
                loop
                autoPlay
                muted={muted}
                playsInline
                preload="none"
                className={cn(
                  "absolute inset-0 h-full w-full",
                  film.portrait ? "object-contain" : "object-cover",
                )}
              />
            )}

            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 bg-linear-to-t from-black/85 via-black/25 to-black/5 transition-opacity duration-300",
                isActive ? "opacity-40" : "opacity-100",
              )}
            />

            {!isActive && (
              <span
                aria-hidden
                className="absolute top-1/2 left-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 ring-1 ring-white/25 backdrop-blur-xs transition-transform duration-300 group-hover:scale-110"
              >
                {isEmbed ? (
                  <Play className="h-4.5 w-4.5 translate-x-px fill-white text-white" />
                ) : (
                  <VolumeX className="h-4.5 w-4.5 text-white" />
                )}
              </span>
            )}

            <div
              className={cn(
                "absolute inset-x-0 bottom-0 z-10 p-3 transition-opacity duration-300 sm:p-4",
                isActive ? "opacity-0" : "opacity-100",
              )}
            >
              <p className="mb-1 line-clamp-1 text-[9px] font-bold tracking-[0.18em] text-primary uppercase sm:text-[10px] sm:tracking-[0.2em]">
                {film.label}
              </p>
              <p className="line-clamp-2 text-xs leading-snug font-semibold text-white sm:text-sm">
                {film.title}
              </p>
            </div>
          </button>
        )}

        {isActive && !isEmbed && (
          <button
            type="button"
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              v.muted = !v.muted;
              setMuted(v.muted);
            }}
            aria-label={muted ? "Unmute video" : "Mute video"}
            className="absolute top-2.5 right-2.5 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/20 transition-colors hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Curated entries first, then everything the survey scripts turned up.
 *
 * De-duplicated on the id, because the surveys overlap: a supplier and the
 * merchant who stocks them publish the same installation film, so the same
 * YouTube id reaches this list from two directions. First writer wins, which
 * keeps the hand-written title ahead of a generated one.
 */
const ALL_FILMS: ProjectFilm[] = (() => {
  const seen = new Set<string>();
  return [...FILMS, ...GENERATED_FILMS, ...FAKRO_FILMS, ...BRITMET_FILMS].filter((f) => {
    const key = f.youtubeId || f.vimeoId || f.src;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
})();

export function RealProjects({ films = ALL_FILMS }: { films?: ProjectFilm[] }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  /** Keep the arrows honest about whether there is anywhere left to go. */
  const syncEdges = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 8);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    syncEdges();
    const el = railRef.current;
    if (!el) return;
    el.addEventListener("scroll", syncEdges, { passive: true });
    window.addEventListener("resize", syncEdges);
    return () => {
      el.removeEventListener("scroll", syncEdges);
      window.removeEventListener("resize", syncEdges);
    };
  }, [syncEdges]);

  // Step by whole cards rather than a fixed pixel count, so the rail lands on
  // a card edge at every breakpoint instead of stopping mid-card.
  const step = useCallback((dir: -1 | 1) => {
    const el = railRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-film-card]");
    const width = card ? card.offsetWidth + 16 : el.clientWidth * 0.8;
    const perPage = Math.max(1, Math.floor(el.clientWidth / width));
    el.scrollBy({ left: dir * width * perPage, behavior: "smooth" });
  }, []);

  if (!films.length) return null;

  return (
    <section className="bg-[hsl(var(--dark-section))] py-14 text-white md:py-20">
      <div className="site-container space-y-8">
        <div className="mx-auto max-w-2xl space-y-3 text-center">
          <p className="text-[10px] font-bold tracking-[0.22em] text-primary uppercase">
            Real projects
          </p>
          <h2 className="font-serif text-2xl tracking-[0.04em] text-balance md:text-3xl">
            Watch Real Projects Come Together
          </h2>
          <p className="text-sm leading-relaxed text-white/55">
            See the work behind the finish — real installs, on-site
            walkthroughs and the detail that goes in before the last coat.
          </p>
        </div>

        {/* Horizontal rail rather than a wrapping grid, so the section stays
            one band tall however many films are listed. */}
        <div className="relative -mx-4 px-4 sm:mx-0 sm:px-0">
          <div
            ref={railRef}
            className="flex snap-x gap-4 overflow-x-auto scroll-smooth pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {films.map((film, i) => {
              const key = film.src || film.youtubeId || film.vimeoId || String(i);
              return (
                <FilmCard
                  key={key}
                  film={film}
                  isActive={activeKey === key}
                  onActivate={() => setActiveKey(key)}
                />
              );
            })}
          </div>

          {[-1, 1].map((dir) => {
            const isPrev = dir === -1;
            const disabled = isPrev ? atStart : atEnd;
            return (
              <button
                key={dir}
                type="button"
                onClick={() => step(dir as -1 | 1)}
                disabled={disabled}
                aria-label={isPrev ? "Previous films" : "Next films"}
                className={cn(
                  "absolute top-[38%] hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/20 backdrop-blur-xs transition hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:flex",
                  isPrev ? "left-0 sm:-left-4" : "right-0 sm:-right-4",
                  disabled && "pointer-events-none opacity-0",
                )}
              >
                {isPrev ? (
                  <ChevronLeft className="h-5 w-5" />
                ) : (
                  <ChevronRight className="h-5 w-5" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
