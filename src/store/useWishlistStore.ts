import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WishlistItem {
  id: string;
  name: string;
  price: number;
  image: string;
  category: string;
  /** Department slug — carried so "move to cart" is rated like any other add. */
  department?: string | null;
}

interface WishlistStore {
  items: WishlistItem[];
  addItem: (item: WishlistItem) => void;
  removeItem: (id: string) => void;
  setItems: (items: WishlistItem[]) => void;
  syncItemImages: (imagesById: Record<string, string>) => void;
  clearWishlist: () => void;
  isInWishlist: (id: string) => boolean;
}

export const useWishlistStore = create<WishlistStore>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (item) => {
        const items = get().items;
        if (!items.find((i) => i.id === item.id)) {
          set({ items: [...items, item] });
        }
      },
      removeItem: (id) => {
        set({ items: get().items.filter((i) => i.id !== id) });
      },
      setItems: (items) => set({ items }),
      syncItemImages: (imagesById) => {
        set({
          items: get().items.map((item) => {
            const next = imagesById[item.id];
            if (!next || next === item.image) return item;
            return { ...item, image: next };
          }),
        });
      },
      clearWishlist: () => set({ items: [] }),
      isInWishlist: (id) => get().items.some((i) => i.id === id),
    }),
    {
      name: "wishlist-storage",
    },
  ),
);
