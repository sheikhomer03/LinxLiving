/**
 * Mirror a product's videos onto its Shopify product.
 *
 * The gallery sync deliberately skips these: `images[]` mixes stills with MP4s
 * and `youtube:`/`vimeo:` markers, and offering either to Shopify as image
 * media fails the whole mutation (`UNSUPPORTED_IMAGE_FILE_TYPE`). Shopify does
 * take video, but by two different routes, and neither resembles how it takes
 * an image:
 *
 *   EXTERNAL_VIDEO  a YouTube or Vimeo URL is attached by reference. Shopify
 *                   stores the link, not the file, and accepts it directly.
 *   VIDEO           a hosted file cannot be fetched from a URL — Shopify
 *                   answers "Invalid video url" — so the bytes have to be
 *                   downloaded from Cloudinary and pushed through a staged
 *                   upload before the media can be created.
 *
 * The second route moves real data (these files average ten megabytes), which
 * is why it is separable: `syncExternalVideos` costs nothing and can run over
 * the whole catalogue, while `syncHostedVideos` is a transfer job.
 */
import { shopifyAdminRequest } from "./admin";
import type { ShopifyUserError } from "./types";

export type VideoLink = {
  sourceUrl: string;
  mediaId: string;
  kind: "video" | "external";
  status: string;
};

/**
 * Shopify accepts a watch URL; the bare `youtube:ID` form we store is not one.
 *
 * The stored prefix is not trusted on its own. Several ranges — Pooky's whole
 * lighting catalogue among them — carry Vimeo ids behind a `youtube:` label,
 * and Shopify rejects the YouTube URL built from one. The id itself settles it:
 * YouTube ids are eleven characters of mixed alphanumerics, Vimeo's are all
 * digits, so an all-numeric id is a Vimeo video whatever the prefix claims.
 */
export function toExternalVideoUrl(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;

  const vimeoUrl = (id: string) => `https://vimeo.com/${id}`;
  const youtubeUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

  // Explicit hosts in a real URL are unambiguous.
  const vimeoFromUrl =
    value.match(/player\.vimeo\.com\/video\/(\d{6,})/)?.[1] ||
    value.match(/vimeo\.com\/(?:channels\/[^/]+\/)?(\d{6,})/)?.[1];
  if (vimeoFromUrl) return vimeoUrl(vimeoFromUrl);

  const youtubeFromUrl =
    value.match(/[?&]v=([a-zA-Z0-9_-]{6,})/)?.[1] ||
    value.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/)?.[1] ||
    value.match(/youtube\.com\/(?:embed|shorts)\/([a-zA-Z0-9_-]{6,})/)?.[1];
  if (youtubeFromUrl) return youtubeUrl(youtubeFromUrl);

  // Bare markers: believe the id, not the label.
  const marker = value.match(/^(youtube|vimeo):([a-zA-Z0-9_-]{6,})$/i);
  if (marker) {
    const id = marker[2];
    return /^\d+$/.test(id) ? vimeoUrl(id) : youtubeUrl(id);
  }

  return null;
}

/** A Cloudinary-hosted (or other) video file we would have to upload. */
export function isHostedVideoUrl(raw: string): boolean {
  const value = String(raw || "").trim();
  if (!/^https?:\/\//i.test(value)) return false;
  return /\/video\/upload\//i.test(value) || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(value);
}

type MediaNode = {
  id: string;
  status: string | null;
  mediaContentType: string;
};

async function fetchVideoMedia(productId: string) {
  const data = await shopifyAdminRequest<{
    product: {
      media: {
        nodes: (MediaNode & { originUrl?: string; filename?: string })[];
      };
    } | null;
  }>(
    `
    query ProductVideoMedia($id: ID!) {
      product(id: $id) {
        media(first: 100) {
          nodes {
            mediaContentType
            status
            ... on Video { id filename }
            ... on ExternalVideo { id originUrl }
          }
        }
      }
    }
  `,
    { id: productId },
  );
  return (data.product?.media?.nodes ?? []).filter(
    (n) => n.mediaContentType === "VIDEO" || n.mediaContentType === "EXTERNAL_VIDEO",
  );
}

function assertNoUserErrors(errors: ShopifyUserError[] | undefined, what: string) {
  if (errors?.length) {
    throw new Error(`${what}: ${errors.map((e) => e.message).join("; ")}`);
  }
}

/**
 * Attach YouTube / Vimeo references. Cheap — no file leaves Cloudinary.
 *
 * `known` is what the product already recorded, so a re-run does not stack a
 * second copy of the same video onto the product.
 */
export async function syncExternalVideos(
  productId: string,
  sources: string[],
  known: VideoLink[] = [],
): Promise<{ links: VideoLink[]; added: number }> {
  const wanted: { source: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const raw of sources) {
    const url = toExternalVideoUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    wanted.push({ source: String(raw).trim(), url });
  }
  if (!wanted.length) return { links: known, added: 0 };

  const live = await fetchVideoMedia(productId);
  const liveIds = new Set(live.map((n) => n.id));
  const liveOrigins = new Set(
    live.map((n) => String(n.originUrl || "")).filter(Boolean),
  );

  const links = known.filter((l) => l.mediaId && liveIds.has(l.mediaId));
  const have = new Set(links.map((l) => l.sourceUrl));

  // Shopify normalises a watch URL to youtu.be, so compare on the video id.
  const idOf = (u: string) => u.match(/[a-zA-Z0-9_-]{6,}$/)?.[0] || u;
  const liveIdSet = new Set([...liveOrigins].map(idOf));

  const missing = wanted.filter(
    (w) => !have.has(w.source) && !liveIdSet.has(idOf(w.url)),
  );
  if (!missing.length) return { links, added: 0 };

  const data = await shopifyAdminRequest<{
    productCreateMedia: {
      media: (MediaNode & { originUrl?: string })[];
      mediaUserErrors: ShopifyUserError[];
    };
  }>(
    `
    mutation AddExternalVideo($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          mediaContentType
          status
          ... on ExternalVideo { id originUrl }
        }
        mediaUserErrors { field message }
      }
    }
  `,
    {
      productId,
      media: missing.map((m) => ({
        originalSource: m.url,
        mediaContentType: "EXTERNAL_VIDEO",
        alt: "",
      })),
    },
  );
  assertNoUserErrors(
    data.productCreateMedia.mediaUserErrors,
    "Shopify productCreateMedia(EXTERNAL_VIDEO)",
  );

  const created = data.productCreateMedia.media ?? [];
  missing.forEach((m, i) => {
    const node = created[i];
    if (!node?.id) return;
    links.push({
      sourceUrl: m.source,
      mediaId: node.id,
      kind: "external",
      status: node.status || "",
    });
  });

  return { links, added: missing.length };
}

/**
 * Upload a hosted video file and attach it.
 *
 * Three steps, none of them optional: ask Shopify for a staging target, PUT the
 * bytes there, then create the media from the resource URL it hands back.
 */
export async function uploadHostedVideo(
  productId: string,
  sourceUrl: string,
): Promise<VideoLink | null> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`source fetch ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const filename = (sourceUrl.split("/").pop() || "video.mp4").split("?")[0];
  const mimeType = res.headers.get("content-type")?.split(";")[0] || "video/mp4";

  const staged = await shopifyAdminRequest<{
    stagedUploadsCreate: {
      stagedTargets: {
        url: string;
        resourceUrl: string;
        parameters: { name: string; value: string }[];
      }[];
      userErrors: ShopifyUserError[];
    };
  }>(
    `
    mutation StageVideo($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }
  `,
    {
      input: [
        {
          resource: "VIDEO",
          filename,
          mimeType,
          fileSize: String(buffer.byteLength),
          httpMethod: "POST",
        },
      ],
    },
  );
  assertNoUserErrors(staged.stagedUploadsCreate.userErrors, "Shopify stagedUploadsCreate");

  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target?.url) throw new Error("no staging target returned");

  const form = new FormData();
  // The signed parameters must precede the file part, or the upload is rejected.
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([buffer], { type: mimeType }), filename);

  const put = await fetch(target.url, { method: "POST", body: form });
  if (!put.ok) {
    throw new Error(`staged upload ${put.status}: ${(await put.text()).slice(0, 200)}`);
  }

  const created = await shopifyAdminRequest<{
    productCreateMedia: {
      media: MediaNode[];
      mediaUserErrors: ShopifyUserError[];
    };
  }>(
    `
    mutation AddVideo($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          mediaContentType
          status
          ... on Video { id }
        }
        mediaUserErrors { field message }
      }
    }
  `,
    {
      productId,
      media: [
        {
          originalSource: target.resourceUrl,
          mediaContentType: "VIDEO",
          alt: "",
        },
      ],
    },
  );
  assertNoUserErrors(
    created.productCreateMedia.mediaUserErrors,
    "Shopify productCreateMedia(VIDEO)",
  );

  const node = created.productCreateMedia.media?.[0];
  if (!node?.id) return null;
  return {
    sourceUrl,
    mediaId: node.id,
    kind: "video",
    status: node.status || "",
  };
}

/** Videos already on the product, so a re-run does not duplicate them. */
export async function existingVideoMedia(productId: string) {
  return fetchVideoMedia(productId);
}
