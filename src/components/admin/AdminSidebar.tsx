"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Users,
  ShoppingBag,
  Settings,
  LogOut,
  ChevronLeft,
  AlertCircle,
  CreditCard,
  Layers,
  Mail,
  MessageSquare,
  Ticket,
  Store,
  FolderOpen,
  ExternalLink,
  PanelLeftClose,
  PanelLeft,
  Star,
  Truck,
  ClipboardList,
  BarChart3,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "next-auth/react";
import { getStoreName } from "@/app/actions/settings";
import { BrandLogo } from "@/components/layout/BrandLogo";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ name: "Dashboard", href: "/admin", icon: LayoutDashboard }],
  },
  {
    label: "Catalog",
    items: [
      { name: "Products", href: "/admin/products", icon: Package },
      { name: "Departments", href: "/admin/departments", icon: Building2 },
      { name: "Brands", href: "/admin/brands", icon: Store },
      { name: "Suppliers", href: "/admin/suppliers", icon: Truck },
      { name: "Supplier Ops", href: "/admin/supplier-ops", icon: BarChart3 },
      { name: "Menus", href: "/admin/menus", icon: Layers },
      { name: "Collections", href: "/admin/collections", icon: FolderOpen },
    ],
  },
  {
    label: "Sales",
    items: [
      { name: "Orders", href: "/admin/orders", icon: ShoppingBag },
      {
        name: "Purchase Orders",
        href: "/admin/purchase-orders",
        icon: ClipboardList,
      },
      { name: "Coupons", href: "/admin/coupons", icon: Ticket },
      { name: "Payments", href: "/admin/transactions", icon: CreditCard },
    ],
  },
  {
    label: "Audience",
    items: [
      { name: "Customers", href: "/admin/customers", icon: Users },
      { name: "Subscribers", href: "/admin/subscribers", icon: Mail },
      { name: "Messages", href: "/admin/queries", icon: MessageSquare },
      { name: "Reviews", href: "/admin/reviews", icon: Star },
    ],
  },
  {
    label: "System",
    items: [{ name: "Settings", href: "/admin/settings", icon: Settings }],
  },
];

interface AdminSidebarProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export function AdminSidebar({ isOpen, setIsOpen }: AdminSidebarProps) {
  const pathname = usePathname();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [storeName, setStoreName] = useState("Linx Square");

  useEffect(() => {
    getStoreName().then(setStoreName);
  }, []);

  const isItemActive = (href: string) =>
    pathname === href ||
    (href !== "/admin" && pathname.startsWith(href));

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 admin-modal-overlay z-40 lg:hidden transition-opacity duration-300",
          isOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        onClick={() => setIsOpen(false)}
      />

      <aside
        className={cn(
          "bg-white border-r border-stone-200 flex flex-col h-screen fixed lg:sticky top-0 z-50 transition-all duration-300 ease-out",
          isCollapsed ? "w-[4.5rem]" : "w-[15.75rem]",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Brand header */}
        <div
          className={cn(
            "shrink-0 border-b border-stone-200",
            isCollapsed ? "p-3" : "p-4",
          )}
        >
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <Link
                href="/admin"
                onClick={() => setIsOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-sm font-serif font-bold text-primary"
                title={storeName}
              >
                {(storeName || "L").charAt(0)}
              </Link>
              <button
                onClick={() => setIsCollapsed(false)}
                className="hidden lg:flex h-7 w-7 items-center justify-center rounded-md border border-stone-200 text-stone-500 hover:bg-stone-50 hover:text-stone-800 transition-colors"
                aria-label="Expand sidebar"
              >
                <PanelLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <Link
                href="/admin"
                onClick={() => setIsOpen(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-serif font-bold text-primary border border-primary/15"
              >
                {(storeName || "L").charAt(0)}
              </Link>

              <div className="min-w-0 flex-1 pt-0.5">
                <Link href="/admin" onClick={() => setIsOpen(false)}>
                  <BrandLogo
                    name={storeName}
                    size="sm"
                    className="block truncate"
                  />
                </Link>
                <p className="mt-1 text-[11px] text-stone-400">
                  Admin console
                </p>
              </div>

              <button
                onClick={() => {
                  if (window.innerWidth < 1024) {
                    setIsOpen(false);
                  } else {
                    setIsCollapsed(true);
                  }
                }}
                className="hidden lg:flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-stone-200 text-stone-400 hover:bg-stone-50 hover:text-stone-700 transition-colors"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => setIsOpen(false)}
                className="lg:hidden flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-stone-200 text-stone-400 hover:bg-stone-50"
                aria-label="Close menu"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto custom-scrollbar overflow-x-hidden bg-[#faf9f7]",
            isCollapsed ? "px-2 py-3" : "px-3 py-4",
          )}
        >
          <div className={cn(isCollapsed ? "space-y-2" : "space-y-5")}>
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                {!isCollapsed && (
                  <p className="px-2.5 mb-1.5 text-[10px] font-semibold text-stone-400 tracking-wide">
                    {group.label}
                  </p>
                )}
                {isCollapsed && group.label !== "Overview" && (
                  <div className="mx-auto mb-2 h-px w-6 bg-stone-200" />
                )}
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isItemActive(item.href);
                    return (
                      <li key={item.name}>
                        <Link
                          href={item.href}
                          onClick={() => setIsOpen(false)}
                          title={isCollapsed ? item.name : undefined}
                          className={cn(
                            "flex items-center rounded-lg transition-colors duration-150",
                            isCollapsed
                              ? "justify-center h-9 w-9 mx-auto"
                              : "gap-2.5 px-2.5 py-2",
                            active
                              ? "bg-white text-stone-900 shadow-sm border border-stone-200/80"
                              : "text-stone-600 hover:bg-white/70 hover:text-stone-900 border border-transparent",
                          )}
                        >
                          <item.icon
                            className={cn(
                              "shrink-0 w-4 h-4 stroke-[1.6]",
                              active
                                ? "text-primary"
                                : "text-stone-400",
                            )}
                          />
                          {!isCollapsed && (
                            <span className="text-[13px] font-medium truncate">
                              {item.name}
                            </span>
                          )}
                          {!isCollapsed && active && (
                            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        {/* Footer actions */}
        <div
          className={cn(
            "shrink-0 border-t border-stone-200 bg-white",
            isCollapsed ? "p-2.5" : "p-3",
          )}
        >
          <div className={cn(isCollapsed ? "space-y-2" : "space-y-2")}>
            <Link
              href="/"
              target="_blank"
              title={isCollapsed ? "View store" : undefined}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border border-stone-200 bg-stone-50 text-stone-700 hover:bg-white hover:border-primary/30 hover:text-stone-900 transition-colors font-medium",
                isCollapsed ? "h-9 w-9 mx-auto p-0" : "w-full h-9 px-3 text-[12px]",
              )}
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0 text-primary" />
              {!isCollapsed && <span>View store</span>}
            </Link>

            <button
              onClick={() => setShowLogoutModal(true)}
              title={isCollapsed ? "Sign out" : undefined}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border border-red-200/80 bg-red-50/50 text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors font-medium w-full",
                isCollapsed ? "h-9 w-9 mx-auto p-0" : "h-9 px-3 text-[12px]",
              )}
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              {!isCollapsed && <span>Sign out</span>}
            </button>
          </div>
        </div>
      </aside>

      {showLogoutModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center admin-modal-overlay px-4">
          <div className="admin-panel-elevated w-full max-w-sm p-5 animate-in fade-in zoom-in duration-300">
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-stone-500" />
              </div>

              <div className="space-y-1">
                <h2 className="text-base font-serif text-stone-800">
                  Sign out?
                </h2>
                <p className="text-xs text-stone-500">
                  You will need to sign in again to access the admin dashboard.
                </p>
              </div>

              <div className="flex flex-col w-full gap-1.5 pt-1">
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="w-full admin-btn-primary"
                >
                  Confirm sign out
                </button>
                <button
                  onClick={() => setShowLogoutModal(false)}
                  className="w-full admin-btn-secondary"
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
