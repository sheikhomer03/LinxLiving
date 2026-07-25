export type ShopifyUserError = {
  field?: string[] | null;
  message: string;
};

export type ShopifyProductIds = {
  productId: string;
  variantId: string;
  inventoryItemId?: string | null;
};

export type LinxProductForShopify = {
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  subCategory?: string | null;
  brandName?: string | null;
  images?: string[];
  tagline?: string | null;
  specs?: Record<string, unknown> | null;
  /** Existing Shopify GIDs when updating */
  shopifyProductId?: string | null;
  shopifyVariantId?: string | null;
};

export type StorefrontMoney = {
  amount: string;
  currencyCode: string;
};

export type StorefrontProduct = {
  id: string;
  handle: string;
  title: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  featuredImage?: { url: string; altText?: string | null } | null;
  images: { url: string; altText?: string | null }[];
  price: number;
  currencyCode: string;
  availableForSale: boolean;
  totalInventory: number | null;
  variantId: string | null;
};
