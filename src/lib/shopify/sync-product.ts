import { getPrimaryLocationId, shopifyAdminRequest, isShopifyThrottled } from "./admin";
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

/** Products without a main category stay Draft in Shopify (not Active). */
function shopifyStatusForProduct(input: LinxProductForShopify): "ACTIVE" | "DRAFT" {
  return String(input.category || "").trim() ? "ACTIVE" : "DRAFT";
}

export async function shopifyVariantExists(variantId: string): Promise<boolean> {
  if (!variantId?.startsWith("gid://shopify/ProductVariant/")) return false;
  try {
    const data = await shopifyAdminRequest<{
      productVariant: { id: string } | null;
    }>(
      `
      query VariantExists($id: ID!) {
        productVariant(id: $id) { id }
      }
    `,
      { id: variantId },
    );
    return Boolean(data.productVariant?.id);
  } catch {
    return false;
  }
}

export async function shopifyProductExists(productId: string): Promise<boolean> {
  if (!productId?.startsWith("gid://shopify/Product/")) return false;
  try {
    const data = await shopifyAdminRequest<{
      product: { id: string } | null;
    }>(
      `
      query ProductExists($id: ID!) {
        product(id: $id) { id }
      }
    `,
      { id: productId },
    );
    return Boolean(data.product?.id);
  } catch {
    return false;
  }
}

/** Publish to Online Store so Storefront Checkout can add the variant. */
async function publishProductToOnlineStore(productId: string) {
  try {
    const pubs = await shopifyAdminRequest<{
      publications: {
        nodes: { id: string; name: string }[];
      };
    }>(
      `
      query Pubs {
        publications(first: 20) {
          nodes { id name }
        }
      }
    `,
    );
    const online = (pubs.publications?.nodes || []).find((p) =>
      /online\s*store/i.test(p.name || ""),
    );
    if (!online?.id) return;

    await shopifyAdminRequest(
      `
      mutation Publish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { message }
        }
      }
    `,
      {
        id: productId,
        input: [{ publicationId: online.id }],
      },
    );
  } catch (error) {
    // Needs read_publications + write_publications — don't fail the whole sync
    console.warn(
      "Shopify publish to Online Store skipped:",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Ensure Mongo product IDs point at variants that exist on the *current* shop.
 * Recreates the Shopify product when IDs are from an old store / deleted.
 */
export async function ensureShopifyProductLinked(
  input: LinxProductForShopify,
): Promise<ShopifyProductIds> {
  if (
    input.shopifyVariantId &&
    (await shopifyVariantExists(input.shopifyVariantId))
  ) {
    if (input.shopifyProductId) {
      await publishProductToOnlineStore(input.shopifyProductId);
    }
    return {
      productId: input.shopifyProductId!,
      variantId: input.shopifyVariantId,
    };
  }

  if (
    input.shopifyProductId &&
    (await shopifyProductExists(input.shopifyProductId))
  ) {
    // Product exists but variant GID is stale — refresh first variant id via update path recreate
    const data = await shopifyAdminRequest<{
      product: {
        id: string;
        variants: { nodes: { id: string }[] };
      } | null;
    }>(
      `
      query ProductVariants($id: ID!) {
        product(id: $id) {
          id
          variants(first: 1) { nodes { id } }
        }
      }
    `,
      { id: input.shopifyProductId },
    );
    const freshVariant = data.product?.variants?.nodes?.[0]?.id;
    if (freshVariant) {
      await publishProductToOnlineStore(input.shopifyProductId);
      await updateShopifyProduct({
        ...input,
        shopifyVariantId: freshVariant,
      });
      return {
        productId: input.shopifyProductId,
        variantId: freshVariant,
      };
    }
  }

  // Stale / missing — create on the current store
  return createShopifyProduct({
    ...input,
    shopifyProductId: null,
    shopifyVariantId: null,
  });
}

function buildMedia(images?: string[]) {
  // `images` is a mixed media list: alongside real URLs it holds markers like
  // "youtube:giijTtxGDTY" for embedded video. Shopify rejects anything that is
  // not a fetchable absolute URL with "Image URL is invalid", which fails the
  // whole productCreate — so the markers are dropped rather than sent.
  return (images ?? [])
    .filter((url) => /^https?:\/\//i.test(String(url || "").trim()))
    .slice(0, 10)
    .map((url) => ({
      originalSource: String(url).trim(),
      mediaContentType: "IMAGE" as const,
      alt: "",
    }));
}

/** Linx-only product fields stored as Shopify product metafields (namespace `linx`). */
function buildLinxMetafields(input: LinxProductForShopify) {
  const fields: {
    namespace: string;
    key: string;
    type: string;
    value: string;
  }[] = [];

  if (input.tagline != null) {
    fields.push({
      namespace: "linx",
      key: "tagline",
      type: "single_line_text_field",
      value: String(input.tagline || ""),
    });
  }
  if (input.specs != null) {
    fields.push({
      namespace: "linx",
      key: "specs",
      type: "json",
      value: JSON.stringify(input.specs || {}),
    });
  }
  if (input.showSpecs != null) {
    fields.push({
      namespace: "linx",
      key: "show_specs",
      type: "boolean",
      value: input.showSpecs ? "true" : "false",
    });
  }
  if (input.schematicImage != null) {
    fields.push({
      namespace: "linx",
      key: "schematic_image",
      type: "single_line_text_field",
      value: String(input.schematicImage || ""),
    });
  }
  if (input.subCategory) {
    fields.push({
      namespace: "linx",
      key: "sub_category",
      type: "single_line_text_field",
      value: String(input.subCategory),
    });
  }
  if (input.installationGuide != null) {
    fields.push({
      namespace: "linx",
      key: "installation_guide",
      type: "multi_line_text_field",
      value: String(input.installationGuide || ""),
    });
  }
  if (input.insulatingSetPrice != null && input.insulatingSetPrice !== undefined) {
    fields.push({
      namespace: "linx",
      key: "insulating_set_price",
      type: "single_line_text_field",
      value: String(input.insulatingSetPrice),
    });
  } else {
    fields.push({
      namespace: "linx",
      key: "insulating_set_price",
      type: "single_line_text_field",
      value: "",
    });
  }
  if (input.flashingFinder != null) {
    fields.push({
      namespace: "linx",
      key: "flashing_finder",
      type: "json",
      value: JSON.stringify(input.flashingFinder || []),
    });
  }
  if (input.finishes != null) {
    fields.push({
      namespace: "linx",
      key: "finishes",
      type: "json",
      value: JSON.stringify(input.finishes || []),
    });
  }
  if (input.flashings != null) {
    fields.push({
      namespace: "linx",
      key: "flashings",
      type: "json",
      value: JSON.stringify(input.flashings || []),
    });
  }
  return fields;
}

export async function setVariantInventory(
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
        status: shopifyStatusForProduct(input),
        tags: buildTags(input),
        metafields: buildLinxMetafields(input),
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
    await publishProductToOnlineStore(product.id);
    return {
      productId: product.id,
      variantId: fallback.id,
      inventoryItemId: fallback.inventoryItem?.id,
    };
  }

  await publishProductToOnlineStore(product.id);

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

  // IDs from a previous Shopify store → recreate on the current shop
  if (!(await shopifyProductExists(input.shopifyProductId))) {
    return createShopifyProduct({
      ...input,
      shopifyProductId: null,
      shopifyVariantId: null,
    });
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
        status: shopifyStatusForProduct(input),
        metafields: buildLinxMetafields(input),
      },
    },
  );

  if (updateData.productUpdate.userErrors.length) {
    const msg = updateData.productUpdate.userErrors
      .map((e) => e.message)
      .join("; ");
    if (/does not exist|not found/i.test(msg)) {
      return createShopifyProduct({
        ...input,
        shopifyProductId: null,
        shopifyVariantId: null,
      });
    }
    throw new Error(msg);
  }

  await publishProductToOnlineStore(input.shopifyProductId);

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

  // Replace media: delete existing images, then add the current set
  if (input.images) {
    try {
      const mediaData = await shopifyAdminRequest<{
        product: {
          media: { nodes: { id: string }[] };
        } | null;
      }>(
        `
        query ProductMedia($id: ID!) {
          product(id: $id) {
            media(first: 50) { nodes { id } }
          }
        }
      `,
        { id: input.shopifyProductId },
      );
      const mediaIds = (mediaData.product?.media?.nodes || []).map((m) => m.id);
      if (mediaIds.length) {
        await shopifyAdminRequest(
          `
          mutation DeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
            productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
              userErrors { field message }
            }
          }
        `,
          {
            productId: input.shopifyProductId,
            mediaIds,
          },
        );
      }
    } catch (error) {
      console.error("Shopify media delete failed:", error);
    }

    if (input.images.length) {
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

/**
 * Push Mongo products that are missing Shopify IDs, or were updated locally
 * after the last successful Shopify sync (e.g. gallery re-sync / extras).
 */
export async function pushUnsyncedProducts(limit = 15) {
  if (!isShopifySyncEnabled()) return { pushed: 0, created: 0, updated: 0 };

  const { default: connectDB } = await import("@/lib/mongodb");
  const { Product } = await import("@/models/Product");
  const { Brand } = await import("@/models/Brand");

  await connectDB();

  // Create only when category is set (Active in Shopify). Updates allowed for any linked product.
  const candidates = await Product.find({
    $or: [
      {
        category: { $exists: true, $nin: [null, ""] },
        $or: [
          { shopifyProductId: null },
          { shopifyProductId: { $exists: false } },
          { shopifyProductId: "" },
        ],
      },
      {
        shopifyProductId: { $exists: true, $nin: [null, ""] },
        $or: [
          { shopifySyncedAt: null },
          { shopifySyncedAt: { $exists: false } },
          { $expr: { $gt: ["$updatedAt", "$shopifySyncedAt"] } },
        ],
      },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  let created = 0;
  let updated = 0;

  for (const product of candidates as any[]) {
    if (isShopifyThrottled()) {
      console.warn(
        "pushUnsyncedProducts paused: Shopify throttle cooldown active",
      );
      break;
    }
    try {
      let brandName: string | null = null;
      if (product.brand) {
        const brand = await Brand.findById(product.brand).select("name").lean();
        brandName = brand?.name ?? null;
      }

      const payload: LinxProductForShopify = {
        name: product.name,
        description: product.description || product.name,
        price: product.price,
        stock: product.stock ?? 0,
        category: product.category,
        subCategory: product.subCategory,
        brandName,
        images: product.images ?? [],
        tagline: product.tagline,
        specs: product.specs ?? {},
        showSpecs: product.showSpecs,
        installationGuide: product.installationGuide,
        insulatingSetPrice: product.insulatingSetPrice,
        flashingFinder: product.flashingFinder,
        finishes: product.finishes,
        flashings: product.flashings,
        shopifyProductId: product.shopifyProductId,
        shopifyVariantId: product.shopifyVariantId,
      };

      const missingLink = !product.shopifyProductId;
      const ids = missingLink
        ? await createShopifyProduct(payload)
        : await updateShopifyProduct(payload);

      await Product.findByIdAndUpdate(product._id, {
        shopifyProductId: ids.productId,
        shopifyVariantId: ids.variantId,
        shopifySyncError: null,
        shopifySyncedAt: new Date(),
      });

      if (missingLink) created += 1;
      else updated += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Shopify product push failed";
      const throttled = /throttl/i.test(message);

      // Don't stamp shopifySyncedAt on throttle — leave row eligible for next run.
      if (throttled) {
        await Product.findByIdAndUpdate(product._id, {
          shopifySyncError: message,
        });
        console.warn(
          `pushUnsyncedProducts paused after throttle on ${product._id}`,
        );
        break;
      }

      await Product.findByIdAndUpdate(product._id, {
        shopifySyncError: message,
        shopifySyncedAt: new Date(),
      });
      console.error(
        `pushUnsyncedProducts failed for ${product._id}:`,
        message,
      );
    }
  }

  return { pushed: created + updated, created, updated };
}
