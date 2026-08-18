/* eslint-disable @typescript-eslint/no-explicit-any */
import { getAdminReviews } from "@/app/actions/reviews";
import Link from "next/link";
import { MessageSquareQuote, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { getProductDisplayImage } from "@/lib/productImage";

export const dynamic = "force-dynamic";

function statusTone(status: string) {
  if (status === "pending") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "approved") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  return "border-red-200 bg-red-50 text-red-700";
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(
            "w-3.5 h-3.5",
            i < rating
              ? "fill-primary text-primary"
              : "fill-transparent text-stone-300",
          )}
        />
      ))}
      <span className="ml-1.5 text-xs font-bold text-stone-700">{rating}</span>
    </div>
  );
}

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const params = await searchParams;
  const currentPage = parseInt(params.page || "1", 10);
  const status = params.status || "";
  const { reviews, totalCount, totalPages } = await getAdminReviews({
    page: currentPage,
    limit: 20,
    status: status || undefined,
  });

  const filters = [
    { label: "All", value: "", hint: "Everything" },
    { label: "Pending", value: "pending", hint: "Needs review" },
    { label: "Approved", value: "approved", hint: "Live on site" },
    { label: "Rejected", value: "rejected", hint: "Hidden" },
  ];

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div className="space-y-2 min-w-0">
          <h1 className="admin-page-title font-serif text-primary">Reviews</h1>
          <p className="text-[10px] sm:text-sm text-stone-500 uppercase sm:normal-case tracking-[0.12em] sm:tracking-normal font-bold sm:font-normal">
            Moderate customer reviews before they appear on product pages.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3.5 py-2 shadow-sm">
          <MessageSquareQuote className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-stone-600">
            <span className="text-stone-900">{totalCount}</span> total
          </span>
        </div>
      </header>

      {/* Filter chips */}
      <div className="bg-white admin-panel-elevated p-2 sm:p-2.5">
        <div
          className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 sm:gap-2"
          role="tablist"
          aria-label="Filter reviews by status"
        >
          {filters.map((f) => {
            const href = f.value
              ? `/admin/reviews?status=${f.value}`
              : "/admin/reviews";
            const active = status === f.value;
            return (
              <Link
                key={f.label}
                href={href}
                role="tab"
                aria-selected={active}
                className={cn(
                  "group relative flex flex-col items-start sm:items-center justify-center rounded-lg px-3.5 py-2.5 sm:min-w-30 border transition-all",
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-stone-50 text-stone-700 border-stone-200 hover:bg-white hover:border-primary/35 hover:text-stone-900",
                )}
              >
                <span className="text-[10px] uppercase tracking-[0.16em] font-bold">
                  {f.label}
                </span>
                <span
                  className={cn(
                    "mt-0.5 text-[9px] tracking-wide",
                    active ? "text-primary-foreground/80" : "text-stone-400",
                  )}
                >
                  {f.hint}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {reviews.length === 0 ? (
        <div className="bg-white admin-panel-elevated flex flex-col items-center justify-center py-16 px-4 text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center">
            <MessageSquareQuote className="w-5 h-5 text-primary" />
          </div>
          <p className="text-sm font-medium text-stone-700">No reviews found</p>
          <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-stone-400">
            {status
              ? `Nothing in “${status}” right now`
              : "Customer reviews will show up here"}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile / tablet cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:hidden">
            {reviews.map((review: any) => {
              const product = review.product;
              const image = product
                ? getProductDisplayImage(product.images)
                : "";
              return (
                <article
                  key={review._id}
                  className="bg-white admin-panel-elevated overflow-hidden flex flex-col min-w-0"
                >
                  <div className="flex items-start gap-3 p-3.5 border-b border-stone-100">
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image}
                        alt=""
                        className="w-14 h-14 object-cover bg-stone-100 border border-stone-200 shrink-0 rounded-sm"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-stone-100 border border-dashed border-stone-200 shrink-0 rounded-sm" />
                    )}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <span
                        className={cn(
                          "inline-flex text-[9px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full border",
                          statusTone(review.status),
                        )}
                      >
                        {review.status}
                      </span>
                      <p className="text-[12px] font-semibold text-stone-800 leading-snug">
                        {product?.name || "Deleted product"}
                      </p>
                    </div>
                  </div>

                  <div className="p-3.5 space-y-3 flex-1">
                    <div className="min-w-0">
                      <p className="text-sm font-serif text-stone-800 truncate">
                        {review.name}
                      </p>
                      <p className="text-[11px] text-stone-500 truncate mt-0.5">
                        {review.email}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <Stars rating={Number(review.rating) || 0} />
                      <span className="text-[10px] uppercase tracking-widest font-bold text-stone-400">
                        {new Date(review.createdAt).toLocaleDateString("en-GB")}
                      </span>
                    </div>

                    {review.comment ? (
                      <p className="text-[12px] text-stone-600 leading-relaxed border-t border-stone-100 pt-3">
                        {review.comment}
                      </p>
                    ) : null}
                  </div>

                  <div className="p-3 pt-0 mt-auto">
                    <Link
                      href={`/admin/reviews/${review._id}`}
                      className="inline-flex w-full items-center justify-center rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5 text-[10px] uppercase tracking-widest font-bold text-stone-700 hover:bg-white hover:border-primary/30 transition-colors"
                    >
                      Open review
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block bg-white admin-panel-elevated overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left min-w-225">
                <thead>
                  <tr className="admin-table-head font-semibold tracking-[0.12em]">
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Product</th>
                    <th className="px-4 py-2.5">Customer</th>
                    <th className="px-4 py-2.5">Rating</th>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {reviews.map((review: any) => {
                    const product = review.product;
                    const image = product
                      ? getProductDisplayImage(product.images)
                      : "";
                    return (
                      <tr
                        key={review._id}
                        className="group hover:bg-secondary/5 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex text-[9px] uppercase tracking-widest font-bold px-3 py-1 rounded-full border",
                              statusTone(review.status),
                            )}
                          >
                            {review.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={image}
                                alt=""
                                className="w-11 h-11 object-cover bg-stone-100 border border-stone-200 shrink-0 rounded-sm"
                              />
                            ) : (
                              <div className="w-11 h-11 bg-stone-100 border border-dashed border-stone-200 shrink-0 rounded-sm" />
                            )}
                            <span className="text-sm font-medium text-stone-800 max-w-60">
                              {product?.name || "Deleted product"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-serif text-stone-800 truncate">
                              {review.name}
                            </span>
                            <span className="text-[10px] text-stone-500 truncate">
                              {review.email}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Stars rating={Number(review.rating) || 0} />
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-stone-600 font-medium">
                            {new Date(review.createdAt).toLocaleDateString(
                              "en-GB",
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/admin/reviews/${review._id}`}
                            className="inline-flex items-center justify-center rounded-md border border-stone-200 bg-stone-50 px-4 py-2 text-[10px] uppercase tracking-widest font-bold text-stone-700 hover:bg-white hover:border-primary/30 hover:text-primary transition-colors"
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {totalPages > 1 ? (
        <div className="bg-white admin-panel-elevated overflow-hidden">
          <ReviewsPagination
            currentPage={currentPage}
            totalPages={totalPages}
            status={status}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Server-friendly pagination that preserves status query */
function ReviewsPagination({
  currentPage,
  totalPages,
  status,
}: {
  currentPage: number;
  totalPages: number;
  status: string;
}) {
  const hrefFor = (page: number) => {
    const qs = new URLSearchParams();
    qs.set("page", String(page));
    if (status) qs.set("status", status);
    return `/admin/reviews?${qs.toString()}`;
  };

  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
    if (totalPages <= 5) return i + 1;
    if (currentPage <= 3) return i + 1;
    if (currentPage >= totalPages - 2) return totalPages - 4 + i;
    return currentPage - 2 + i;
  });

  return (
    <div className="flex flex-col items-center gap-2.5 px-3 sm:px-4 py-3">
      <div className="flex items-center justify-center gap-1.5 flex-wrap">
        <Link
          href={hrefFor(Math.max(1, currentPage - 1))}
          aria-disabled={currentPage === 1}
          className={cn(
            "p-1.5 border border-primary/10 bg-white rounded transition-all",
            currentPage === 1
              ? "pointer-events-none opacity-30"
              : "hover:bg-primary hover:text-white",
          )}
        >
          <span className="sr-only">Previous</span>
          <span aria-hidden className="block w-3.5 text-center text-sm leading-none">
            ‹
          </span>
        </Link>

        {pages.map((pageNum) => (
          <Link
            key={pageNum}
            href={hrefFor(pageNum)}
            className={cn(
              "w-7 h-7 flex items-center justify-center text-[10px] uppercase font-bold tracking-widest border rounded transition-all",
              currentPage === pageNum
                ? "bg-primary text-white border-primary"
                : "bg-white border-primary/10 hover:border-primary/30 text-primary/60 hover:text-primary",
            )}
          >
            {pageNum}
          </Link>
        ))}

        <Link
          href={hrefFor(Math.min(totalPages, currentPage + 1))}
          aria-disabled={currentPage === totalPages}
          className={cn(
            "p-1.5 border border-primary/10 bg-white rounded transition-all",
            currentPage === totalPages
              ? "pointer-events-none opacity-30"
              : "hover:bg-primary hover:text-white",
          )}
        >
          <span className="sr-only">Next</span>
          <span aria-hidden className="block w-3.5 text-center text-sm leading-none">
            ›
          </span>
        </Link>
      </div>
      <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-primary/60 text-center">
        Page <span className="text-primary">{currentPage}</span> of{" "}
        <span className="text-primary">{totalPages}</span>
      </p>
    </div>
  );
}
