/**
 * Server-side replica of src/hooks/useCardImageFit.ts.
 *
 * The hook decides in the browser from a canvas; this decides from the same
 * pixels via sharp, so an audit can ask what a card will actually do without
 * rendering 14,000 pages. Keep the two in step — the constants below mirror
 * the hook's, and `classify` mirrors its `analyse`.
 */
const sharp = require("sharp");

const SAMPLE = 48;
const BACKDROP_TOLERANCE = 14;
const MIN_BACKDROP_SHARE = 0.55;
const MIN_BACKDROP_LEVEL = 240;
const CLEAR_ALPHA = 16;

/** What the card will do with this image: "cover" (crop) or "contain" (whole). */
async function classify(buf) {
  const { data } = await sharp(buf)
    .ensureAlpha()
    .resize(SAMPLE, SAMPLE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const at = (x, y) => {
    const i = (y * SAMPLE + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };

  const edge = [];
  for (let i = 0; i < SAMPLE; i++) {
    edge.push(at(i, 0), at(i, SAMPLE - 1), at(0, i), at(SAMPLE - 1, i));
  }

  const clear = edge.filter((px) => px[3] < CLEAR_ALPHA);
  if (clear.length / edge.length >= MIN_BACKDROP_SHARE) {
    return { fit: "contain", reason: "transparent backdrop", median: null };
  }

  const opaque = edge.filter((px) => px[3] >= CLEAR_ALPHA);
  if (!opaque.length) return { fit: "cover", reason: "unreadable edge", median: null };

  const median = [0, 1, 2].map((c) => {
    const v = opaque.map((px) => px[c]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  });

  if (Math.min(...median) < MIN_BACKDROP_LEVEL) {
    return { fit: "cover", reason: `backdrop rgb(${median.join(",")}) not light`, median };
  }

  const backdrop =
    clear.length +
    opaque.filter((px) => median.every((m, c) => Math.abs(px[c] - m) <= BACKDROP_TOLERANCE)).length;
  const share = backdrop / edge.length;
  if (share < MIN_BACKDROP_SHARE) {
    return { fit: "cover", reason: `only ${(share * 100).toFixed(0)}% of edge is backdrop`, median };
  }
  return { fit: "contain", reason: `${(share * 100).toFixed(0)}% backdrop`, median };
}

/**
 * The product's own bounding box, so an audit can tell whether a crop would
 * actually cut into it rather than merely trim empty backdrop.
 */
async function subjectBox(buf, meta) {
  try {
    const { info } = await sharp(buf).trim({ threshold: 12 }).raw().toBuffer({ resolveWithObject: true });
    if (info.width > 8 && info.height > 8) {
      return { width: info.width, height: info.height };
    }
  } catch {
    /* nothing uniform to trim */
  }
  return { width: meta.width || 0, height: meta.height || 0 };
}

/**
 * How much of the subject a square centre crop would remove, 0-1.
 *
 * The crop window is the shorter side, centred. Anything of the subject beyond
 * that window is lost — which is the thing worth auditing, since a crop that
 * only removes backdrop costs nothing.
 */
function subjectLoss(meta, box) {
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) return 0;
  const window = Math.min(w, h);
  if (w >= h) {
    return box.width <= window ? 0 : (box.width - window) / box.width;
  }
  return box.height <= window ? 0 : (box.height - window) / box.height;
}

module.exports = { classify, subjectBox, subjectLoss, SAMPLE };
