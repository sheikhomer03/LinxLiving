"use client";

import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { cn } from "@/lib/utils";

export type ProductAddOn = {
  /** Department slug — decides the delivery rate (see lib/shipping). */
  department?: string | null;
  id: string;
  name: string;
  image: string;
  price: number;
  category: string;
  stock: number;
};

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * "Add-ons for this product" — the complementary items the supplier shows
 * under the gallery (bulbs, fixings), each addable without leaving the page.
 */
export function ProductAddOns({
  heading = "Add-ons for this product",
  items = [],
  className,
}: {
  heading?: string;
  items?: ProductAddOn[];
  className?: string;
}) {
  const addItem = useCartStore((s) => s.addItem);
  const openCart = useCartDrawerStore((s) => s.open);
  const usable = (items || []).filter((i) => i?.id && i?.name);
  if (!usable.length) return null;

  const add = (item: ProductAddOn) => {
    const result = addItem({
      id: item.id,
      name: item.name,
      price: item.price,
      image: item.image,
      category: item.category,
      department: item.department ?? null,
      stock: item.stock,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${item.name} added to your cart`);
    openCart();
  };

  return (
    <section className={cn("mt-6", className)}>
      <details open className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 border-b border-foreground/10 pb-3 text-base font-semibold">
          {heading}
          <span className="text-lg leading-none text-foreground/40 transition-transform group-open:rotate-45">
            +
          </span>
        </summary>
        <div className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-3 lg:grid-cols-4">
          {usable.map((item) => (
            <div key={item.id} className="min-w-0">
              <Link
                href={`/products/${item.id}`}
                className="block overflow-hidden rounded-lg border border-foreground/10 bg-[#fafafa]"
              >
                <div className="relative aspect-square">
                  {item.image ? (
                    <Image
                      src={item.image}
                      alt={item.name}
                      fill
                      sizes="(max-width: 640px) 45vw, 200px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
              </Link>
              <div className="mt-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/products/${item.id}`}
                    className="text-xs font-medium leading-snug hover:underline"
                  >
                    {item.name}
                  </Link>
                  <p className="mt-0.5 text-xs font-semibold">
                    {formatPrice(item.price)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => add(item)}
                  aria-label={`Add ${item.name} to cart`}
                  className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-foreground/20 hover:bg-foreground hover:text-background transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
