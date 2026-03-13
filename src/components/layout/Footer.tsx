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

export function Footer() {
  const [storeName, setStoreName] = useState("Linx Living");

  useEffect(() => {
    getStoreName().then(setStoreName);
  }, []);

  const CATEGORIES = [
    { name: "Stone Baths", href: "/baths" },
    { name: "Vanity Units", href: "/vanity-units" },
    { name: "Accessories", href: "/accessories" },
    { name: "New Arrivals", href: "/new-arrivals" },
    { name: "Explore", href: "/collections" },
  ];

  return (
    <footer className="bg-[hsl(var(--dark-section))] text-[hsl(var(--dark-foreground))] pt-20 pb-10 px-6 lg:px-20 border-t border-white/5">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-24 mb-20">
        <div className="space-y-6">
          <div className="relative w-40 h-16">
            <img
              src="/logo.png"
              alt={storeName}
              className="w-full h-full object-contain filter brightness-0 invert"
            />
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
            Specializing in designing and creating exquisite bathrooms and
            luxury tiles for those who value timeless elegance.
          </p>
          <div className="flex gap-4">
            <Instagram className="w-5 h-5 cursor-pointer hover:text-accent transition-colors" />
            <Facebook className="w-5 h-5 cursor-pointer hover:text-accent transition-colors" />
            <Twitter className="w-5 h-5 cursor-pointer hover:text-accent transition-colors" />
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-widest">
            Collections
          </h3>
          <ul className="space-y-4 text-sm text-muted-foreground">
            {CATEGORIES.map((category) => (
              <li key={category.name}>
                <Link
                  href={category.href}
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
            Client Service
          </h3>
          <ul className="space-y-4 text-sm text-muted-foreground">
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
                href="/shipping-returns"
                className="hover:text-background transition-colors"
              >
                Shipping & Returns
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
            <li>
              <Link
                href="/faq"
                className="hover:text-background transition-colors"
              >
                FAQ
              </Link>
            </li>
          </ul>
        </div>

        <div className="space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-widest">Store</h3>
          <ul className="space-y-4 text-sm text-muted-foreground">
            <li className="flex items-center gap-3">
              <MapPin className="w-4 h-4" /> 123 Luxury Lane, Beverly Hills, CA
            </li>
            <li className="flex items-center gap-3">
              <Phone className="w-4 h-4" /> 1-800-
              {storeName.toUpperCase().replace(/\s+/g, "-")}
            </li>
            <Link
              className="flex items-center gap-3"
              href="mailto:info@linxliving.co.uk"
            >
              <Mail className="w-4 h-4" />
              info@linxliving.co.uk
            </Link>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 pt-10 flex flex-col md:flex-row justify-between items-center gap-6 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
        <p>
          © {new Date().getFullYear()} {storeName.toUpperCase()}. ALL RIGHTS
          RESERVED.
        </p>
        <div className="flex gap-8">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms & Conditions</Link>
          <Link href="/cookies">Cookies</Link>
        </div>
      </div>
    </footer>
  );
}
