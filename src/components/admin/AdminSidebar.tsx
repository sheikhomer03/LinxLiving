"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  CreditCard,
  X,
  Layers,
  Mail,
  MessageSquare,
  Ticket,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "next-auth/react";
import { getStoreName } from "@/app/actions/settings";

const NAV_ITEMS = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Orders", href: "/admin/orders", icon: ShoppingBag },
  { name: "Products", href: "/admin/products", icon: Package },
  { name: "Collections", href: "/admin/collections", icon: Layers },
  { name: "Customers", href: "/admin/customers", icon: Users },
  { name: "Subscribers", href: "/admin/subscribers", icon: Mail },
  { name: "Messages", href: "/admin/queries", icon: MessageSquare },
  { name: "Coupons", href: "/admin/coupons", icon: Ticket },
  { name: "Payments", href: "/admin/transactions", icon: CreditCard },
  { name: "Settings", href: "/admin/settings", icon: Settings },
];

interface AdminSidebarProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export function AdminSidebar({ isOpen, setIsOpen }: AdminSidebarProps) {
  const pathname = usePathname();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [storeName, setStoreName] = useState("Linx Living");

  useEffect(() => {
    getStoreName().then(setStoreName);
  }, []);

  const router = useRouter();

  return (
    <>
      {/* Mobile Overlay */}
      <div
        className={cn(
          "fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-500",
          isOpen
            ? "opacity-800 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        onClick={() => setIsOpen(false)}
      />

      <aside
        className={cn(
          "bg-white border-r border-[#333]/10 flex flex-col h-screen fixed lg:sticky top-0 z-50 transition-all duration-500 ease-in-out",
          isCollapsed ? "w-20" : "w-72",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Toggle / Close Button */}
        <button
          onClick={() => {
            if (window.innerWidth < 1024) {
              setIsOpen(false);
            } else {
              setIsCollapsed(!isCollapsed);
            }
          }}
          className="absolute -right-3 top-10 w-6 h-6 bg-white border border-[#333]/10 rounded-full hidden lg:flex items-center justify-center z-50 hover:bg-[#333] hover:text-white transition-all shadow-sm"
        >
          {isOpen ? (
            <X className="w-3 h-3" />
          ) : (
            <ChevronRight
              className={cn(
                "w-3 h-3 transition-transform duration-300",
                !isCollapsed && "rotate-180",
              )}
            />
          )}
        </button>

        <div
          className={cn(
            "p-8 border-b border-[#333]/5 overflow-hidden",
            isCollapsed && "px-4",
          )}
        >
          <div className="hidden">
            <span className="text-[10px] uppercase tracking-widest font-black opacity-90">
              Navigation
            </span>
            <button onClick={() => setIsOpen(false)} className="p-1">
              <X className="w-4 h-4 opacity-80 hover:opacity-800" />
            </button>
          </div>
          <Link href="/" className="group" onClick={() => setIsOpen(false)}>
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "relative transition-all duration-500",
                  isCollapsed ? "w-12 h-12" : "w-32 h-16",
                )}
              >
                <img
                  src="/logo.png"
                  alt={storeName}
                  className="w-full h-full object-contain"
                />
              </div>
              {!isCollapsed && (
                <p className="text-[9px] uppercase tracking-[0.3em] font-bold mt-2 text-primary">
                  Admin Console
                </p>
              )}
            </div>
          </Link>
        </div>

        <nav
          className={`flex-1 space-y-2 overflow-y-auto custom-scrollbar overflow-x-hidden ${isCollapsed ? "p-3" : "p-4"}`}
        >
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={cn(
                  "flex items-center transition-all duration-300 group relative",
                  isCollapsed
                    ? "justify-center px-2 py-3"
                    : "justify-between px-4 py-3.5",
                  isActive
                    ? "bg-[#333] text-white shadow-lg"
                    : "text-[#333]/60 hover:text-[#333] hover:bg-primary/5",
                )}
                title={isCollapsed ? item.name : ""}
              >
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-primary" />
                )}

                <div
                  className={cn(
                    "flex items-center",
                    isCollapsed ? "gap-0" : "gap-4",
                  )}
                >
                  <item.icon
                    className={cn(
                      ` ${isCollapsed ? "w-[18px] h-[18px]" : "w-4 h-4"} stroke-2 transition-colors shrink-0`,
                      isActive
                        ? "text-primary"
                        : "text-[#333] group-hover:text-primary",
                    )}
                  />
                  {!isCollapsed && (
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-[0.25em] font-bold whitespace-nowrap",
                      )}
                    >
                      {item.name}
                    </span>
                  )}
                </div>
                {!isCollapsed && isActive && (
                  <ChevronRight className="w-4 h-4" />
                )}
              </Link>
            );
          })}
        </nav>

        <div
          className={cn(
            "p-6 border-t border-[#333]/10 bg-secondary/5",
            isCollapsed && "p-4",
          )}
        >
          <button
            onClick={() => setShowLogoutModal(true)}
            className={cn(
              "flex items-center justify-center gap-4 bg-white border border-[#333]/10 text-[#333] hover:bg-[#333] hover:text-white transition-all duration-500 group font-bold shadow-sm",
              isCollapsed
                ? "w-12 h-12 mx-auto rounded-full"
                : "w-full px-4 py-4",
            )}
            title={isCollapsed ? "Sign Out" : ""}
          >
            <LogOut className="w-5 h-5 stroke-2 group-hover:scale-110 transition-transform shrink-0" />
            {!isCollapsed && (
              <span className="text-[11px] uppercase tracking-[0.2em]">
                Sign Out
              </span>
            )}
          </button>
        </div>
      </aside>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white w-full max-w-md p-10 border border-[#333]/10 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="flex flex-col items-center text-center space-y-6">
              <div className="w-16 h-16 bg-secondary/50 rounded-full flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-[#333] opacity-80" />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-serif uppercase tracking-widest text-[#333]">
                  Exit Session
                </h2>
                <p className="text-[11px] uppercase tracking-[0.2em] font-bold opacity-80">
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
