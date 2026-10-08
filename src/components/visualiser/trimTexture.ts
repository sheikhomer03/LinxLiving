/**
 * Crop the plain margin off a tile photograph before it becomes a texture.
 *
 * Many tile samples are shot on white (or on transparency): laid as they are,
 * every tile would carry a white frame and the wall would read as wide white
 * grout. Each side is checked on its own — a tile can touch the top and bottom
 * of the photo and still have white either side — and only a uniform band
 * that is light or transparent is cut. Anything doubtful keeps the original.
 *
 * Browser only, in memory: the result is a blob URL cached for the visit. No
 * image is stored anywhere and the engine files are untouched.
 */
import { loadImage } from "@/components/visualiser/engine/textures.js";

const MAX_SIDE = 1024;
const cache = new Map<string, Promise<string>>();

/** Pixel is part of a plain margin: transparent, or near the margin colour and light. */
function isMargin(data: Uint8ClampedArray, i: number, bg: [number, number, number]) {
  if (data[i + 3] < 24) return true;
  const d = Math.max(
    Math.abs(data[i] - bg[0]),
    Math.abs(data[i + 1] - bg[1]),
    Math.abs(data[i + 2] - bg[2]),
  );
  return d <= 14;
}

async function trim(url: string): Promise<string> {
  const img = (await loadImage(url)) as HTMLImageElement;
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * scale));
  const H = Math.max(1, Math.round(img.naturalHeight * scale));
  if (W < 32 || H < 32) return url;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return url;
  ctx.drawImage(img, 0, 0, W, H);
  // Throws if the CDN ever stops sending CORS headers; the caller keeps the original.
  const data = ctx.getImageData(0, 0, W, H).data;

  // Margin colour: the average of the four corners, which must be light
  // (white backdrop) or transparent — a dark corner is part of the tile.
  const corners = [0, (W - 1) * 4, (H - 1) * W * 4, ((H - 1) * W + W - 1) * 4];
  const transparent = corners.every((i) => data[i + 3] < 24);
  const bg: [number, number, number] = [0, 1, 2].map(
    (k) => corners.reduce((sum, i) => sum + data[i + k], 0) / corners.length,
  ) as [number, number, number];
  if (!transparent && Math.min(...bg) < 215) return url;

  const rowMargin = (y: number) => {
    let n = 0;
    for (let x = 0; x < W; x += 2) if (isMargin(data, (y * W + x) * 4, bg)) n++;
    return n / Math.ceil(W / 2);
  };
  const colMargin = (x: number) => {
    let n = 0;
    for (let y = 0; y < H; y += 2) if (isMargin(data, (y * W + x) * 4, bg)) n++;
    return n / Math.ceil(H / 2);
  };

  // Walk each side inward while the line is almost all margin.
  const LIMIT = 0.97;
  let top = 0;
  let bottom = H - 1;
  let left = 0;
  let right = W - 1;
  while (top < bottom && rowMargin(top) >= LIMIT) top++;
  while (bottom > top && rowMargin(bottom) >= LIMIT) bottom--;
  while (left < right && colMargin(left) >= LIMIT) left++;
  while (right > left && colMargin(right) >= LIMIT) right--;

  // A hair inside the edge, so no anti-aliased halo is left.
  const inset = (n: number) => Math.max(0, Math.round(n * 0.01));
  const cw = right - left + 1;
  const ch = bottom - top + 1;
  if (cw === W && ch === H) return url; // nothing to cut
  // A crop this small means the "margin" was really the tile (white on white).
  if (cw * ch < W * H * 0.2 || cw < 24 || ch < 24) return url;
  const x0 = left + inset(cw);
  const y0 = top + inset(ch);
  const x1 = right - inset(cw);
  const y1 = bottom - inset(ch);

  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  const octx = out.getContext("2d");
  if (!octx) return url;
  octx.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.92));
  return blob ? URL.createObjectURL(blob) : url;
}

/** The tile photo with its plain margin cut off (a blob URL), or the original. */
export function trimmedTexture(url: string): Promise<string> {
  if (!url) return Promise.resolve(url);
  let hit = cache.get(url);
  if (!hit) {
    hit = trim(url).catch(() => url);
    cache.set(url, hit);
  }
  return hit;
}
