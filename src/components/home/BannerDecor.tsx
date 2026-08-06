/**
 * Decorative artwork for the promotional banner.
 *
 * Drawn as inline SVG rather than shipped as an image: it scales to any
 * banner size without a second network request, recolours with the brand red,
 * and carries no third-party licensing.
 */

/** Single frond, built from mirrored leaflets around a central stem. */
function Frond({ className }: { className?: string }) {
  const leaflets = Array.from({ length: 13 }, (_, i) => {
    const t = i / 12;
    // Leaflets shorten and steepen toward the tip, as a real frond does.
    const y = 8 + t * 104;
    const len = 46 * (1 - t * 0.78) + 6;
    const lift = 16 + t * 20;
    return { y, len, lift };
  });

  return (
    <svg
      viewBox="0 0 130 130"
      fill="none"
      aria-hidden
      className={className}
    >
      <g stroke="currentColor" strokeLinecap="round">
        {/* Stem */}
        <path d="M65 122 C64 92, 64 46, 66 8" strokeWidth={2.4} />
        {leaflets.map((l, i) => (
          <g key={i} strokeWidth={1.7}>
            <path d={`M65 ${l.y} C ${65 - l.len * 0.5} ${l.y - l.lift * 0.3}, ${65 - l.len * 0.8} ${l.y - l.lift * 0.8}, ${65 - l.len} ${l.y - l.lift}`} />
            <path d={`M65 ${l.y} C ${65 + l.len * 0.5} ${l.y - l.lift * 0.3}, ${65 + l.len * 0.8} ${l.y - l.lift * 0.8}, ${65 + l.len} ${l.y - l.lift}`} />
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * Tiled wordmark that sits behind the banner, plus a frond in two corners.
 * Everything is set at very low opacity so it reads as texture and never
 * competes with the headline.
 */
export function BannerDecor({ word = "TRADE" }: { word?: string }) {
  const rows = [0, 1, 2, 3, 4];

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden select-none">
      {/* Repeating ghost wordmark */}
      <div className="absolute inset-0 flex flex-col justify-center gap-2">
        {rows.map((r) => (
          <div
            key={r}
            className="flex whitespace-nowrap text-white/[0.055] font-black leading-none tracking-[0.02em] text-[clamp(3.5rem,9vw,8rem)]"
            style={{ transform: `translateX(${r % 2 === 0 ? "-4%" : "-11%"})` }}
          >
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="pr-8">
                {word}
              </span>
            ))}
          </div>
        ))}
      </div>

      {/* Fronds, echoing the botanical detail on premium retail banners */}
      <Frond className="absolute -top-6 right-[16%] w-40 md:w-56 text-white/[0.10] rotate-[18deg]" />
      <Frond className="absolute -bottom-10 left-[6%] w-36 md:w-52 text-white/[0.09] -rotate-[24deg]" />
      <Frond className="absolute bottom-[-14%] right-[4%] w-32 md:w-44 text-white/[0.07] rotate-[52deg]" />
    </div>
  );
}
