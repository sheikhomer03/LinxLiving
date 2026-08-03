"use client";

import { useState, useEffect } from "react";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { Menu } from "lucide-react";
import { getStoreName } from "@/app/actions/settings";
import { useSession } from "next-auth/react";
import { ShopifyAdminAutoSync } from "@/components/admin/ShopifyAdminAutoSync";
import "@/styles/admin.css";

export default function AdminLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [storeName, setStoreName] = useState("Linx Square");
  const { data: session } = useSession();

  useEffect(() => {
    getStoreName().then(setStoreName);
  }, []);

  return (
    <div className="admin-app flex min-h-screen">
      <ShopifyAdminAutoSync />
      <AdminSidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-stone-200/80">
          <div className="flex items-center justify-between gap-3 px-4 lg:px-6 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-1.5 -ml-1 rounded-md hover:bg-stone-100 transition-colors"
                aria-label="Open menu"
              >
                <Menu className="w-4 h-4 text-stone-700" />
              </button>
              <div className="min-w-0">
                <p className="text-[9px] uppercase tracking-[0.2em] font-bold text-primary">
                  Admin Console
                </p>
                <h2 className="text-sm font-serif tracking-wide text-stone-800 truncate">
                  {storeName}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2.5 text-right shrink-0">
              <div className="hidden sm:block">
                <p className="text-[9px] uppercase tracking-[0.14em] font-bold text-stone-400">
                  Signed in
                </p>
                <p className="text-xs text-stone-700 font-medium truncate max-w-[140px]">
                  {session?.user?.name || "Administrator"}
                </p>
              </div>
              <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center text-[10px] font-bold text-primary uppercase">
                {(session?.user?.name || "A").charAt(0)}
              </div>
            </div>
          </div>
        </header>

        <div className="p-3 sm:p-5 lg:p-6 flex-1 animate-in fade-in duration-300 max-w-[1400px] mx-auto w-full min-w-0 overflow-x-clip">
          {children}
        </div>
      </main>
    </div>
  );
}
