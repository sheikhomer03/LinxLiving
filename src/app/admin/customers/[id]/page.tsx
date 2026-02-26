"use client";

import React, { useState, use } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  Mail,
  MapPin,
  Calendar,
  CreditCard,
  Package,
  ArrowUpRight,
  Shield,
  Clock,
  ChevronRight,
  CheckCircle2,
  Truck,
} from "lucide-react";
import Image from "next/image";

const DUMMY_ORDERS = [
  {
    id: "ORD-9921",
    date: "24 FEB 2026",
    status: "Delivered",
    amount: "£4,200.00",
    items: 3,
  },
  {
    id: "ORD-8812",
    date: "12 JAN 2026",
    status: "Shipped",
    amount: "£1,850.00",
    items: 1,
  },
  {
    id: "ORD-7102",
    date: "03 NOV 2025",
    status: "Delivered",
    amount: "£8,450.00",
    items: 8,
  },
];

export default function PatronProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const unwrappedParams = use(params);
  const patronId = unwrappedParams.id;

  return (
    <div className="max-w-[1400px] mx-auto space-y-20 pb-40 animate-in fade-in duration-1000">
      {/* Editorial Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between border-b border-[#333]/10 pb-16 gap-12">
        <div className="space-y-8">
          <Link
            href="/admin/customers"
            className="flex items-center gap-4 text-[10px] uppercase tracking-[0.5em] font-black opacity-30 hover:opacity-100 transition-all group"
          >
            <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
            Registry
          </Link>
          <div className="space-y-4">
            <div className="flex items-center gap-6">
              <div className="w-24 h-24 bg-[#333] text-white flex items-center justify-center font-serif text-4xl shadow-2xl">
                J
              </div>
              <div className="space-y-1">
                <h1 className="text-7xl font-serif uppercase tracking-tight text-[#333]">
                  Julianne Moore
                </h1>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] uppercase tracking-[0.5em] font-black px-4 py-2 bg-[#333] text-white">
                    Elite Platinum
                  </span>
                  <p className="text-[10px] uppercase tracking-[0.4em] font-black opacity-30">
                    REF: {patronId}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-16 pb-4">
          <div className="space-y-2">
            <p className="text-[9px] uppercase tracking-[0.4em] font-black opacity-30">
              Patron LTV
            </p>
            <p className="text-3xl font-serif text-[#333]">£14,500.00</p>
          </div>
          <div className="w-px h-12 bg-[#333]/10" />
          <div className="space-y-2">
            <p className="text-[9px] uppercase tracking-[0.4em] font-black opacity-30">
              Chronicles
            </p>
            <p className="text-3xl font-serif text-[#333]">12</p>
          </div>
        </div>
      </header>

      {/* Profile Studio Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
        {/* Left Column: Essential Dossier */}
        <div className="lg:col-span-4 space-y-12">
          <section className="bg-white p-12 shadow-[0_20px_50px_rgba(0,0,0,0.03)] border border-[#333]/5 space-y-10">
            <h2 className="text-[11px] uppercase tracking-[0.6em] font-black text-[#333] opacity-40 pb-6 border-b border-[#333]/5">
              Patron Essence
            </h2>
            <div className="space-y-10 text-[10px] uppercase tracking-[0.4em] font-black">
              <div className="flex items-center gap-6 group">
                <Mail className="w-4 h-4 opacity-20 group-hover:opacity-100 transition-opacity" />
                <span className="text-[#333]">j.moore@studio.com</span>
              </div>
              <div className="flex items-center gap-6 group">
                <MapPin className="w-4 h-4 opacity-20 group-hover:opacity-100 transition-opacity" />
                <span className="text-[#333]">LONDON, UNITED KINGDOM</span>
              </div>
              <div className="flex items-center gap-6 group">
                <Calendar className="w-4 h-4 opacity-20 group-hover:opacity-100 transition-opacity" />
                <span className="text-[#333]">JOINED OCTOBER 2024</span>
              </div>
            </div>
          </section>

          <section className="bg-white p-12 shadow-[0_20px_50px_rgba(0,0,0,0.03)] border border-[#333]/5 space-y-10">
            <h2 className="text-[11px] uppercase tracking-[0.6em] font-black text-[#333] opacity-40 pb-6 border-b border-[#333]/5">
              Registry Roles
            </h2>
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest font-black text-[#333]">
                  Elite Status
                </span>
                <div className="w-12 h-6 bg-[#333] rounded-full relative cursor-pointer flex items-center justify-end px-1 shadow-inner">
                  <div className="w-4 h-4 bg-white rounded-full shadow-md" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest font-black text-[#333]">
                  Admin Access
                </span>
                <div className="w-12 h-6 bg-secondary/30 rounded-full relative cursor-pointer flex items-center px-1">
                  <div className="w-4 h-4 bg-white rounded-full shadow-sm" />
                </div>
              </div>
            </div>
          </section>

          <div className="bg-[#333] p-12 space-y-8 shadow-2xl">
            <h3 className="text-white font-serif text-xl tracking-wide uppercase">
              Curation Note
            </h3>
            <p className="text-[10px] uppercase tracking-[0.3em] leading-relaxed text-white/40 font-black">
              Preferential focus on stone artifacts and matte ceramics. High
              sensitivity to aesthetic precision.
            </p>
            <button className="w-full py-4 border border-white/10 text-[9px] uppercase tracking-[0.5em] text-white font-black hover:bg-white/5 transition-colors">
              Append Dossier
            </button>
          </div>
        </div>

        {/* Right Column: Transaction Archive */}
        <div className="lg:col-span-8 space-y-16">
          <section className="bg-white p-12 shadow-[0_20px_50px_rgba(0,0,0,0.03)] border border-[#333]/5 space-y-12">
            <div className="flex items-center justify-between pb-8 border-b border-[#333]/5">
              <h2 className="text-[12px] uppercase tracking-[0.6em] font-black text-[#333] opacity-40">
                Transaction Archive
              </h2>
              <p className="text-[10px] uppercase tracking-widest font-black opacity-20">
                Full History
              </p>
            </div>

            <div className="divide-y divide-[#333]/5">
              {DUMMY_ORDERS.map((order) => (
                <Link
                  key={order.id}
                  href={`/admin/orders/${order.id}`}
                  className="flex items-center justify-between py-10 group hover:px-6 transition-all duration-700"
                >
                  <div className="space-y-3">
                    <p className="text-[11px] uppercase tracking-[0.4em] font-black text-[#333]">
                      #{order.id} • {order.date}
                    </p>
                    <div className="flex items-center gap-4 text-[10px] uppercase tracking-[0.3em] font-black opacity-30">
                      <Package className="w-4 h-4" />
                      {order.items} ITEMS ENCAPSULATED
                    </div>
                  </div>

                  <div className="flex items-center gap-16">
                    <div className="text-right space-y-2">
                      <p className="text-2xl font-serif text-[#333]">
                        {order.amount}
                      </p>
                      <div className="flex items-center justify-end gap-3 uppercase tracking-widest font-black text-[9px]">
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${order.status === "Delivered" ? "bg-green-500" : "bg-amber-500"}`}
                        />
                        <span className="opacity-40">{order.status}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-6 h-6 opacity-10 group-hover:opacity-100 group-hover:translate-x-2 transition-all duration-700" />
                  </div>
                </Link>
              ))}
            </div>

            <button className="w-full py-8 text-[11px] uppercase tracking-[0.6em] font-black opacity-30 hover:opacity-100 transition-all border-t border-[#333]/5">
              Load Complete Chronicle
            </button>
          </section>

          {/* Preference Snapshots */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <section className="bg-white p-10 border border-[#333]/5 space-y-8 shadow-sm">
              <h3 className="text-[10px] uppercase tracking-[0.5em] font-black opacity-40">
                Acquisition Trends
              </h3>
              <div className="space-y-6">
                {["Stone Classics", "Minimalist Ceramics", "Lighting"].map(
                  (cat) => (
                    <div key={cat} className="space-y-3">
                      <div className="flex justify-between text-[10px] uppercase tracking-widest font-black">
                        <span className="opacity-40">{cat}</span>
                        <span className="text-[#333]">70%</span>
                      </div>
                      <div className="h-0.5 w-full bg-secondary/20">
                        <div className="h-full bg-[#333] w-[70%]" />
                      </div>
                    </div>
                  ),
                )}
              </div>
            </section>

            <div className="bg-[#fafafa] p-10 border border-[#333]/5 flex items-center justify-center text-center group cursor-pointer hover:bg-white transition-all duration-700">
              <div className="space-y-6">
                <ArrowUpRight className="w-8 h-8 mx-auto opacity-10 group-hover:opacity-100 group-hover:scale-110 transition-all duration-700" />
                <p className="text-[10px] uppercase tracking-[0.4em] font-black opacity-30">
                  Export Aesthetic Analysis
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
