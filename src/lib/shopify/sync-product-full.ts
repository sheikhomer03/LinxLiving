/**
 * Push one Mongo product to Shopify in full: content, gallery, options,
 * variants, per-variant images, stock, and the Linx-only fields that live as
 * metafields — then record on the Mongo row what Shopify gave back.
 *
 * This exists because "synced" had meant several different things. The admin
 * dual-write pushed a product and its first variant; the auto-sync job pushed
 * content only; variant images were never pushed at all; and nothing recorded
 * the Shopify CDN URLs, so the gallery was deleted and re-uploaded on every
 * update. One function that does the whole job — used by the admin action and
 * by the catalogue backfill alike — is what makes a product's sync state
 * checkable rather than a matter of which path last touched it.
 *
 * Nothing here saves the document. The caller owns persistence, which lets the
 * backfill write with a bulk operation and the admin action keep its own
 * validation.
 */
import { attachVariantMedia, usableImageUrls } from "./sync-media";
import { ensureShopifyProductLinked, updateShopifyProduct } from "./sync-product";
import { syncVariantsToShopify, type LinxVariantForShopify } from "./sync-variants";
import { shopifyProductUrl } from "./helpers";
import type { LinxProductForShopify, ShopifyImageLink } from "./types";

/** The subset of a Product document this module reads and writes. */
export type SyncableProduct = {
  _id?: unknown;
  name: string;
  description?: string | null;
  price?: number | null;
  stock?: number | null;
  category?: string | null;
  subCategory?: string | null;
  images?: string[] | null;
  tagline?: string | null;
  specs?: Record<string, unknown> | null;
  showSpecs?: boolean | null;
  schematicImage?: string | null;
  installationGuide?: string | null;
  insulatingSetPrice?: number | null;
  flashingFinder?: unknown;
  finishes?: unknown;
  flashings?: unknown;
  shopifyOptions?: unknown;
  linxSku?: string | null;
  supplierSku?: string | null;
  productCode?: string | null;
  barcode?: string | null;
  shopifyProductId?: string | null;
  shopifyVariantId?: string | null;
  shopifyImages?: ShopifyImageLink[] | null;
  shopifyHandle?: string | null;
  shopifyProductUrl?: string | null;
  variants?: {
    _id?: unknown;
    name?: string;
    sku?: string;
    barcode?: string;
    price?: number | null;
    compareAtPrice?: number | null;
    stock?: number | null;
    imageUrl?: string;
    options?: Record<string, unknown> | null;
    option1?: string;
    option2?: string;
    option3?: string;
    shopifyVariantId?: string;
    shopifyInventoryItemId?: string;
    shopifyImageUrl?: string;
    shopifyMediaId?: string;
  }[];
};

export type FullSyncReport = {
  productId: string;
  variantId: string;
  status: "ACTIVE" | "DRAFT";
  /** Gallery entries paired with their Shopify CDN copy. */
  images: number;
  /** Mongo variants that came back with a Shopify GID. */
  variantsLinked: number;
  variantsTotal: number;
  variantImagesAttached: number;
  warnings: string[];
};

/**
 * Highest price the product can actually be bought at.
 *
 * A product row may carry 0 while its variants hold the real figures — that is
 * how several supplier imports land — so the status decision has to look at
 * both before concluding the product is unpriced.
 */
function effectivePrice(product: SyncableProduct) {
  const own = Number(product.price) || 0;
  const fromVariants = (product.variants ?? []).reduce(
    (max, v) => Math.max(max, Number(v.price) || 0),
    0,
  );
  return Math.max(own, fromVariants);
}

/**
 * Flatten Mongo variants into the option-axis shape Shopify needs.
 *
 * Axis names come from `options` when the supplier gave them, falling back to
 * the positional option1..3 against the product's own axis names.
 */
export function buildVariantPayload(
  product: SyncableProduct,
): LinxVariantForShopify[] {
  const axisNames = Array.isArray(product.shopifyOptions)
    ? (product.shopifyOptions as { name?: string }[])
        .map((a) => String(a?.name || "").trim())
        .filter(Boolean)
    : [];

  return (product.variants ?? []).map((row, index) => {
    const options: { name: string; value: string }[] = [];
    if (row.options && typeof row.options === "object") {
      for (const [name, value] of Object.entries(row.options)) {
        if (name && value != null && String(value).trim()) {
          options.push({ name, value: String(value) });
        }
      }
    }
    if (!options.length) {
      [row.option1, row.option2, row.option3].forEach((value, i) => {
        if (value && String(value).trim()) {
          options.push({
            name: axisNames[i] || `Option ${i + 1}`,
            value: String(value),
          });
        }
      });
    }
    return {
      key: String(row._id ?? index),
      name: row.name || `Variant ${index + 1}`,
      sku: row.sku || null,
      barcode: row.barcode || null,
      price: Number(row.price ?? product.price) || 0,
      compareAtPrice: row.compareAtPrice ?? null,
      stock: Number(row.stock ?? product.stock) || 0,
      options,
    };
  });
}

/**
 * Every image the Shopify product needs to hold: the gallery, then any variant
 * image not already in it. Shopify has no per-variant upload — a variant image
 * is product media the variant points at — so both sets go up together.
 */
function mediaSourcesFor(product: SyncableProduct) {
  return usableImageUrls([
    ...(product.images ?? []),
    ...(product.variants ?? []).map((v) => v.imageUrl ?? ""),
  ]);
}

/**
 * SKU for the product-level Shopify variant.
 *
 * Only meaningful when the product has no option axes: a product with variants
 * gets one SKU per row through `syncVariantsToShopify`. For the rest, the code
 * lives on the single Mongo variant when there is one, and otherwise on the
 * product itself.
 *
 * `specs.sku` is part of the chain because for nearly ten thousand products it
 * is the only place the code exists — the Product model states that `linxSku`
 * "falls back to specs.sku when empty", and the importers relied on it.
 */
function productLevelSku(product: SyncableProduct) {
  const rows = product.variants ?? [];
  if (rows.length === 1 && rows[0]?.sku) return String(rows[0].sku);
  if (rows.length > 1) return null;
  const fromSpecs = (product.specs as Record<string, unknown> | null | undefined)?.sku;
  return (
    product.linxSku ||
    product.supplierSku ||
    product.productCode ||
    (fromSpecs ? String(fromSpecs) : null) ||
    null
  );
}

function productLevelBarcode(product: SyncableProduct) {
  const rows = product.variants ?? [];
  if (rows.length === 1 && rows[0]?.barcode) return String(rows[0].barcode);
  if (rows.length > 1) return null;
  return product.barcode || null;
}

export async function syncFullProductToShopify(
  product: SyncableProduct,
  brandName: string | null,
): Promise<FullSyncReport> {
  const warnings: string[] = [];
  const price = effectivePrice(product);
  const status: "ACTIVE" | "DRAFT" =
    price > 0 && String(product.category || "").trim() ? "ACTIVE" : "DRAFT";

  const payload: LinxProductForShopify = {
    name: product.name,
    description: product.description || product.name,
    price: Number(product.price) || 0,
    stock: Number(product.stock) || 0,
    category: product.category || "",
    subCategory: product.subCategory,
    brandName,
    images: mediaSourcesFor(product),
    tagline: product.tagline,
    specs: product.specs ?? {},
    showSpecs: product.showSpecs,
    schematicImage: product.schematicImage,
    installationGuide: product.installationGuide,
    insulatingSetPrice: product.insulatingSetPrice,
    flashingFinder: product.flashingFinder,
    finishes: product.finishes,
    flashings: product.flashings,
    shopifyStatus: status,
    sku: productLevelSku(product),
    barcode: productLevelBarcode(product),
    shopifyProductId: product.shopifyProductId,
    shopifyVariantId: product.shopifyVariantId,
    shopifyImages: product.shopifyImages ?? [],
    handleSeed: product._id ? String(product._id) : null,
  };

  // Verifies the stored GIDs against the current shop and recreates when they
  // are stale — the catalogue still holds ids from a previous store.
  const linked = await ensureShopifyProductLinked(payload);

  // A create already carried the whole payload — copy, price, stock, status,
  // metafields and the gallery — so updating it again would be seven wasted
  // requests on each of the seventeen thousand products that have never been
  // pushed. For a product that already existed, the update *is* the push.
  const ids = linked.created
    ? linked
    : await updateShopifyProduct({
        ...payload,
        shopifyProductId: linked.productId,
        shopifyVariantId: linked.variantId,
      });

  const imageLinks = ids.imageLinks ?? linked.imageLinks ?? [];
  const mediaBySource = new Map(imageLinks.map((l) => [l.sourceUrl, l]));

  product.shopifyProductId = ids.productId;
  product.shopifyVariantId = ids.variantId;
  product.shopifyImages = imageLinks;
  const handle = ids.handle ?? linked.handle ?? product.shopifyHandle ?? "";
  if (handle) {
    product.shopifyHandle = handle;
    product.shopifyProductUrl = shopifyProductUrl(handle);
  }

  const rows = product.variants ?? [];
  let variantsLinked = 0;

  // A single-variant product is already covered by the product-level variant
  // the create path builds; declaring an option axis for it would only add an
  // unnecessary "Title" dimension.
  if (rows.length >= 2) {
    try {
      const result = await syncVariantsToShopify(
        ids.productId,
        buildVariantPayload(product),
      );
      warnings.push(...result.warnings);
      for (const [index, row] of rows.entries()) {
        const key = String(row._id ?? index);
        if (result.linked[key]) row.shopifyVariantId = result.linked[key];
        if (result.inventoryItems[key]) {
          row.shopifyInventoryItemId = result.inventoryItems[key];
        }
      }
    } catch (error) {
      // The product itself synced; losing that because one option axis is
      // malformed would be the worse outcome. Reported, not thrown.
      warnings.push(
        `Variant sync failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else if (rows.length === 1) {
    rows[0].shopifyVariantId = ids.variantId;
    if (ids.inventoryItemId) {
      rows[0].shopifyInventoryItemId = ids.inventoryItemId;
    }
  }

  // Pair each variant with its own image, now that both the media and the
  // variant GIDs exist.
  const pairs: { variantId: string; mediaId: string }[] = [];
  for (const row of rows) {
    const media = mediaBySource.get(String(row.imageUrl || "").trim());
    if (!media?.mediaId || !row.shopifyVariantId) continue;
    row.shopifyImageUrl = media.shopifyUrl;
    row.shopifyMediaId = media.mediaId;
    pairs.push({ variantId: row.shopifyVariantId, mediaId: media.mediaId });
  }

  let variantImagesAttached = 0;
  if (pairs.length) {
    try {
      const attached = await attachVariantMedia(ids.productId, pairs);
      variantImagesAttached = attached.attached;
      warnings.push(...attached.warnings);
    } catch (error) {
      warnings.push(
        `Variant images not attached: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  for (const row of rows) if (row.shopifyVariantId) variantsLinked += 1;

  return {
    productId: ids.productId,
    variantId: ids.variantId,
    status,
    images: imageLinks.length,
    variantsLinked,
    variantsTotal: rows.length,
    variantImagesAttached,
    warnings,
  };
}
