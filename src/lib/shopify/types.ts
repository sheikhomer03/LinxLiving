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
  showSpecs?: boolean | null;
  schematicImage?: string | null;
  installationGuide?: string | null;
  insulatingSetPrice?: number | null;
  flashingFinder?: unknown;
  finishes?: unknown;
  flashings?: unknown;
  /**
   * Force the Shopify status instead of deriving it from `category`.
   *
   * A product normally goes Active as soon as it has a main category. Set
   * "DRAFT" to push a fully built product — variants, options, images — while
   * keeping it off sale, which is what a range still awaiting a pricing
   * decision needs. Omit to keep the category-derived behaviour.
   */
  shopifyStatus?: "ACTIVE" | "DRAFT" | null;
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
