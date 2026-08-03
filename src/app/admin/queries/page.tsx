import { RealtimeInquiryList } from "@/components/admin/RealtimeInquiryList";
import { getQueries } from "@/app/actions/contact";
import Link from "next/link";
import {
  MessageSquare,
  Calendar,
  User,
  Mail,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Pagination } from "@/components/admin/InquiryPagination";

export const dynamic = "force-dynamic";

export default async function QueriesPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const currentPage = parseInt(searchParams.page || "1");
  const itemsPerPage = 10;
  const { queries, totalCount } = await getQueries(currentPage, itemsPerPage);
  const totalPages = Math.ceil(totalCount / itemsPerPage);

  return (
    <RealtimeInquiryList>
      <div className="admin-page">
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="space-y-3 lg:space-y-4">
            <h1 className="admin-page-title font-serif text-primary">
              Customer Inquiries
            </h1>
          </div>
        </header>

        <div className="bg-white border border-stone-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-stone-200">
                  <th className="px-4 py-3 text-[10px] uppercase tracking-[0.12em] font-bold opacity-80">
                    Status
                  </th>
                  <th className="px-4 py-3 text-[10px] uppercase tracking-[0.12em] font-bold opacity-80">
                    Customer
                  </th>
                  <th className="px-4 py-3 text-[10px] uppercase tracking-[0.12em] font-bold opacity-80">
                    Subject
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
                {queries.map((query: any) => (
                  <tr
                    key={query._id}
                    className="border-b border-stone-200/80 hover:bg-secondary/10 transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "text-[9px] uppercase tracking-widest font-bold px-3 py-1 rounded-full border",
                          query.status === "pending"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : query.status === "replied"
                              ? "border-green-200 bg-green-50 text-green-700"
                              : "border-gray-200 bg-gray-50 text-gray-700",
                        )}
                      >
                        {query.status}
                      </span>
                      {query.notificationFailed && (
                        <span
                          title="This enquiry was saved but the staff notification email failed to send."
                          className="mt-1 block text-[9px] uppercase tracking-widest font-bold px-3 py-1 rounded-full border border-red-200 bg-red-50 text-red-700"
                        >
                          Email failed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-sm font-serif text-stone-800">
                          {query.name}
                        </span>
                        <span className="text-[10px] opacity-80 uppercase tracking-widest">
                          {query.email}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-stone-800 font-medium line-clamp-1">
                        {query.subject}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-xs text-stone-800">
                          {new Date(query.createdAt).toLocaleDateString()}
                        </span>
                        <span className="text-[10px] opacity-80 uppercase tracking-widest">
                          {new Date(query.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/queries/${query._id}`}
                        className="text-[9px] uppercase tracking-widest font-bold opacity-80 hover:opacity-800 hover:text-primary transition-all border-b border-transparent hover:border-stone-200 pb-1"
                      >
                        Open Inquiry
                      </Link>
                    </td>
                  </tr>
                ))}
                {queries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <div className="flex flex-col items-center justify-center space-y-4 opacity-80">
                        <MessageSquare className="w-12 h-12 stroke-1" />
                        <p className="text-[10px] uppercase tracking-[0.12em] font-bold">
                          No Inquiries Found
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            className="border-t border-stone-200 px-4"
          />
        </div>
      </div>
    </RealtimeInquiryList>
  );
}
