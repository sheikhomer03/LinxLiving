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
    <div className="max-w-4xl mx-auto space-y-10 lg:space-y-12">
      <header className="space-y-6">
        <Link
          href="/admin/queries"
          className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Inquiries
        </Link>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 pt-4 border-t border-[#333]/10">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-serif text-[#333]">
              {query.subject}
            </h1>
            <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest font-bold opacity-40">
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
        <div className="md:col-span-2 space-y-8">
          <div className="bg-white p-8 lg:p-12 border border-[#333]/10 space-y-10 shadow-sm">
            <div className="space-y-4">
              <h3 className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-40 border-b border-[#333]/10 pb-4">
                Enquiry Content
              </h3>
              <p className="text-base text-[#333] leading-relaxed whitespace-pre-wrap font-serif italic">
                "{query.message}"
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-secondary/30 p-8 border border-[#333]/5 space-y-8">
            <h3 className="text-[10px] uppercase tracking-[0.3em] font-bold">
              Sender profile
            </h3>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <User className="w-4 h-4 mt-1 opacity-40" />
                <div>
                  <p className="text-[9px] uppercase tracking-widest font-bold opacity-40">
                    Name
                  </p>
                  <p className="text-sm font-medium">{query.name}</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <Mail className="w-4 h-4 mt-1 opacity-40" />
                <div>
                  <p className="text-[9px] uppercase tracking-widest font-bold opacity-40">
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

              <div className="flex items-start gap-4">
                <Calendar className="w-4 h-4 mt-1 opacity-40" />
                <div>
                  <p className="text-[9px] uppercase tracking-widest font-bold opacity-40">
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
        </div>
      </div>
    </div>
  );
}
