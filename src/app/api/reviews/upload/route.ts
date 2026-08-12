import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { cloudinary } from "@/lib/cloudinary";
import { authOptions } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { findPurchaseOrder } from "@/app/actions/reviews";
import {
  ALLOWED_REVIEW_PHOTO_TYPES,
  MAX_REVIEW_PHOTO_BYTES,
  REVIEW_PHOTO_FOLDER,
} from "@/lib/reviewRules";

/**
 * Customer photo upload for product reviews.
 *
 * Deliberately separate from /api/admin/upload rather than relaxing that
 * route's auth. This endpoint is reachable by any signed-in customer, so it is
 * far tighter: images only (the admin route accepts PDFs and `resource_type:
 * "auto"`), a size cap, a rate limit, and — most importantly — the caller must
 * have actually bought the product. Without that last check the endpoint is
 * free image hosting for anyone with an account.
 *
 * Uploads land in their own folder so customer photos are never mixed with
 * catalogue imagery, and are resized on the way in: phone photos are 3–8MB
 * each and nothing on the page displays them above ~1600px.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Please sign in to add photos" },
        { status: 401 },
      );
    }

    const ip = await getClientIp();
    const limit = checkRateLimit(`review-upload:${userId}:${ip}`, 20, 60 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Please try again later." },
        { status: 429 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const productId = String(formData.get("productId") || "").trim();

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!ALLOWED_REVIEW_PHOTO_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Please upload a JPG, PNG or WebP image" },
        { status: 400 },
      );
    }
    if (file.size > MAX_REVIEW_PHOTO_BYTES) {
      return NextResponse.json(
        { error: "That image is over 8MB — please choose a smaller one" },
        { status: 400 },
      );
    }

    // The gate that stops this being open image hosting.
    const order = await findPurchaseOrder(userId, productId);
    if (!order) {
      return NextResponse.json(
        { error: "Only customers who have received this product can add photos" },
        { status: 403 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await new Promise<{ secure_url: string; public_id: string }>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: REVIEW_PHOTO_FOLDER,
            resource_type: "image",
            // Strip EXIF (customer photos carry GPS coordinates) and cap the
            // stored size — display never exceeds ~1600px.
            transformation: [
              { width: 1600, height: 1600, crop: "limit" },
              { quality: "auto:good", fetch_format: "auto" },
            ],
          },
          (error, uploaded) => {
            if (error) reject(error);
            else resolve(uploaded as any);
          },
        );
        stream.end(buffer);
      },
    );

    return NextResponse.json({ success: true, url: result.secure_url });
  } catch (error) {
    console.error("Review photo upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
