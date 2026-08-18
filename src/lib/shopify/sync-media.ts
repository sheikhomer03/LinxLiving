/**
 * Reconcile a product's gallery against Shopify media, and pair every source
 * URL with the Shopify CDN copy.
 *
 * The gallery master lives in Mongo (`images`, normally Cloudinary). Shopify
 * mirrors each file onto its own CDN under a different host and filename, so
 * the two URLs cannot be derived from one another — the pair has to be stored,
 * which is what `Product.shopifyImages` is for.
 *
 * That mapping is also what makes a re-sync cheap. The previous approach
 * deleted every media node and re-uploaded the lot on each update, which for a
 * catalogue of this size means tens of thousands of needless uploads, a new set
 * of CDN URLs each run, and a gallery that flickers empty while Shopify
 * reprocesses. Here a file already uploaded is recognised and left alone; only
 * genuinely new images are sent and genuinely removed ones deleted.
 *
 * Shopify processes uploads asynchronously, so `image.url` is often null on the
 * response that creates it. Reconcile records what it can; `harvestMediaUrls`
 * fills the gaps in a later, much cheaper batched pass.
 */
import { shopifyAdminRequest } from "./admin";
import type { ShopifyImageLink, ShopifyUserError } from "./types";

/** Shopify accepts at most 250 media files on one product. */
export const MAX_MEDIA_PER_PRODUCT = 250;

/** Images sent per upload mutation — see the loop in `reconcileProductMedia`. */
export const MEDIA_UPLOAD_CHUNK = 10;

type MediaNode = {
  id: string;
  status: string | null;
  image: { url: string | null } | null;
  preview: { image: { url: string | null } | null } | null;
};

const MEDIA_FIELDS = `
  id
  status
  preview { image { url } }
  ... on MediaImage { image { url } }
`;

/**
 * Video files that have found their way into an image gallery.
 *
 * `images` collects whatever a supplier import put there, and for several
 * ranges that includes MP4s — Cloudinary serves them under `/video/upload/`.
 * Sent as image media they come back `UNSUPPORTED_IMAGE_FILE_TYPE (video/mp4)`,
 * leaving a permanently failed attachment on the product. The product's own
 * `videos` and `externalVideos` fields are where these belong.
 */
function isVideoUrl(url: string) {
  return (
    /\/video\/upload\//i.test(url) || /\.(mp4|mov|webm|m4v|avi)(\?|$)/i.test(url)
  );
}

/**
 * Gallery entries Shopify will accept: absolute http(s) URLs to still images.
 *
 * `images` is a mixed media list — alongside real URLs it holds markers such as
 * "youtube:giijTtxGDTY" for embedded video. Shopify rejects anything that is not
 * a fetchable absolute URL with "Image URL is invalid", failing the whole
 * mutation, so the markers are dropped rather than sent.
 */
export function usableImageUrls(images?: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of images ?? []) {
    const url = String(raw ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (isVideoUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_MEDIA_PER_PRODUCT) break;
  }
  return out;
}

/**
 * The URL Shopify should fetch, which is not always the one we store.
 *
 * Shopify refuses an image over 20 megapixels outright — several supplier
 * galleries are 24MP press shots, and they came back
 * `INVALID_IMAGE_RESOLUTION`. Cloudinary resizes on delivery, so asking it for a
 * bounded rendition costs nothing and leaves the stored original untouched:
 * `sourceUrl` stays the URL held in `images`, which is what the mapping matches
 * on, while Shopify is handed a copy it will accept.
 *
 * 4000×4000 is 16MP, comfortably inside the limit and larger than any storefront
 * needs. Images already carrying a transformation are left alone.
 */
export function toUploadableUrl(url: string) {
  const match = url.match(
    /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/i,
  );
  if (!match) return url;
  const [, prefix, rest] = match;
  if (/^[a-z]{1,2}_[^/]+\//i.test(rest)) return url;
  return `${prefix}c_limit,w_4000,h_4000/${rest}`;
}

export function buildMediaInput(urls: string[], alt = "") {
  return urls.map((url) => ({
    originalSource: toUploadableUrl(url),
    mediaContentType: "IMAGE" as const,
    alt,
  }));
}

function urlOf(node: MediaNode | null | undefined) {
  return node?.image?.url || node?.preview?.image?.url || "";
}

/**
 * Shopify prices a query by the size of the connections it asks for, not by
 * what comes back, so `first: 250` on a product holding four images is charged
 * as if it held 250. Asking for what the gallery actually needs is the
 * difference between a run pinned at the rate limit and one that is not.
 */
function connectionSize(expected: number) {
  return Math.max(10, Math.min(MAX_MEDIA_PER_PRODUCT, expected + 5));
}

async function fetchProductMedia(
  productId: string,
  expected: number,
): Promise<MediaNode[]> {
  const data = await shopifyAdminRequest<{
    product: { media: { nodes: MediaNode[] } } | null;
  }>(
    `
    query ProductMediaForSync($id: ID!) {
      product(id: $id) {
        media(first: ${connectionSize(expected)}) { nodes { ${MEDIA_FIELDS} } }
      }
    }
  `,
    { id: productId },
  );
  return data.product?.media?.nodes ?? [];
}

function assertNoUserErrors(errors: ShopifyUserError[] | undefined, what: string) {
  if (errors?.length) {
    throw new Error(`${what}: ${errors.map((e) => e.message).join("; ")}`);
  }
}

/**
 * Bring the Shopify gallery in line with `sources`, reusing what is already there.
 *
 * `known` is the mapping stored on the product from the last run. When it is
 * empty but the counts line up, the existing media is adopted positionally
 * rather than replaced — that is the case for every product synced before this
 * mapping existed, and re-uploading their galleries would be pure waste.
 */
export async function reconcileProductMedia(
  productId: string,
  sources: string[],
  known: ShopifyImageLink[] = [],
): Promise<{ links: ShopifyImageLink[]; uploaded: number; deleted: number }> {
  const wanted = usableImageUrls(sources);
  const live = await fetchProductMedia(
    productId,
    Math.max(wanted.length, known.length),
  );

  // Media Shopify could not process is worse than no media: it occupies the
  // gallery slot, so a mapping that points at it would be honoured on every
  // later run and the image would never be retried. Treating it as absent lets
  // it fall through to the stale-delete below and be uploaded again.
  const usableLive = live.filter((n) => n.status !== "FAILED");
  const liveById = new Map(usableLive.map((n) => [n.id, n]));

  const bySource = new Map<string, ShopifyImageLink>();
  for (const link of known) {
    if (link?.sourceUrl && link.mediaId && liveById.has(link.mediaId)) {
      bySource.set(link.sourceUrl, link);
    }
  }

  // Nothing recorded, but the gallery is already the right size: the media was
  // uploaded in this order by an earlier run, so adopt it instead of churning it.
  if (!bySource.size && usableLive.length && usableLive.length === wanted.length) {
    wanted.forEach((source, i) => {
      bySource.set(source, {
        sourceUrl: source,
        shopifyUrl: urlOf(usableLive[i]),
        mediaId: usableLive[i].id,
        position: i,
      });
    });
  }

  if (!wanted.length) {
    return { links: [], uploaded: 0, deleted: 0 };
  }

  const missing = wanted.filter((source) => !bySource.has(source));

  // Only media this product is meant to keep survives; anything else on the
  // node is a leftover from a removed image or a previous destructive sync.
  const keepIds = new Set(
    wanted.map((s) => bySource.get(s)?.mediaId).filter(Boolean) as string[],
  );
  const staleIds = live.map((n) => n.id).filter((id) => !keepIds.has(id));

  let deleted = 0;
  if (staleIds.length) {
    const data = await shopifyAdminRequest<{
      productDeleteMedia: { userErrors: ShopifyUserError[] };
    }>(
      `
      mutation DeleteProductMedia($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          userErrors { field message }
        }
      }
    `,
      { productId, mediaIds: staleIds },
    );
    assertNoUserErrors(data.productDeleteMedia.userErrors, "Shopify productDeleteMedia");
    deleted = staleIds.length;
  }

  // Uploads go up in chunks. Shopify fetches every URL before answering, so one
  // mutation carrying fifty images holds the connection open for minutes and
  // dies on a socket timeout — which is how a 51-variant product failed outright.
  for (let start = 0; start < missing.length; start += MEDIA_UPLOAD_CHUNK) {
    const chunk = missing.slice(start, start + MEDIA_UPLOAD_CHUNK);
    const data = await shopifyAdminRequest<{
      productCreateMedia: {
        media: MediaNode[];
        mediaUserErrors: ShopifyUserError[];
        userErrors?: ShopifyUserError[];
      };
    }>(
      `
      mutation CreateProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media { ${MEDIA_FIELDS} }
          mediaUserErrors { field message }
        }
      }
    `,
      { productId, media: buildMediaInput(chunk) },
    );
    assertNoUserErrors(
      data.productCreateMedia.mediaUserErrors,
      "Shopify productCreateMedia",
    );

    // Shopify returns the new nodes in the order they were sent.
    const created = data.productCreateMedia.media ?? [];
    chunk.forEach((source, i) => {
      const node = created[i];
      if (!node?.id) return;
      bySource.set(source, {
        sourceUrl: source,
        shopifyUrl: urlOf(node),
        mediaId: node.id,
        position: 0,
      });
    });
  }

  const links = wanted
    .map((source, position) => {
      const link = bySource.get(source);
      return link ? { ...link, position } : null;
    })
    .filter(Boolean) as ShopifyImageLink[];

  return { links, uploaded: missing.length, deleted };
}

/**
 * Point each variant at its own image.
 *
 * A variant image has to be product media first — Shopify has no per-variant
 * upload — so the caller passes media ids drawn from `reconcileProductMedia`.
 */
export async function attachVariantMedia(
  productId: string,
  pairs: { variantId: string; mediaId: string }[],
): Promise<{ attached: number; warnings: string[] }> {
  const usable = pairs.filter((p) => p.variantId && p.mediaId);
  if (!usable.length) return { attached: 0, warnings: [] };

  const data = await shopifyAdminRequest<{
    productVariantsBulkUpdate: {
      productVariants: { id: string }[];
      userErrors: ShopifyUserError[];
    };
  }>(
    `
    mutation AttachVariantMedia($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id }
        userErrors { field message }
      }
    }
  `,
    {
      productId,
      variants: usable.map((p) => ({ id: p.variantId, mediaId: p.mediaId })),
    },
  );

  const errors = data.productVariantsBulkUpdate.userErrors ?? [];
  return {
    attached: data.productVariantsBulkUpdate.productVariants?.length ?? 0,
    warnings: errors.map((e) => e.message),
  };
}

/**
 * Read back the CDN URL of media that was still processing when it was created.
 *
 * Batched by product because a single `nodes` query covers many of them, which
 * is what keeps a catalogue-wide harvest affordable.
 */
export async function harvestMediaUrls(
  productIds: string[],
  expectedPerProduct = 25,
): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  if (!productIds.length) return out;

  const data = await shopifyAdminRequest<{
    nodes: ({
      id: string;
      media?: { nodes: MediaNode[] };
    } | null)[];
  }>(
    `
    query HarvestMedia($ids: [ID!]!) {
      nodes(ids: $ids) {
        id
        ... on Product {
          media(first: ${connectionSize(expectedPerProduct)}) { nodes { ${MEDIA_FIELDS} } }
        }
      }
    }
  `,
    { ids: productIds },
  );

  for (const node of data.nodes ?? []) {
    if (!node?.id) continue;
    const byMediaId = new Map<string, string>();
    for (const media of node.media?.nodes ?? []) {
      const url = urlOf(media);
      if (media.id && url) byMediaId.set(media.id, url);
    }
    out.set(node.id, byMediaId);
  }
  return out;
}
