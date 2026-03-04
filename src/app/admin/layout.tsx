"use client";

import { useState, useEffect } from "react";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { Menu, Search, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoreName } from "@/app/actions/settings";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [storeName, setStoreName] = useState("Linx");

  useEffect(() => {
    getStoreName().then(setStoreName);
  }, []);

  return (
    <div className="flex min-h-screen bg-[#fafafa]">
      <AdminSidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

      <main className="flex-1 flex flex-col min-w-0">
        {/* Responsive Mobile Header */}
        <header className="lg:hidden flex items-center justify-between px-6 py-4 bg-white border-b border-[#333]/10 sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 hover:bg-secondary/50 rounded-lg transition-colors"
          >
            <Menu className="w-6 h-6 text-[#333]" />
          </button>

          <h2 className="text-xl font-bold font-serif tracking-widest uppercase text-[#333]">
            {storeName}
          </h2>

          <div className="opacity-0">
            <button className="p-2 hover:bg-secondary/50 rounded-lg transition-colors">
              <Search className="w-5 h-5 text-[#333]/40" />
            </button>
          </div>
        </header>

        <div className="p-6 lg:p-10 flex-1 animate-in fade-in duration-700 max-w-[1600px] mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
