import { shopifyAdminRequest } from "./admin";
import { isShopifySyncEnabled } from "./config";
import { escapeHtml, slugify, stripHtml, toShopifyGid } from "./helpers";
import connectDB from "@/lib/mongodb";
import { Collection } from "@/models/Collection";
import { Product } from "@/models/Product";
import { revalidatePath } from "next/cache";

type CollectionInput = {
  name: string;
  slug: string;
  description?: string;
  image?: string;
  productIds?: string[];
  shopifyCollectionId?: string | null;
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

export async function pushCollectionToShopify(input: CollectionInput) {
  if (!isShopifySyncEnabled()) return null;

  const shopifyProductIds = await resolveShopifyProductIds(
    input.productIds ?? [],
  );

  if (input.shopifyCollectionId) {
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
          id: input.shopifyCollectionId,
          title: input.name,
          handle: input.slug || slugify(input.name),
          descriptionHtml: `<p>${escapeHtml(input.description || "")}</p>`,
          ...(input.image
            ? { image: { src: input.image } }
            : {}),
        },
      },
    );
    if (data.collectionUpdate.userErrors.length) {
      throw new Error(data.collectionUpdate.userErrors.map((e) => e.message).join("; "));
    }
    return data.collectionUpdate.collection?.id ?? input.shopifyCollectionId;
  }

  const data = await shopifyAdminRequest<{
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
        handle: input.slug || slugify(input.name),
        descriptionHtml: `<p>${escapeHtml(input.description || "")}</p>`,
        products: shopifyProductIds,
        ...(input.image ? { image: { src: input.image } } : {}),
      },
    },
  );

  if (data.collectionCreate.userErrors.length) {
    throw new Error(data.collectionCreate.userErrors.map((e) => e.message).join("; "));
  }
  return data.collectionCreate.collection?.id ?? null;
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

export async function upsertMongoCollectionFromShopify(node: any) {
  await connectDB();
  const shopifyCollectionId = node.id?.startsWith("gid://")
    ? node.id
    : toShopifyGid("Collection", node.id);
  const name = node.title || "Untitled";
  const slug = node.handle || slugify(name);
  const description = stripHtml(String(node.descriptionHtml || node.description || ""));
  const image = node.image?.url || node.image?.src || "";

  const shopifyProductGids = (node.products?.nodes ?? [])
    .map((p: any) => p.id)
    .filter(Boolean);
  const mongoProducts = shopifyProductGids.length
    ? await Product.find({ shopifyProductId: { $in: shopifyProductGids } }).select("_id")
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

  const existing = await Collection.findOne({ shopifyCollectionId });
  if (existing) {
    Object.assign(existing, fields);
    await existing.save();
  } else {
    const slugTaken = await Collection.findOne({ slug });
    if (slugTaken && !slugTaken.shopifyCollectionId) {
      fields.slug = `${slug}-${fromId(shopifyCollectionId)}`;
    }
    await Collection.create({ ...fields, order: 0 });
  }

  revalidatePath("/admin/collections");
  revalidatePath("/");
}

function fromId(gid: string) {
  return gid.split("/").pop() || "x";
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

  let count = 0;
  for (const node of data.collections.nodes) {
    await upsertMongoCollectionFromShopify(node);
    count += 1;
  }
  return { pulled: count };
}

/** Brands sync as Shopify collections tagged linx-brand */
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
