"use client";

import Link from "next/link";
import {
  Instagram,
  Facebook,
  Twitter,
  Phone,
  Mail,
  MessageCircle,
  LifeBuoy,
  MapPin,
} from "lucide-react";
import { getStoreName } from "@/app/actions/settings";
import { useState, useEffect } from "react";
import { NewsletterForm } from "@/components/home/NewsletterForm";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { openSupportChat } from "@/components/support/supportChatBus";
import { COMPANY, COMPANY_MAP_HREF } from "@/lib/company";
import { PaymentMethodTags } from "@/components/common/PaymentMethodTags";

/** Main department nav, mirrored here so the footer's Shop column always
    links to real, populated departments instead of whatever menuTree
    happened to list first (previously surfaced granular items like
    "1 gang switches" / "600x600 Tiles" ahead of the departments themselves). */
const SHOP_DEPARTMENTS = [
  { label: "Home", href: "/" },
  { label: "Flooring", href: "/category?department=flooring" },
  { label: "Tiles", href: "/category?department=tiles" },
  { label: "Wall Panels", href: "/category?department=wall-panels" },
  { label: "Bathrooms", href: "/category?department=bathrooms" },
  { label: "Heating", href: "/category?department=heating" },
  { label: "Electrical", href: "/category?department=electrical" },
  { label: "Rooflights & Glass", href: "/category?department=rooflights-and-glass" },
  { label: "Accessories", href: "/category?department=accessories" },
  { label: "Outdoor Living", href: "/category?department=outdoor-living" },
];

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
            {SHOP_DEPARTMENTS.map((dept) => (
              <li key={dept.href}>
                <Link
                  href={dept.href}
                  className="hover:text-primary transition-colors"
                >
                  {dept.label}
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
                href="/linx-distribution"
                className="hover:text-background transition-colors"
              >
                LINX Square Distribution
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
            <li>
              <a
                href={COMPANY_MAP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 hover:text-primary transition-colors"
              >
                <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  {COMPANY.address.line1}
                  <br />
                  {COMPANY.address.city} {COMPANY.address.postcode}
                </span>
              </a>
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
            {/* Help routes alongside the existing phone/email details. */}
            <li>
              <button
                type="button"
                onClick={() => openSupportChat()}
                className="flex items-center gap-3 hover:text-primary transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                Live chat
              </button>
            </li>
            <li>
              <Link
                href="/help"
                className="flex items-center gap-3 hover:text-primary transition-colors"
              >
                <LifeBuoy className="w-4 h-4" />
                Help &amp; Support
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
        {/* Registered particulars — a UK limited company must show its
            registered name, number and office address on its website. */}
        <div className="space-y-1.5 text-center md:text-left">
          <p>
            © {new Date().getFullYear()} {storeName.toUpperCase()}. ALL RIGHTS
            RESERVED.
          </p>
          <p className="normal-case tracking-normal text-[10px] opacity-70">
            {COMPANY.legalName} · Registered in {COMPANY.address.country} no.{" "}
            {COMPANY.number} · Registered office: {COMPANY.address.line1},{" "}
            {COMPANY.address.city}, {COMPANY.address.postcode}
          </p>
        </div>
        <PaymentMethodTags className="justify-center" />
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms & Conditions</Link>
          <Link href="/cookies">Cookies</Link>
        </div>
      </div>
    </footer>
  );
}
