import { StatusUpdater } from "@/components/admin/StatusUpdater";
import { getQuery } from "@/app/actions/contact";
import Link from "next/link";
import {
  ChevronRight,
  ArrowLeft,
  Mail,
  User,
  Calendar,
  MessageSquare,
  Package,
  BadgeCheck,
  Tag,
} from "lucide-react";
import { notFound } from "next/navigation";
import { cn } from "@/lib/utils";

export default async function QueryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const query = await getQuery(id);

  if (!query) {
    notFound();
  }

  return (
    <div className="max-w-7xl mx-auto admin-page">
      <header className="space-y-6">
        <Link
          href="/admin/queries"
          className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-80 hover:opacity-800 transition-opacity"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Inquiries
        </Link>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 pt-4 border-t border-stone-200">
          <div className="space-y-2">
            <h1 className="text-lg font-serif text-primary">
              {query.subject}
            </h1>
            <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest font-bold opacity-80">
              <span
                className={cn(
                  "px-2 py-0.5 rounded-sm border",
                  query.status === "pending"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : query.status === "replied"
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-gray-200 bg-gray-50 text-gray-700",
                )}
              >
                {query.status}
              </span>
              <span>Ref: {query._id.slice(-8).toUpperCase()}</span>
            </div>
          </div>

          <StatusUpdater id={id} currentStatus={query.status} />
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
        <div className="md:col-span-2 space-y-5">
          <div className="bg-white p-4 sm:p-5 border border-stone-200 space-y-5 shadow-sm">
            <div className="space-y-4">
              <h3 className="text-[10px] text-primary uppercase tracking-[0.16em] font-bold opacity-80 border-b border-primary/10 pb-4">
                Message
              </h3>
              <p className="text-base text-stone-800 leading-relaxed whitespace-pre-wrap font-serif italic">
                "{query.message}"
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="bg-secondary/30 p-8 border border-stone-200/80 space-y-5">
            <h3 className="text-[10px] uppercase tracking-[0.16em] font-bold">
              Sender profile
            </h3>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <User className="w-4 h-4 mt-1 opacity-80" />
                <div>
                  <p className="text-[9px] uppercase tracking-widest font-bold opacity-80">
                    Name
                  </p>
                  <p className="text-sm font-medium">{query.name}</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <Mail className="w-4 h-4 mt-1 opacity-80" />
                <div>
                  <p className="text-[9px] uppercase tracking-widest font-bold opacity-80">
                    Email
                  </p>
                  <p className="text-sm font-medium">{query.email}</p>
                  <a
                    href={`mailto:${query.email}`}
                    className="text-[9px] uppercase tracking-widest font-bold text-blue-600 hover:underline mt-1 inline-block"
                  >
                    Reply via Email
                  </a>
                </div>
              </div>

              {query.account ? (
                <div className="flex items-start gap-4">
                  <BadgeCheck className="w-4 h-4 mt-1 text-emerald-600" />
                  <div>
                    <p className="text-[9px] uppercase tracking-widest font-bold opacity-80">
                      Registered account
                    </p>
                    <p className="text-sm font-medium">
                      {query.account.name || query.account.email}
                    </p>
                    <p className="text-[10px] opacity-70">
                      Customer since{" "}
                      {new Date(query.account.createdAt).toLocaleDateString(
                        "en-GB",
                        { month: "short", year: "numeric" },
                      )}
                    </p>
                  </div>
                </div>
              ) : null}

              {query.productName ? (
                <div className="flex items-start gap-4">
                  <Tag className="w-4 h-4 mt-1 opacity-80" />
                  <div>
                    <p className="text-[9px] uppercase tracking-widest font-bold opacity-80">
                      Product enquired about
                    </p>
                    <p className="text-sm font-medium">{query.productName}</p>
                  </div>
                </div>
              ) : null}

              <div className="flex items-start gap-4">
                <Calendar className="w-4 h-4 mt-1 opacity-80" />
                <div>
                  <p className="text-[9px] uppercase tracking-widest font-bold opacity-80">
                    Submitted
                  </p>
                  <p className="text-sm font-medium">
                    {new Date(query.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Order-aware support: matched on the linked account, or on the
              email address for guest checkouts. */}
          <div className="bg-white p-6 border border-stone-200/80 mt-6">
            <h3 className="text-[10px] uppercase tracking-[0.16em] font-bold opacity-80 mb-6">
              Recent orders
            </h3>

            {query.orders?.length ? (
              <div className="space-y-3">
                {query.orders.map((order: any) => (
                  <Link
                    key={order.id}
                    href={`/admin/orders/${order.id}`}
                    className="flex items-start gap-4 p-3 border border-stone-200/80 hover:border-stone-400 transition-colors"
                  >
                    <Package className="w-4 h-4 mt-0.5 opacity-80 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        #{order.orderNumber}
                      </p>
                      <p className="text-[10px] uppercase tracking-widest opacity-70 mt-0.5">
                        {order.status} · {order.itemCount} item
                        {order.itemCount === 1 ? "" : "s"} · £
                        {Number(order.totalAmount || 0).toFixed(2)}
                      </p>
                      <p className="text-[10px] opacity-60 mt-0.5">
                        {new Date(order.createdAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-xs opacity-70">
                No orders found for this customer.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
