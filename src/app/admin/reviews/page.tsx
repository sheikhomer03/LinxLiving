import { getAdminReviews } from "@/app/actions/reviews";
import Link from "next/link";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { getProductDisplayImage } from "@/lib/productImage";

export const dynamic = "force-dynamic";

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
    { label: "All", value: "" },
    { label: "Pending", value: "pending" },
    { label: "Approved", value: "approved" },
    { label: "Rejected", value: "rejected" },
  ];

  return (
    <div className="admin-page">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-2">
          <h1 className="admin-page-title font-serif text-primary">Reviews</h1>
          <p className="text-sm text-stone-500">
            Moderate customer reviews before they appear on product pages.
          </p>
        </div>
        <p className="text-[10px] uppercase tracking-widest font-bold opacity-60">
          {totalCount} total
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const href = f.value
            ? `/admin/reviews?status=${f.value}`
            : "/admin/reviews";
          const active = status === f.value;
          return (
            <Link
              key={f.label}
              href={href}
              className={cn(
                "px-4 py-2 text-[10px] uppercase tracking-widest font-bold border transition-colors",
                active
                  ? "bg-foreground text-background border-foreground"
                  : "border-stone-200 text-stone-600 hover:border-stone-400",
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="bg-white border border-stone-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-stone-200">
                <th className="px-4 py-3 text-[10px] uppercase tracking-[0.12em] font-bold opacity-80">
                  Status
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-[0.12em] font-bold opacity-80">
                  Product
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-[0.12em] font-bold opacity-80">
                  Customer
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-[0.12em] font-bold opacity-80">
                  Rating
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-[0.12em] font-bold opacity-80">
                  Date
                </th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-[0.12em] font-bold opacity-80 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((review: any) => {
                const product = review.product;
                const image = product
                  ? getProductDisplayImage(product.images)
                  : "";
                return (
                  <tr
                    key={review._id}
                    className="border-b border-stone-200/80 hover:bg-secondary/10 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "text-[9px] uppercase tracking-widest font-bold px-3 py-1 rounded-full border",
                          review.status === "pending"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : review.status === "approved"
                              ? "border-green-200 bg-green-50 text-green-700"
                              : "border-red-200 bg-red-50 text-red-700",
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
                            className="w-10 h-10 object-cover bg-secondary shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-secondary shrink-0" />
                        )}
                        <span className="text-sm font-medium line-clamp-2 max-w-[220px]">
                          {product?.name || "Deleted product"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-sm font-serif text-stone-800">
                          {review.name}
                        </span>
                        <span className="text-[10px] opacity-70">
                          {review.email}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 fill-stone-800 text-stone-800" />
                        <span className="text-sm font-semibold">
                          {review.rating}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-stone-700">
                        {new Date(review.createdAt).toLocaleDateString("en-GB")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/reviews/${review._id}`}
                        className="text-[9px] uppercase tracking-widest font-bold opacity-80 hover:opacity-100 hover:text-primary transition-all border-b border-transparent hover:border-stone-200 pb-1"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {reviews.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <p className="text-sm text-stone-500">No reviews found.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 ? (
        <div className="flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
            const qs = new URLSearchParams();
            qs.set("page", String(page));
            if (status) qs.set("status", status);
            return (
              <Link
                key={page}
                href={`/admin/reviews?${qs.toString()}`}
                className={cn(
                  "w-9 h-9 flex items-center justify-center text-xs border",
                  page === currentPage
                    ? "bg-foreground text-background border-foreground"
                    : "border-stone-200 hover:border-stone-400",
                )}
              >
                {page}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
