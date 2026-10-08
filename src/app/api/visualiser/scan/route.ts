import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

/**
 * POST /api/visualiser/scan — multipart `photo` (+ optional `focal35`).
 *
 * Forwards a customer's room photo to the room scanner (the detector on the
 * Oracle VM) and returns the surfaces it found: the floor, and every wall part
 * the scanner split at corners and steps (back_wall, back_wall_2, …), exactly
 * as it returned them. The scanner's shared secret
 * lives only here, server-side: the browser never sees DETECT_URL or
 * DETECT_KEY. Nothing is stored — the photo passes straight through.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A scan takes ~10–20 s, longer when the scanner is queueing.
export const maxDuration = 120;

/** Vercel rejects request bodies over 4.5 MB; the browser shrinks to ≤ 4 MB. */
const MAX_PHOTO_BYTES = 4.5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
]);
const SCAN_TIMEOUT_MS = 110_000;
/** Scans per customer per window — each one costs the scanner ~12 s of CPU. */
const RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };

const fail = (status: number, error: string, extra?: Record<string, string>) =>
  NextResponse.json({ error }, { status, headers: extra });

const NOTHING_FOUND =
  "We couldn't find the floor or walls in this photo. Stand back so the photo shows plenty of floor or wall, and hold your phone level.";

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isPoint = (p: unknown) => Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1]);

/**
 * A floor or wall part the renderer can lay: four corner points, a real size
 * and at least one outline. The renderer reads all three unguarded, so a part
 * missing any of them would take the whole room down; it is dropped instead.
 * Ceilings are never requested and are dropped too.
 */
function usableSurface(o: unknown): boolean {
  const s = o as {
    name?: unknown;
    product_surface?: unknown;
    quad?: unknown;
    realSize?: { w?: unknown; h?: unknown };
    mask?: { polygons?: { mode?: unknown; points?: unknown }[] };
  } | null;
  if (!s || typeof s.name !== "string" || !s.name) return false;
  if (s.product_surface !== "floor" && s.product_surface !== "wall") return false;
  if (!Array.isArray(s.quad) || s.quad.length !== 4 || !s.quad.every(isPoint)) return false;
  const w = Number(s.realSize?.w);
  const h = Number(s.realSize?.h);
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return false;
  const polys = Array.isArray(s.mask?.polygons) ? s.mask!.polygons! : [];
  return polys.some(
    (p) => p?.mode !== "subtract" && Array.isArray(p?.points) && p.points.length >= 3 && p.points.every(isPoint),
  );
}

export async function POST(request: Request) {
  const url = process.env.DETECT_URL?.trim();
  const key = process.env.DETECT_KEY?.trim();
  if (!url || !key) {
    console.error("[visualiser/scan] DETECT_URL / DETECT_KEY are not set");
    return fail(503, "The room scanner is not available right now.");
  }

  const ip = await getClientIp();
  const rate = checkRateLimit(`visualiser-scan:${ip}`, RATE_LIMIT.limit, RATE_LIMIT.windowMs);
  if (!rate.allowed) {
    return fail(429, "You've scanned a lot of photos in a short time. Please wait a few minutes and try again.", {
      "Retry-After": String(rate.retryAfterSeconds || 600),
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Please choose a photo of your room.");
  }

  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return fail(400, "Please choose a photo of your room.");
  }
  if (!ALLOWED_TYPES.has(photo.type)) {
    return fail(400, "That file isn't a photo we can read. Please use a JPG or PNG.");
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return fail(413, "That photo is too large. Please choose a smaller one.");
  }

  const upstream = new FormData();
  upstream.append("photo", photo, photo.name || "room.jpg");
  upstream.append("quality", "balanced");
  upstream.append("roomHeight", "2.7");
  const focal35 = Number(form.get("focal35"));
  if (Number.isFinite(focal35) && focal35 >= 8 && focal35 <= 400) {
    upstream.append("focal35", String(Math.round(focal35)));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      body: upstream,
      headers: {
        authorization: `Bearer ${key}`,
        // The scanner rate-limits per customer, not per shop server.
        ...(ip && ip !== "unknown" ? { "x-client-ip": ip } : {}),
      },
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    console.error("[visualiser/scan] scanner unreachable:", e instanceof Error ? e.message : e);
    return fail(
      503,
      timedOut
        ? "The room scanner took too long. Please try again in a minute."
        : "The room scanner is busy. Please try again in a minute.",
    );
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  if (res.ok) {
    const raw = Array.isArray(body?.objectList) ? (body!.objectList as unknown[]) : [];
    const width = Number(body?.width);
    const height = Number(body?.height);
    // Usable floor and wall parts only, each name once, in the scanner's order
    // (floor first, then walls left to right) — the order they are drawn in.
    const seen = new Set<string>();
    const objectList = raw.filter((o) => {
      if (!usableSurface(o)) return false;
      const name = (o as { name: string }).name;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
    if (!objectList.length || !(width > 0) || !(height > 0)) {
      return fail(422, NOTHING_FOUND);
    }
    return NextResponse.json(
      { width, height, objectList, camera: body?.camera ?? null, scan: body?.scan ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  switch (res.status) {
    case 400:
    case 413:
      return fail(res.status, "We couldn't read that photo. Please try another one.");
    case 422:
      return fail(422, NOTHING_FOUND);
    case 429:
      return fail(429, "You've scanned a lot of photos in a short time. Please wait a few minutes and try again.", {
        "Retry-After": res.headers.get("retry-after") || "600",
      });
    case 503:
      return fail(503, "The room scanner is busy. Please try again in a minute.", {
        "Retry-After": res.headers.get("retry-after") || "30",
      });
    default:
      // 401 (wrong key) and anything unexpected: the customer can't fix it.
      console.error(`[visualiser/scan] scanner answered ${res.status}:`, body?.error ?? "");
      return fail(502, "We couldn't scan this photo right now. Please try again shortly.");
  }
}
