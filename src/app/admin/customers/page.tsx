"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Search,
  ChevronDown,
  Mail,
  MapPin,
  UserPlus,
  ExternalLink,
  Diamond,
  Zap,
  Clock,
} from "lucide-react";

const DUMMY_CUSTOMERS = [
  {
    id: "CUST-7842",
    name: "Julianne Moore",
    email: "j.moore@studio.com",
    location: "London, UK",
    ltv: 14500,
    orders: 12,
    role: "VIP",
    joined: "Oct 2024",
    status: "Active",
  },
  {
    id: "CUST-2391",
    name: "Sebastian Vanc",
    email: "vanc@arch.com",
    location: "Milan, IT",
    ltv: 2890,
    orders: 3,
    role: "Regular",
    joined: "Jan 2025",
    status: "Active",
  },
  {
    id: "CUST-9012",
    name: "Elena Rigby",
    email: "elena@home.co",
    location: "Paris, FR",
    ltv: 2100,
    orders: 1,
    role: "Regular",
    joined: "Feb 2026",
    status: "New",
  },
];

export default function CustomersPage() {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredCustomers = DUMMY_CUSTOMERS.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.email.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="space-y-24 pb-32 animate-in fade-in duration-1000">
      {/* Header */}
      <header className="flex items-center justify-between gap-8">
        <div className="space-y-2">
          <h1 className="text-5xl font-serif tracking-tight text-[#333] font-bold">
            Customers
          </h1>
          <p className="text-[10px] uppercase tracking-[0.5em] font-black opacity-40">
            Customer Directory v3.4
          </p>
        </div>
        <button className="bg-[#333] hover:bg-black text-white px-10 py-4 transition-all shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)] flex items-center gap-4 group overflow-hidden relative">
          <div className="relative z-10 flex items-center gap-4">
            <UserPlus className="w-5 h-5 transition-transform duration-500 group-hover:scale-110" />
            <span className="text-[11px] uppercase tracking-[0.4em] font-black">
              Add Customer
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20" />
        </button>
      </header>

      {/* Analytics Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
        <div className="bg-white p-12 border border-[#333]/5 shadow-sm group hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4 mb-6 opacity-40 group-hover:opacity-100 transition-opacity">
            <Diamond className="w-4 h-4" />
            <p className="text-[9px] uppercase tracking-[0.4em] font-black">
              Total Revenue
            </p>
          </div>
          <p className="text-4xl font-serif text-[#333]">£1,248,500</p>
          <div className="mt-6 flex items-center gap-2">
            <span className="text-green-600 text-[10px] font-black tracking-widest">
              +12.4%
            </span>
            <span className="text-[9px] uppercase tracking-widest opacity-20 font-black">
              vs last month
            </span>
          </div>
        </div>
        <div className="bg-white p-12 border border-[#333]/5 shadow-sm group hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4 mb-6 opacity-40 group-hover:opacity-100 transition-opacity">
            <Zap className="w-4 h-4" />
            <p className="text-[9px] uppercase tracking-[0.4em] font-black">
              Active Customers
            </p>
          </div>
          <p className="text-4xl font-serif text-[#333]">4,821</p>
          <div className="mt-6 flex items-center gap-2">
            <span className="text-[#333] text-[10px] font-black tracking-widest">
              84% RETENTION
            </span>
          </div>
        </div>
        <div className="bg-white p-12 border border-[#333]/5 shadow-sm group hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4 mb-6 opacity-40 group-hover:opacity-100 transition-opacity">
            <Clock className="w-4 h-4" />
            <p className="text-[9px] uppercase tracking-[0.4em] font-black">
              Avg Support Response
            </p>
          </div>
          <p className="text-4xl font-serif text-[#333]">4.2 HRS</p>
          <div className="mt-6 flex items-center gap-2 text-[9px] uppercase tracking-widest opacity-20 font-black">
            OPTIMIZED
          </div>
        </div>
      </div>

      {/* Refined Minimalist Search Bar */}
      <div className="bg-white border border-[#333]/80 px-8 py-5 flex items-center gap-6 shadow-[0_10px_30px_-15px_rgba(0,0,0,0.1)] group transition-all duration-700 hover:shadow-[0_15px_40px_-15px_rgba(0,0,0,0.15)] mb-12">
        <div className="shrink-0">
          <Search className="w-5 h-5 text-[#333] group-focus-within:opacity-100 transition-opacity" />
        </div>
        <div className="grow">
          <input
            type="search"
            placeholder="Search customers..."
            className="w-full bg-transparent placeholder:text-gray-400 text-lg font-serif tracking-wide text-[#333] outline-none transition-all uppercase"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button className="flex items-center gap-3 px-6 py-2 border-l border-[#333]/80 text-[10px] uppercase tracking-[0.4em] font-black text-[#333] hover:text-[#333] transition-all group/btn">
          <span>Filters</span>
          <ChevronDown className="w-4 h-4 opacity-40 group-hover/btn:opacity-100 transition-all shrink-0" />
        </button>
      </div>

      {/* Table Remodel */}
      <div className="bg-white shadow-[0_10px_30px_-15px_rgba(0,0,0,0.5)] border border-[#333]/5 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#333] text-white font-black text-[12px] uppercase tracking-[0.2em]">
              <th className="px-10 py-5">Customer</th>
              <th className="px-10 py-5">Location</th>
              <th className="px-10 py-5">Orders</th>
              <th className="px-10 py-5">Spent (LTV)</th>
              <th className="px-10 py-5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#333]/10">
            {filteredCustomers.map((customer) => (
              <tr
                key={customer.id}
                className="group hover:bg-secondary/5 transition-all duration-500"
              >
                <td className="px-10 py-8">
                  <div className="flex items-center gap-8">
                    <div className="w-14 h-14 bg-secondary/30 flex items-center justify-center font-serif text-lg text-[#333]/40 border border-[#333]/5 relative overflow-hidden group-hover:bg-[#333] group-hover:text-white transition-all duration-700 shadow-sm">
                      {customer.name.charAt(0)}
                    </div>
                    <div>
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="text-base font-serif tracking-wide text-[#333] hover:underline"
                      >
                        {customer.name}
                      </Link>
                      <p className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-30 mt-1 flex items-center gap-2">
                        <Mail className="w-2.5 h-2.5" /> {customer.email}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-10 py-8 text-[11px] uppercase tracking-[0.3em] font-bold text-[#333]/50">
                  <div className="flex items-center gap-3">
                    <MapPin className="w-3.5 h-3.5 opacity-40" />
                    {customer.location}
                  </div>
                </td>
                <td className="px-10 py-8">
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-widest font-bold text-[#333]">
                      {customer.orders} orders
                    </p>
                    <p className="text-[9px] uppercase tracking-[0.4em] opacity-20 font-bold">
                      SINCE {customer.joined}
                    </p>
                  </div>
                </td>
                <td className="px-10 py-8">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-serif text-[#333]">
                      £{customer.ltv.toLocaleString()}
                    </span>
                    {customer.role === "VIP" && (
                      <span className="text-[8px] uppercase tracking-[0.5em] font-bold px-2 py-1 bg-amber-50 text-amber-700 border border-amber-100">
                        PLATINUM
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-10 py-8 text-right">
                  <Link
                    href={`/admin/customers/${customer.id}`}
                    className="inline-flex p-3 bg-secondary/10 hover:bg-[#333] hover:text-white transition-all opacity-40 group-hover:opacity-100 shadow-sm"
                  >
                    <ExternalLink className="w-5 h-5 " />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
