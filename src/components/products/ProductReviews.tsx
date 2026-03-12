"use client";

import React, { useRef, useState, useEffect } from "react";
import { Star, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { getStoreName } from "@/app/actions/settings";
import { cn } from "@/lib/utils";

const getReviews = (storeName: string) => [
  {
    id: 1,
    name: "Antoinette",
    rating: 5,
    comment:
      "Excellent support. Cannot wait to receive the tub! Highly professional service throughout.",
    date: "1 week ago",
    verified: true,
  },
  {
    id: 2,
    name: "Adam Z",
    rating: 5,
    comment:
      "The range was fantastic making choice very easy. Ordering process was smooth and communication was second to none. Would highly recommend.",
    date: "1 week ago",
    verified: true,
  },
  {
    id: 3,
    name: "Judith H",
    rating: 5,
    comment:
      "Amazed at the high quality of our vanity unit - we had a follow up call giving us a firm quick delivery date. Great service - just need to fit it now!",
    date: "2 weeks ago",
    verified: true,
  },
  {
    id: 4,
    name: "Janet",
    rating: 5,
    comment: `${storeName} have a super range of products. The website is easy to use and should you need to contact ${storeName}, emails are responded to quickly and efficiently.`,
    date: "2 weeks ago",
    verified: true,
  },
  {
    id: 5,
    name: "Michael R",
    rating: 5,
    comment:
      "The precision of the cut and the depth of the gold veining exceeds expectations. A true architectural masterpiece for our ensuite.",
    date: "3 weeks ago",
    verified: true,
  },
];

export function ProductReviews() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [storeName, setStoreName] = useState("Linx Living");
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  useEffect(() => {
    getStoreName().then(setStoreName);
  }, []);

  const checkScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 10);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
    }
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, []);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const { clientWidth } = scrollRef.current;
      // Scroll by one card width (assuming ~400px + gap) or 70% of view
      const scrollAmount = clientWidth > 1200 ? 800 : clientWidth * 0.8;
      const scrollTo =
        direction === "left"
          ? scrollRef.current.scrollLeft - scrollAmount
          : scrollRef.current.scrollLeft + scrollAmount;

      scrollRef.current.scrollTo({
        left: scrollTo,
        behavior: "smooth",
      });
    }
  };

  return (
    <section className="bg-[#f5f5f5] py-24 px-6 lg:px-20 overflow-hidden border-t border-foreground/5">
      <div className="max-w-[1800px] mx-auto flex flex-col lg:flex-row gap-0 lg:gap-16 items-stretch">
        {/* Left: Summary Banner */}
        <div className="lg:w-80 bg-[#e5e1dd] p-12 lg:p-16 flex flex-col items-center justify-center text-center space-y-8 shrink-0 shadow-2xl shadow-black/5 z-20">
          <div className="space-y-4">
            <h3 className="text-2xl font-serif tracking-tight text-[#333]">
              Excellent
            </h3>
            <div className="flex gap-1.5 justify-center">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-5 h-5 fill-[#333] text-[#333]" />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-sans font-bold opacity-90">
              4.9 average
            </p>
            <p className="text-xs font-sans opacity-80">Based on 379 reviews</p>
          </div>
          <div className="flex items-center gap-3 pt-6 border-t border-[#333]/10 w-full justify-center">
            <div className="w-6 h-6 rounded-full bg-[#333] flex items-center justify-center">
              <Star className="w-3 h-3 fill-white text-white" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-widest text-[#333]">
              Reviews.io
            </p>
          </div>
        </div>

        {/* Right: Carousel Container */}
        <div className="relative flex-1 group min-w-0">
          {/* Controls */}
          <button
            onClick={() => scroll("left")}
            disabled={!canScrollLeft}
            className={cn(
              "absolute left-6 top-1/2 -translate-y-1/2 z-50 w-12 h-12 bg-white shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 disabled:scale-90 disabled:opacity-0",
              canScrollLeft
                ? "opacity-800 lg:opacity-0 lg:group-hover:opacity-800"
                : "pointer-events-none",
            )}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <button
            onClick={() => scroll("right")}
            disabled={!canScrollRight}
            className={cn(
              "absolute right-6 top-1/2 -translate-y-1/2 z-50 w-12 h-12 bg-white shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 disabled:scale-90 disabled:opacity-0",
              canScrollRight
                ? "opacity-800 lg:opacity-0 lg:group-hover:opacity-800"
                : "pointer-events-none",
            )}
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          {/* Carousel */}
          <div
            ref={scrollRef}
            onScroll={checkScroll}
            className="flex gap-6 lg:gap-10 overflow-x-auto no-scrollbar py-12 lg:py-6 items-stretch snap-x snap-mandatory scroll-smooth"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {getReviews(storeName).map((review) => (
              <div
                key={review.id}
                className="w-[85vw] sm:w-[400px] lg:w-[450px] bg-white p-10 lg:p-14 flex flex-col justify-between space-y-10 shrink-0 shadow-sm hover:shadow-2xl transition-all duration-700 group/card snap-start"
              >
                <div className="space-y-8">
                  <div className="flex justify-between items-start">
                    <div className="space-y-2">
                      <p className="text-xs font-black uppercase tracking-widest text-[#333]">
                        {review.name}
                      </p>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                        <p className="text-[9px] uppercase tracking-[0.2em] font-black opacity-90">
                          Verified
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      {[...Array(review.rating)].map((_, i) => (
                        <Star
                          key={i}
                          className="w-3.5 h-3.5 fill-[#333] text-[#333]"
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-[15px] lg:text-base font-serif italic leading-relaxed text-[#333]/80">
                    "{review.comment}"
                  </p>
                </div>
                <div className="flex items-center justify-between pt-6 border-t border-[#333]/5">
                  <div className="flex gap-1">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={i}
                        className="w-1 h-1 rounded-full bg-[#333]/10"
                      />
                    ))}
                  </div>
                  <p className="text-[10px] font-sans opacity-90 uppercase tracking-widest">
                    {review.date}
                  </p>
                </div>
              </div>
            ))}
            {/* End Spacer */}
            <div className="w-1 lg:w-20 shrink-0" />
          </div>
        </div>
      </div>
    </section>
  );
}
