import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { Brand } from "@/models/Brand";
import { revalidatePath } from "next/cache";

export type ShopifyInboundProduct = {
  shopifyProductId: string;
  shopifyVariantId: string | null;
  handle?: string | null;
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  vendor?: string | null;
  images: string[];
  status?: string | null;
};

function toGid(resource: "Product" | "ProductVariant", id: string | number) {
  const raw = String(id);
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/${resource}/${raw}`;
}

function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function resolveBrandId(vendor?: string | null) {
  if (!vendor?.trim()) return null;
  const name = vendor.trim();
  const brand = await Brand.findOne({
    name: {
      $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      $options: "i",
    },
  })
    .select("_id")
    .lean();
  return brand?._id ?? null;
}

/**
 * Map Shopify REST webhook product payload → inbound shape.
 * https://shopify.dev/docs/api/webhooks
 */
export function mapRestWebhookProduct(payload: any): ShopifyInboundProduct {
  const variant = payload?.variants?.[0];
  const images = Array.isArray(payload?.images)
    ? payload.images.map((img: any) => img?.src).filter(Boolean)
    : [];
  if (!images.length && payload?.image?.src) {
    images.push(payload.image.src);
  }

  const productType = String(payload?.product_type || "").trim();
  const tags = String(payload?.tags || "")
    .split(",")
    .map((t: string) => t.trim())
    .filter(Boolean);

  return {
    shopifyProductId: toGid("Product", payload.id),
    shopifyVariantId: variant?.id
      ? toGid("ProductVariant", variant.id)
      : null,
    handle: payload.handle ?? null,
    name: payload.title || "Untitled",
    description:
      stripHtml(String(payload.body_html || "")) ||
      payload.title ||
      "No description",
    price: parseFloat(String(variant?.price ?? "0")) || 0,
    stock: Math.max(0, Number(variant?.inventory_quantity ?? 0) || 0),
    category: productType || tags[0] || "Uncategorized",
    vendor: payload.vendor || null,
    images,
    status: payload.status ?? null,
  };
}

/**
 * Map Admin GraphQL product node → inbound shape.
 */
export function mapGraphqlProduct(node: any): ShopifyInboundProduct {
  const variant = node?.variants?.nodes?.[0];
  const images = (node?.media?.nodes ?? [])
    .map((m: any) => m?.preview?.image?.url || m?.image?.url)
    .filter(Boolean);
  if (!images.length && node?.featuredImage?.url) {
    images.push(node.featuredImage.url);
  }

  const productType = String(node?.productType || "").trim();
  const tags = Array.isArray(node?.tags) ? node.tags : [];

  return {
    shopifyProductId: node.id,
    shopifyVariantId: variant?.id ?? null,
    handle: node.handle ?? null,
    name: node.title || "Untitled",
    description:
      stripHtml(String(node.descriptionHtml || node.description || "")) ||
      node.title ||
      "No description",
    price: parseFloat(String(variant?.price ?? "0")) || 0,
    stock: Math.max(0, Number(variant?.inventoryQuantity ?? 0) || 0),
    category: productType || tags[0] || "Uncategorized",
    vendor: node.vendor || null,
    images,
    status: node.status ?? null,
  };
}

/**
 * Upsert Mongo product from Shopify. Does NOT push back to Shopify (avoids loops).
 */
export async function upsertMongoProductFromShopify(
  input: ShopifyInboundProduct,
) {
  await connectDB();
  const brandId = await resolveBrandId(input.vendor);

  const fields = {
    name: input.name,
    description: input.description,
    price: input.price,
    stock: input.stock,
    category: input.category,
    brand: brandId,
    images: input.images,
    shopifyProductId: input.shopifyProductId,
    shopifyVariantId: input.shopifyVariantId,
    shopifySyncError: null,
    shopifySyncedAt: new Date(),
  };

  const existing = await Product.findOne({
    shopifyProductId: input.shopifyProductId,
  });

  let product;
  let action: "created" | "updated";

  if (existing) {
    Object.assign(existing, fields);
    await existing.save();
    product = existing;
    action = "updated";
  } else {
    product = await Product.create({
      ...fields,
      subCategory: "",
      showSpecs: true,
      specs: {},
    });
    action = "created";
  }

  revalidatePath("/admin/products");
  revalidatePath("/");
  revalidatePath("/", "layout");

  return {
    action,
    id: String(product._id),
    name: product.name,
    shopifyProductId: input.shopifyProductId,
  };
}

export async function deleteMongoProductByShopifyId(
  shopifyProductId: string | number,
) {
  await connectDB();
  const gid = toGid("Product", shopifyProductId);
  const deleted = await Product.findOneAndDelete({ shopifyProductId: gid });
  if (deleted) {
    revalidatePath("/admin/products");
    revalidatePath("/");
    revalidatePath("/", "layout");
  }
  return {
    deleted: Boolean(deleted),
    id: deleted ? String(deleted._id) : null,
  };
}
