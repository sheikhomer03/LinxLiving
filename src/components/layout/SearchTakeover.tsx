/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { getPublicProducts, getSearchPopularProducts } from "@/app/actions/products";
import { getProductDisplayImage } from "@/lib/productImage";
import { getPriceLabel } from "@/lib/priceOnRequest";
import { resolveStorefrontUnitPrice } from "@/lib/naturaPrice";

/**
 * The header's search panel, built to Lusso Stone's.
 *
 * Theirs is not a dropdown: clicking "Search" drops a white panel over the
 * whole viewport — announcement bar, logo row and nav all disappear behind it
 * — carrying a borderless full-bleed input at the top and, beneath, the
 * things worth clicking before you have typed anything. Measured off the live
 * site: 66px input row, 32px below it to the results, 40px between result
 * columns from 990px up.
 *
 * It renders nothing until opened, so the popular-products read only happens
 * when someone actually opens the panel.
 */

/** One product row in the results column. */
function ProductRow({
  product,
  onNavigate,
  wide,
}: {
  product: any;
  onNavigate: () => void;
  /**
   * Typed results run title and price on one line across a wider column;
   * the untyped "Popular Products" column is narrow and stacks them.
   */
  wide?: boolean;
}) {
  const image = getProductDisplayImage(product.images);
  const brandName = product.brandName || product.brand?.name;
  const brandSlug = product.brandSlug || product.brand?.slug;
  const unit = resolveStorefrontUnitPrice({
    price: product.price,
    brandName,
    brandSlug,
    specs: product.specs,
  });

  return (
    <Link
      href={`/products/${product._id}`}
      onClick={onNavigate}
      className="flex w-full items-center gap-4 text-left"
    >
      <span className="relative block h-20 w-20 shrink-0 overflow-hidden bg-secondary/40">
        {image ? (
          // `contain`, not `cover` — the reference does the same, and a
          // cropped tap or trim profile is unrecognisable at 80px.
          <Image
            src={image}
            alt=""
            fill
            sizes="80px"
            className="object-contain"
          />
        ) : null}
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-col",
          wide && "sm:flex-row sm:items-baseline sm:gap-3",
        )}
      >
        <span className="lx-menu-type text-black">{product.name}</span>
        <span className="lx-menu-type whitespace-nowrap text-black/50">
          {getPriceLabel(
            unit.price,
            brandName,
            brandSlug,
            product.specs?.priceDisplay,
          )}
          {unit.perSqm ? " /m²" : ""}
        </span>
      </span>
    </Link>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-6 text-[14px] font-medium uppercase leading-[1.2] tracking-[0.1em] text-black">
      {children}
    </h2>
  );
}

export function SearchTakeover({
  open,
  onClose,
  /** Uppercase shortcuts under "Trending searches" — the department names. */
  trending,
}: {
  open: boolean;
  onClose: () => void;
  trending: { label: string; href: string }[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ term: string; items: any[] } | null>(
    null,
  );
  const [popular, setPopular] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const router = useRouter();

  const trimmed = query.trim();
  const isTyping = trimmed.length > 1;

  const close = useCallback(() => {
    setQuery("");
    setResults(null);
    onClose();
  }, [onClose]);

  /*
   * Clear the field whenever the panel closes, so the next open starts from
   * the untyped state rather than the last search — including when the
   * parent closes it for us (a route change does exactly that) rather than
   * going through `close`.
   *
   * Adjusted during render off a previous-value marker rather than in an
   * effect: React re-runs this pass before committing anything to the DOM,
   * where the effect version would paint the stale query first and then
   * cascade a second render to wipe it.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setResults(null);
    }
  }

  // Focus the field the moment the panel opens.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(id);
  }, [open]);

  // Escape closes, and the page behind must not scroll while the panel covers it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  // Popular products are fetched once, on first open — not on mount, so a
  // visitor who never opens search never pays for the query.
  useEffect(() => {
    if (!open || popular.length) return;
    let cancelled = false;
    getSearchPopularProducts(4)
      .then((list) => {
        if (!cancelled) setPopular(list || []);
      })
      .catch(() => {
        if (!cancelled) setPopular([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, popular.length]);

  /*
   * Results carry the term they belong to.
   *
   * Cheaper than clearing them whenever the field empties — that needed a
   * synchronous setState in the effect, which cascades a second render — and
   * it also fixes the flash of the previous query's products during the
   * 300ms debounce on the next one. A result set only renders when its term
   * still matches what is in the field.
   */
  useEffect(() => {
    if (!isTyping) return;
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const { products } = await getPublicProducts({
          search: trimmed,
          limit: 6,
        });
        if (requestId !== requestIdRef.current) return;
        setResults({ term: trimmed, items: products });
      } catch {
        if (requestId !== requestIdRef.current) return;
        setResults({ term: trimmed, items: [] });
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [trimmed, isTyping]);

  const submit = () => {
    if (!trimmed) return;
    close();
    router.push(`/search?search=${encodeURIComponent(trimmed)}`);
  };

  // Typing filters the shortcut list the way the reference does, so the
  // column narrows to matches instead of sitting there unchanged.
  const shownTrending = isTyping
    ? trending.filter((t) =>
        t.label.toLowerCase().includes(trimmed.toLowerCase()),
      )
    : trending;

  const matched = results?.term === trimmed ? results.items : null;
  const loading = isTyping && (isLoading || matched === null);
  const products = isTyping ? (matched ?? []) : popular;
  const noResults = isTyping && !loading && matched?.length === 0;

  return (
    <div
      className={cn(
        // Covers the announcement bar too: the reference panel starts at the
        // very top of the window, not below the black strip.
        "fixed inset-x-0 top-0 z-100 h-[100dvh] bg-white transition-[transform,opacity] duration-300 ease-[cubic-bezier(.6,0,.2,1)]",
        open
          ? "translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-full opacity-0",
      )}
      aria-hidden={!open}
    >
      <div className="flex h-full flex-col">
        {/* Input row — 66px, full bleed, borderless, rule underneath. */}
        <div className="relative shrink-0 border-b border-black/5 px-4 py-4 lg:px-8">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 opacity-100 lg:left-8" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Search “Stone Bath”"
            aria-label="Search"
            /*
             * `shadow-none!` as well as `border-none!`: globals.css gives
             * every focused input a gold border and a 3px ring, and the
             * border utility alone left the ring drawing a box round a field
             * that is supposed to be invisible apart from the rule beneath
             * it.
             */
            className="h-8 w-full border-none! bg-transparent pl-10 pr-10 text-[16px] font-normal tracking-[0.02em] text-black shadow-none! outline-none placeholder:text-black/50 focus:border-none! focus:shadow-none! lg:text-[14px]"
          />
          {loading ? (
            <Loader2 className="absolute right-14 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin opacity-100 lg:right-20" />
          ) : null}
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="absolute right-4 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center lg:right-8"
          >
            <X className="h-5 w-5 stroke-[1.5] opacity-100" />
          </button>
        </div>

        {/* Results — 32px below the row, stacked on mobile, two columns from
            lg up with a 40px gutter. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-8 lg:px-8">
          <div className="flex flex-col gap-14 lg:flex-row lg:gap-10">
            {/* The products column is narrow while it is showing the four
                popular picks, and widens once there are real results in it —
                the reference does the same, so a matched title and its price
                sit on one line instead of wrapping over four. */}
            <div
              className={cn(
                "flex min-w-0 flex-col",
                isTyping
                  ? "lg:max-w-[44rem] lg:flex-1"
                  : "lg:w-[19rem] lg:shrink-0",
              )}
            >
              <GroupHeading>
                {isTyping ? "Products" : "Popular products"}
              </GroupHeading>

              {noResults ? (
                <p className="lx-menu-type text-black/50">
                  No products found for “{trimmed}”
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {products.map((product) => (
                    <ProductRow
                      key={product._id}
                      product={product}
                      onNavigate={close}
                      wide={isTyping}
                    />
                  ))}
                </div>
              )}

              {isTyping && products.length ? (
                <button
                  type="button"
                  onClick={submit}
                  className="lx-menu-type mt-8 w-fit bg-black px-8 py-3.5 text-white"
                >
                  View more
                </button>
              ) : null}
            </div>

            {/* Hidden outright when a query matches none of the shortcuts.
                A "Trending searches" heading over the words "no matches" is
                just noise beside a column of real results. */}
            <div
              className={cn(
                "flex min-w-0 flex-col lg:w-[19rem] lg:shrink-0",
                !shownTrending.length && "hidden",
              )}
            >
              <GroupHeading>Trending searches</GroupHeading>
              {shownTrending.length ? (
                <ul className="flex flex-col gap-2">
                  {shownTrending.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={close}
                        className="text-[13px] font-medium uppercase leading-[1.4] tracking-[0.1em] text-black"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lx-menu-type text-black/50">No matches</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
