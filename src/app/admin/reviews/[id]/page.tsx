import { getAdminReview } from "@/app/actions/reviews";
import { ReviewStatusUpdater } from "@/components/admin/ReviewStatusUpdater";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, Star } from "lucide-react";
import { getProductDisplayImage } from "@/lib/productImage";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const review = await getAdminReview(id);
  if (!review) notFound();

  const product = review.product as any;
  const image = product ? getProductDisplayImage(product.images) : "";

  return (
    <div className="admin-page max-w-4xl">
      <Link
        href="/admin/reviews"
        className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-70 hover:opacity-100 mb-2"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to reviews
      </Link>

      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-2">
          <h1 className="admin-page-title font-serif text-primary">
            Review detail
          </h1>
          <span
            className={cn(
              "inline-flex text-[9px] uppercase tracking-widest font-bold px-3 py-1 rounded-full border",
              review.status === "pending"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : review.status === "approved"
                  ? "border-green-200 bg-green-50 text-green-700"
                  : "border-red-200 bg-red-50 text-red-700",
            )}
          >
            {review.status}
          </span>
        </div>
        <ReviewStatusUpdater id={review._id} currentStatus={review.status} />
      </header>

      <div className="bg-white border border-stone-200 p-6 space-y-6">
        <div className="flex items-start gap-4">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt=""
              className="w-16 h-16 object-cover bg-secondary shrink-0"
            />
          ) : (
            <div className="w-16 h-16 bg-secondary shrink-0" />
          )}
          <div className="min-w-0 space-y-1">
            <p className="text-[10px] uppercase tracking-widest font-bold opacity-60">
              Product
            </p>
            {product?._id ? (
              <Link
                href={`/products/${product._id}`}
                className="text-base font-serif hover:text-primary transition-colors"
              >
                {product.name}
              </Link>
            ) : (
              <p className="text-base font-serif">Deleted product</p>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 border-t border-stone-100 pt-6">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">
              Customer
            </p>
            <p className="text-sm font-medium">{review.name}</p>
            <p className="text-xs text-stone-500">{review.email}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">
              Rating
            </p>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className={cn(
                    "w-4 h-4",
                    n <= review.rating
                      ? "fill-stone-800 text-stone-800"
                      : "text-stone-200",
                  )}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">
              Submitted
            </p>
            <p className="text-sm">
              {new Date(review.createdAt).toLocaleString("en-GB")}
            </p>
          </div>
          {review.title ? (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">
                Title
              </p>
              <p className="text-sm font-medium">{review.title}</p>
            </div>
          ) : null}
        </div>

        <div className="border-t border-stone-100 pt-6">
          <p className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-2">
            Comment
          </p>
          <p className="text-sm leading-relaxed text-stone-700 whitespace-pre-line">
            {review.comment}
          </p>
        </div>

        {/* Approving publishes these on the storefront, so they have to be
            visible before the decision, at a size you can actually judge. */}
        {review.photos?.length ? (
          <div className="border-t border-stone-100 pt-6">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest opacity-60">
              Customer photos ({review.photos.length}) — check before approving
            </p>
            <div className="flex flex-wrap gap-3">
              {review.photos.map((url: string) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative h-40 w-40 overflow-hidden rounded-lg border border-stone-200 transition-opacity hover:opacity-85"
                  title="Open full size"
                >
                  <Image
                    src={url}
                    alt="Customer review photo"
                    fill
                    sizes="160px"
                    className="object-cover"
                  />
                </a>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-stone-500">
              Reject the whole review if any photo is unsuitable.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
