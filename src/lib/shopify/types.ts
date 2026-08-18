export type ShopifyUserError = {
  field?: string[] | null;
  message: string;
};

/**
 * A gallery image paired with the copy Shopify serves from its own CDN.
 * Mirrors one entry of `Product.shopifyImages`.
 */
export type ShopifyImageLink = {
  /** The Cloudinary (or supplier) URL that was uploaded. */
  sourceUrl: string;
  /** Shopify CDN URL. Empty while Shopify is still processing the upload. */
  shopifyUrl: string;
  mediaId: string;
  position: number;
};

export type ShopifyProductIds = {
  productId: string;
  variantId: string;
  inventoryItemId?: string | null;
  /** Gallery pairing produced by the media reconcile, when one ran. */
  imageLinks?: ShopifyImageLink[];
  handle?: string | null;
  /**
   * True when this call built the product on Shopify rather than finding it.
   * A fresh create already carries the full payload, so the caller can skip the
   * update that an existing product needs.
   */
  created?: boolean;
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
  /**
   * Stock-keeping code for the product-level variant.
   *
   * A product with option axes gets its SKUs through `sync-variants`, one per
   * row. A product without them has a single Shopify variant and nothing was
   * setting its SKU at all, so the whole single-variant catalogue reached
   * Shopify with a null SKU — invisible on the product page, but the field
   * fulfilment, stock reports and every export key on.
   */
  sku?: string | null;
  barcode?: string | null;
  /** Existing Shopify GIDs when updating */
  shopifyProductId?: string | null;
  shopifyVariantId?: string | null;
  /**
   * Gallery pairing recorded by the last sync. Passing it lets the media
   * reconcile recognise files it has already uploaded instead of replacing the
   * whole gallery.
   */
  shopifyImages?: ShopifyImageLink[] | null;
  /**
   * Disambiguator for the URL slug, used only if Shopify rejects the one it
   * derives from the title as taken. Supplier catalogues repeat a product name
   * across sizes and finishes, so collisions are routine rather than
   * exceptional; the Mongo id makes the retry deterministic.
   */
  handleSeed?: string | null;
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
