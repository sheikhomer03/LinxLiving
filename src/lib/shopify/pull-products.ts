import { shopifyAdminRequest } from "./admin";
import {
  mapGraphqlProduct,
  upsertMongoProductFromShopify,
} from "./inbound";

const PRODUCT_FIELDS = `
  id
  title
  handle
  status
  productType
  vendor
  tags
  description
  descriptionHtml
  featuredImage { url }
  media(first: 10) {
    nodes {
      preview { image { url } }
    }
  }
  variants(first: 1) {
    nodes {
      id
      price
      inventoryQuantity
    }
  }
`;

/**
 * Pull products from Shopify Admin API into Mongo (Shopify → Linx).
 */
export async function pullProductsFromShopify(options?: {
  first?: number;
  query?: string;
}) {
  const first = Math.min(Math.max(options?.first ?? 50, 1), 100);

  const data = await shopifyAdminRequest<{
    products: {
      nodes: any[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }>(
    `
    query PullProducts($first: Int!, $query: String) {
      products(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
        nodes { ${PRODUCT_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,
    {
      first,
      query: options?.query ?? "status:active",
    },
  );

  const results: {
    action: "created" | "updated";
    id: string;
    name: string;
    shopifyProductId: string;
  }[] = [];

  for (const node of data.products.nodes) {
    // Skip drafts if query didn't filter them
    if (String(node.status).toUpperCase() === "DRAFT") continue;
    const mapped = mapGraphqlProduct(node);
    const result = await upsertMongoProductFromShopify(mapped);
    results.push(result);
  }

  return {
    pulled: results.length,
    created: results.filter((r) => r.action === "created").length,
    updated: results.filter((r) => r.action === "updated").length,
    results,
  };
}

/**
 * Fetch a single Shopify product by GID or numeric id and upsert into Mongo.
 */
export async function pullShopifyProductById(id: string | number) {
  const gid = String(id).startsWith("gid://")
    ? String(id)
    : `gid://shopify/Product/${id}`;

  const data = await shopifyAdminRequest<{
    product: any | null;
  }>(
    `
    query ProductById($id: ID!) {
      product(id: $id) { ${PRODUCT_FIELDS} }
    }
  `,
    { id: gid },
  );

  if (!data.product) {
    throw new Error(`Shopify product not found: ${gid}`);
  }

  return upsertMongoProductFromShopify(mapGraphqlProduct(data.product));
}
