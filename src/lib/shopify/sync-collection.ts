import { shopifyAdminRequest } from "./admin";
import { isShopifySyncEnabled } from "./config";
import { escapeHtml, slugify, stripHtml, toShopifyGid } from "./helpers";
import connectDB from "@/lib/mongodb";
import { Brand } from "@/models/Brand";
import { Collection } from "@/models/Collection";
import { Menu } from "@/models/Menu";
import { Product } from "@/models/Product";
import { revalidatePath } from "next/cache";

type CollectionInput = {
  name: string;
  slug: string;
  description?: string;
  image?: string;
  productIds?: string[];
  shopifyCollectionId?: string | null;
  metafields?: {
    namespace: string;
    key: string;
    type: string;
    value: string;
  }[];
};

async function resolveShopifyProductIds(mongoProductIds: string[]) {
  if (!mongoProductIds.length) return [] as string[];
  const products = await Product.find({
    _id: { $in: mongoProductIds },
    shopifyProductId: { $ne: null },
  })
    .select("shopifyProductId")
    .lean();
  return products
    .map((p: any) => p.shopifyProductId)
    .filter(Boolean) as string[];
}

async function fetchShopifyCollectionProductIds(collectionId: string) {
  const data = await shopifyAdminRequest<{
    collection: { products: { nodes: { id: string }[] } } | null;
  }>(
    `
    query CollectionProducts($id: ID!) {
      collection(id: $id) {
        products(first: 250) { nodes { id } }
      }
    }
  `,
    { id: collectionId },
  );
  return (data.collection?.products?.nodes ?? []).map((p) => p.id);
}

async function findShopifyCollectionIdByHandle(handle: string) {
  const data = await shopifyAdminRequest<{
    collections: { nodes: { id: string; handle: string }[] };
  }>(
    `
    query CollectionByHandle($query: String!) {
      collections(first: 5, query: $query) {
        nodes { id handle }
      }
    }
  `,
    { query: `handle:${handle}` },
  );
  const exact = data.collections.nodes.find((n) => n.handle === handle);
  return exact?.id ?? data.collections.nodes[0]?.id ?? null;
}

/**
 * Keep Shopify collection membership aligned with Mongo product list.
 */
async function syncCollectionProductMembership(
  shopifyCollectionId: string,
  desiredShopifyProductIds: string[],
) {
  const current = await fetchShopifyCollectionProductIds(shopifyCollectionId);
  const desired = new Set(desiredShopifyProductIds);
  const currentSet = new Set(current);

  const toAdd = desiredShopifyProductIds.filter((id) => !currentSet.has(id));
  const toRemove = current.filter((id) => !desired.has(id));

  if (toAdd.length) {
    // Add one-by-one so stale IDs from an old store don't block the whole sync
    for (const productId of toAdd) {
      const data = await shopifyAdminRequest<{
        collectionAddProducts: {
          userErrors: { message: string }[];
        };
      }>(
        `
        mutation AddProducts($id: ID!, $productIds: [ID!]!) {
          collectionAddProducts(id: $id, productIds: $productIds) {
            userErrors { message }
          }
        }
      `,
        { id: shopifyCollectionId, productIds: [productId] },
      );
      const errs = data.collectionAddProducts.userErrors.map((e) => e.message);
      if (errs.length && !errs.every((m) => /product does not exist|already/i.test(m))) {
        throw new Error(errs.join("; "));
      }
    }
  }

  if (toRemove.length) {
    const data = await shopifyAdminRequest<{
      collectionRemoveProducts: {
        userErrors: { message: string }[];
      };
    }>(
      `
      mutation RemoveProducts($id: ID!, $productIds: [ID!]!) {
        collectionRemoveProducts(id: $id, productIds: $productIds) {
          userErrors { message }
        }
      }
    `,
      { id: shopifyCollectionId, productIds: toRemove },
    );
    if (data.collectionRemoveProducts.userErrors.length) {
      throw new Error(
        data.collectionRemoveProducts.userErrors
          .map((e) => e.message)
          .join("; "),
      );
    }
  }
}

/**
 * Shopify fetches collection images server-side — only absolute public http(s)
 * URLs work. Relative paths (/fakro-products/...), localhost, and SVGs fail with
 * "Error updating collection with this image".
 */
function shopifySafeCollectionImageSrc(src?: string | null): string | undefined {
  const url = String(src || "").trim();
  if (!url) return undefined;
  if (!/^https?:\/\//i.test(url)) return undefined;
  if (
    /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(url)
  ) {
    return undefined;
  }
  // Collection images reject SVG / data URIs
  if (/\.svg(\?|#|$)/i.test(url) || /^data:/i.test(url)) return undefined;
  return url;
}

function isCollectionImageError(message: string) {
  return /collection with this image|invalid image|image src|failed to download|could not download/i.test(
    message,
  );
}

export async function pushCollectionToShopify(input: CollectionInput) {
  if (!isShopifySyncEnabled()) return null;

  const shopifyProductIds = await resolveShopifyProductIds(
    input.productIds ?? [],
  );
  const handle = input.slug || slugify(input.name);
  const imageSrc = shopifySafeCollectionImageSrc(input.image);

  const updateExisting = async (
    shopifyCollectionId: string,
    includeImage: boolean,
  ) => {
    const data = await shopifyAdminRequest<{
      collectionUpdate: {
        collection: { id: string } | null;
        userErrors: { message: string }[];
      };
    }>(
      `
      mutation UpdateCollection($input: CollectionInput!) {
        collectionUpdate(input: $input) {
          collection { id }
          userErrors { message }
        }
      }
    `,
      {
        input: {
          id: shopifyCollectionId,
          title: input.name,
          handle,
          descriptionHtml: `<p>${escapeHtml(input.description || "")}</p>`,
          ...(includeImage && imageSrc ? { image: { src: imageSrc } } : {}),
          ...(input.metafields?.length
            ? { metafields: input.metafields }
            : {}),
        },
      },
    );
    if (data.collectionUpdate.userErrors.length) {
      throw new Error(
        data.collectionUpdate.userErrors.map((e) => e.message).join("; "),
      );
    }

    const id =
      data.collectionUpdate.collection?.id ?? shopifyCollectionId;
    await syncCollectionProductMembership(id, shopifyProductIds);
    return id;
  };

  const updateWithImageFallback = async (shopifyCollectionId: string) => {
    try {
      return await updateExisting(shopifyCollectionId, Boolean(imageSrc));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (imageSrc && isCollectionImageError(msg)) {
        console.warn(
          `Shopify rejected collection image for "${handle}" — syncing without image:`,
          msg,
        );
        return updateExisting(shopifyCollectionId, false);
      }
      throw error;
    }
  };

  if (input.shopifyCollectionId) {
    try {
      return await updateWithImageFallback(input.shopifyCollectionId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!/collection does not exist/i.test(msg)) throw error;

      // Stale Shopify ID (deleted / wrong store) — relink by handle or recreate.
      const existingId = await findShopifyCollectionIdByHandle(handle);
      if (existingId) return updateWithImageFallback(existingId);
      // fall through to create
    }
  }

  const createCollection = async (
    productIds: string[],
    includeImage: boolean,
  ) =>
    shopifyAdminRequest<{
      collectionCreate: {
        collection: { id: string } | null;
        userErrors: { message: string }[];
      };
    }>(
      `
      mutation CreateCollection($input: CollectionInput!) {
        collectionCreate(input: $input) {
          collection { id }
          userErrors { message }
        }
      }
    `,
      {
        input: {
          title: input.name,
          handle,
          descriptionHtml: `<p>${escapeHtml(input.description || "")}</p>`,
          ...(includeImage && imageSrc ? { image: { src: imageSrc } } : {}),
          ...(input.metafields?.length
            ? { metafields: input.metafields }
            : {}),
          ...(productIds.length ? { products: productIds } : {}),
        },
      },
    );

  let includeImage = Boolean(imageSrc);
  let data = await createCollection(shopifyProductIds, includeImage);

  // Stale GIDs from a previous Shopify store → create empty collection, then attach valid products
  let createErrors = data.collectionCreate.userErrors.map((e) => e.message);
  if (
    createErrors.length &&
    createErrors.every((m) => /product does not exist/i.test(m))
  ) {
    data = await createCollection([], includeImage);
    createErrors = data.collectionCreate.userErrors.map((e) => e.message);
  }

  // Bad image URL → retry create without image
  if (
    includeImage &&
    createErrors.length &&
    createErrors.some(isCollectionImageError)
  ) {
    console.warn(
      `Shopify rejected collection image for "${handle}" on create — retrying without image:`,
      createErrors.join("; "),
    );
    includeImage = false;
    data = await createCollection(shopifyProductIds, false);
    createErrors = data.collectionCreate.userErrors.map((e) => e.message);
    if (
      createErrors.length &&
      createErrors.every((m) => /product does not exist/i.test(m))
    ) {
      data = await createCollection([], false);
      createErrors = data.collectionCreate.userErrors.map((e) => e.message);
    }
  }

  // Collection already exists in Shopify under this handle — adopt + update it.
  if (
    createErrors.length &&
    createErrors.some((m) => /handle has already been taken/i.test(m))
  ) {
    const existingId = await findShopifyCollectionIdByHandle(handle);
    if (existingId) return updateWithImageFallback(existingId);
  }

  if (data.collectionCreate.userErrors.length) {
    throw new Error(
      data.collectionCreate.userErrors.map((e) => e.message).join("; "),
    );
  }

  const createdId = data.collectionCreate.collection?.id ?? null;
  if (createdId && shopifyProductIds.length) {
    try {
      await syncCollectionProductMembership(createdId, shopifyProductIds);
    } catch (error) {
      // Membership is best-effort when switching stores; collection itself is synced
      console.warn(
        "Collection created but some products could not be linked:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return createdId;
}

export async function deleteShopifyCollection(shopifyCollectionId: string) {
  if (!isShopifySyncEnabled()) return;
  await shopifyAdminRequest(
    `
    mutation DeleteCollection($input: CollectionDeleteInput!) {
      collectionDelete(input: $input) {
        deletedCollectionId
        userErrors { message }
      }
    }
  `,
    { input: { id: shopifyCollectionId } },
  );
}

function fromId(gid: string) {
  return gid.split("/").pop() || "x";
}

export async function upsertMongoMenuFromShopify(node: any) {
  await connectDB();
  const shopifyCollectionId = node.id?.startsWith("gid://")
    ? node.id
    : toShopifyGid("Collection", node.id);
  const handle = String(node.handle || "");
  const slug = handle.replace(/^menu-/, "") || slugify(node.title || "menu");
  const name = String(node.title || slug);
  const image = node.image?.url || node.image?.src || "";
  const description = stripHtml(
    String(node.descriptionHtml || node.description || ""),
  );

  const parentSlug =
    node.linxParentSlug?.value ||
    node.metafields?.nodes?.find(
      (m: any) => m.namespace === "linx" && m.key === "parent_slug",
    )?.value ||
    "";
  const orderRaw =
    node.linxOrder?.value ||
    node.metafields?.nodes?.find(
      (m: any) => m.namespace === "linx" && m.key === "order",
    )?.value;
  const brandSlugMeta =
    node.linxBrandSlug?.value ||
    node.metafields?.nodes?.find(
      (m: any) => m.namespace === "linx" && m.key === "brand_slug",
    )?.value ||
    "";

  let brandId: any = null;
  const brandSlug =
    brandSlugMeta || description.match(/brand:([a-z0-9-]+)/i)?.[1] || "";
  if (brandSlug) {
    const brand = await Brand.findOne({ slug: brandSlug }).select("_id");
    brandId = brand?._id ?? null;
  }

  let parentId: any = null;
  if (parentSlug) {
    const parentQuery: Record<string, unknown> = { slug: parentSlug };
    if (brandId) parentQuery.brand = brandId;
    const parent = await Menu.findOne(parentQuery).select("_id");
    parentId = parent?._id ?? null;
  }

  // Never match another brand's menu by bare slug — that steals categories
  // (e.g. Sterlingbuild overwriting FAKRO "pitched-roof-windows").
  const slugFilter = brandId ? { slug, brand: brandId } : { slug };
  await Menu.findOneAndUpdate(
    { $or: [{ shopifyCollectionId }, slugFilter] },
    {
      name,
      slug,
      image,
      isActive: true,
      // Only when Shopify actually told us. A webhook payload carries no
      // metafields, so treating "absent" as zero silently flattened the nav
      // ordering of every menu whose collection was pushed — the push itself
      // triggers the webhook, so a menu could not be updated without losing
      // its position.
      ...(orderRaw != null ? { order: Number(orderRaw) || 0 } : {}),
      ...(brandId ? { brand: brandId } : {}),
      ...(parentId !== null ? { parent: parentId } : {}),
      shopifyCollectionId,
      shopifySyncedAt: new Date(),
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  await Collection.deleteOne({
    shopifyCollectionId,
    slug: { $regex: /^menu-/ },
  }).catch(() => null);

  revalidatePath("/admin/menus");
  revalidatePath("/");
}

export async function upsertMongoBrandFromShopify(node: any) {
  await connectDB();
  const shopifyCollectionId = node.id?.startsWith("gid://")
    ? node.id
    : toShopifyGid("Collection", node.id);
  const handle = String(node.handle || "");
  const slug = handle.replace(/^brand-/, "") || slugify(node.title || "brand");
  const name = String(node.title || slug);
  const image = node.image?.url || node.image?.src || "";

  // Do not force Active on existing brands — admin "Hidden" must stick
  // (Shopify pull / auto-sync was reactivating LINX TRADE after supplier link).
  const existingBrand = await Brand.findOne({
    $or: [{ shopifyCollectionId }, { slug }],
  }).select("_id isActive");

  await Brand.findOneAndUpdate(
    { $or: [{ shopifyCollectionId }, { slug }] },
    {
      name,
      slug,
      image,
      ...(existingBrand ? {} : { isActive: true }),
      shopifyCollectionId,
      shopifySyncedAt: new Date(),
      shopifySyncError: null,
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  // Avoid duplicate in Collections if this was previously mis-imported
  await Collection.deleteOne({
    shopifyCollectionId,
    slug: { $regex: /^brand-/ },
  }).catch(() => null);

  revalidatePath("/admin/brands");
  revalidatePath("/");
}

export async function upsertMongoCollectionFromShopify(node: any) {
  await connectDB();
  const handle = String(node.handle || "");

  // Brands / menus use collection handles with prefixes — keep them out of Collections
  if (handle.startsWith("brand-")) {
    await upsertMongoBrandFromShopify(node);
    return { kind: "brand" as const };
  }
  if (handle.startsWith("menu-")) {
    await upsertMongoMenuFromShopify(node);
    return { kind: "menu" as const };
  }

  const shopifyCollectionId = node.id?.startsWith("gid://")
    ? node.id
    : toShopifyGid("Collection", node.id);
  const name = node.title || "Untitled";
  const slug = handle || slugify(name);

  // Shopify system "Home page" / frontpage — not a Linx admin collection
  if (
    handle === "frontpage" ||
    name.trim().toLowerCase() === "home page"
  ) {
    return { kind: "skipped" as const };
  }

  const description = stripHtml(
    String(node.descriptionHtml || node.description || ""),
  );
  const image = node.image?.url || node.image?.src || "";

  const shopifyProductGids = (node.products?.nodes ?? [])
    .map((p: any) => p.id)
    .filter(Boolean);
  const mongoProducts = shopifyProductGids.length
    ? await Product.find({
        shopifyProductId: { $in: shopifyProductGids },
      }).select("_id")
    : [];

  const fields = {
    name,
    slug,
    description,
    image,
    products: mongoProducts.map((p) => p._id),
    isActive: true,
    shopifyCollectionId,
    shopifySyncedAt: new Date(),
    shopifySyncError: null as string | null,
  };

  // Match by Shopify ID, then slug/name (links local rows; avoids E11000 on name/slug)
  let existing =
    (await Collection.findOne({ shopifyCollectionId })) ||
    (await Collection.findOne({ slug })) ||
    (await Collection.findOne({ name }));

  if (existing) {
    // Different Shopify collection already owns this slug/name → create with unique keys
    if (
      existing.shopifyCollectionId &&
      existing.shopifyCollectionId !== shopifyCollectionId
    ) {
      fields.slug = `${slug}-${fromId(shopifyCollectionId)}`;
      fields.name = `${name} (${fromId(shopifyCollectionId)})`;
      await Collection.create({ ...fields, order: 0 });
    } else {
      Object.assign(existing, fields);
      await existing.save();
    }
  } else {
    try {
      await Collection.create({ ...fields, order: 0 });
    } catch (error: any) {
      // Race or leftover unique index on name
      if (error?.code === 11000) {
        const dup = await Collection.findOne({
          $or: [{ name }, { slug }, { shopifyCollectionId }],
        });
        if (dup) {
          Object.assign(dup, fields);
          await dup.save();
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }

  revalidatePath("/admin/collections");
  revalidatePath("/");
  return { kind: "collection" as const };
}

export async function deleteMongoCollectionOrBrandByShopifyId(
  shopifyId: string | number,
) {
  await connectDB();
  const gid = toShopifyGid("Collection", shopifyId);

  const brand = await Brand.findOneAndDelete({ shopifyCollectionId: gid });
  if (brand) {
    revalidatePath("/admin/brands");
    revalidatePath("/");
    return { kind: "brand" as const, deleted: true };
  }

  const menu = await Menu.findOneAndDelete({ shopifyCollectionId: gid });
  if (menu) {
    revalidatePath("/admin/menus");
    revalidatePath("/");
    return { kind: "menu" as const, deleted: true };
  }

  const collection = await Collection.findOneAndDelete({
    shopifyCollectionId: gid,
  });
  if (collection) {
    revalidatePath("/admin/collections");
    revalidatePath("/");
    return { kind: "collection" as const, deleted: true };
  }

  return { deleted: false };
}

export async function pullCollectionsFromShopify(first = 50) {
  const data = await shopifyAdminRequest<{
    collections: { nodes: any[] };
  }>(
    `
    query Collections($first: Int!) {
      collections(first: $first, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id
          title
          handle
          descriptionHtml
          image { url }
          products(first: 50) { nodes { id } }
        }
      }
    }
  `,
    { first },
  );

  let collections = 0;
  let brands = 0;
  let menus = 0;
  for (const node of data.collections.nodes) {
    const result = await upsertMongoCollectionFromShopify(node);
    if (result?.kind === "brand") brands += 1;
    else if (result?.kind === "menu") menus += 1;
    else if (result?.kind === "collection") collections += 1;
  }
  return {
    pulled: collections + brands + menus,
    collections,
    brands,
    menus,
  };
}

export async function pullMenusFromShopify(first = 50) {
  const data = await shopifyAdminRequest<{
    collections: { nodes: any[] };
  }>(
    `
    query MenuCollections($first: Int!) {
      collections(first: $first, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id
          title
          handle
          descriptionHtml
          image { url }
          linxParentSlug: metafield(namespace: "linx", key: "parent_slug") { value }
          linxOrder: metafield(namespace: "linx", key: "order") { value }
          linxBrandSlug: metafield(namespace: "linx", key: "brand_slug") { value }
        }
      }
    }
  `,
    { first },
  );

  let pulled = 0;
  for (const node of data.collections.nodes) {
    if (!node.handle?.startsWith("menu-")) continue;
    await upsertMongoMenuFromShopify(node);
    pulled += 1;
  }
  return { pulled };
}

/** Menus sync as Shopify collections with menu-* handles */
export async function pushMenuAsCollection(input: {
  name: string;
  slug: string;
  image?: string;
  brandSlug?: string | null;
  parentSlug?: string | null;
  order?: number;
  shopifyCollectionId?: string | null;
  productIds?: string[];
}) {
  const brandHint = input.brandSlug ? ` brand:${input.brandSlug}` : "";
  const metafields = [
    {
      namespace: "linx",
      key: "kind",
      type: "single_line_text_field",
      value: "menu",
    },
    {
      namespace: "linx",
      key: "parent_slug",
      type: "single_line_text_field",
      value: input.parentSlug || "",
    },
    {
      namespace: "linx",
      key: "order",
      type: "number_integer",
      value: String(input.order ?? 0),
    },
    {
      namespace: "linx",
      key: "brand_slug",
      type: "single_line_text_field",
      value: input.brandSlug || "",
    },
  ];
  return pushCollectionToShopify({
    name: input.name,
    slug: `menu-${input.slug}`,
    description: `Menu: ${input.name}${brandHint}`,
    image: input.image,
    shopifyCollectionId: input.shopifyCollectionId,
    productIds: input.productIds ?? [],
    metafields,
  });
}

export async function pullBrandsFromShopify(first = 50) {
  const data = await shopifyAdminRequest<{
    collections: { nodes: any[] };
  }>(
    `
    query BrandCollections($first: Int!) {
      collections(first: $first, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id
          title
          handle
          image { url }
        }
      }
    }
  `,
    { first },
  );

  let pulled = 0;
  for (const node of data.collections.nodes) {
    if (!node.handle?.startsWith("brand-")) continue;
    await upsertMongoBrandFromShopify(node);
    pulled += 1;
  }
  return { pulled };
}

/** Brands sync as Shopify collections with brand-* handles */
export async function pushBrandAsCollection(input: {
  name: string;
  slug: string;
  image?: string;
  shopifyCollectionId?: string | null;
}) {
  return pushCollectionToShopify({
    name: input.name,
    slug: `brand-${input.slug}`,
    description: `Brand: ${input.name}`,
    image: input.image,
    shopifyCollectionId: input.shopifyCollectionId,
    productIds: [],
  });
}

/**
 * Push Brands/Collections/Menus missing a Shopify ID, or updated locally
 * after the last successful sync (true Living → Shopify catch-up).
 */
export async function pushUnsyncedBrandsAndCollections(limit = 15) {
  if (!isShopifySyncEnabled()) {
    return { brands: 0, collections: 0, menus: 0 };
  }

  const { needsShopifyOutboundSync } = await import("./helpers");

  await connectDB();
  let brands = 0;
  let collections = 0;
  let menus = 0;

  const unsyncedBrands = await Brand.find(
    needsShopifyOutboundSync("shopifyCollectionId"),
  )
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  for (const brand of unsyncedBrands as any[]) {
    try {
      const shopifyId = await pushBrandAsCollection({
        name: brand.name,
        slug: brand.slug,
        image: brand.image || "",
        shopifyCollectionId: brand.shopifyCollectionId || null,
      });
      if (shopifyId) {
        await Brand.updateOne(
          { _id: brand._id },
          {
            $set: {
              shopifyCollectionId: shopifyId,
              shopifySyncedAt: new Date(),
              shopifySyncError: null,
            },
          },
        );
        brands += 1;
      }
    } catch (error) {
      await Brand.updateOne(
        { _id: brand._id },
        {
          $set: {
            shopifySyncError:
              error instanceof Error ? error.message : "Brand sync failed",
          },
        },
      );
    }
  }

  const unsyncedCollections = await Collection.find(
    needsShopifyOutboundSync("shopifyCollectionId"),
  )
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  for (const collection of unsyncedCollections as any[]) {
    try {
      const shopifyId = await pushCollectionToShopify({
        name: collection.name,
        slug: collection.slug,
        description: collection.description || "",
        image: collection.image || "",
        shopifyCollectionId: collection.shopifyCollectionId || null,
        productIds: (collection.products || []).map((p: any) => String(p)),
      });
      if (shopifyId) {
        await Collection.updateOne(
          { _id: collection._id },
          {
            $set: {
              shopifyCollectionId: shopifyId,
              shopifySyncedAt: new Date(),
              shopifySyncError: null,
            },
          },
        );
        collections += 1;
      }
    } catch (error) {
      await Collection.updateOne(
        { _id: collection._id },
        {
          $set: {
            shopifySyncError:
              error instanceof Error
                ? error.message
                : "Collection sync failed",
          },
        },
      );
    }
  }

  const unsyncedMenus = await Menu.find(
    needsShopifyOutboundSync("shopifyCollectionId"),
  )
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  for (const menu of unsyncedMenus as any[]) {
    try {
      let brandSlug: string | null = null;
      if (menu.brand) {
        const brand = await Brand.findById(menu.brand).select("slug").lean();
        brandSlug = brand?.slug || null;
      }
      // Don't attach products during catch-up after a store switch — old GIDs often 404.
      // Products can be linked later once they are re-pushed to the new store.
      let parentSlug: string | null = null;
      if (menu.parent) {
        const parent = await Menu.findById(menu.parent).select("slug").lean();
        parentSlug = parent?.slug || null;
      }
      const shopifyId = await pushMenuAsCollection({
        name: menu.name,
        slug: menu.slug,
        image: menu.image || "",
        brandSlug,
        parentSlug,
        order: menu.order ?? 0,
        shopifyCollectionId: menu.shopifyCollectionId || null,
        productIds: [],
      });
      if (shopifyId) {
        await Menu.updateOne(
          { _id: menu._id },
          {
            $set: {
              shopifyCollectionId: shopifyId,
              shopifySyncedAt: new Date(),
            },
          },
        );
        menus += 1;
      }
    } catch (error) {
      console.error("Menu catch-up sync failed:", error);
    }
  }

  return { brands, collections, menus };
}
