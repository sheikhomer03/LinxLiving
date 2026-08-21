"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { getPublicProducts } from "@/app/actions/products";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { getProductDisplayImage } from "@/lib/productImage";
import { getPriceLabel } from "@/lib/priceOnRequest";
import { resolveStorefrontUnitPrice } from "@/lib/naturaPrice";

interface SearchBarProps {
  onClose?: () => void;
  className?: string;
  isMobile?: boolean;
}

export function SearchBar({ onClose, className, isMobile }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const router = useRouter();

  const goToSearchPage = (value: string) => {
    const q = value.trim();
    if (!q) return;
    setIsOpen(false);
    setQuery("");
    if (onClose) onClose();
    router.push(`/search?search=${encodeURIComponent(q)}`);
  };

  // Debounce search
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length <= 1) {
      setResults([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const { products } = await getPublicProducts({
          search: trimmed,
          limit: 5,
        });
        if (requestId !== requestIdRef.current) return;
        setResults(products);
        setIsOpen(true);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setResults([]);
        setIsOpen(true);
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleResultClick = (productId: string) => {
    setIsOpen(false);
    setQuery("");
    if (onClose) onClose();
    router.push(`/products/${productId}`);
  };

  return (
    <div ref={searchRef} className={cn("relative w-full group", className)}>
      <div
        className={cn(
          "relative rounded-lg border border-foreground/10 bg-white transition-all duration-300 overflow-hidden",
          isOpen && results.length > 0
            ? "shadow-2xl ring-1 ring-foreground/5 z-50"
            : "shadow-sm",
        )}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              goToSearchPage(query);
            }
          }}
          placeholder={
            isMobile ? "Search our catalog" : "What are you looking for?"
          }
          className={cn(
            "w-full bg-transparent px-3.5 py-2 pl-9 text-[11px] tracking-wide outline-none border-none! placeholder:text-foreground/40 placeholder:normal-case placeholder:tracking-normal",
            isMobile && "py-2.5 text-sm",
          )}
        />
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-60 group-focus-within:opacity-100 transition-opacity" />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin opacity-80" />
        )}
        {query && !isLoading && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setIsOpen(false);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-100 opacity-80 transition-opacity"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && results.length > 0 && (
        <div
          className={cn(
            "absolute top-full left-0 right-0 mt-2 bg-white border border-foreground/10 rounded-xl shadow-2xl overflow-hidden z-100 animate-in fade-in slide-in-from-top-2 duration-300",
            isMobile ? "max-h-[60vh] overflow-y-auto" : "",
          )}
        >
          <div className="p-2 border-b border-foreground/5 bg-secondary/10">
            <p className="text-[9px] uppercase tracking-[0.2em] font-bold opacity-80 px-3 py-1">
              Top Matches
            </p>
          </div>
          <div className="flex flex-col">
            {results.map((product) => (
              <button
                key={product._id}
                type="button"
                onClick={() => handleResultClick(product._id)}
                className="flex items-center gap-4 p-4 hover:bg-secondary transition-all text-left group/item"
              >
                <div className="relative w-12 h-12 bg-secondary/10 overflow-hidden rounded-lg shrink-0">
                  {getProductDisplayImage(product.images) ? (
                    <Image
                      src={getProductDisplayImage(product.images)}
                      alt={product.name}
                      fill
                      className="object-cover transition-transform duration-500 group-hover/item:scale-110"
                    />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#333] truncate">
                    {product.name}
                  </h4>
                  <p className="text-[9px] opacity-80 uppercase tracking-widest mt-0.5">
                    {product.category}
                  </p>
                </div>
                <div className="text-right">
                  {(() => {
                    const brandName =
                      product.brandName || product.brand?.name;
                    const brandSlug =
                      product.brandSlug || product.brand?.slug;
                    const unit = resolveStorefrontUnitPrice({
                      price: product.price,
                      brandName,
                      brandSlug,
                      specs: product.specs,
                    });
                    return (
                      <p className="text-[11px] font-bold text-[#333]">
                        {getPriceLabel(
                          unit.price,
                          brandName,
                          brandSlug,
                          product.specs?.priceDisplay,
                        )}
                        {unit.perSqm ? (
                          <span className="font-semibold">/m²</span>
                        ) : null}
                      </p>
                    );
                  })()}
                </div>
              </button>
            ))}
          </div>
          <Link
            href={`/search?search=${encodeURIComponent(query.trim())}`}
            onClick={() => {
              setIsOpen(false);
              if (onClose) onClose();
            }}
            className="block p-4 text-center text-[9px] uppercase tracking-[0.2em] font-bold bg-secondary/10 hover:bg-secondary/30 transition-all border-t border-foreground/5"
          >
            View all results
          </Link>
        </div>
      )}

      {/* No Results state */}
      {isOpen &&
        query.trim().length > 1 &&
        results.length === 0 &&
        !isLoading && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-foreground/10 rounded-xl shadow-2xl p-8 text-center animate-in fade-in slide-in-from-top-2 duration-300 z-100">
            <Search className="w-8 h-8 opacity-80 mx-auto mb-4" />
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80">
              No products found for &quot;{query}&quot;
            </p>
          </div>
        )}
    </div>
  );
}
