import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartItem {
  id: string;
  name: string;
  price: number;
  image: string;
  category: string;
  quantity: number;
  /** Catalog stock at time of add — used as max quantity. */
  stock?: number;
  /** Shopify ProductVariant GID when product is synced. */
  shopifyVariantId?: string | null;
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
  getTotalPrice: () => number;
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
        const maxStock =
          typeof product.stock === "number"
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

        if (typeof item.stock === "number" && quantity > item.stock) {
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

      getCartQuantity: (id) => {
        return get().items.find((item) => item.id === id)?.quantity || 0;
      },
    }),
    {
      name: "linx-living-cart-storage",
    },
  ),
);
