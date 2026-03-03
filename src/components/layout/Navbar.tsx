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
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/store/useCartStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import ConfirmationModal from "@/components/common/ConfirmationModal";

const CATEGORIES = [
  { name: "Stone Baths", href: "/baths" },
  { name: "Vanity Units", href: "/vanity-units" },
  { name: "Basins", href: "/basins" },
  { name: "Mirrors", href: "/mirrors" },
  { name: "Accessories", href: "/accessories" },
  { name: "New Arrivals", href: "/tiles" },
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

  useEffect(() => {
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
          "hidden md:flex bg-background border-b border-foreground/5 py-3 px-6 lg:px-20 justify-between items-center transition-all duration-500 overflow-hidden",
          isScrolled ? "h-0 py-0 border-none" : "h-10",
        )}
      >
        <div className="flex items-center gap-6 text-[11px] uppercase tracking-[0.2em] font-bold">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4" />
            <span>1-800-LINX-LIVING</span>
          </div>
        </div>

        <div className="flex items-center gap-6 text-[11px] uppercase tracking-[0.2em] font-bold">
          <span className="hidden md:inline opacity-60 italic lowercase">
            Need help with a project?
          </span>
          <Link
            href="#"
            className="border-b border-foreground/20 hover:border-foreground pb-0.5 transition-colors"
          >
            WhatsApp our team
          </Link>
          <span className="opacity-20">|</span>
          <Link
            href="#"
            className="border-b border-foreground/20 hover:border-foreground pb-0.5 transition-colors"
          >
            Call Us
          </Link>
        </div>

        <div className="flex items-center gap-4 text-[9px] uppercase tracking-[0.2em] font-bold">
          <div className="flex items-center gap-1 bg-secondary/50 rounded-full p-0.5 border border-foreground/5">
            <button
              onClick={() => setIsIncVat(true)}
              className={cn(
                "px-2 py-1 rounded-full transition-all",
                isIncVat
                  ? "bg-foreground text-background"
                  : "opacity-40 hover:opacity-100",
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
                  : "opacity-40 hover:opacity-100",
              )}
            >
              Ex Tax
            </button>
          </div>
        </div>
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
              className="lg:hidden p-2 -ml-2 hover:opacity-60 transition-opacity"
            >
              <Menu className="w-6 h-6 stroke-[1.5]" />
            </button>

            <div className="hidden lg:flex items-center group max-w-xs lg:w-xs">
              <div className="relative w-full">
                <input
                  type="text"
                  placeholder="What are you looking for?"
                  className="w-full bg-white px-4 py-2.5 pl-10 text-[10px] uppercase tracking-[0.2em] transition-all placeholder:text-foreground placeholder:opacity-60"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40 group-focus-within:opacity-100 transition-opacity" />
              </div>
            </div>
          </div>

          {/* Center: Logo */}
          <Link href="/" className="lg:justify-self-center text-center">
            <h1 className="text-xl md:text-2xl lg:text-3xl font-serif tracking-[0.25em] uppercase pl-[0.25em]">
              Linx Living
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
              className="hidden sm:block hover:opacity-60 transition-opacity"
            >
              <User className={cn("w-6 h-6 stroke-[1.5]")} />
            </Link>
            {status === "authenticated" && (
              <button
                onClick={() => setShowLogoutModal(true)}
                className="hidden lg:block text-[9px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity"
              >
                Sign Out / Exit
              </button>
            )}
            <Link
              href="/wishlist"
              className="relative hover:opacity-60 transition-opacity p-2"
            >
              <Heart className="w-6 h-6 stroke-[1.5]" />
              {mounted && wishlistItems.length > 0 && (
                <span className="absolute top-1 right-1 bg-foreground text-background text-[8px] w-4 h-4 flex items-center justify-center font-bold rounded-full">
                  {wishlistItems.length}
                </span>
              )}
            </Link>
            <Link
              href="/cart"
              className="relative hover:opacity-60 transition-opacity p-2"
            >
              <ShoppingBag className="w-6 h-6 stroke-[1.5]" />
              {mounted && getTotalItems() > 0 && (
                <span className="absolute top-1 right-1 bg-foreground text-background text-[8px] w-4 h-4 flex items-center justify-center font-bold rounded-full">
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
              className="text-[11px] uppercase tracking-[0.3em] font-bold hover:opacity-40 transition-opacity luxury-underline"
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
            isMenuOpen ? "opacity-100" : "opacity-0",
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
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search our collections"
                  className="w-full bg-white px-4 py-3 pl-10 text-xs uppercase tracking-widest transition-colors"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
              </div>
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
              <Link
                href="/login"
                className="flex items-center gap-4 text-xs uppercase tracking-widest font-bold"
              >
                <User className="w-4 h-4" />
                Sign In / Register
              </Link>
              <div className="flex items-center gap-1 bg-background/50 rounded-full p-1 border border-foreground/5 w-fit">
                <button
                  onClick={() => setIsIncVat(true)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest transition-all",
                    isIncVat ? "bg-foreground text-background" : "opacity-40",
                  )}
                >
                  Inc Tax
                </button>
                <button
                  onClick={() => setIsIncVat(false)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest transition-all",
                    !isIncVat ? "bg-foreground text-background" : "opacity-40",
                  )}
                >
                  Ex Tax
                </button>
              </div>
            </div>
          </div>

          <div className="p-8 border-t border-foreground/5 bg-secondary/50">
            <div className="space-y-4">
              <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40">
                Client Service
              </p>
              <a
                href="tel:1800LINXLIVING"
                className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest hover:opacity-60 transition-opacity"
              >
                <Phone className="w-4 h-4" /> 1-800-LINX-LIVING
              </a>
              <a
                href="#"
                className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest hover:opacity-60 transition-opacity"
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
