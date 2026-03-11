"use client";

import Link from "next/link";
import {
  Search,
  ShoppingBag,
  User,
  Menu,
  Phone,
  MessageSquare,
  X,
  Heart,
  LogOut,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/store/useCartStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import ConfirmationModal from "@/components/common/ConfirmationModal";
import { getStoreName } from "@/app/actions/settings";
import { SearchBar } from "./SearchBar";

const CATEGORIES = [
  { name: "Stone Baths", href: "/baths" },
  { name: "Vanity Units", href: "/vanity-units" },
  { name: "Basins", href: "/basins" },
  { name: "Mirrors", href: "/mirrors" },
  { name: "Accessories", href: "/accessories" },
  { name: "New Arrivals", href: "/new-arrivals" },
  { name: "Explore", href: "/collections" },
];

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isIncVat, setIsIncVat] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { getTotalItems } = useCartStore();
  const { items: wishlistItems } = useWishlistStore();
  const [mounted, setMounted] = useState(false);
  const { data: session, status } = useSession();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [storeName, setStoreName] = useState("Linx Living");

  useEffect(() => {
    getStoreName().then((name) => setStoreName(name));
    // ...
    setMounted(true);
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className="fixed top-0 w-full z-50 transition-all duration-500">
      {/* Top Bar - Hidden on Mobile */}
      <div
        className={cn(
          "hidden md:flex bg-[hsl(var(--dark-section))] text-[hsl(var(--dark-foreground))] border-b border-white/5 py-3 px-6 lg:px-20 justify-between items-center transition-all duration-500 overflow-hidden",
          isScrolled ? "h-0 py-0 border-none" : "h-10",
        )}
      >
        <div className="flex items-center gap-6 text-[11px] uppercase tracking-[0.2em] font-bold">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4" />
            <span>1-800-{storeName.toUpperCase().replace(/\s+/g, "-")}</span>
          </div>
        </div>

        <div className="flex items-center gap-6 text-[11px] uppercase tracking-[0.2em] font-bold">
          <span className="hidden md:inline opacity-90 italic lowercase">
            Need help with a project?
          </span>
          <Link
            href="#"
            className="border-b border-foreground/20 hover:border-foreground pb-0.5 transition-colors"
          >
            WhatsApp our team
          </Link>
          <span className="opacity-90">|</span>
          <Link
            href="#"
            className="border-b border-foreground/20 hover:border-foreground pb-0.5 transition-colors"
          >
            Call Us
          </Link>
        </div>

        {/* <div className="flex items-center gap-4 text-[9px] uppercase tracking-[0.2em] font-bold">
          <div className="flex items-center gap-1 bg-secondary/50 rounded-full p-0.5 border border-foreground/5">
            <button
              onClick={() => setIsIncVat(true)}
              className={cn(
                "px-2 py-1 rounded-full transition-all",
                isIncVat
                  ? "bg-foreground text-background"
                  : "opacity-80 hover:opacity-800",
              )}
            >
              Inc Tax
            </button>
            <button
              onClick={() => setIsIncVat(false)}
              className={cn(
                "px-2 py-1 rounded-full transition-all",
                !isIncVat
                  ? "bg-foreground text-background"
                  : "opacity-80 hover:opacity-800",
              )}
            >
              Ex Tax
            </button>
          </div>
        </div> */}
      </div>

      {/* Main Nav */}
      <nav
        className={cn(
          "w-full transition-all duration-500 px-6 lg:px-20 py-4 lg:py-6 border-b",
          isScrolled
            ? "bg-background backdrop-blur-md border-foreground/10"
            : "bg-background backdrop-blur-sm border-foreground/5",
        )}
      >
        <div className="max-w-[1920px] mx-auto flex items-center justify-between lg:grid lg:grid-cols-3">
          {/* Left: Mobile Menu Toggle / Desktop Search */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 hover:opacity-90 transition-opacity"
            >
              <Menu className="w-6 h-6 stroke-[1.5]" />
            </button>

            <div className="hidden lg:block w-72">
              <SearchBar />
            </div>
          </div>

          {/* Center: Logo */}
          <Link href="/" className="lg:justify-self-center text-center">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-serif tracking-[0.25em] uppercase pl-[0.25em] text-primary">
              {storeName}
            </h1>
          </Link>

          {/* Right: Icons */}
          <div className="flex items-center gap-3 justify-self-end">
            <Link
              href={
                status === "authenticated"
                  ? (session?.user as any)?.role === "admin"
                    ? "/admin"
                    : "/profile"
                  : "/login"
              }
              className="hidden sm:block hover:opacity-90 transition-opacity"
            >
              <User className={cn("w-6 h-6 stroke-[1.5]")} />
            </Link>
            {status === "authenticated" && (
              <button
                onClick={() => setShowLogoutModal(true)}
                className="hidden md:block text-white md:px-4 md:py-2.5 rounded-[5px] text-[9px] uppercase tracking-widest font-bold opacity-100 bg-black hover:bg-gray-700 transition-colors"
              >
                Logout
              </button>
            )}
            <Link
              href="/wishlist"
              className="relative hover:opacity-90 transition-opacity p-2"
            >
              <Heart className="w-6 h-6 stroke-[1.5]" />
              {mounted && wishlistItems.length > 0 && (
                <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[8px] w-4 h-4 flex items-center justify-center font-bold rounded-full">
                  {wishlistItems.length}
                </span>
              )}
            </Link>
            <Link
              href="/cart"
              className="relative hover:text-primary transition-all p-2"
            >
              <ShoppingBag className="w-6 h-6 stroke-[1.5]" />
              {mounted && getTotalItems() > 0 && (
                <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[8px] w-4 h-4 flex items-center justify-center font-bold rounded-full">
                  {getTotalItems()}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* Desktop Category Nav */}
        <div className="hidden lg:flex pt-8 justify-center gap-10">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.name}
              href={cat.href}
              className="text-[11px] uppercase tracking-[0.3em] font-bold hover:opacity-80 transition-opacity luxury-underline"
            >
              {cat.name}
            </Link>
          ))}
        </div>
      </nav>

      {/* Mobile Side Menu */}
      <div
        className={cn(
          "fixed inset-0 z-100 lg:hidden transition-all duration-700",
          isMenuOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        {/* Backdrop */}
        <div
          className={cn(
            "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-700",
            isMenuOpen ? "opacity-800" : "opacity-0",
          )}
          onClick={() => setIsMenuOpen(false)}
        />

        {/* Drawer */}
        <div
          className={cn(
            "absolute top-0 left-0 w-[85%] max-w-sm h-full bg-background shadow-2xl transition-transform duration-700 ease-out flex flex-col",
            isMenuOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="p-8 border-b border-foreground/5 flex justify-between items-center">
            <h2 className="text-xl font-serif tracking-widest uppercase">
              Menu
            </h2>
            <button onClick={() => setIsMenuOpen(false)}>
              <X className="w-6 h-6 stroke-1" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* Mobile Search */}
            <div className="p-8 border-b border-foreground/5">
              <SearchBar isMobile={true} onClose={() => setIsMenuOpen(false)} />
            </div>

            {/* Categories */}
            <div className="p-8 py-10 space-y-8">
              {CATEGORIES.map((cat) => (
                <Link
                  key={cat.name}
                  href={cat.href}
                  onClick={() => setIsMenuOpen(false)}
                  className="block text-xl tracking-tight uppercase hover:pl-2 transition-all duration-300"
                >
                  {cat.name}
                </Link>
              ))}
            </div>

            {/* Account & Support */}
            <div className="p-8 space-y-6 bg-secondary/30">
              {status === "authenticated" ? (
                <>
                  <Link
                    href={
                      (session?.user as any)?.role === "admin"
                        ? "/admin"
                        : "/profile"
                    }
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-4 text-xs uppercase tracking-widest font-bold"
                  >
                    <User className="w-4 h-4" />
                    Welcome, {session?.user?.name || "User"}
                  </Link>
                  {/* <button
                onClick={() => setShowLogoutModal(true)}
                className="hidden md:block text-white md:px-4 md:py-2.5 rounded-[5px] text-[9px] uppercase tracking-widest font-bold opacity-100 bg-black hover:bg-gray-700 transition-colors"
              >
                Logout
              </button> */}
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      setShowLogoutModal(true);
                    }}
                    className="flex  items-center gap-4 bg-black text-xs uppercase tracking-widest font-bold text-white hover:text-gray-700 transition-colors px-9 py-2.5 rounded-[5px] "
                  >
                    Logout
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-4 text-xs uppercase tracking-widest font-bold"
                >
                  <User className="w-4 h-4" />
                  Sign In / Register
                </Link>
              )}

              <Link
                href="/wishlist"
                onClick={() => setIsMenuOpen(false)}
                className="flex items-center gap-4 text-xs uppercase tracking-widest font-bold"
              >
                <div className="relative">
                  <Heart className="w-4 h-4" />
                  {mounted && wishlistItems.length > 0 && (
                    <span className="absolute -top-2 -right-2 bg-foreground text-background text-[8px] w-4 h-4 flex items-center justify-center font-bold rounded-full">
                      {wishlistItems.length}
                    </span>
                  )}
                </div>
                Wishlist
              </Link>

              <Link
                href="/cart"
                onClick={() => setIsMenuOpen(false)}
                className="flex items-center gap-4 text-xs uppercase tracking-widest font-bold"
              >
                <div className="relative">
                  <ShoppingBag className="w-4 h-4" />
                  {mounted && getTotalItems() > 0 && (
                    <span className="absolute -top-2 -right-2 bg-foreground text-background text-[8px] w-4 h-4 flex items-center justify-center font-bold rounded-full">
                      {getTotalItems()}
                    </span>
                  )}
                </div>
                Cart
              </Link>
              {/* <div className="flex items-center gap-1 bg-background/50 rounded-full p-1 border border-foreground/5 w-fit">
                <button
                  onClick={() => setIsIncVat(true)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest transition-all",
                    isIncVat ? "bg-foreground text-background" : "opacity-80",
                  )}
                >
                  Inc Tax
                </button>
                <button
                  onClick={() => setIsIncVat(false)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest transition-all",
                    !isIncVat ? "bg-foreground text-background" : "opacity-80",
                  )}
                >
                  Ex Tax
                </button>
              </div> */}
            </div>
          </div>

          <div className="p-8 border-t border-foreground/5 bg-secondary/50">
            <div className="space-y-4">
              <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80">
                Client Service
              </p>
              <a
                href={`tel:1800${storeName.toUpperCase().replace(/[^A-Z0-9]/g, "")}`}
                className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
              >
                <Phone className="w-4 h-4" /> 1-800-
                {storeName.toUpperCase().replace(/\s+/g, "-")}
              </a>
              <a
                href="#"
                className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
              >
                <MessageSquare className="w-4 h-4" /> WhatsApp
              </a>
            </div>
          </div>
        </div>
      </div>
      <ConfirmationModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={() => signOut()}
        title="Sign Out"
        isDangerous={true}
        message="Are you sure you wish to exit your current session? You will need to re-authenticate to access your private acquisitions."
        confirmLabel="Exit Session"
      />
    </header>
  );
}
