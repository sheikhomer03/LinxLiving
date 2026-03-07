"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { getPublicProducts } from "@/app/actions/products";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

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
  const router = useRouter();

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.trim().length > 1) {
        setIsLoading(true);
        const { products } = await getPublicProducts({
          search: query,
          limit: 5,
        });
        setResults(products);
        setIsLoading(false);
        setIsOpen(true);
      } else {
        setResults([]);
        setIsOpen(false);
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
          "relative rounded-xl border border-foreground/10 bg-white transition-all duration-300 overflow-hidden",
          isOpen && results.length > 0
            ? "shadow-2xl ring-1 ring-foreground/5 z-50"
            : "shadow-sm",
        )}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            isMobile ? "Search our collections" : "What are you looking for?"
          }
          className={cn(
            "w-full bg-transparent px-4 py-3 pl-10 text-[10px] uppercase tracking-[0.2em] outline-none placeholder:text-foreground/40",
            isMobile && "py-4 text-xs",
          )}
        />
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-80 group-focus-within:opacity-800 transition-opacity" />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin opacity-80" />
        )}
        {query && !isLoading && (
          <button
            onClick={() => {
              setQuery("");
              setIsOpen(false);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-800 opacity-80 transition-opacity"
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
                onClick={() => handleResultClick(product._id)}
                className="flex items-center gap-4 p-4 hover:bg-secondary/20 transition-all text-left group/item"
              >
                <div className="relative w-12 h-12 bg-secondary/10 overflow-hidden rounded-lg shrink-0">
                  <Image
                    src={product.images[0]}
                    alt={product.name}
                    fill
                    className="object-cover transition-transform duration-500 group-hover/item:scale-110"
                  />
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
                  <p className="text-[11px] font-bold text-[#333]">
                    £{product.price.toLocaleString()}
                  </p>
                </div>
              </button>
            ))}
          </div>
          <Link
            href={`/search?q=${query}`}
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
              No products found for "{query}"
            </p>
          </div>
        )}
    </div>
  );
}
