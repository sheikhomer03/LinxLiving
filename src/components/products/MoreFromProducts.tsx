"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/store/useCartStore";
import { useCartDrawerStore } from "@/store/useCartDrawerStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { MoreFromProduct } from "@/lib/moreFromProducts";
import {
  CONTACT_HREF,
  PRICE_ON_REQUEST_LABEL,
  isPriceOnRequest,
} from "@/lib/priceOnRequest";

export type { MoreFromProduct };

function formatPrice(value: number) {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function shortProductName(name: string) {
  return name.replace(/^FAKRO\s+/i, "").split(" in ")[0] ?? name;
}

function UpsellCard({ product }: { product: MoreFromProduct }) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const cartQty = useCartStore((s) => s.getCartQuantity(product.id));
  const openCart = useCartDrawerStore((s) => s.open);

  const priceOnRequest = isPriceOnRequest(product.price);
  const available = Math.max(0, (product.stock ?? 0) - cartQty);
  const outOfStock = !priceOnRequest && available <= 0;
  const image = product.image || "";
  const cover = image.includes("cloudinary");

  const handleAdd = () => {
    if (priceOnRequest) {
      router.push(CONTACT_HREF);
      return;
    }
    if (outOfStock) {
      toast.error(
        cartQty > 0
          ? "All available units are already in your cart"
          : "Out of stock",
      );
      return;
    }
    const result = addItem({
      id: product.id,
      name: product.name,
      price: product.price,
      image,
      category: product.category || "product",
      stock: product.stock,
      shopifyVariantId: product.shopifyVariantId || undefined,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    openCart();
    toast.success("Added to cart");
  };

  return (
    <div className="flex flex-col rounded-lg border border-foreground/10 bg-white overflow-hidden h-full">
      <Link
        href={`/products/${product.id}`}
        className="relative aspect-square bg-white border-b border-foreground/10 block"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={shortProductName(product.name)}
            className={cn(
              "absolute inset-0 h-full w-full p-2",
              cover ? "object-cover" : "object-contain",
            )}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] text-foreground/40">
            No image
          </span>
        )}
      </Link>
      <div className="flex flex-col flex-1 p-3 bg-[#f7f7f7]">
        <p className="text-[9px] font-bold uppercase tracking-wider text-foreground/45">
          {product.brandName || "Product"}
        </p>
        <Link
          href={`/products/${product.id}`}
          className="text-xs font-bold text-foreground leading-snug hover:opacity-70 transition-opacity mt-0.5 line-clamp-3"
        >
          {shortProductName(product.name)}
        </Link>
        <p className="mt-1 text-sm font-bold text-foreground">
          {priceOnRequest
            ? PRICE_ON_REQUEST_LABEL
            : formatPrice(product.price)}
        </p>
        <button
          type="button"
          onClick={handleAdd}
          disabled={outOfStock}
          className="mt-auto pt-3 w-full h-9 px-1 text-[10px] font-bold uppercase tracking-normal whitespace-nowrap border border-foreground text-foreground hover:bg-foreground hover:text-background rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {outOfStock ? "Out of Stock" : "Add to Cart"}
        </button>
      </div>
    </div>
  );
}

export function MoreFromProducts({
  categoryLabel,
  products,
}: {
  categoryLabel: string;
  products: MoreFromProduct[];
}) {
  if (!products.length) return null;

  return (
    <section className="rounded-xl border border-foreground/10 bg-[#f5f5f5] p-5">
      <h3 className="text-base font-bold text-foreground mb-4">
        More from {categoryLabel}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {products.map((product) => (
          <UpsellCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
