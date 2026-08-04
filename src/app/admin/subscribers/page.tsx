import React from "react";
import Link from "next/link";
import { ChevronRight, Mail, Calendar, User } from "lucide-react";
import { getSubscribers } from "@/app/actions/newsletter";

export default async function SubscribersPage() {
  const subscribers = await getSubscribers();

  return (
    <div className="max-w-6xl mx-auto admin-page pb-8 animate-in fade-in duration-300 px-4 sm:px-0 text-stone-800">
      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="space-y-2 lg:space-y-3">
          <h1 className="admin-page-title font-serif text-primary">
            Newsletter Subscribers
          </h1>
          <p className="text-[9px] lg:text-[11px] uppercase tracking-[0.16em] lg:tracking-[0.18em] font-bold opacity-80">
            Total of {subscribers.length} unique entries in the inner circle.
          </p>
        </div>
      </header>

      {/* Content */}
      <div className="bg-white border border-stone-200/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="admin-responsive-table w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-stone-200/80 bg-secondary/10">
                <th className="px-6 py-4 text-[9px] lg:text-[10px] uppercase tracking-[0.12em] font-bold opacity-90">
                  <div className="flex items-center gap-2">
                    <User className="w-3 h-3" />
                    Email Address
                  </div>
                </th>
                <th className="px-6 py-4 text-[9px] lg:text-[10px] uppercase tracking-[0.12em] font-bold opacity-90">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3 h-3" />
                    Subscribed On
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {subscribers.length > 0 ? (
                subscribers.map((sub: any) => (
                  <tr
                    key={sub._id}
                    className="hover:bg-secondary/5 transition-colors"
                  >
                    <td
                      data-label="Email"
                      className="px-6 py-2.5 text-sm font-sans tracking-wide text-stone-800 break-all"
                    >
                      {sub.email}
                    </td>
                    <td
                      data-label="Subscribed"
                      className="px-6 py-2.5 text-xs text-stone-500 font-medium"
                    >
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
                    <div className="flex flex-col items-center gap-3 opacity-80">
                      <Mail className="w-8 h-8 stroke-1" />
                      <p className="text-[9px] uppercase tracking-[0.12em] font-bold">
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
