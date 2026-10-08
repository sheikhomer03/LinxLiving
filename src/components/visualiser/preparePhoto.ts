/**
 * Get a customer's room photo ready for the scanner, in the browser.
 *
 *  - The lens is read from EXIF first: shrinking the photo drops EXIF, and the
 *    35 mm focal length is the scanner's best clue to the field of view.
 *  - The photo is drawn upright onto a canvas at ≤ 2400 px on its long side
 *    (the scanner works at that size anyway) and re-encoded as JPEG small
 *    enough for Vercel's 4.5 MB request limit.
 */

export const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_SIDE = 2400;
const MIN_SIDE = 320;
const TARGET_BYTES = 4 * 1024 * 1024;

export class PhotoError extends Error {}

export type PreparedPhoto = {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  focal35: number | null;
};

/** FocalLengthIn35mmFilm (EXIF tag 0xA405) from a JPEG, or null. */
export function readFocal35(buf: ArrayBuffer): number | null {
  try {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null; // not a JPEG
    let off = 2;
    while (off + 4 <= v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xff00) !== 0xff00) return null;
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && off + 10 <= v.byteLength) {
        // "Exif\0\0"
        if (v.getUint32(off + 4) === 0x45786966 && v.getUint16(off + 8) === 0) {
          return focalFromTiff(v, off + 10, off + 2 + len);
        }
      }
      if (marker === 0xffda) return null; // image data: no EXIF before it
      off += 2 + len;
    }
  } catch {
    /* malformed EXIF: no lens */
  }
  return null;
}

function focalFromTiff(v: DataView, base: number, end: number): number | null {
  if (base + 8 > end) return null;
  const le = v.getUint16(base) === 0x4949; // "II"
  const u16 = (o: number) => v.getUint16(base + o, le);
  const u32 = (o: number) => v.getUint32(base + o, le);
  if (u16(2) !== 42) return null;
  const findTag = (ifd: number, tag: number): number | null => {
    if (base + ifd + 2 > end) return null;
    const n = u16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (base + e + 12 > end) return null;
      if (u16(e) === tag) return e;
    }
    return null;
  };
  const exifPtr = findTag(u32(4), 0x8769);
  if (exifPtr === null) return null;
  const e = findTag(u32(exifPtr + 8), 0xa405);
  if (e === null) return null;
  const value = u16(e + 8);
  return value >= 8 && value <= 400 ? value : null;
}

async function decodeUpright(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to <img>, which also honours EXIF orientation */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Validate, read the lens, and shrink a chosen photo. Throws PhotoError with a customer-facing message. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file || !file.type.startsWith("image/")) {
    throw new PhotoError("Please choose a photo (JPG, PNG or HEIC).");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new PhotoError("That photo is very large. Please choose one under 30 MB.");
  }

  let focal35: number | null = null;
  if (/jpe?g/i.test(file.type)) {
    // EXIF sits in the first segment; 256 KB is ample.
    focal35 = readFocal35(await file.slice(0, 256 * 1024).arrayBuffer());
  }

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decodeUpright(file);
  } catch {
    throw new PhotoError(
      "This browser couldn't open that photo. Please try a JPG, or take the photo again with your camera.",
    );
  }

  const sw = "naturalWidth" in source ? source.naturalWidth : source.width;
  const sh = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!sw || !sh) throw new PhotoError("That photo appears to be empty. Please try another.");
  if (Math.min(sw, sh) < MIN_SIDE) {
    throw new PhotoError("That photo is too small. Please use a photo at least 320 pixels across.");
  }

  let blob: Blob | null = null;
  let width = 0;
  let height = 0;
  // Shrink, then step quality and size down until it fits the upload limit.
  for (const [maxSide, quality] of [
    [MAX_SIDE, 0.9],
    [MAX_SIDE, 0.8],
    [2000, 0.8],
    [1600, 0.75],
  ] as const) {
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    width = Math.round(sw * scale);
    height = Math.round(sh * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoError("This browser couldn't process the photo.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    blob = await toBlob(canvas, quality);
    if (blob && blob.size <= TARGET_BYTES) break;
  }
  if ("close" in source && typeof source.close === "function") source.close();
  if (!blob || blob.size > TARGET_BYTES) {
    throw new PhotoError("We couldn't make that photo small enough to upload. Please try another.");
  }

  return { blob, url: URL.createObjectURL(blob), width, height, focal35 };
}
