"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Users,
  ShoppingBag,
  Settings,
  LogOut,
  ChevronRight,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "next-auth/react";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
      { name: "Orders", href: "/admin/orders", icon: ShoppingBag },
    ],
  },
  {
    label: "Catalog",
    items: [
      { name: "Products", href: "/admin/products", icon: Package },
      { name: "Collections", href: "/admin/collections", icon: Package },
    ],
  },
  {
    label: "Management",
    items: [
      { name: "Customers", href: "/admin/customers", icon: Users },
      { name: "Settings", href: "/admin/settings", icon: Settings },
    ],
  },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  return (
    <>
      <aside className="w-72 bg-white border-r border-[#333]/10 flex flex-col h-screen sticky top-0 z-40">
        <div className="p-8 border-b border-[#333]/5">
          <Link href="/" className="group">
            <div className="flex items-center gap-3 mb-1">
              <Sparkles className="w-5 h-5 opacity-60 group-hover:rotate-12 transition-transform duration-500 text-[#333]" />
              <span className="text-[10px] uppercase tracking-[0.4em] font-bold opacity-40 group-hover:opacity-100 transition-opacity text-[#333]">
                Back to Store
              </span>
            </div>
            <h1 className="text-2xl font-serif tracking-[0.25em] uppercase text-[#333]">
              Aurelia
            </h1>
            <p className="text-[9px] uppercase tracking-[0.3em] font-bold mt-1 opacity-60 text-[#333]">
              Admin Console
            </p>
          </Link>
        </div>

        <nav className="flex-1 p-6 space-y-10 mt-4 overflow-y-auto custom-scrollbar">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="space-y-3">
              <h3 className="px-4 text-[9px] uppercase tracking-[0.4em] font-black text-[#333] opacity-50 mb-4">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={cn(
                        "flex items-center justify-between px-4 py-3.5 transition-all duration-300 group relative",
                        isActive
                          ? "bg-[#333] text-white shadow-lg"
                          : "text-[#333]/60 hover:text-[#333] hover:bg-secondary/30",
                      )}
                    >
                      {/* Active Accent Bar */}
                      {isActive && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-white" />
                      )}

                      <div className="flex items-center gap-4">
                        <item.icon
                          className={cn(
                            "w-4 h-4 stroke-2 transition-colors",
                            isActive
                              ? "text-white"
                              : "text-[#333] group-hover:text-[#333]",
                          )}
                        />
                        <span
                          className={cn(
                            "text-[10px] uppercase tracking-[0.25em] font-bold",
                            isActive ? "opacity-100" : "opacity-100",
                          )}
                        >
                          {item.name}
                        </span>
                      </div>
                      {isActive && (
                        <ChevronRight className="w-4 h-4 opacity-60" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-6 border-t border-[#333]/10 bg-secondary/5">
          <button
            onClick={() => setShowLogoutModal(true)}
            className="w-full flex items-center justify-center gap-4 px-4 py-4 bg-white border border-[#333]/10 text-[#333] hover:bg-[#333] hover:text-white transition-all duration-500 group font-bold shadow-sm"
          >
            <LogOut className="w-5 h-5 stroke-2 group-hover:scale-110 transition-transform" />
            <span className="text-[11px] uppercase tracking-[0.2em]">
              Sign Out
            </span>
          </button>
        </div>
      </aside>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white w-full max-w-md p-10 border border-[#333]/10 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="flex flex-col items-center text-center space-y-6">
              <div className="w-16 h-16 bg-secondary/50 rounded-full flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-[#333] opacity-40" />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-serif uppercase tracking-widest text-[#333]">
                  Exit Session
                </h2>
                <p className="text-[11px] uppercase tracking-[0.2em] font-bold opacity-40">
                  Are you sure you wish to leave your dashboard?
                </p>
              </div>

              <div className="flex flex-col w-full gap-3 pt-4">
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="w-full bg-[#333] text-white py-5 text-[10px] uppercase tracking-[0.3em] font-bold hover:bg-black transition-all shadow-lg"
                >
                  Confirm Sign Out
                </button>
                <button
                  onClick={() => setShowLogoutModal(false)}
                  className="w-full bg-white text-[#333] py-5 text-[10px] uppercase tracking-[0.3em] font-bold border border-[#333]/10 hover:bg-secondary/30 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
