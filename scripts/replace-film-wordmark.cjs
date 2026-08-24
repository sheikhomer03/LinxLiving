/**
 * Replace burnt-in supplier names in the homepage films with the Linx Square
 * lockup.
 *
 *   node scripts/replace-film-wordmark.cjs                 # report only
 *   node scripts/replace-film-wordmark.cjs --apply         # rewrite the mp4s
 *   node scripts/replace-film-wordmark.cjs --apply a.mp4   # just these files
 *
 * The rest of the homepage rail is de-branded in the copy — labels and titles
 * name the work, never the supplier (see RealProjects.tsx). The supplier's own
 * name was still burnt into the picture of the films they self-host, so it
 * could not be edited out in text: every frame is read with the Vision
 * framework, each hit measured against its own background, and the replacement
 * composited at the same ink height and centre.
 *
 * What it will not touch: a name filmed on location — printed on a pallet, on
 * a showroom sign — sits on moving footage, where a patch reads as a grey
 * block. Those are left as filmed and listed in the run's output.
 *
 * Run it against the original downloads, not against its own output — a second
 * pass re-encodes a film that has already been through x264 once.
 *
 * Originals are re-fetchable with the scripts/download-*-videos.cjs helpers.
 * After a run, re-upload with scripts/upload-real-projects-videos-to-cloudinary.cjs
 * (OVERWRITE=1) — the films are served from Cloudinary, not from public/.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const { BRAND_TERMS } = require("./wordmark/brands.cjs");

const ROOT = path.join(__dirname, "..");
const FILMS = path.join(ROOT, "public", "home", "real-projects");
const SWIFT = path.join(__dirname, "wordmark");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const arg = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};
/** Sampling rate for the search. The wordmark cards last seconds, not frames. */
const RATE = Number(arg("rate", 4));
const TERMS = arg("terms", BRAND_TERMS.join(",")).toLowerCase();
/**
 * How rough the background behind the name may be before it is left as filmed.
 *
 * Measured as the median step between neighbouring pixels around the text, not
 * as spread around the average. Spread cannot tell a gradient from a
 * photograph — the ProWarm title card is flat beige with a vignette and scored
 * 28.8, the same as a shot of a warehouse — so it was refusing to patch cards
 * that delogo handles perfectly. Roughness separates them: those two measure
 * 0.00 and 1.50.
 */
const ROUGH = Number(arg("rough", 1.2));
/**
 * Below this, the background is flat or a clean gradient, and the covered
 * rectangle is refilled by interpolating across it rather than by delogo.
 */
const SMOOTH = Number(arg("smooth", 0.4));
/**
 * Least width-to-height a run of ink has to have to be treated as a wordmark.
 *
 * A name set on one line is about as many times wider than it is tall as it
 * has letters, so the test has to scale with the name: "PORCELANOSA" lands
 * near 9:1, but "XTONE" is five letters and measures 3:1 on screen and is no
 * less a wordmark for it. A fixed threshold tuned to the long name threw the
 * short ones away.
 *
 * What it is still for: ink much squarer than the name could be is something
 * the reader matched loosely — the name printed on a pallet and read at an
 * angle, a fragment wrapped across two lines — and replacing that drops the
 * lockup into the middle of a scene.
 */
const ASPECT_PER_LETTER = Number(arg("aspect-per-letter", 0.45));
const minAspectFor = (term) => Math.max(1.6, ASPECT_PER_LETTER * String(term || "").length);

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { maxBuffer: 1 << 28, ...opts });

/**
 * The two Swift helpers, built on demand.
 *
 * Vision does the reading and Core Text the drawing; both are macOS frameworks
 * with no usable Node binding, so they are small compiled tools rather than a
 * dependency. Built into a temp dir so nothing lands in the repo.
 */
const BIN = fs.mkdtempSync(path.join(os.tmpdir(), "wordmark-bin-"));
function tool(name) {
  const out = path.join(BIN, name);
  if (!fs.existsSync(out)) {
    sh("swiftc", ["-O", "-o", out, path.join(SWIFT, `${name}.swift`)]);
  }
  return out;
}

/** Replace every occurrence in one film. Returns a report. */
function processFilm(IN, OUT) {
  /* ---------- probe ---------- */
  const probe = JSON.parse(
    sh("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
      "stream=width,height", "-show_entries", "format=duration", "-of", "json", IN]).toString(),
  );
  const W = probe.streams[0].width;
  const H = probe.streams[0].height;
  const DURATION = Number(probe.format.duration);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "wordmark-"));
  const frames = path.join(work, "frames");
  fs.mkdirSync(frames);

  /* ---------- find the wordmark ---------- */
  sh("ffmpeg", ["-v", "error", "-i", IN, "-vf", `fps=${RATE}`, "-q:v", "2",
    path.join(frames, "%06d.jpg"), "-y"]);

  const list = fs.readdirSync(frames).filter((f) => f.endsWith(".jpg")).sort();
  const ocr = sh(tool("ocr"), [TERMS], {
    input: list.map((f) => path.join(frames, f)).join("\n"),
  }).toString();

  // A wordmark set on its own — "PORCELANOSA", "PORCELANOSA Grupo",
  // "PORCELANOSA eco" — is replaced whole, so no orphaned "Grupo" is left behind
  // next to the new name. Inside a sentence only the name itself is replaced.
  const LOCKUP_SLACK = 8;
  const lines = new Map();
  const matches = [];
  for (const row of ocr.split("\n")) {
    if (!row) continue;
    const [file, obs, kind, text, x, y, w, h, , term] = row.split("\t");
    const box = { text, x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
    if (kind === "line") lines.set(`${file}#${obs}`, box);
    else matches.push({ file, obs, term, ...box });
  }
  const hits = matches.map((m) => {
    const line = lines.get(`${m.file}#${m.obs}`);
    const lockup = line && line.text.length <= m.text.length + LOCKUP_SLACK;
    const box = lockup ? line : m;
    return {
      t: (Number(path.basename(m.file, ".jpg")) - 1) / RATE,
      text: box.text, lockup: Boolean(lockup), term: m.term,
      x: box.x, y: box.y, w: box.w, h: box.h,
    };
  });
  if (!hits.length) {
    fs.rmSync(work, { recursive: true, force: true });
    return { file: path.basename(IN), patches: [], notes: [], skipped: "no wordmark found" };
  }

  /* ---------- group into cards ---------- */
  // One on-screen wordmark spans many frames. Hits join a cluster when they are
  // the same name, sit in roughly the same place, and follow closely enough in
  // time; a moving or resizing wordmark widens the cluster's box rather than
  // splitting it.
  //
  // Matching on the name matters where a card stacks two of them — the
  // trendbook trailer opens on STARWOOD above PORCELANOSA. Merged, they
  // measure as one 459x123 block, which is not the shape of a wordmark, and
  // the guard below then throws away a replacement that was working.
  const MAX_GAP = 1.0;
  const near = (a, b) =>
    a.term === b.term &&
    Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < Math.max(a.w, b.w) * 0.6 &&
    Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < Math.max(a.h, b.h) * 1.2;

  const clusters = [];
  for (const hit of hits.sort((a, b) => a.t - b.t)) {
    const open = clusters.find((c) => hit.t - c.end <= MAX_GAP && near(c, hit));
    if (!open) {
      clusters.push({ ...hit, start: hit.t, end: hit.t, n: 1 });
      continue;
    }
    const x0 = Math.min(open.x, hit.x), y0 = Math.min(open.y, hit.y);
    const x1 = Math.max(open.x + open.w, hit.x + hit.w);
    const y1 = Math.max(open.y + open.h, hit.y + hit.h);
    open.x = x0; open.y = y0; open.w = x1 - x0; open.h = y1 - y0;
    open.end = hit.t; open.n++;
  }

  /* ---------- measure each card against its own background ---------- */
  /** Raw RGB of a rectangle of one frame, at native resolution. */
  function crop(time, x, y, w, h) {
    const buf = sh("ffmpeg", ["-v", "error", "-ss", String(time), "-i", IN,
      "-vf", `crop=${w}:${h}:${x}:${y}`, "-frames:v", "1",
      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    return buf;
  }
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const hex = (c) => c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1] ?? 0;

  const overlays = [];
  const notes = [];
  clusters.forEach((c, i) => {
    // Sample a ring outside the OCR box for the background, but look for ink
    // only inside the box itself — in body copy the line above and below sit
    // close enough that a padded search would measure them too.
    const padX = c.w * 0.12, padY = c.h * 0.30;
    const inner = {
      x: Math.round(c.x * W), y: Math.round(c.y * H),
      w: Math.round(c.w * W), h: Math.round(c.h * H),
    };
    let x = Math.max(0, Math.round((c.x - padX) * W));
    let y = Math.max(0, Math.round((c.y - padY) * H));
    let w = Math.min(W - x, Math.round((c.w + padX * 2) * W));
    let h = Math.min(H - y, Math.round((c.h + padY * 2) * H));
    w -= w % 2; h -= h % 2;
    if (w < 8 || h < 8) return;
    // The box in crop-local coordinates.
    const inX0 = Math.max(0, inner.x - x), inY0 = Math.max(0, inner.y - y);
    const inX1 = Math.min(w - 1, inX0 + inner.w), inY1 = Math.min(h - 1, inY0 + inner.h);

    const mid = Math.min(DURATION - 0.05, (c.start + c.end) / 2);
    const px = crop(mid, x, y, w, h);
    const at = (cx, cy) => {
      const o = (cy * w + cx) * 3;
      return [px[o], px[o + 1], px[o + 2]];
    };

    // Background from the border ring of the crop.
    const ring = [];
    const rough = [];
    const band = Math.max(1, Math.round(h * 0.12));
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const edge = cy < band || cy >= h - band || cx < band || cx >= w - band;
        if (!edge) continue;
        ring.push(at(cx, cy));
        // Difference to the next pixel along, which is what separates a
        // gradient from a photograph — see ROUGH below.
        if (cx + 1 < w) rough.push(Math.abs(lum(...at(cx, cy)) - lum(...at(cx + 1, cy))));
      }
    }
    const bg = [0, 1, 2].map((ch) => median(ring.map((p) => p[ch])));
    const bgLum = lum(...bg);
    const spread = median(ring.map((p) => Math.abs(lum(...p) - bgLum)));
    const roughness = median(rough);

    // Ink is whatever departs from that background.
    const THRESH = 28;
    let ix0 = w, iy0 = h, ix1 = -1, iy1 = -1;
    const inkPix = [];
    for (let cy = inY0; cy <= inY1; cy++) {
      for (let cx = inX0; cx <= inX1; cx++) {
        const p = at(cx, cy);
        if (Math.abs(lum(...p) - bgLum) < THRESH) continue;
        if (cx < ix0) ix0 = cx;
        if (cy < iy0) iy0 = cy;
        if (cx > ix1) ix1 = cx;
        if (cy > iy1) iy1 = cy;
        inkPix.push(p);
      }
    }
    if (ix1 < 0) { notes.push(`cluster ${i}: no ink measured, skipped`); return; }

    const inkColour = [0, 1, 2].map((ch) => median(inkPix.map((p) => p[ch])));
    // Take the ink's own colour only when it is decisive; a fading or
    // anti-aliased wordmark averages toward its background.
    const text = Math.abs(lum(...inkColour) - bgLum) > 60
      ? hex(inkColour)
      : (bgLum < 128 ? "ffffff" : "111111");

    const inkX = x + ix0, inkY = y + iy0;
    const inkW = ix1 - ix0 + 1, inkH = iy1 - iy0 + 1;
    // Cover the ink with a small margin so anti-aliased edges go too.
    const m = Math.max(2, Math.round(inkH * 0.35));
    const rx = Math.max(0, inkX - m), ry = Math.max(0, inkY - m);
    const rw = Math.min(W - rx, inkW + m * 2), rh = Math.min(H - ry, inkH + m * 2);

    if (inkW / inkH < minAspectFor(c.term) || inkW < 30) {
      notes.push(`${c.start.toFixed(1)}s "${c.text}": left as filmed, ink is ${inkW}x${inkH}, not wordmark-shaped`);
      return;
    }

    // Text burnt over live footage cannot be patched — delogo rebuilds the
    // covered rectangle from its border pixels, which reads as a smear once
    // there is any detail behind it.
    if (roughness > ROUGH) {
      notes.push(`${c.start.toFixed(1)}s "${c.text}": left as filmed, background is footage (roughness ${roughness.toFixed(2)})`);
      return;
    }

    // ffmpeg's delogo rebuilds the covered rectangle from its own border
    // pixels, so a card with a gradient behind it does not gain a flat patch.
    // It needs a pixel of margin inside the frame to interpolate from.
    const dx = Math.max(1, rx), dy = Math.max(1, ry);
    const dw = Math.min(W - dx - 1, rw), dh = Math.min(H - dy - 1, rh);
    if (dw < 4 || dh < 4) return;

    /*
     * How the covered rectangle gets refilled.
     *
     * delogo is per-frame, which a moving background needs, but it streaks
     * badly once the rectangle is tall — the ProWarm title card came back with
     * vertical smears through the middle of it. Where the background is
     * genuinely smooth the rectangle can instead be rebuilt by interpolating
     * across it from its own edges, which is seamless at any size and is baked
     * into the overlay. That fill is one frame's worth, so it is only right
     * where the background is not moving — which is the same "smooth" test.
     */
    let fill = "none";
    if (roughness <= SMOOTH) {
      const patch = Buffer.alloc(rw * rh * 3);
      // Rect corners in crop-local coordinates, and the ring just outside it.
      const lx = rx - x - 1, rxi = rx - x + rw, ty = ry - y - 1, by = ry - y + rh;
      const edge = (cx, cy) => at(
        Math.min(w - 1, Math.max(0, cx)),
        Math.min(h - 1, Math.max(0, cy)),
      );
      /*
       * Interpolate only from edges that are actually background.
       *
       * A name set between two lines of type — "INTRODUCING" above the ProWarm
       * logo, "PRO TOUCH IQ" below — has its own neighbours in the rectangle's
       * top and bottom edges, and pulling those across it drew the letters of
       * both lines down through the fill as vertical bars. An edge whose ink
       * departs from the background is dropped, and whatever is left carries
       * the fill; if that is nothing, the background colour does.
       */
      const edgeIsClean = (samples) =>
        median(samples.map((p) => Math.abs(lum(...p) - bgLum))) <= THRESH;
      const rows = [], cols = [];
      for (let cy = ry - y; cy < ry - y + rh; cy++) rows.push(cy);
      for (let cx = rx - x; cx < rx - x + rw; cx++) cols.push(cx);
      const useH =
        edgeIsClean(rows.map((cy) => edge(lx, cy))) &&
        edgeIsClean(rows.map((cy) => edge(rxi, cy)));
      const useV =
        edgeIsClean(cols.map((cx) => edge(cx, ty))) &&
        edgeIsClean(cols.map((cx) => edge(cx, by)));

      for (let py = 0; py < rh; py++) {
        for (let px = 0; px < rw; px++) {
          const cx = rx - x + px, cy = ry - y + py;
          const fx = rw > 1 ? px / (rw - 1) : 0;
          const fy = rh > 1 ? py / (rh - 1) : 0;
          for (let ch = 0; ch < 3; ch++) {
            const horizontal = edge(lx, cy)[ch] * (1 - fx) + edge(rxi, cy)[ch] * fx;
            const vertical = edge(cx, ty)[ch] * (1 - fy) + edge(cx, by)[ch] * fy;
            const value = useH && useV
              ? (horizontal + vertical) / 2
              : useH ? horizontal : useV ? vertical : bg[ch];
            patch[(py * rw + px) * 3 + ch] = Math.round(value);
          }
        }
      }
      const patchPath = path.join(work, `fill${i}.rgb`);
      fs.writeFileSync(patchPath, patch);
      fill = `@${patchPath}`;
    }

    // Rendered below, once every cluster is measured — which name on a card
    // becomes the lockup can only be decided with all of them in hand.
    overlays.push({
      index: i, delogo: [dx, dy, dw, dh],
      start: Math.max(0, c.start - 0.4),
      end: Math.min(DURATION, c.end + 0.4),
      rect: [rx, ry, rw, rh], ink: [inkX, inkY, inkW, inkH], fill,
      text: c.text, lockup: c.lockup, bg: hex(bg), colour: text,
      frames: c.n, spread: +spread.toFixed(1), roughness: +roughness.toFixed(2),
    });
    if (roughness > ROUGH * 0.6) {
      notes.push(`cluster ${i} (${c.start.toFixed(1)}s "${c.text}"): background has some detail (roughness ${roughness.toFixed(2)}), patch may show`);
    }
  });

  if (!overlays.length) {
    fs.rmSync(work, { recursive: true, force: true });
    return { file: path.basename(IN), patches: [], notes, skipped: "nothing to patch" };
  }

  /*
   * One lockup per card.
   *
   * A title card can carry two supplier names — the trendbook trailer opens on
   * STARWOOD above PORCELANOSA — and replacing both writes "LINX SQUARE" twice,
   * stacked. Where two replacements are on screen together and sit close
   * enough to read as one lockup, the widest keeps the name and the rest are
   * cleared without one.
   */
  const together = (a, b) => {
    if (a.start > b.end || b.start > a.end) return false;
    const [ax, ay, aw, ah] = a.rect;
    const [bx, by, bw, bh] = b.rect;
    const gap = Math.max(ay, by) - Math.min(ay + ah, by + bh);
    return (
      gap < Math.max(ah, bh) * 2 &&
      Math.abs(ax + aw / 2 - (bx + bw / 2)) < Math.max(aw, bw) * 1.2
    );
  };
  const cleared = new Set();
  for (const a of overlays) {
    if (cleared.has(a.index)) continue;
    for (const b of overlays) {
      if (b === a || cleared.has(b.index)) continue;
      if (!together(a, b)) continue;
      const loser = a.rect[2] >= b.rect[2] ? b : a;
      cleared.add(loser.index);
      notes.push(
        `${loser.start.toFixed(1)}s "${loser.text}": cleared without a lockup, another name shares the card`,
      );
      if (loser === a) break;
    }
  }

  for (const o of overlays) {
    o.png = path.join(work, `ov${o.index}.png`);
    const [inkX, inkY, inkW, inkH] = o.ink;
    const [rx, ry, rw, rh] = o.rect;
    sh(tool("overlay"), [o.png, String(W), String(H),
      String(rx), String(ry), String(rw), String(rh), o.fill,
      String(inkX), String(inkY), String(inkW), String(inkH),
      cleared.has(o.index) ? "none" : o.colour]);
    o.wordmark = !cleared.has(o.index);
  }

  /* ---------- composite ---------- */
  const inputs = ["-v", "error", "-i", IN];
  overlays.forEach((o) => inputs.push("-i", o.png));
  const chain = overlays
    .map((o, i) => {
      const when = `enable='between(t,${o.start.toFixed(2)},${o.end.toFixed(2)})'`;
      const src = i === 0 ? "0:v" : `v${i}`;
      const [dx, dy, dw, dh] = o.delogo;
      return `[${src}]delogo=x=${dx}:y=${dy}:w=${dw}:h=${dh}:${when}[c${i}];` +
             `[c${i}][${i + 1}:v]overlay=0:0:${when}[v${i + 1}]`;
    })
    .join(";");

  sh("ffmpeg", [...inputs,
    "-filter_complex", chain,
    "-map", `[v${overlays.length}]`, "-map", "0:a?",
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart", OUT, "-y"]);

  const report = {
    file: path.basename(IN), width: W, height: H, duration: DURATION,
    patches: overlays.map((o) => ({
      text: o.text, lockup: o.lockup, start: +o.start.toFixed(2), end: +o.end.toFixed(2),
      rect: o.rect, bg: o.bg, ink: o.colour, wordmark: o.wordmark, frames: o.frames, spread: o.spread,
    })),
    notes,
  };
  fs.rmSync(work, { recursive: true, force: true });
  return report;
}

/* ---------- run ---------- */
const named = argv.filter((a) => !a.startsWith("--"));
const targets = (named.length
  ? named.map((f) => (path.isAbsolute(f) ? f : path.join(FILMS, f)))
  : fs.readdirSync(FILMS).filter((f) => f.endsWith(".mp4")).sort().map((f) => path.join(FILMS, f)));

console.log(`${targets.length} film(s), searching for ${TERMS.split(",").length} name(s)`);
console.log(APPLY ? "--apply — films will be rewritten in place\n" : "report only (pass --apply to rewrite)\n");

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "wordmark-out-"));
const summary = [];
for (const film of targets) {
  const out = path.join(stage, path.basename(film));
  let report;
  try {
    report = processFilm(film, out);
  } catch (e) {
    console.log(`${path.basename(film)}: FAILED ${e.message}`);
    continue;
  }
  summary.push(report);
  if (!report.patches.length) {
    if (report.notes?.length) {
      console.log(`${report.file}: ${report.skipped}`);
      for (const n of report.notes) console.log(`  ! ${n}`);
    }
    continue;
  }
  console.log(`${report.file}: ${report.patches.length} replaced`);
  for (const p of report.patches) {
    console.log(`  ${p.start}s-${p.end}s  "${p.text}"${p.lockup ? " [whole lockup]" : ""}  ${p.rect.join(",")}`);
  }
  for (const n of report.notes) console.log(`  ! ${n}`);
  if (APPLY) {
    fs.copyFileSync(out, film);
    console.log(`  written ${path.relative(ROOT, film)}`);
  } else {
    console.log(`  staged ${out}`);
  }
}

const replaced = summary.reduce((n, r) => n + r.patches.length, 0);
const left = summary.flatMap((r) => (r.notes || []).map((n) => `${r.file}: ${n}`));
console.log(`\n${replaced} wordmark(s) replaced across ${summary.filter((r) => r.patches.length).length} film(s)`);
if (left.length) {
  console.log(`${left.length} left as filmed:`);
  for (const l of left) console.log(`  ${l}`);
}
if (!APPLY) console.log(`\nstaged output: ${stage}`);
