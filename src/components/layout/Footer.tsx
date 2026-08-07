"use client";

import Link from "next/link";
import {
  Instagram,
  Facebook,
  Twitter,
  Phone,
  Mail,
  MapPin,
} from "lucide-react";
import { getStoreName } from "@/app/actions/settings";
import { useState, useEffect } from "react";
import { NewsletterForm } from "@/components/home/NewsletterForm";
import { BrandLogo } from "@/components/layout/BrandLogo";

export function Footer({
  initialStoreName,
  initialMenuTree,
}: {
  initialStoreName?: string;
  initialMenuTree?: any[];
} = {}) {
  const [storeName, setStoreName] = useState(
    initialStoreName || "Linx Square",
  );
  const [menuTree, setMenuTree] = useState<any[]>(initialMenuTree || []);

  useEffect(() => {
    if (initialStoreName) setStoreName(initialStoreName);
    if (initialMenuTree?.length) setMenuTree(initialMenuTree);
  }, [initialStoreName, initialMenuTree]);

  useEffect(() => {
    // Skip network when server already provided data
    if (initialStoreName && initialMenuTree?.length) return;

    let cancelled = false;

    if (!initialStoreName) {
      getStoreName().then((name) => {
        if (!cancelled) setStoreName(name);
      });
    }

    if (!initialMenuTree?.length) {
      const fetchMenus = async () => {
        try {
          const { getMenuTree } = await import("@/app/actions/admin");
          const result = await getMenuTree();
          if (!cancelled && result.success) {
            setMenuTree(result.tree);
          }
        } catch (error) {
          console.error("Failed to fetch menu tree:", error);
        }
      };
      fetchMenus();
    }

    return () => {
      cancelled = true;
    };
  }, [initialStoreName, initialMenuTree]);

  return (
    <footer className="bg-[hsl(var(--dark-section))] text-[hsl(var(--dark-foreground))] pt-12 sm:pt-16 md:pt-20 pb-10 border-t border-white/5">
      <div className="site-container grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-10 lg:gap-24 mb-12 sm:mb-16 md:mb-20">
        <div className="space-y-6">
          <BrandLogo name={storeName} variant="light" size="lg" />
          <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
            Specializing in designing and creating exquisite bathrooms and
            luxury tiles for those who value timeless elegance.
          </p>
          {/* <div className="flex gap-4">
            <Instagram className="w-5 h-5 cursor-pointer hover:text-accent transition-colors" />
            <Facebook className="w-5 h-5 cursor-pointer hover:text-accent transition-colors" />
            <Twitter className="w-5 h-5 cursor-pointer hover:text-accent transition-colors" />
          </div> */}
        </div>

        <div className="space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-widest">
            Shop
          </h3>
          <ul className="space-y-4 text-sm text-muted-foreground">
            {menuTree.slice(0, 5).map((category) => (
              <li key={category._id}>
                <Link
                  href={`/category/${category.slug}`}
                  className="hover:text-primary transition-colors"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-widest">
            About
          </h3>
          <ul className="space-y-4 text-sm text-muted-foreground">
            <li>
              <Link
                href="/contact"
                className="hover:text-background transition-colors"
              >
                About Us
              </Link>
            </li>
            <li>
              <Link
                href="/contact"
                className="hover:text-background transition-colors"
              >
                Contact Us
              </Link>
            </li>
            <li>
              <Link
                href="/track-order"
                className="hover:text-background transition-colors"
              >
                Track Order
              </Link>
            </li>
            <li>
              <Link
                href="/shipping-returns"
                className="hover:text-background transition-colors"
              >
                Shipping & Returns
              </Link>
            </li>
            <li>
              <Link
                href="/faq"
                className="hover:text-background transition-colors"
              >
                Buying Guides / FAQ
              </Link>
            </li>
            <li>
              <Link
                href="/custom"
                className="hover:text-background transition-colors"
              >
                Custom Design
              </Link>
            </li>
          </ul>
        </div>

        <div className="space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-widest">Store</h3>
          <ul className="space-y-4 text-sm text-muted-foreground">
            <li className="flex items-center gap-3">
              <MapPin className="w-4 h-4" /> 189 Brampton Road
            </li>
            <li className="flex items-center gap-3">
              <Phone className="w-4 h-4" />
              <Link
                href="tel:02046342203"
                className="hover:text-primary transition-colors"
              >
                020 4634 2203
              </Link>
            </li>
            <li>
              <Link
                className="flex items-center gap-3 hover:text-primary transition-colors"
                href="mailto:info@linxsquare.co.uk"
              >
                <Mail className="w-4 h-4" />
                info@linxsquare.co.uk
              </Link>
            </li>
          </ul>
          <div className="pt-2 space-y-3">
            <p className="text-[10px] uppercase tracking-[0.25em] font-bold text-primary">
              Newsletter
            </p>
            <NewsletterForm variant="footer" />
          </div>
        </div>
      </div>

      <div className="site-container border-t border-white/10 pt-10 flex flex-col md:flex-row justify-between items-center gap-6 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
        <p>
          © {new Date().getFullYear()} {storeName.toUpperCase()}. ALL RIGHTS
          RESERVED.
        </p>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms & Conditions</Link>
          <Link href="/cookies">Cookies</Link>
        </div>
      </div>
    </footer>
  );
}
