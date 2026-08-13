/**
 * Mirror a Linx product's variants as real Shopify variants.
 *
 * Checkout is hosted by Shopify, and a Shopify cart line is `merchandiseId +
 * quantity` — the price comes from the variant and cannot be overridden. A
 * product whose sizes or colours exist only in Mongo therefore cannot be sold
 * through it: sending the product-level variant id would charge one price for
 * every option (the 700mm screen's £374.99 for a 900mm order).
 *
 * `createShopifyProduct` in sync-product.ts builds one option-less variant,
 * which is right for a plain SKU. This module handles the rest: it declares
 * the option axes on the Shopify product and reconciles one Shopify variant
 * per Mongo variant, returning their GIDs to be stored against each row.
 *
 * Matching is by SKU first, then by the option signature ("Chrome / 900mm x
 * 2000mm"), so a re-sync updates rows rather than duplicating them. Variants
 * present on Shopify but absent from Mongo are reported, never deleted —
 * deleting a variant on a live store destroys its order history.
 */
import { getPrimaryLocationId, shopifyAdminRequest } from "./admin";
import { isShopifySyncEnabled } from "./config";
import { setVariantInventory } from "./sync-product";
import type { ShopifyUserError } from "./types";

/** One Mongo variant, flattened to what Shopify needs. */
export type LinxVariantForShopify = {
  /** Mongo `_id`, so the caller can write the returned GID back to the row. */
  key: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  price: number;
  compareAtPrice?: number | null;
  stock: number;
  /** Ordered axis values, e.g. [{name:"Colour",value:"Chrome"}, …]. */
  options: { name: string; value: string }[];
};

export type VariantSyncResult = {
  /** Mongo variant key → Shopify variant GID. */
  linked: Record<string, string>;
  /** Mongo variant key → inventory item GID. */
  inventoryItems: Record<string, string>;
  created: number;
  updated: number;
  /** Variants live on Shopify with no Mongo counterpart — left untouched. */
  orphaned: { id: string; title: string }[];
  /** Non-fatal problems worth showing the operator. */
  warnings: string[];
};

const optionSignature = (options: { name: string; value: string }[]) =>
  options
    .map((o) => `${o.name}=${String(o.value).trim().toLowerCase()}`)
    .join(" / ");

const skuKey = (sku?: string | null) =>
  String(sku || "").trim().toLowerCase();

function assertNoUserErrors(errors: ShopifyUserError[], what: string) {
  if (errors?.length) {
    throw new Error(`${what}: ${errors.map((e) => e.message).join("; ")}`);
  }
}

/**
 * Axis list for the Shopify product, derived from the variants themselves so
 * it can never disagree with them. Shopify allows at most three options, and
 * every variant must supply a value for each one.
 */
export function deriveOptionAxes(
  variants: LinxVariantForShopify[],
): { name: string; values: string[] }[] {
  const axes: { name: string; values: string[] }[] = [];
  for (const variant of variants) {
    for (const option of variant.options) {
      const name = String(option.name || "").trim();
      const value = String(option.value || "").trim();
      if (!name || !value) continue;
      let axis = axes.find((a) => a.name === name);
      if (!axis) {
        axis = { name, values: [] };
        axes.push(axis);
      }
      if (!axis.values.includes(value)) axis.values.push(value);
    }
  }
  return axes.slice(0, 3);
}

type ShopifyVariantNode = {
  id: string;
  title: string;
  sku: string | null;
  inventoryItem: { id: string } | null;
  selectedOptions: { name: string; value: string }[];
};

async function fetchShopifyVariants(productId: string) {
  const data = await shopifyAdminRequest<{
    product: {
      id: string;
      options: { id: string; name: string; position: number }[];
      variants: { nodes: ShopifyVariantNode[] };
    } | null;
  }>(
    `
    query ProductVariantsForSync($id: ID!) {
      product(id: $id) {
        id
        options { id name position }
        variants(first: 250) {
          nodes {
            id
            title
            sku
            inventoryItem { id }
            selectedOptions { name value }
          }
        }
      }
    }
  `,
    { id: productId },
  );
  return data.product;
}

/**
 * Declare the option axes on an existing Shopify product.
 *
 * A product created by `createShopifyProduct` has the implicit single "Title"
 * axis, which cannot hold a size or colour. Adding the real axes has to happen
 * before any multi-option variant can be created.
 */
async function ensureProductOptions(
  productId: string,
  axes: { name: string; values: string[] }[],
  existing: { name: string }[],
): Promise<{ changed: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  const missing = axes.filter(
    (axis) =>
      !existing.some(
        (e) => e.name.trim().toLowerCase() === axis.name.trim().toLowerCase(),
      ),
  );
  if (!missing.length) return { changed: false, warnings };

  const data = await shopifyAdminRequest<{
    productOptionsCreate: {
      product: { id: string } | null;
      userErrors: ShopifyUserError[];
    };
  }>(
    `
    mutation AddOptions($productId: ID!, $options: [OptionCreateInput!]!) {
      productOptionsCreate(
        productId: $productId
        options: $options
        variantStrategy: LEAVE_AS_IS
      ) {
        product { id }
        userErrors { field message }
      }
    }
  `,
    {
      productId,
      options: missing.map((axis) => ({
        name: axis.name,
        values: axis.values.map((value) => ({ name: value })),
      })),
    },
  );

  assertNoUserErrors(
    data.productOptionsCreate.userErrors,
    "Shopify productOptionsCreate",
  );
  // LEAVE_AS_IS keeps the existing rows instead of fanning out every option
  // combination; this module creates the exact variants Mongo holds, and a
  // combinatorial explosion on an 84-variant product would be unmanageable.
  return { changed: true, warnings };
}

/**
 * Reconcile every Mongo variant onto the Shopify product.
 *
 * The product must already exist on Shopify — run `ensureShopifyProductLinked`
 * first, which is how the rest of the sync gets its `shopifyProductId`.
 */
export async function syncVariantsToShopify(
  shopifyProductId: string,
  variants: LinxVariantForShopify[],
): Promise<VariantSyncResult> {
  if (!isShopifySyncEnabled()) {
    throw new Error("Shopify sync is disabled");
  }
  if (!shopifyProductId) {
    throw new Error("Product is not linked to Shopify yet");
  }

  const result: VariantSyncResult = {
    linked: {},
    inventoryItems: {},
    created: 0,
    updated: 0,
    orphaned: [],
    warnings: [],
  };

  const usable = variants.filter((v) => v.options.length > 0);
  if (usable.length !== variants.length) {
    result.warnings.push(
      `${variants.length - usable.length} variant(s) have no option values and were skipped — Shopify needs a value on every axis.`,
    );
  }
  if (!usable.length) return result;

  const axes = deriveOptionAxes(usable);
  if (!axes.length) return result;

  const locationId = await getPrimaryLocationId();
  if (!locationId) {
    throw new Error(
      "No Shopify location found. Open Shopify Admin → Settings → Locations and ensure one is active.",
    );
  }

  const product = await fetchShopifyVariants(shopifyProductId);
  if (!product) {
    throw new Error(`Shopify product ${shopifyProductId} no longer exists`);
  }

  const optionResult = await ensureProductOptions(
    shopifyProductId,
    axes,
    product.options,
  );
  result.warnings.push(...optionResult.warnings);

  // Re-read whenever an axis was added, not when the axis *count* grew: a new
  // product carries one placeholder axis ("Title"), so adding a single real
  // axis leaves the count unchanged while every variant's selectedOptions
  // change underneath — matching against the stale read would duplicate rows.
  const refreshed = optionResult.changed
    ? await fetchShopifyVariants(shopifyProductId)
    : product;
  const live = refreshed?.variants.nodes ?? [];

  const bySku = new Map<string, ShopifyVariantNode>();
  const bySignature = new Map<string, ShopifyVariantNode>();
  for (const node of live) {
    if (node.sku) bySku.set(skuKey(node.sku), node);
    bySignature.set(
      optionSignature(
        node.selectedOptions.map((o) => ({ name: o.name, value: o.value })),
      ),
      node,
    );
  }

  const matched = new Set<string>();
  const toUpdate: { variant: LinxVariantForShopify; node: ShopifyVariantNode }[] = [];
  const toCreate: LinxVariantForShopify[] = [];

  for (const variant of usable) {
    const node =
      (variant.sku ? bySku.get(skuKey(variant.sku)) : undefined) ||
      bySignature.get(optionSignature(variant.options));
    if (node && !matched.has(node.id)) {
      matched.add(node.id);
      toUpdate.push({ variant, node });
    } else {
      toCreate.push(variant);
    }
  }

  for (const node of live) {
    if (!matched.has(node.id) && !toCreate.length) {
      result.orphaned.push({ id: node.id, title: node.title });
    }
  }

  const variantInput = (variant: LinxVariantForShopify) => ({
    price: String(variant.price),
    ...(variant.compareAtPrice != null && variant.compareAtPrice > variant.price
      ? { compareAtPrice: String(variant.compareAtPrice) }
      : {}),
    optionValues: variant.options.map((o) => ({
      optionName: o.name,
      name: o.value,
    })),
    inventoryItem: {
      tracked: true,
      ...(variant.sku ? { sku: String(variant.sku) } : {}),
    },
    ...(variant.barcode ? { barcode: String(variant.barcode) } : {}),
  });

  if (toCreate.length) {
    const data = await shopifyAdminRequest<{
      productVariantsBulkCreate: {
        productVariants: {
          id: string;
          sku: string | null;
          inventoryItem: { id: string } | null;
          selectedOptions: { name: string; value: string }[];
        }[];
        userErrors: ShopifyUserError[];
      };
    }>(
      `
      mutation CreateVariants(
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
            sku
            inventoryItem { id }
            selectedOptions { name value }
          }
          userErrors { field message }
        }
      }
    `,
      {
        productId: shopifyProductId,
        // The placeholder variant Shopify creates alongside a new product has
        // no real options; it is removed rather than left as a buyable row.
        strategy: live.length === 1 && !matched.size ? "REMOVE_STANDALONE_VARIANT" : "DEFAULT",
        variants: toCreate.map((variant) => ({
          ...variantInput(variant),
          inventoryQuantities: [
            {
              availableQuantity: Math.max(0, Math.floor(variant.stock)),
              locationId,
            },
          ],
        })),
      },
    );

    assertNoUserErrors(
      data.productVariantsBulkCreate.userErrors,
      "Shopify productVariantsBulkCreate",
    );

    const created = data.productVariantsBulkCreate.productVariants;
    for (const variant of toCreate) {
      const node =
        created.find(
          (c) => variant.sku && skuKey(c.sku) === skuKey(variant.sku),
        ) ||
        created.find(
          (c) =>
            optionSignature(c.selectedOptions) ===
            optionSignature(variant.options),
        );
      if (node) {
        result.linked[variant.key] = node.id;
        if (node.inventoryItem?.id) {
          result.inventoryItems[variant.key] = node.inventoryItem.id;
        }
        result.created += 1;
      } else {
        result.warnings.push(
          `Shopify accepted "${variant.name}" but returned no variant to link.`,
        );
      }
    }
  }

  if (toUpdate.length) {
    const data = await shopifyAdminRequest<{
      productVariantsBulkUpdate: {
        productVariants: { id: string }[];
        userErrors: ShopifyUserError[];
      };
    }>(
      `
      mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }
    `,
      {
        productId: shopifyProductId,
        variants: toUpdate.map(({ variant, node }) => ({
          id: node.id,
          ...variantInput(variant),
        })),
      },
    );

    assertNoUserErrors(
      data.productVariantsBulkUpdate.userErrors,
      "Shopify productVariantsBulkUpdate",
    );

    // Stock is not part of a variant update — it lives on the inventory item,
    // so an existing row keeps Shopify's old quantity unless it is set here.
    for (const { variant, node } of toUpdate) {
      result.linked[variant.key] = node.id;
      if (node.inventoryItem?.id) {
        result.inventoryItems[variant.key] = node.inventoryItem.id;
        try {
          await setVariantInventory(
            node.inventoryItem.id,
            variant.stock,
            locationId,
          );
        } catch (error) {
          result.warnings.push(
            `Stock for "${variant.name}" could not be set: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      result.updated += 1;
    }
  }

  return result;
}
