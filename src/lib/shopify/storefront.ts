import {
  getShopifyConfig,
  shopifyStorefrontGraphqlUrl,
  type ShopifyConfig,
} from "./config";
import type { StorefrontProduct } from "./types";

export class ShopifyStorefrontError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "ShopifyStorefrontError";
  }
}

type GraphqlResponse<T> = {
  data?: T;
  errors?: { message: string }[];
};

export async function shopifyStorefrontRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  configOverride?: ShopifyConfig,
): Promise<T> {
  const config = configOverride ?? getShopifyConfig();
  if (!config?.storefrontAccessToken) {
    throw new ShopifyStorefrontError(
      "Shopify Storefront is not configured. Set SHOPIFY_STOREFRONT_ACCESS_TOKEN.",
    );
  }

  const res = await fetch(shopifyStorefrontGraphqlUrl(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": config.storefrontAccessToken,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ShopifyStorefrontError(
      `Shopify Storefront API HTTP ${res.status}: ${text.slice(0, 300)}`,
      res.status,
    );
  }

  const json = (await res.json()) as GraphqlResponse<T>;
  if (json.errors?.length) {
    throw new ShopifyStorefrontError(
      json.errors.map((e) => e.message).join("; "),
    );
  }
  if (!json.data) {
    throw new ShopifyStorefrontError("Shopify Storefront API returned no data");
  }
  return json.data;
}

const PRODUCT_CARD_FIELDS = `
  id
  handle
  title
  description
  productType
  vendor
  tags
  availableForSale
  totalInventory
  featuredImage { url altText }
  images(first: 10) { nodes { url altText } }
  priceRange {
    minVariantPrice { amount currencyCode }
  }
  variants(first: 1) {
    nodes { id availableForSale quantityAvailable }
  }
`;

function mapProduct(node: any): StorefrontProduct {
  const priceAmount = node.priceRange?.minVariantPrice?.amount ?? "0";
  const currencyCode =
    node.priceRange?.minVariantPrice?.currencyCode ?? "GBP";
  const variant = node.variants?.nodes?.[0];

  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    description: node.description ?? "",
    productType: node.productType ?? "",
    vendor: node.vendor ?? "",
    tags: node.tags ?? [],
    featuredImage: node.featuredImage ?? null,
    images: (node.images?.nodes ?? []).map((img: any) => ({
      url: img.url,
      altText: img.altText,
    })),
    price: parseFloat(priceAmount),
    currencyCode,
    availableForSale: Boolean(node.availableForSale),
    totalInventory:
      typeof node.totalInventory === "number" ? node.totalInventory : null,
    variantId: variant?.id ?? null,
  };
}

export async function fetchStorefrontProducts(options?: {
  first?: number;
  query?: string;
}): Promise<StorefrontProduct[]> {
  const first = options?.first ?? 24;
  const data = await shopifyStorefrontRequest<{
    products: { nodes: any[] };
  }>(
    `
    query Products($first: Int!, $query: String) {
      products(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        nodes { ${PRODUCT_CARD_FIELDS} }
      }
    }
  `,
    { first, query: options?.query ?? null },
  );

  return data.products.nodes.map(mapProduct);
}

export async function fetchStorefrontProductByHandle(
  handle: string,
): Promise<StorefrontProduct | null> {
  const data = await shopifyStorefrontRequest<{
    product: any | null;
  }>(
    `
    query ProductByHandle($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CARD_FIELDS} }
    }
  `,
    { handle },
  );

  return data.product ? mapProduct(data.product) : null;
}

export async function fetchStorefrontProductById(
  id: string,
): Promise<StorefrontProduct | null> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
  const data = await shopifyStorefrontRequest<{
    product: any | null;
  }>(
    `
    query ProductById($id: ID!) {
      product(id: $id) { ${PRODUCT_CARD_FIELDS} }
    }
  `,
    { id: gid },
  );

  return data.product ? mapProduct(data.product) : null;
}
