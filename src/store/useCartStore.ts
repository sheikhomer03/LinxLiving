import { create } from "zustand";
import { persist } from "zustand/middleware";
import { calculateVat } from "@/lib/vat";

export interface CartItem {
  id: string;
  name: string;
  price: number;
  image: string;
  category: string;
  /**
   * Department slug, carried so the delivery rate can be decided on the
   * taxonomy the business reasons in — Flooring and Tiles ship at the
   * palletised rate. Optional: a line without it falls back to the category
   * list in lib/shipping, which is how every line behaved before.
   */
  department?: string | null;
  quantity: number;
  /** Catalog stock at time of add — used as max quantity. */
  stock?: number;
  /**
   * VAT rate for this line. Prices are stored ex-VAT, so VAT is added on top
   * at the cart. Omitted = UK standard 20%.
   */
  vatRate?: number | null;
  /**
   * Mongo product `_id`, kept separately because `id` is a cart-line key and
   * carries the chosen option ("<productId>::CHROME-900"). Server routes that
   * need the real product — stock deduction, Shopify lookup — must read this.
   */
  productId?: string;
  /** Shopify ProductVariant GID when product is synced. */
  shopifyVariantId?: string | null;
  /**
   * Made-to-measure configurator line (ATW-style) — cut to the customer's own
   * dimensions, so it has no SKU, no stock and no Shopify variant.
   *
   * This is NOT "the customer picked an option". A chosen size or colour is an
   * ordinary stocked variant: it must still deduct stock and still check out
   * through Shopify, and marking it configured sent it to the site's own
   * checkout instead.
   */
  isConfigured?: boolean;
  configurationSummary?: string;
  configWidthMm?: number;
  configHeightMm?: number;
  /**
   * What the configurator was, and the selections it made.
   *
   * These are SELECTORS, not prices: the server re-derives the price from the
   * product in Mongo using them, so a tampered `price` cannot be charged. Only
   * quantities the customer actually receives (area, packs, chosen options)
   * travel from the browser — never a rate.
   */
  configKind?: "area" | "pooky" | "ufhs" | "size" | "colour";
  /** Area billed for, in m² — already rounded up to whole packs. */
  configAreaM2?: number;
  configPacks?: number;
  /** Indices into the product's own option arrays (Pooky). */
  configPooky?: {
    baseIndex: number | null;
    shadeIndex: number | null;
    pendantIndex: number | null;
    wallFittingIndex: number | null;
    shadeTab: "shade" | "pendant";
  };
  /** SKU of the resolved variant (UFHS), for server-side price lookup. */
  configVariantSku?: string;
  /** Colour/finish name chosen from a supplier finish list. */
  configColorName?: string;
}

type MutateResult = { ok: true } | { ok: false; error: string };

interface CartStore {
  items: CartItem[];
  addItem: (
    product: Omit<CartItem, "quantity"> & { stock?: number },
  ) => MutateResult;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => MutateResult;
  clearCart: () => void;
  syncItemImages: (imagesById: Record<string, string>) => void;
  getTotalItems: () => number;
  /** Goods total EXCLUDING VAT (prices are stored ex-VAT). */
  getTotalPrice: () => number;
  /** VAT due on the current basket, before shipping/discount. */
  getVatAmount: () => number;
  /** Goods total INCLUDING VAT. */
  getTotalIncVat: () => number;
  getCartQuantity: (id: string) => number;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (product) => {
        const currentItems = get().items;
        const existingItem = currentItems.find(
          (item) => item.id === product.id,
        );
        const nextQty = (existingItem?.quantity || 0) + 1;
        const maxStock = product.isConfigured
          ? undefined
          : typeof product.stock === "number"
            ? product.stock
            : typeof existingItem?.stock === "number"
              ? existingItem.stock
              : undefined;

        if (typeof maxStock === "number" && nextQty > maxStock) {
          return { ok: false, error: "Not enough stock available" };
        }

        if (existingItem) {
          set({
            items: currentItems.map((item) =>
              item.id === product.id
                ? {
                    ...item,
                    quantity: item.quantity + 1,
                    stock: maxStock ?? item.stock,
                    shopifyVariantId:
                      product.shopifyVariantId ?? item.shopifyVariantId,
                  }
                : item,
            ),
          });
        } else {
          set({
            items: [
              ...currentItems,
              { ...product, quantity: 1, stock: maxStock ?? product.stock },
            ],
          });
        }

        return { ok: true };
      },

      removeItem: (id) => {
        set({
          items: get().items.filter((item) => item.id !== id),
        });
      },

      updateQuantity: (id, quantity) => {
        const item = get().items.find((i) => i.id === id);
        if (!item) return { ok: false, error: "Item not found" };

        if (quantity <= 0) {
          get().removeItem(id);
          return { ok: true };
        }

        if (
          !item.isConfigured &&
          typeof item.stock === "number" &&
          quantity > item.stock
        ) {
          return { ok: false, error: "Not enough stock available" };
        }

        set({
          items: get().items.map((i) =>
            i.id === id ? { ...i, quantity } : i,
          ),
        });
        return { ok: true };
      },

      clearCart: () => set({ items: [] }),

      syncItemImages: (imagesById) => {
        set({
          items: get().items.map((item) => {
            const next = imagesById[item.id];
            if (!next || next === item.image) return item;
            return { ...item, image: next };
          }),
        });
      },

      getTotalItems: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },

      getTotalPrice: () => {
        return get().items.reduce(
          (total, item) => total + item.price * item.quantity,
          0,
        );
      },

      getVatAmount: () => {
        return calculateVat({ lines: get().items }).vatAmount;
      },

      getTotalIncVat: () => {
        const { subtotalExVat, vatAmount } = calculateVat({
          lines: get().items,
        });
        return Math.round((subtotalExVat + vatAmount) * 100) / 100;
      },

      getCartQuantity: (id) => {
        return get().items.find((item) => item.id === id)?.quantity || 0;
      },
    }),
    {
      name: "linx-living-cart-storage",
    },
  ),
);
