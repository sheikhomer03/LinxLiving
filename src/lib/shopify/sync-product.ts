import { getPrimaryLocationId, shopifyAdminRequest, isShopifyThrottled } from "./admin";
import { isShopifySyncEnabled } from "./config";
import { slugify } from "./helpers";
import {
  buildMediaInput,
  MEDIA_UPLOAD_CHUNK,
  reconcileProductMedia,
  usableImageUrls,
} from "./sync-media";
import type { LinxProductForShopify, ShopifyProductIds } from "./types";

function toDescriptionHtml(description: string) {
  const escaped = description
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped.replace(/\n+/g, "</p><p>")}</p>`;
}

/**
 * Shopify caps a product title at 255 characters and rejects the whole mutation
 * past it. Some supplier catalogues print a full specification where a name
 * belongs — "Wall mounted electronic soap dispenser. Refillable soap container
 * with 1 L capacity…" runs to 318 — so the title is cut rather than lost. The
 * full text still reaches Shopify through the description.
 */
const SHOPIFY_TITLE_MAX = 255;

function toShopifyTitle(name: string) {
  const title = String(name ?? "").trim();
  if (title.length <= SHOPIFY_TITLE_MAX) return title;
  // Cut on a word boundary when one is near the limit, so the title does not
  // end mid-word; the ellipsis marks it as abbreviated.
  const clipped = title.slice(0, SHOPIFY_TITLE_MAX - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > SHOPIFY_TITLE_MAX - 40 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

function buildTags(input: LinxProductForShopify) {
  const tags = [input.category, input.subCategory, input.brandName]
    .filter(Boolean)
    .map((t) => String(t).trim())
    .filter(Boolean);
  return Array.from(new Set(tags));
}

/**
 * Products without a main category stay Draft in Shopify (not Active).
 * An explicit `shopifyStatus` overrides that, so a finished product can be
 * pushed and still held off sale.
 *
 * A product with no price is held back too. Checkout is hosted by Shopify and
 * charges whatever the variant costs, so an Active product carrying the £0 that
 * a catalogue import leaves behind is not merely mispriced — it is orderable for
 * nothing. Draft keeps the product built in Shopify, images and variants and
 * all, until a price is set.
 */
function shopifyStatusForProduct(input: LinxProductForShopify): "ACTIVE" | "DRAFT" {
  if (input.shopifyStatus === "DRAFT" || input.shopifyStatus === "ACTIVE") {
    return input.shopifyStatus;
  }
  if (!(Number(input.price) > 0)) return "DRAFT";
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

/**
 * Id of the Online Store publication, looked up once per process.
 *
 * The publication list does not change while the app runs, and re-reading it
 * before every publish doubles the request count of a catalogue-wide sync.
 */
let onlineStorePublicationId: string | null | undefined;

async function getOnlineStorePublicationId() {
  if (onlineStorePublicationId !== undefined) return onlineStorePublicationId;

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
  onlineStorePublicationId = online?.id ?? null;
  return onlineStorePublicationId;
}

/**
 * Products already published in this process.
 *
 * Publishing is idempotent, and several steps of one sync each want to be sure
 * it happened — which on a catalogue-wide run is a second wasted mutation per
 * product. Bounded so a long-lived server cannot accumulate the whole catalogue.
 */
const publishedProductIds = new Set<string>();

/** Publish to Online Store so Storefront Checkout can add the variant. */
async function publishProductToOnlineStore(productId: string) {
  if (publishedProductIds.has(productId)) return;
  try {
    const publicationId = await getOnlineStorePublicationId();
    if (!publicationId) return;

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
        input: [{ publicationId }],
      },
    );
    if (publishedProductIds.size > 20_000) publishedProductIds.clear();
    publishedProductIds.add(productId);
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
      created: false,
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
      // The content push is folded in here rather than left to the caller:
      // relinking is the one path where the stored variant GID was wrong, and
      // the product needs its price re-stated against the variant now in use.
      const refreshed = await updateShopifyProduct({
        ...input,
        shopifyVariantId: freshVariant,
      });
      return { ...refreshed, created: false };
    }
  }

  // Stale / missing — create on the current store
  return createShopifyProduct({
    ...input,
    shopifyProductId: null,
    shopifyVariantId: null,
  });
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

  const mediaSources = usableImageUrls(input.images);
  // Shopify fetches every URL before answering the create, so only a first
  // chunk rides along with it; the rest follow through the reconcile below,
  // which uploads in chunks of its own.
  const inlineMedia = mediaSources.slice(0, MEDIA_UPLOAD_CHUNK);

  const runCreate = (handle?: string) =>
    shopifyAdminRequest<{
    productCreate: {
      product: {
        id: string;
        handle: string;
        variants: {
          nodes: { id: string; inventoryItem: { id: string } }[];
        };
        media: { nodes: { id: string; image: { url: string | null } | null }[] };
      } | null;
      userErrors: { field?: string[]; message: string }[];
    };
  }>(
    `
    mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product {
          id
          handle
          variants(first: 1) {
            nodes {
              id
              inventoryItem { id }
            }
          }
          media(first: ${MEDIA_UPLOAD_CHUNK}) {
            nodes {
              id
              ... on MediaImage { image { url } }
            }
          }
        }
        userErrors { field message }
      }
    }
  `,
    {
      product: {
        title: toShopifyTitle(input.name),
        ...(handle ? { handle } : {}),
        descriptionHtml: toDescriptionHtml(input.description),
        productType: input.category || undefined,
        vendor: input.brandName || "Linx Square",
        status: shopifyStatusForProduct(input),
        tags: buildTags(input),
        metafields: buildLinxMetafields(input),
      },
      media: buildMediaInput(inlineMedia),
    },
  );

  let createData = await runCreate();

  // Supplier catalogues repeat a product name across sizes and finishes, so the
  // slug Shopify derives from the title collides often. Retry once with the
  // Mongo id appended, which is unique by construction.
  if (
    createData.productCreate.userErrors.some((e) =>
      /handle has already been taken/i.test(e.message),
    )
  ) {
    const seed = String(input.handleSeed || "").trim();
    const unique = `${slugify(input.name)}-${seed || Date.now().toString(36)}`;
    createData = await runCreate(unique.slice(0, 255));
  }

  if (createData.productCreate.userErrors.length) {
    throw new Error(
      createData.productCreate.userErrors.map((e) => e.message).join("; "),
    );
  }

  const product = createData.productCreate.product;
  if (!product?.id) {
    throw new Error("Shopify productCreate returned no product");
  }

  // Media comes back in the order it was sent, which is the only handle on
  // which upload became which Shopify file — the CDN filename is Shopify's own.
  let imageLinks = inlineMedia.map((sourceUrl, position) => {
    const node = product.media?.nodes?.[position];
    return {
      sourceUrl,
      shopifyUrl: node?.image?.url ?? "",
      mediaId: node?.id ?? "",
      position,
    };
  });

  if (mediaSources.length > inlineMedia.length) {
    try {
      const rest = await reconcileProductMedia(
        product.id,
        mediaSources,
        imageLinks,
      );
      imageLinks = rest.links;
    } catch (error) {
      // The product exists and is priced; a gallery short of its tail is worth
      // less than losing the product, and the next run reconciles it.
      console.error("Shopify media upload incomplete:", error);
    }
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
          ...(input.barcode ? { barcode: String(input.barcode) } : {}),
          inventoryItem: {
            tracked: true,
            ...(input.sku ? { sku: String(input.sku) } : {}),
          },
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
      imageLinks,
      handle: product.handle,
      created: true,
    };
  }

  await publishProductToOnlineStore(product.id);

  return {
    productId: product.id,
    variantId: variant.id,
    inventoryItemId: variant.inventoryItem?.id,
    imageLinks,
    handle: product.handle,
    created: true,
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
      product: { id: string; handle: string } | null;
      userErrors: { field?: string[]; message: string }[];
    };
  }>(
    `
    mutation UpdateProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id handle }
        userErrors { field message }
      }
    }
  `,
    {
      product: {
        id: input.shopifyProductId,
        title: toShopifyTitle(input.name),
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
          ...(input.barcode ? { barcode: String(input.barcode) } : {}),
          inventoryItem: {
            tracked: true,
            ...(input.sku ? { sku: String(input.sku) } : {}),
          },
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

  // Bring the gallery in line, reusing files Shopify already holds. Failure
  // here is reported but not fatal: the product itself updated fine, and losing
  // a price or stock push because one image 404s would be the worse outcome.
  let imageLinks = input.shopifyImages ?? undefined;
  if (input.images) {
    try {
      const media = await reconcileProductMedia(
        input.shopifyProductId,
        input.images,
        input.shopifyImages ?? [],
      );
      imageLinks = media.links;
    } catch (error) {
      console.error("Shopify media reconcile failed:", error);
    }
  }

  return {
    productId: input.shopifyProductId,
    variantId: input.shopifyVariantId,
    inventoryItemId,
    imageLinks,
    handle: updateData.productUpdate.product?.handle ?? null,
    created: false,
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

      const missingLink = !product.shopifyProductId;

      // The whole product, not a hand-built subset. Passing only `images` here
      // left the gallery reconcile unaware of the variant images that share the
      // product's Shopify media, so this job — which runs every forty-five
      // seconds behind the admin — would have deleted them as stale.
      const { syncFullProductToShopify } = await import("./sync-product-full");
      await syncFullProductToShopify(product, brandName);

      await Product.findByIdAndUpdate(product._id, {
        shopifyProductId: product.shopifyProductId,
        shopifyVariantId: product.shopifyVariantId,
        shopifyImages: product.shopifyImages ?? [],
        shopifyHandle: product.shopifyHandle ?? "",
        shopifyProductUrl: product.shopifyProductUrl ?? "",
        ...(product.variants ? { variants: product.variants } : {}),
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
