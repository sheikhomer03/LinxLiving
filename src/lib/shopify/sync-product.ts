import { getPrimaryLocationId, shopifyAdminRequest } from "./admin";
import { isShopifySyncEnabled } from "./config";
import type { LinxProductForShopify, ShopifyProductIds } from "./types";

function toDescriptionHtml(description: string) {
  const escaped = description
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped.replace(/\n+/g, "</p><p>")}</p>`;
}

function buildTags(input: LinxProductForShopify) {
  const tags = [input.category, input.subCategory, input.brandName]
    .filter(Boolean)
    .map((t) => String(t).trim())
    .filter(Boolean);
  return Array.from(new Set(tags));
}

function buildMedia(images?: string[]) {
  return (images ?? [])
    .filter(Boolean)
    .slice(0, 10)
    .map((url) => ({
      originalSource: url,
      mediaContentType: "IMAGE" as const,
      alt: "",
    }));
}

async function setVariantInventory(
  inventoryItemId: string,
  quantity: number,
  locationId: string,
) {
  const data = await shopifyAdminRequest<{
    inventorySetQuantities: {
      userErrors: { field?: string[]; message: string }[];
    };
  }>(
    `
    mutation SetInventory($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        userErrors { field message }
      }
    }
  `,
    {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        quantities: [
          {
            inventoryItemId,
            locationId,
            quantity: Math.max(0, Math.floor(quantity)),
          },
        ],
      },
    },
  );

  const errors = data.inventorySetQuantities.userErrors;
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
}

/**
 * Create a Shopify product with price, stock, images, and Linx metadata tags.
 */
export async function createShopifyProduct(
  input: LinxProductForShopify,
): Promise<ShopifyProductIds> {
  if (!isShopifySyncEnabled()) {
    throw new Error("Shopify sync is disabled");
  }

  const locationId = await getPrimaryLocationId();
  if (!locationId) {
    throw new Error(
      "No Shopify location found. Open Shopify Admin → Settings → Locations and ensure one is active.",
    );
  }

  const createData = await shopifyAdminRequest<{
    productCreate: {
      product: {
        id: string;
        variants: {
          nodes: { id: string; inventoryItem: { id: string } }[];
        };
      } | null;
      userErrors: { field?: string[]; message: string }[];
    };
  }>(
    `
    mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product {
          id
          variants(first: 1) {
            nodes {
              id
              inventoryItem { id }
            }
          }
        }
        userErrors { field message }
      }
    }
  `,
    {
      product: {
        title: input.name,
        descriptionHtml: toDescriptionHtml(input.description),
        productType: input.category || undefined,
        vendor: input.brandName || "Linx Square",
        status: "ACTIVE",
        tags: buildTags(input),
      },
      media: buildMedia(input.images),
    },
  );

  if (createData.productCreate.userErrors.length) {
    throw new Error(
      createData.productCreate.userErrors.map((e) => e.message).join("; "),
    );
  }

  const product = createData.productCreate.product;
  if (!product?.id) {
    throw new Error("Shopify productCreate returned no product");
  }

  const variantsData = await shopifyAdminRequest<{
    productVariantsBulkCreate: {
      productVariants: {
        id: string;
        inventoryItem: { id: string };
      }[];
      userErrors: { field?: string[]; message: string }[];
    };
  }>(
    `
    mutation CreateVariant(
      $productId: ID!
      $variants: [ProductVariantsBulkInput!]!
      $strategy: ProductVariantsBulkCreateStrategy
    ) {
      productVariantsBulkCreate(
        productId: $productId
        variants: $variants
        strategy: $strategy
      ) {
        productVariants {
          id
          inventoryItem { id }
        }
        userErrors { field message }
      }
    }
  `,
    {
      productId: product.id,
      strategy: "REMOVE_STANDALONE_VARIANT",
      variants: [
        {
          price: String(input.price),
          inventoryItem: { tracked: true },
          inventoryQuantities: [
            {
              availableQuantity: Math.max(0, Math.floor(input.stock)),
              locationId,
            },
          ],
        },
      ],
    },
  );

  if (variantsData.productVariantsBulkCreate.userErrors.length) {
    throw new Error(
      variantsData.productVariantsBulkCreate.userErrors
        .map((e) => e.message)
        .join("; "),
    );
  }

  const variant = variantsData.productVariantsBulkCreate.productVariants[0];
  if (!variant?.id) {
    // Fallback to the auto-created standalone variant if bulk create failed silently
    const fallback = product.variants.nodes[0];
    if (!fallback) throw new Error("Shopify returned no product variant");
    if (fallback.inventoryItem?.id) {
      await setVariantInventory(
        fallback.inventoryItem.id,
        input.stock,
        locationId,
      );
    }
    return {
      productId: product.id,
      variantId: fallback.id,
      inventoryItemId: fallback.inventoryItem?.id,
    };
  }

  return {
    productId: product.id,
    variantId: variant.id,
    inventoryItemId: variant.inventoryItem?.id,
  };
}

/**
 * Update an existing Shopify product (title, description, price, stock, images).
 */
export async function updateShopifyProduct(
  input: LinxProductForShopify,
): Promise<ShopifyProductIds> {
  if (!isShopifySyncEnabled()) {
    throw new Error("Shopify sync is disabled");
  }
  if (!input.shopifyProductId || !input.shopifyVariantId) {
    // No Shopify link yet — create instead
    return createShopifyProduct(input);
  }

  const locationId = await getPrimaryLocationId();

  const updateData = await shopifyAdminRequest<{
    productUpdate: {
      product: { id: string } | null;
      userErrors: { field?: string[]; message: string }[];
    };
  }>(
    `
    mutation UpdateProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id }
        userErrors { field message }
      }
    }
  `,
    {
      product: {
        id: input.shopifyProductId,
        title: input.name,
        descriptionHtml: toDescriptionHtml(input.description),
        productType: input.category || undefined,
        vendor: input.brandName || "Linx Square",
        tags: buildTags(input),
        status: "ACTIVE",
      },
    },
  );

  if (updateData.productUpdate.userErrors.length) {
    throw new Error(
      updateData.productUpdate.userErrors.map((e) => e.message).join("; "),
    );
  }

  const variantUpdate = await shopifyAdminRequest<{
    productVariantsBulkUpdate: {
      productVariants: {
        id: string;
        inventoryItem: { id: string };
      }[];
      userErrors: { field?: string[]; message: string }[];
    };
  }>(
    `
    mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          inventoryItem { id }
        }
        userErrors { field message }
      }
    }
  `,
    {
      productId: input.shopifyProductId,
      variants: [
        {
          id: input.shopifyVariantId,
          price: String(input.price),
          inventoryItem: { tracked: true },
        },
      ],
    },
  );

  if (variantUpdate.productVariantsBulkUpdate.userErrors.length) {
    throw new Error(
      variantUpdate.productVariantsBulkUpdate.userErrors
        .map((e) => e.message)
        .join("; "),
    );
  }

  const variant = variantUpdate.productVariantsBulkUpdate.productVariants[0];
  const inventoryItemId = variant?.inventoryItem?.id;

  if (inventoryItemId && locationId) {
    await setVariantInventory(inventoryItemId, input.stock, locationId);
  }

  // Replace media when new image URLs are provided
  if (input.images?.length) {
    await shopifyAdminRequest(
      `
      mutation CreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          userErrors { field message }
        }
      }
    `,
      {
        productId: input.shopifyProductId,
        media: buildMedia(input.images),
      },
    );
  }

  return {
    productId: input.shopifyProductId,
    variantId: input.shopifyVariantId,
    inventoryItemId,
  };
}

export async function deleteShopifyProduct(shopifyProductId: string) {
  if (!isShopifySyncEnabled()) return;

  const data = await shopifyAdminRequest<{
    productDelete: {
      deletedProductId: string | null;
      userErrors: { field?: string[]; message: string }[];
    };
  }>(
    `
    mutation DeleteProduct($input: ProductDeleteInput!) {
      productDelete(input: $input) {
        deletedProductId
        userErrors { field message }
      }
    }
  `,
    { input: { id: shopifyProductId } },
  );

  if (data.productDelete.userErrors.length) {
    throw new Error(
      data.productDelete.userErrors.map((e) => e.message).join("; "),
    );
  }
}
