import React from "react";
import Link from "next/link";
import { ChevronRight, Mail, Calendar, User } from "lucide-react";
import { getSubscribers } from "@/app/actions/newsletter";

export default async function SubscribersPage() {
  const subscribers = await getSubscribers();

  return (
    <div className="max-w-6xl mx-auto space-y-8 lg:space-y-12 pb-20 animate-in fade-in duration-700 px-4 sm:px-0 text-[#333]">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 lg:gap-2 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] lg:tracking-[0.3em] font-bold text-[#333]/40">
        <Link href="/admin" className="hover:text-[#333] transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="w-2.5 h-2.5" />
        <span className="text-[#333]">Subscribers</span>
      </nav>

      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 lg:gap-8">
        <div className="space-y-2 lg:space-y-3">
          <h1 className="text-2xl lg:text-3xl font-serif tracking-normal text-[#333] font-bold">
            Newsletter Subscribers
          </h1>
          <p className="text-[9px] lg:text-[11px] uppercase tracking-[0.3em] lg:tracking-[0.4em] font-bold opacity-40">
            Total of {subscribers.length} unique entries in the inner circle.
          </p>
        </div>
      </header>

      {/* Content */}
      <div className="bg-white border border-[#333]/5 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#333]/5 bg-secondary/10">
                <th className="px-6 py-4 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] font-bold opacity-60">
                  <div className="flex items-center gap-2">
                    <User className="w-3 h-3" />
                    Email Address
                  </div>
                </th>
                <th className="px-6 py-4 text-[9px] lg:text-[10px] uppercase tracking-[0.2em] font-bold opacity-60">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3 h-3" />
                    Subscribed On
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#333]/5">
              {subscribers.length > 0 ? (
                subscribers.map((sub: any) => (
                  <tr
                    key={sub._id}
                    className="hover:bg-secondary/5 transition-colors"
                  >
                    <td className="px-6 py-5 text-sm font-sans tracking-wide text-[#333]">
                      {sub.email}
                    </td>
                    <td className="px-6 py-5 text-xs text-[#333]/60 font-medium">
                      {new Date(sub.createdAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-3 opacity-40">
                      <Mail className="w-8 h-8 stroke-1" />
                      <p className="text-[9px] uppercase tracking-[0.2em] font-bold">
                        No subscribers yet
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
