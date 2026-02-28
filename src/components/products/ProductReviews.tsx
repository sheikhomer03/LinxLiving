"use client";

import React, { useRef } from "react";
import {
  Star,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Pause,
} from "lucide-react";
import { cn } from "@/lib/utils";

const REVIEWS = [
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
    comment:
      "Linx Living have a super range of products. The website is easy to use and should you need to contact Linx Living, emails are responded to quickly and efficiently.",
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

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      const scrollTo =
        direction === "left"
          ? scrollLeft - clientWidth / 2
          : scrollLeft + clientWidth / 2;

      scrollRef.current.scrollTo({ left: scrollTo, behavior: "smooth" });
    }
  };

  return (
    <section className="bg-[#f5f5f5] py-20 px-6 lg:px-20 overflow-hidden">
      <div className="max-w-8xl mx-auto flex flex-col lg:flex-row gap-0 lg:gap-12 items-stretch">
        {/* Left: Summary Banner */}
        <div className="lg:w-72 bg-[#e5e1dd] p-12 flex flex-col items-center justify-center text-center space-y-6 shrink-0 shadow-xl shadow-black/5 z-10">
          <h3 className="text-xl font-serif tracking-tight text-[#333]">
            Excellent
          </h3>
          <div className="flex gap-1">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="w-4 h-4 fill-[#333] text-[#333]" />
            ))}
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-sans opacity-60">4.9 average</p>
            <p className="text-[11px] font-sans opacity-60">379 reviews</p>
          </div>
          <div className="flex items-center gap-2 pt-4">
            <div className="w-5 h-5 rounded-full bg-[#333] flex items-center justify-center">
              <Star className="w-2.5 h-3.5 fill-white text-white" />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#333]">
              Reviews.io
            </p>
          </div>
        </div>

        {/* Right: Carousel Container */}
        <div className="relative flex-1 group">
          {/* Controls */}
          <button
            onClick={() => scroll("left")}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 bg-white shadow-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110 active:scale-95"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <button
            onClick={() => scroll("right")}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 bg-white shadow-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110 active:scale-95"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          {/* Carousel */}
          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto no-scrollbar py-8 lg:py-0 items-stretch"
          >
            {REVIEWS.map((review) => (
              <div
                key={review.id}
                className="w-[300px] lg:w-[350px] bg-white p-10 flex flex-col justify-between space-y-8 shrink-0 shadow-sm hover:shadow-xl transition-all duration-500 group/card"
              >
                <div className="space-y-6">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <p className="text-[11px] font-bold uppercase tracking-tight text-[#333]">
                        {review.name}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-green-600" />
                        <p className="text-[9px] uppercase tracking-widest font-bold opacity-40">
                          Verified Customer
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      {[...Array(review.rating)].map((_, i) => (
                        <Star
                          key={i}
                          className="w-3 h-3 fill-[#333] text-[#333]"
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-sm font-sans leading-relaxed text-[#333]/70">
                    "{review.comment}"
                  </p>
                </div>
                <div className="flex justify-end">
                  <p className="text-[10px] font-sans opacity-30">
                    {review.date}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom Controls */}
          <div className="absolute bottom-4 right-0 flex items-center gap-4 opacity-40 hover:opacity-100 transition-opacity">
            <Pause className="w-3 h-3 cursor-pointer" />
          </div>
        </div>
      </div>
    </section>
  );
}
