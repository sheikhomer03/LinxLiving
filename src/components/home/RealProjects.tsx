"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { GENERATED_FILMS } from "@/components/home/realProjectsFilms";

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
    label: "Outdoor living",
    title: "Assembling a louvered pergola",
    // Space in the filename is deliberate — two import scripts already point
    // products at this asset via encodeURI, so the file is left alone and the
    // path encoded the same way here.
    src: encodeURI("/oscar/Type175 145 Installation.mp4"),
    poster: "/home/real-projects/posters/louvered-pergola-assembly.jpg",
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
   * linxdesignbuild.co.uk. Only cards actually in view load their file, and
   * scrolling one away pauses it again so a long rail never has more than a
   * handful of videos decoding at once.
   */
  useEffect(() => {
    const el = cardRef.current;
    if (!el || isEmbed) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        const v = videoRef.current;
        if (entry.isIntersecting) {
          setEngaged(true);
          if (v?.paused) void v.play().catch(() => {});
        } else if (v && !v.paused) {
          v.pause();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
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

  const showEmbed = isEmbed && isActive && engaged;
  const embedSrc = film.youtubeId
    ? `https://www.youtube.com/embed/${film.youtubeId}?autoplay=1&rel=0&modestbranding=1`
    : `https://player.vimeo.com/video/${film.vimeoId}?autoplay=1&title=0&byline=0`;

  return (
    <div data-film-card className="w-[82vw] max-w-90 shrink-0 snap-start sm:w-90">
      <div
        ref={cardRef}
        className="group relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-white/10"
      >
        {showEmbed ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={embedSrc}
            title={film.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
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

/** Curated entries first, then everything the survey scripts turned up. */
const ALL_FILMS: ProjectFilm[] = [...FILMS, ...GENERATED_FILMS];

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
