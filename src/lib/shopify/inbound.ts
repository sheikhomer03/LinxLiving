import connectDB from "@/lib/mongodb";
import { Product } from "@/models/Product";
import { Brand } from "@/models/Brand";
import { revalidatePath } from "next/cache";
import { parseProductExtras } from "@/lib/productExtras";

export type ShopifyInboundProduct = {
  shopifyProductId: string;
  shopifyVariantId: string | null;
  handle?: string | null;
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  subCategory?: string | null;
  vendor?: string | null;
  images: string[];
  status?: string | null;
  tagline?: string | null;
  specs?: Record<string, unknown> | null;
  showSpecs?: boolean | null;
  schematicImage?: string | null;
  installationGuide?: string | null;
  insulatingSetPrice?: number | null;
  flashingFinder?: unknown;
  finishes?: unknown;
  flashings?: unknown;
};

function parseJsonField(raw: string | undefined | null) {
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readLinxMetafields(node: any) {
  const byKey = new Map<string, string>();

  const aliased: Record<string, string> = {
    tagline: node?.linxTagline?.value,
    specs: node?.linxSpecs?.value,
    show_specs: node?.linxShowSpecs?.value,
    schematic_image: node?.linxSchematic?.value,
    sub_category: node?.linxSubCategory?.value,
    installation_guide: node?.linxInstallationGuide?.value,
    insulating_set_price: node?.linxInsulatingSetPrice?.value,
    flashing_finder: node?.linxFlashingFinder?.value,
    finishes: node?.linxFinishes?.value,
    flashings: node?.linxFlashings?.value,
  };
  for (const [key, value] of Object.entries(aliased)) {
    if (value != null) byKey.set(key, String(value));
  }

  const list = Array.isArray(node?.metafields?.nodes)
    ? node.metafields.nodes
    : Array.isArray(node?.metafields)
      ? node.metafields
      : [];
  for (const m of list) {
    if (m?.namespace === "linx" && m?.key) {
      byKey.set(m.key, String(m.value ?? ""));
    }
  }

  let specs: Record<string, unknown> | null = null;
  const specsRaw = byKey.get("specs");
  if (specsRaw) {
    try {
      specs = JSON.parse(specsRaw);
    } catch {
      specs = {};
    }
  }

  const showRaw = byKey.get("show_specs");
  const extras = parseProductExtras({
    installationGuide: byKey.get("installation_guide"),
    insulatingSetPrice: byKey.get("insulating_set_price"),
    flashingFinder: parseJsonField(byKey.get("flashing_finder")),
    finishes: parseJsonField(byKey.get("finishes")),
    flashings: parseJsonField(byKey.get("flashings")),
  });

  return {
    tagline: byKey.has("tagline") ? byKey.get("tagline")! : null,
    specs,
    showSpecs:
      showRaw == null ? null : showRaw === "true" || showRaw === "1",
    schematicImage: byKey.has("schematic_image")
      ? byKey.get("schematic_image")!
      : null,
    subCategory: byKey.has("sub_category")
      ? byKey.get("sub_category")!
      : null,
    ...extras,
  };
}

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

  const meta = readLinxMetafields(node);
  const subFromTags =
    tags.length > 1 && tags[0] === productType ? tags[1] : tags[1] || "";

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
    subCategory: meta.subCategory || subFromTags || "",
    vendor: node.vendor || null,
    images,
    status: node.status ?? null,
    tagline: meta.tagline,
    specs: meta.specs,
    showSpecs: meta.showSpecs,
    schematicImage: meta.schematicImage,
    installationGuide: meta.installationGuide,
    insulatingSetPrice: meta.insulatingSetPrice,
    flashingFinder: meta.flashingFinder,
    finishes: meta.finishes,
    flashings: meta.flashings,
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

  const fields: Record<string, unknown> = {
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

  if (input.subCategory != null) fields.subCategory = input.subCategory;
  if (input.tagline != null) fields.tagline = input.tagline;
  if (input.specs != null) fields.specs = input.specs;
  if (input.showSpecs != null) fields.showSpecs = input.showSpecs;
  if (input.schematicImage != null) fields.schematicImage = input.schematicImage;
  if (input.installationGuide != null)
    fields.installationGuide = input.installationGuide;
  if (input.insulatingSetPrice !== undefined)
    fields.insulatingSetPrice = input.insulatingSetPrice;
  if (input.flashingFinder != null) fields.flashingFinder = input.flashingFinder;
  if (input.finishes != null) fields.finishes = input.finishes;
  if (input.flashings != null) fields.flashings = input.flashings;

  const existing = await Product.findOne({
    shopifyProductId: input.shopifyProductId,
  });

  let product;
  let action: "created" | "updated";

  if (existing) {
    // Never replace a Cloudinary / non-Shopify gallery with Shopify CDN URLs
    // or an empty gallery. Display already prioritises Cloudinary; sync must not wipe it.
    const { hasCloudinaryImage, hasNonShopifyImage, isShopifyCdnUrl } =
      await import("@/lib/productImage");
    const existingImages = Array.isArray(existing.images)
      ? (existing.images as string[])
      : [];
    const incoming = Array.isArray(input.images) ? input.images : [];
    const incomingAreShopifyOnly =
      incoming.length > 0 &&
      incoming.every((u) => isShopifyCdnUrl(String(u || "")));
    const incomingEmpty = incoming.length === 0;
    const keepLocalGallery =
      hasCloudinaryImage(existingImages) ||
      (hasNonShopifyImage(existingImages) &&
        (incomingAreShopifyOnly || incomingEmpty)) ||
      (existingImages.length > 0 && incomingEmpty) ||
      // Scraped brands (DFO, Sterling, etc.) must never lose Cloudinary galleries
      // to Shopify CDN media on inbound sync.
      (Boolean((existing as any)?.specs?.source) &&
        String((existing as any).specs.source).endsWith("-scrape") &&
        (incomingAreShopifyOnly || incomingEmpty || hasCloudinaryImage(existingImages)));

    // Don't clobber fresher Mongo edits (e.g. gallery re-sync) with older Shopify media.
    const localNewer =
      existing.updatedAt &&
      existing.shopifySyncedAt &&
      new Date(existing.updatedAt).getTime() >
        new Date(existing.shopifySyncedAt).getTime();

    if (keepLocalGallery || localNewer) {
      delete fields.images;
      Object.assign(existing, fields);
    } else {
      Object.assign(existing, fields);
    }
    await existing.save();
    product = existing;
    action = "updated";
  } else {
    product = await Product.create({
      ...fields,
      subCategory: input.subCategory || "",
      showSpecs: input.showSpecs ?? true,
      specs: input.specs || {},
      tagline: input.tagline || "",
      schematicImage: input.schematicImage || "",
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
